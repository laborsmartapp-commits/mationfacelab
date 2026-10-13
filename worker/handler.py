"""RunPod handler for MationFacelab.

Request (from the app's submitPerformanceJob):
  {"audio_url", "range_start", "range_end", "model": "audio2face-3d-v3.0", "emotion": "audio2emotion",
   "output": "blendshapes", "job_ref"}
  {"self_test": true}   real inference on NVIDIA's 4 s sample clip
  {"diagnose": true}    environment report, no inference
Response:
  {"channels": [...], "fps": N, "frames": [[...], ...], "ranges": {...}, "timing": {...},
   "model_info": {...}, "inference_ok": true}
frames[0] is the frame at range_start (seconds on the vocal file's own timeline).
"""
import json
import os
import statistics
import subprocess
import tempfile
import time
import urllib.request

import runpod

from prepare import ensure_prepared, last_status, runtime_info

SR = 16000
PREROLL = 1.0  # seconds of audio context fed before the excerpt, then discarded
MAX_DOWNLOAD = 300 * 1024 * 1024
HARNESS = os.environ.get("A2X_BIN", "/opt/a2x/bin/a2f_harness")
IDENTITY = int(os.environ.get("A2F_IDENTITY", "0"))
SELFTEST_WAV = "/opt/a2x/selftest.wav"


def fetch(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "mationfacelab-a2f-worker"})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
        total = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_DOWNLOAD:
                raise ValueError("Vocal file is larger than 300 MB.")
            f.write(chunk)


def decode(src, start, end, dest):
    """ffmpeg -> 16 kHz mono float32. Returns seconds of pre-roll actually included."""
    ss = max(0.0, start - PREROLL)
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{ss:.3f}", "-i", src]
    if end is not None:
        cmd += ["-t", f"{end - ss:.3f}"]
    cmd += ["-ac", "1", "-ar", str(SR), "-f", "f32le", "-y", dest]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    if os.path.getsize(dest) == 0:
        raise ValueError("The selected range contains no audio.")
    return start - ss, os.path.getsize(dest) / 4 / SR


def run_harness(paths, audio_path, out_path):
    p = subprocess.run([HARNESS, paths["a2f_model"], paths["a2e_model"], audio_path, out_path, str(IDENTITY)],
                       capture_output=True, text=True, timeout=1500)
    if p.returncode != 0:
        raise RuntimeError("Audio2Face SDK failed: " + (p.stderr or p.stdout).strip()[-1500:])
    with open(out_path) as f:
        return json.load(f), p.stdout.strip()


def to_timeline(raw, preroll, duration):
    """Uniform frames starting exactly at range_start, using the SDK's own frame timestamps (in 16 kHz samples)."""
    ts = raw["timestamps"]
    weights = raw["weights"]
    if len(ts) < 2:
        raise RuntimeError("Model produced fewer than 2 frames.")
    delta = statistics.median(b - a for a, b in zip(ts, ts[1:]))
    if delta <= 0:
        raise RuntimeError("Non-increasing frame timestamps from the SDK.")
    fps = SR / delta
    if not 10 <= fps <= 240:
        raise RuntimeError(f"Unexpected frame rate {fps:.2f} derived from SDK timestamps (delta={delta} samples).")
    n = max(1, int(round(duration * fps)))
    frames = []
    for i in range(n):
        target = (preroll + i / fps) * SR  # sample position within the decoded audio
        k = min(len(ts) - 1, max(0, int(round((target - ts[0]) / delta))))
        frames.append([round(v, 5) for v in weights[k]])
    return fps, frames, {"preroll_s": round(preroll, 4), "first_sdk_frame_s": ts[0] / SR,
                         "frame_delta_samples": delta, "sdk_frames": len(ts)}


def ranges_of(channels, frames):
    out = {}
    for i, c in enumerate(channels):
        col = [f[i] for f in frames]
        out[c] = [min(col), max(col)]
    return out


def infer(job, src, start, end):
    runpod.serverless.progress_update(job, {"stage": "initializing_gpu", "detail": last_status()})
    paths = ensure_prepared()
    runpod.serverless.progress_update(job, {"stage": "generating"})
    with tempfile.TemporaryDirectory() as tmp:
        audio = os.path.join(tmp, "audio.f32")
        preroll, decoded = decode(src, start, end, audio)
        duration = (end - start) if end is not None else decoded - preroll
        started = time.time()
        raw, summary = run_harness(paths, audio, os.path.join(tmp, "out.json"))
        infer_ms = int((time.time() - started) * 1000)
    fps, frames, timing = to_timeline(raw, preroll, duration)
    timing.update({"time_origin_s": start, "duration_s": round(duration, 4)})
    channels = raw["channels"]
    return {
        "channels": channels, "fps": fps, "frames": frames, "ranges": ranges_of(channels, frames), "timing": timing,
        "model_info": {"a2f": "nvidia/Audio2Face-3D-v3.0 (diffusion)", "a2e": "nvidia/Audio2Emotion-v2.2",
                       "identity": raw["identity"], "skin_channels": raw["skin_count"], "solver": "CPU blendshape solver",
                       "inference_ms": infer_ms, "harness": summary, "cache_key": paths["cache_key"], **paths["runtime"]},
    }


def handler(job):
    inp = job.get("input") or {}
    if inp.get("diagnose"):
        from diagnose import report
        return report()
    if inp.get("self_test"):
        out = infer(job, SELFTEST_WAV, 0.0, None)
        moving = [c for c, (lo, hi) in out["ranges"].items() if hi - lo > 1e-3]
        if not out["frames"] or not moving:
            raise RuntimeError("Self-test produced no moving channels; inference is not working.")
        out["inference_ok"] = True
        out["self_test"] = {"clip": "NVIDIA sample-data/audio_4sec_16k_s16le.wav", "moving_channels": len(moving)}
        return out
    for k in ("audio_url", "range_start", "range_end"):
        if k not in inp:
            raise ValueError(f"Missing input field: {k}")
    if inp.get("model", "audio2face-3d-v3.0") != "audio2face-3d-v3.0" or inp.get("output", "blendshapes") != "blendshapes":
        raise ValueError("This worker serves audio2face-3d-v3.0 blendshape output only.")
    start, end = float(inp["range_start"]), float(inp["range_end"])
    if start < 0 or end <= start:
        raise ValueError("range_end must be greater than range_start.")
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "vocal")
        runpod.serverless.progress_update(job, {"stage": "downloading_audio"})
        fetch(inp["audio_url"], src)
        out = infer(job, src, start, end)
    out["inference_ok"] = True
    out["job_ref"] = inp.get("job_ref")
    return out


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
