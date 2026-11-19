import os, csv, json, uuid, re, sys, subprocess
from datetime import datetime, timezone
from pathlib import Path
from flask import Blueprint, request, jsonify, Response
from werkzeug.utils import secure_filename
from .storage import Storage
from .services.sentiment import clean_text, classify
from .services import hadoop
from .services.collectors import reddit_search, youtube_search

api = Blueprint("api", __name__)
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads")).resolve()
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

def err(message, code=400):
    return jsonify(error=str(message)), code

@api.get("/health")
def health():
    return jsonify(
        status="ok",
        database="Firebase Realtime Database (NoSQL)",
        service="SentimentX Big Data API"
    )

@api.get("/dashboard/summary")
def summary():
    return jsonify(Storage.get_summary())

@api.get("/dashboard/trends")
def trends():
    posts = Storage.get_all_posts()
    grouped = {}
    for p in posts:
        dt_str = p.get("created_at") or p.get("processed_at") or datetime.now(timezone.utc).isoformat()
        day = dt_str[:10]
        grouped.setdefault(day, {"date": day, "positive": 0, "negative": 0, "neutral": 0})
        sent = p.get("sentiment")
        if sent in ("positive", "negative", "neutral"):
            grouped[day][sent] += 1
    return jsonify(list(sorted(grouped.values(), key=lambda x: x["date"])))

@api.post("/datasets/upload")
def upload():
    f = request.files.get("file")
    if not f or not f.filename:
        return err("Please select a valid CSV or JSON file.")
    name = secure_filename(f.filename)
    if not name.lower().endswith((".csv", ".json")):
        return err("Only CSV and JSON files are supported.")
    
    path = UPLOAD_DIR / f"{uuid.uuid4().hex}_{name}"
    f.save(path)
    try:
        if name.lower().endswith(".csv"):
            with path.open(encoding="utf-8-sig", newline="") as fh:
                records = list(csv.DictReader(fh))
        else:
            data = json.loads(path.read_text(encoding="utf-8"))
            records = data if isinstance(data, list) else data.get("posts", [])
        
        if not records:
            raise ValueError("Dataset is empty. No records found.")
        
        ds = Storage.add_dataset(name=name, source="upload", status="uploaded", row_count=len(records))
        posts = Storage.add_posts(ds["id"], records)
        
        return jsonify(
            id=ds["id"],
            name=ds["name"],
            row_count=ds["row_count"],
            status=ds["status"],
            posts=posts[:200]
        ), 201
    except Exception as e:
        path.unlink(missing_ok=True)
        return err(e)

@api.get("/datasets")
def datasets():
    return jsonify(Storage.list_datasets())

@api.post("/preprocessing/<int:dataset_id>")
def preprocess(dataset_id):
    ds = Storage.get_dataset(dataset_id)
    if not ds:
        return err("Dataset not found", 404)
    posts = Storage.get_posts_by_dataset(dataset_id)
    for p in posts:
        p["text"] = clean_text(p["text"])
    ds["status"] = "preprocessed"
    return jsonify(dataset_id=ds["id"], processed=len(posts), status=ds["status"])

@api.get("/hdfs/status")
def hdfs_status():
    try:
        return jsonify(hadoop.hdfs_status())
    except Exception as e:
        return jsonify(connected=False, error=str(e)), 503

@api.get("/hdfs/files")
def hdfs_files():
    path = request.args.get("path", os.getenv("HDFS_BASE_PATH", "/sentimentx"))
    try:
        return jsonify(path=path, listing=hadoop.list_files(path))
    except Exception as e:
        return err(e, 503)

@api.post("/collection/reddit")
def collect_reddit():
    body = request.get_json(silent=True) or {}
    try:
        records = reddit_search(body.get("query", ""), body.get("limit", 50))
    except Exception as e:
        return err(e, 502)
    return save_collected(records, "reddit")

@api.post("/collection/youtube")
def collect_youtube():
    body = request.get_json(silent=True) or {}
    try:
        records = youtube_search(body.get("query", ""), body.get("limit", 25))
    except Exception as e:
        return err(e, 502)
    return save_collected(records, "youtube")

def save_collected(records, source):
    if not records:
        return err("No records returned by the API.", 404)
    name = f"{source}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    ds = Storage.add_dataset(name=name, source=source, status="collected", row_count=len(records))
    posts = Storage.add_posts(ds["id"], records)
    return jsonify(dataset_id=ds["id"], source=source, collected=len(records), posts=posts[:200]), 201

