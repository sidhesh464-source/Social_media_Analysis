# SentimentX — Hadoop-Based Social Media Sentiment Analysis

A cloud-deployable academic Big Data application implementing:

- Module 1: social-media data ingestion (CSV/JSON + optional Reddit/YouTube API adapters), preprocessing and HDFS storage.
- Module 2: Hadoop Streaming MapReduce sentiment aggregation.
- React dashboard with dark/light theme, Flask REST API and PostgreSQL metadata store.

## Architecture

React/Vite -> Flask API -> PostgreSQL
                     -> HDFS (Hadoop CLI)
                     -> Hadoop Streaming (Python mapper/reducer)
                     -> sentiment output in HDFS -> dashboard

**Important:** Live platform collection requires platform API credentials, approved access and compliance with each platform's terms. CSV/JSON import works without API credentials. The app never scrapes protected pages. Demo mode is clearly labelled and never reports simulated execution as a real Hadoop job.

## Requirements

- Python 3.10+
- Node.js 20+
- PostgreSQL 14+
- Ubuntu 22.04/24.04 VM for Hadoop 3.x
- Java 11 or 17 compatible with your chosen Hadoop distribution
- Hadoop configured with HDFS and YARN/MapReduce
- Hadoop Streaming JAR available

## Local development

### 1. Database

Create a PostgreSQL database and user, then set `DATABASE_URL` in `backend/.env`.

Example:
```bash
createdb sentimentx
```

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
flask --app run.py init-db
python run.py
```

The API runs at `http://localhost:5000`.

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`.

### 4. Configure real Hadoop

On the Hadoop VM:
1. Install Java and Hadoop 3.x.
2. Configure `core-site.xml`, `hdfs-site.xml`, `mapred-site.xml` and `yarn-site.xml`.
3. Format the NameNode only for a brand-new cluster.
4. Start HDFS and YARN.
5. Confirm `hdfs dfs -ls /` and `hadoop version` work for the backend service account.
6. Set `HADOOP_HOME`, `HADOOP_STREAMING_JAR`, `HDFS_BASE_PATH` and `HADOOP_ENABLED=true` in the backend environment.
7. Ensure the backend can SSH or run Hadoop commands on the Hadoop host. Prefer a private network/VPN and a dedicated least-privilege service account. Do not expose NameNode, DataNode or YARN ports publicly.

The backend's Hadoop service uses the Hadoop CLI installed on the backend host. For a separate Hadoop VM, deploy the backend on the same private network and configure the Hadoop CLI/client XML files there. Do not expose SSH or Hadoop management endpoints to the public internet.

## Hadoop configuration notes

Typical environment values:
```env
HADOOP_ENABLED=true
HADOOP_HOME=/opt/hadoop
HADOOP_STREAMING_JAR=/opt/hadoop/share/hadoop/tools/lib/hadoop-streaming-3.3.6.jar
HDFS_BASE_PATH=/sentimentx
HADOOP_BIN=/opt/hadoop/bin/hadoop
HDFS_BIN=/opt/hadoop/bin/hdfs
```

Version and JAR path vary by Hadoop installation. Verify with:
```bash
find "$HADOOP_HOME" -name 'hadoop-streaming*.jar'
```

## API collection

Optional Reddit adapter:
- Create an application through Reddit's developer portal.
- Set `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`.
- Use the adapter only within approved API access and rate limits.

Optional YouTube adapter:
- Create a Google Cloud project and enable YouTube Data API v3.
- Set `YOUTUBE_API_KEY`.
- The included endpoint searches public video metadata/comments where permitted by API capabilities and quota. Comment retrieval may be disabled for some videos.

## Deployment

### Frontend (Vercel)
- Import `frontend/` as the project root.
- Build command: `npm run build`
- Output directory: `dist`
- Set `VITE_API_BASE_URL=https://YOUR_API_HOST/api`

### Backend
Deploy `backend/` to a VM/container platform that has private network access to Hadoop and PostgreSQL.
- Install requirements.
- Set production environment variables.
- Run with Gunicorn:
```bash
gunicorn -w 2 -b 0.0.0.0:$PORT run:app
```
For a real Hadoop cluster, the backend runtime must have Hadoop client binaries/configuration and network access to the cluster. A generic serverless backend is not suitable for Hadoop CLI job execution.

### PostgreSQL
Use managed PostgreSQL or a private PostgreSQL service. Set `DATABASE_URL` and run:
```bash
flask --app run.py init-db
```

## Security checklist

- Use HTTPS.
- Keep API keys and database credentials only in backend environment variables.
- Set a strong `SECRET_KEY`.
- Restrict CORS to your frontend domain.
- Use a private network for Hadoop.
- Use a dedicated Hadoop account with limited HDFS permissions.
- Configure reverse proxy, firewall, backups and log rotation.
- Add production-grade rate limiting and refresh-token/session strategy before public multi-user use.
- Review API provider terms, privacy notices and data-retention obligations.

## Included routes

- `GET /api/health`
- `GET /api/dashboard/summary`
- `GET /api/dashboard/trends`
- `POST /api/datasets/upload`
- `GET /api/datasets`
- `POST /api/collection/reddit`
- `POST /api/collection/youtube`
- `POST /api/preprocessing/<dataset_id>`
- `GET /api/hdfs/status`
- `GET /api/hdfs/files`
- `POST /api/mapreduce/submit`
- `GET /api/mapreduce/jobs`
- `GET /api/sentiment/results`
- `GET /api/reports/export.csv`

## Academic demonstration flow

1. Upload sample CSV or JSON.
2. Preprocess it.
3. Store the cleaned dataset in HDFS.
4. Submit a real MapReduce job.
5. Read reducer output from HDFS.
6. View positive/negative/neutral totals and export CSV.

If Hadoop is disabled or unreachable, the job endpoint returns a clear error; it does not fake a successful real job.
