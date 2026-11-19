CREATE TABLE IF NOT EXISTS dataset (
 id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, source VARCHAR(40) NOT NULL DEFAULT 'upload',
 status VARCHAR(40) NOT NULL DEFAULT 'uploaded', row_count INTEGER DEFAULT 0,
 hdfs_path VARCHAR(1024), created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS post (
 id SERIAL PRIMARY KEY, dataset_id INTEGER REFERENCES dataset(id) ON DELETE CASCADE,
 platform VARCHAR(40) DEFAULT 'unknown', external_id VARCHAR(255), author VARCHAR(255),
 text TEXT NOT NULL, created_at TIMESTAMPTZ, sentiment VARCHAR(20), score DOUBLE PRECISION,
 processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_post_dataset ON post(dataset_id);
CREATE INDEX IF NOT EXISTS idx_post_sentiment ON post(sentiment);
CREATE TABLE IF NOT EXISTS map_reduce_job (
 id SERIAL PRIMARY KEY, dataset_id INTEGER REFERENCES dataset(id), status VARCHAR(30) DEFAULT 'queued',
 input_path VARCHAR(1024), output_path VARCHAR(1024), positive INTEGER DEFAULT 0,
 negative INTEGER DEFAULT 0, neutral INTEGER DEFAULT 0, log TEXT DEFAULT '',
 started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ
);
