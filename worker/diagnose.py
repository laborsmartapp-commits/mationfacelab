"""Environment report. Run in the container: python3 worker/diagnose.py  (or send {"diagnose": true})."""
import json
import os
import subprocess

from prepare import ROOT, cache_key, last_status, runtime_info


def _run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=60).stdout.strip()[-2000:]
    except Exception as e:  # report, don't crash
        return f"error: {e}"


def report():
    out = {"build": json.load(open("/opt/a2x/BUILD_INFO.json")), "model_dir": ROOT,
           "hf_token_present": bool(os.environ.get("HF_TOKEN")), "last_prepare_status": last_status()}
    try:
        info = runtime_info()
        key = cache_key(info)
        out.update(runtime=info, cache_key=key, engines_ready=os.path.isdir(os.path.join(ROOT, "engines", key)))
    except Exception as e:
        out["gpu_error"] = str(e)
    out["trtexec"] = _run(["bash", "-lc", "trtexec --help 2>&1 | head -n 3"])
    out["harness_libs"] = _run(["bash", "-lc", "ldd " + os.environ.get("A2X_BIN", "/opt/a2x/bin/a2f_harness") + " | grep -E 'audio2x|nvinfer|cudart|not found'"])
    out["volume_free"] = _run(["df", "-h", ROOT if os.path.isdir(ROOT) else "/"])
    return out


if __name__ == "__main__":
    print(json.dumps(report(), indent=2))
