from datetime import datetime, timezone
from .extensions import db

def utcnow():
    return datetime.now(timezone.utc)

class Dataset(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    source = db.Column(db.String(40), nullable=False, default="upload")
    status = db.Column(db.String(40), nullable=False, default="uploaded")
    row_count = db.Column(db.Integer, default=0)
    hdfs_path = db.Column(db.String(1024))
    created_at = db.Column(db.DateTime(timezone=True), default=utcnow)

class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    dataset_id = db.Column(db.Integer, db.ForeignKey("dataset.id"), index=True)
    platform = db.Column(db.String(40), default="unknown")
    external_id = db.Column(db.String(255))
    author = db.Column(db.String(255))
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True))
    sentiment = db.Column(db.String(20))
    score = db.Column(db.Float)
    processed_at = db.Column(db.DateTime(timezone=True))

class MapReduceJob(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    dataset_id = db.Column(db.Integer, db.ForeignKey("dataset.id"), nullable=False)
    status = db.Column(db.String(30), default="queued")
    input_path = db.Column(db.String(1024))
    output_path = db.Column(db.String(1024))
    positive = db.Column(db.Integer, default=0)
    negative = db.Column(db.Integer, default=0)
    neutral = db.Column(db.Integer, default=0)
    log = db.Column(db.Text, default="")
    started_at = db.Column(db.DateTime(timezone=True))
    finished_at = db.Column(db.DateTime(timezone=True))
