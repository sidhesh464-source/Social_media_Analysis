import os, subprocess, uuid, shlex
from pathlib import Path

def _config():
    if os.getenv("HADOOP_ENABLED", "false").lower() != "true":
        raise RuntimeError("Hadoop is disabled. Set HADOOP_ENABLED=true to enable real cluster execution.")
    hadoop = os.getenv("HADOOP_BIN", "hadoop")
    hdfs = os.getenv("HDFS_BIN", "hdfs")
    jar = os.getenv("HADOOP_STREAMING_JAR")
    if not jar or not Path(jar).exists():
        raise RuntimeError("HADOOP_STREAMING_JAR does not point to an existing Hadoop Streaming JAR.")
    return hadoop, hdfs, jar

def run_cmd(args, timeout=1800):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "Command failed")[-5000:])
    return result.stdout

def hdfs_status():
    hadoop, hdfs, _ = _config()
    return {"connected": True, "version": run_cmd([hadoop, "version"]).splitlines()[0],
            "root": run_cmd([hdfs, "dfs", "-ls", "/"])[:2000]}

def put_file(local_path, remote_path):
    _, hdfs, _ = _config()
    run_cmd([hdfs, "dfs", "-mkdir", "-p", str(Path(remote_path).parent)])
    run_cmd([hdfs, "dfs", "-put", "-f", local_path, remote_path])
    return remote_path

def list_files(path):
    _, hdfs, _ = _config()
    return run_cmd([hdfs, "dfs", "-ls", path])

def submit_streaming(input_path, output_path, mapper, reducer):
    hadoop, _, jar = _config()
    # Output directory must not already exist. Use unique output directories.
    args = [hadoop, "jar", jar,
            "-files", f"{mapper},{reducer}",
            "-mapper", "python3 mapper.py",
            "-reducer", "python3 reducer.py",
            "-input", input_path, "-output", output_path]
    return run_cmd(args)
