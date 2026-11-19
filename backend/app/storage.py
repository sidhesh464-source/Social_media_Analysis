"""
In-Memory & JSON Data Store for SentimentX (No SQL).
Stores datasets, posts, and MapReduce jobs in-memory with optional Firebase Realtime Database sync.
"""
import os, time, uuid, json, requests
from datetime import datetime, timezone
from pathlib import Path

DATASETS = {}
POSTS = {}
JOBS = []

RTDB_URL = os.getenv("FIREBASE_DATABASE_URL", "").rstrip("/")

def rtdb_put(path, data):
    """Optionally sync data to Firebase Realtime Database via REST if configured."""
    if not RTDB_URL:
        return
    try:
        url = f"{RTDB_URL}/{path.lstrip('/')}.json"
        requests.put(url, json=data, timeout=3)
    except Exception as e:
        print(f"[RTDB Sync Warning] {e}")

class Storage:
    @staticmethod
    def add_dataset(name, source="upload", status="uploaded", row_count=0):
        ds_id = len(DATASETS) + 1
        record = {
            "id": ds_id,
            "name": name,
            "source": source,
            "status": status,
            "row_count": row_count,
            "hdfs_path": None,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        DATASETS[ds_id] = record
        rtdb_put(f"datasets/{ds_id}", record)
        return record

    @staticmethod
    def get_dataset(ds_id):
        return DATASETS.get(int(ds_id))

    @staticmethod
    def list_datasets():
        return list(sorted(DATASETS.values(), key=lambda x: x["id"], reverse=True))

    @staticmethod
    def add_posts(ds_id, post_items):
        ds_id = int(ds_id)
        if ds_id not in POSTS:
            POSTS[ds_id] = []
        
        created = []
        for item in post_items:
            post_id = len(created) + len(POSTS[ds_id]) + 1
            p = {
                "id": post_id,
                "dataset_id": ds_id,
                "platform": item.get("platform", "upload"),
                "external_id": str(item.get("external_id") or item.get("id") or ""),
                "author": item.get("author") or item.get("username") or "anonymous",
                "text": str(item.get("text") or item.get("post") or item.get("content") or "")[:20000],
                "sentiment": item.get("sentiment"),
                "score": float(item.get("score", 0.0)) if item.get("score") is not None else None,
                "created_at": item.get("created_at") or datetime.now(timezone.utc).isoformat(),
                "processed_at": item.get("processed_at")
            }
            POSTS[ds_id].append(p)
            created.append(p)
        
        rtdb_put(f"posts/{ds_id}", POSTS[ds_id][:200])
        return created

    @staticmethod
    def get_posts_by_dataset(ds_id):
        return POSTS.get(int(ds_id), [])

    @staticmethod
    def get_all_posts():
        all_p = []
        for ds_id in sorted(POSTS.keys(), reverse=True):
            all_p.extend(POSTS[ds_id])
        return all_p

    @staticmethod
    def update_post_sentiments(ds_id, classified_map):
        posts = POSTS.get(int(ds_id), [])
        for p in posts:
            if p["id"] in classified_map:
                res = classified_map[p["id"]]
                p["sentiment"] = res["sentiment"]
                p["score"] = res["score"]
                p["processed_at"] = datetime.now(timezone.utc).isoformat()
        rtdb_put(f"posts/{ds_id}", posts[:200])

    @staticmethod
    def add_job(dataset_id, input_path, output_path, status="running"):
        job_id = len(JOBS) + 1
        record = {
            "id": job_id,
            "dataset_id": int(dataset_id),
            "status": status,
            "positive": 0,
            "negative": 0,
            "neutral": 0,
            "input_path": input_path,
            "output_path": output_path,
            "log": "",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None
        }
        JOBS.append(record)
        rtdb_put(f"jobs/{job_id}", record)
        return record

    @staticmethod
    def update_job(job_id, status, positive, negative, neutral, log=""):
        for j in JOBS:
            if j["id"] == int(job_id):
                j["status"] = status
                j["positive"] = positive
                j["negative"] = negative
                j["neutral"] = neutral
                j["log"] = log[:10000]
                j["finished_at"] = datetime.now(timezone.utc).isoformat()
                rtdb_put(f"jobs/{job_id}", j)
                return j
        return None

    @staticmethod
    def list_jobs():
        return list(sorted(JOBS, key=lambda x: x["id"], reverse=True))

    @staticmethod
    def get_summary():
        all_posts = Storage.get_all_posts()
        pos = sum(1 for p in all_posts if p.get("sentiment") == "positive")
        neg = sum(1 for p in all_posts if p.get("sentiment") == "negative")
        neu = sum(1 for p in all_posts if p.get("sentiment") == "neutral")
        return {
            "total_posts": len(all_posts),
            "datasets": len(DATASETS),
            "mapreduce_jobs": len(JOBS),
            "positive": pos,
            "negative": neg,
            "neutral": neu,
            "hadoop_enabled": os.getenv("HADOOP_ENABLED", "false").lower() == "true",
            "database": "Firebase Realtime Database (NoSQL)"
        }
