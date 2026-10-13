"""GPU-side initialization: model download + TensorRT engine build, cached on the network volume.

Cache key = model revisions + GPU name/compute capability + driver + TensorRT + CUDA + SDK commit.
Builds happen in a temporary directory and are renamed into place only when complete, so an
interrupted preparation never leaves a half-built cache. A file lock serialises workers sharing a volume.
"""
import fcntl
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

SDK = os.environ.get("A2X_SDK", "/opt/a2x/sdk")
ROOT = os.environ.get("MODEL_DIR") or ("/runpod-volume/mationfacelab-a2x" if os.path.isdir("/runpod-volume") else "/tmp/mationfacelab-a2x")
A2F = ("nvidia/Audio2Face-3D-v3.0", "b74132732fd9a9d29b237bec193ded64c9745e91")
A2E = ("nvidia/Audio2Emotion-v2.2", "ce1358310179ed7f6b6ea63fe4fa9de5694c1b87")
STATUS_FILE = os.path.join(ROOT, "status.json")


def log(stage, **extra):
    os.makedirs(ROOT, exist_ok=True)
    rec = {"stage": stage, "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **extra}
    print("[prepare]", json.dumps(rec), flush=True)
    tmp = STATUS_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(rec, f)
    os.replace(tmp, STATUS_FILE)


def sh(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip()


def runtime_info():
    gpu = sh(["nvidia-smi", "--query-gpu=name,compute_cap,driver_version", "--format=csv,noheader"]).splitlines()[0]
    name, cc, driver = [x.strip() for x in gpu.split(",")]
    with open("/opt/a2x/BUILD_INFO.json") as f:
        build = json.load(f)
    return {"gpu": name, "compute_capability": cc, "driver": driver, "tensorrt": build["tensorrt"],
            "cuda": build["cuda"], "sdk_commit": build["sdk_commit"], "a2f_model": "@".join(A2F), "a2e_model": "@".join(A2E)}


def cache_key(info):
    # Driver major only: engines depend on the GPU + TensorRT build, not driver patch level.
    keyed = {k: v for k, v in info.items() if k != "driver"}
    keyed["driver_major"] = info["driver"].split(".")[0]
    return hashlib.sha256(json.dumps(keyed, sort_keys=True).encode()).hexdigest()[:20]


def download(repo, rev):
    dest = os.path.join(ROOT, "models", repo.replace("/", "__") + "@" + rev)
    if os.path.exists(os.path.join(dest, ".complete")):
        return dest
    from huggingface_hub import snapshot_download
    from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError
    log("downloading", repo=repo, revision=rev)
    token = os.environ.get("HF_TOKEN") or None
    try:
        snapshot_download(repo_id=repo, revision=rev, local_dir=dest, token=token)
    except (GatedRepoError, RepositoryNotFoundError) as e:
        raise RuntimeError(
            f"Hugging Face denied access to {repo}. Accept the license at https://huggingface.co/{repo} with the "
            f"account that owns HF_TOKEN, and make sure the token can read public gated repos. ({type(e).__name__})")
    open(os.path.join(dest, ".complete"), "w").close()
    return dest


def convert(src, dest):
    # NVIDIA's own converter (audio2x-common/scripts/audio2x/trt.py) -> trtexec on this GPU.
    sys.path.insert(0, os.path.join(SDK, "audio2x-common", "scripts"))
    argv, sys.argv = sys.argv, sys.argv[:1]  # audio2x.common parses argv on import
    try:
        import audio2x.trt as trt
    finally:
        sys.argv = argv
    trt.convert_onnx_to_trt_from_folders(src, dest)
    engine = os.path.join(dest, "network.trt")
    if not os.path.exists(engine) or os.path.getsize(engine) == 0:
        raise RuntimeError(f"trtexec did not produce {engine}")  # NVIDIA's helper ignores trtexec's exit code


def build(key_dir, a2f_src, a2e_src, info):
    tmp = f"{key_dir}.partial-{os.getpid()}"
    shutil.rmtree(tmp, ignore_errors=True)
    a2f_dst, a2e_dst = os.path.join(tmp, "a2f"), os.path.join(tmp, "a2e")
    os.makedirs(a2f_dst)
    os.makedirs(a2e_dst)
    # Same file selection as audio2face-sdk/scripts/gen_sample_data.py (diffusion) ...
    for pat in ("*.json", "*.npz"):
        for f in glob.glob(os.path.join(a2f_src, pat)):
            shutil.copy(f, a2f_dst)
    log("building_engine", model="audio2face-3d-v3.0", note="first run on this GPU type takes several minutes")
    convert(a2f_src, a2f_dst)
    # ... and audio2emotion-sdk/scripts/gen_sample_data.py.
    for name in ("model_config.json", "network_info.json", "trt_info.json", "model.json"):
        shutil.copy(os.path.join(a2e_src, name), a2e_dst)
    log("building_engine", model="audio2emotion-v2.2")
    convert(a2e_src, a2e_dst)
    with open(os.path.join(tmp, "runtime.json"), "w") as f:
        json.dump(info, f, indent=2)
    os.replace(tmp, key_dir)


def ensure_prepared():
    """Returns paths + runtime info. Safe to call on every job (fast when cached)."""
    info = runtime_info()
    key = cache_key(info)
    engines = os.path.join(ROOT, "engines")
    os.makedirs(engines, exist_ok=True)
    key_dir = os.path.join(engines, key)
    result = {"a2f_model": os.path.join(key_dir, "a2f", "model.json"),
              "a2e_model": os.path.join(key_dir, "a2e", "model.json"), "cache_key": key, "runtime": info}
    if os.path.isdir(key_dir):
        return result
    with open(os.path.join(engines, key + ".lock"), "w") as lock:
        log("waiting_for_lock", cache_key=key)
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            if os.path.isdir(key_dir):
                return result
            for stale in glob.glob(key_dir + ".partial-*"):  # left by an interrupted worker
                log("removing_interrupted_build", path=stale)
                shutil.rmtree(stale, ignore_errors=True)
            a2f_src = download(*A2F)
            a2e_src = download(*A2E)
            started = time.time()
            build(key_dir, a2f_src, a2e_src, info)
            log("ready", cache_key=key, build_seconds=round(time.time() - started, 1), **info)
        except Exception as e:
            log("failed", cache_key=key, error=str(e))
            raise
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
    return result


def last_status():
    try:
        with open(STATUS_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


if __name__ == "__main__":
    print(json.dumps(ensure_prepared(), indent=2))