@api.post("/mapreduce/submit")
def submit_job():
    body = request.get_json(silent=True) or {}
    ds_id = body.get("dataset_id")
    ds = Storage.get_dataset(ds_id)
    if not ds:
        # Check if posts were sent directly in the payload
        raw_posts = body.get("posts", [])
        if raw_posts:
            ds = Storage.add_dataset(name=f"dataset_{ds_id or 'rtdb'}", source="rtdb", row_count=len(raw_posts))
            Storage.add_posts(ds["id"], raw_posts)
            ds_id = ds["id"]
        else:
            return err("Valid dataset_id is required.")
    
    posts = Storage.get_posts_by_dataset(ds_id)
    if not posts:
        return err("Dataset contains no posts.")
    
    local = UPLOAD_DIR / f"dataset_{ds_id}.jsonl"
    with local.open("w", encoding="utf-8") as fh:
        for p in posts:
            fh.write(json.dumps({"text": p["text"]}, ensure_ascii=False) + "\n")
    
    base = os.getenv("HDFS_BASE_PATH", "/sentimentx")
    input_path = f"{base}/input/dataset_{ds_id}_{uuid.uuid4().hex[:8]}.jsonl"
    output_path = f"{base}/output/job_{uuid.uuid4().hex}"
    job = Storage.add_job(dataset_id=ds_id, input_path=input_path, output_path=output_path)
    
    try:
        backend_root = Path(__file__).resolve().parents[1]
        mapper = str(backend_root / "hadoop" / "mapper.py")
        reducer = str(backend_root / "hadoop" / "reducer.py")
        
        if os.getenv("HADOOP_ENABLED", "false").lower() == "true":
            hadoop.put_file(str(local), input_path)
            log = hadoop.submit_streaming(input_path, output_path, mapper, reducer)
            _, hdfs, _ = hadoop._config()
            raw = hadoop.run_cmd([hdfs, "dfs", "-cat", f"{output_path}/part-*"])
            mode = "real_hadoop"
        else:
            # Standalone Local MapReduce emulation (Map -> Shuffle/Sort -> Reduce)
            python_bin = sys.executable
            
            # Phase 1: Mapper
            with local.open("rb") as infile:
                map_res = subprocess.run([python_bin, mapper], stdin=infile, capture_output=True, text=True, check=False)
            if map_res.returncode != 0 and not map_res.stdout:
                raise RuntimeError(f"Mapper error: {map_res.stderr}")
            
            # Phase 2: Hadoop Shuffle & Sort
            raw_lines = [l for l in map_res.stdout.splitlines() if l.strip()]
            raw_lines.sort()
            sorted_map = "\n".join(raw_lines) + ("\n" if raw_lines else "")
            
            # Phase 3: Reducer
            red_res = subprocess.run([python_bin, reducer], input=sorted_map, capture_output=True, text=True, check=False)
            if red_res.returncode != 0 and not red_res.stdout:
                raise RuntimeError(f"Reducer error: {red_res.stderr}")
            
            raw = red_res.stdout
            log = (
                f"=== MapReduce Execution Log ===\n"
                f"Mode: Local Standalone Streaming (No SQL)\n"
                f"Database: Firebase Realtime Database\n"
                f"Input Dataset ID: {ds_id} ({len(posts)} posts)\n"
                f"Mapper: {mapper}\n"
                f"Reducer: {reducer}\n"
                f"Mapper Output Lines: {len(raw_lines)}\n"
                f"Shuffle & Sort: Completed successfully\n"
                f"Reducer Aggregation Output:\n{raw}\n"
                f"Job Status: SUCCEEDED"
            )
            mode = "simulated_hadoop"

        totals = {"positive": 0, "negative": 0, "neutral": 0}
        for line in raw.splitlines():
            parts = line.split("\t")
            if len(parts) == 2 and parts[0] in totals:
                try:
                    totals[parts[0]] = int(parts[1])
                except ValueError:
                    pass
        
        # Classify posts
        classified_map = {}
        classified_list = []
        for p in posts:
            sent, score = classify(p["text"])
            classified_map[p["id"]] = {"sentiment": sent, "score": score}
            p["sentiment"] = sent
            p["score"] = score
            p["processed_at"] = datetime.now(timezone.utc).isoformat()
            classified_list.append(p)
        
        Storage.update_post_sentiments(ds_id, classified_map)
        Storage.update_job(
            job_id=job["id"],
            status="succeeded",
            positive=totals["positive"],
            negative=totals["negative"],
            neutral=totals["neutral"],
            log=log
        )
        
        return jsonify(
            job_id=job["id"],
            status="succeeded",
            mode=mode,
            **totals,
            total=sum(totals.values()),
            classified_posts=classified_list[:200]
        ), 201
    except Exception as e:
        Storage.update_job(
            job_id=job["id"],
            status="failed",
            positive=0,
            negative=0,
            neutral=0,
            log=str(e)
        )
        return err({"job_id": job["id"], "status": "failed", "details": str(e)}, 502)

@api.get("/mapreduce/jobs")
def jobs():
    return jsonify(Storage.list_jobs())

@api.get("/sentiment/results")
def results():
    posts = Storage.get_all_posts()
    sentiment = request.args.get("sentiment")
    if sentiment in ("positive", "negative", "neutral"):
        posts = [p for p in posts if p.get("sentiment") == sentiment]
    search = request.args.get("q")
    if search:
        search_lower = search.lower()
        posts = [p for p in posts if search_lower in p.get("text", "").lower()]
    return jsonify(posts[:500])

@api.get("/reports/export.csv")
def export_csv():
    rows = Storage.get_all_posts()
    def generate():
        yield "id,platform,text,sentiment,score,dataset_id\n"
        import io
        for p in rows:
            buf = io.StringIO()
            csv.writer(buf).writerow([
                p.get("id"),
                p.get("platform"),
                p.get("text"),
                p.get("sentiment"),
                p.get("score"),
                p.get("dataset_id")
            ])
            yield buf.getvalue()
    return Response(
        generate(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=sentimentx-report.csv"}
    )
