"""RunPod Serverless entry point for the MationFacelab Audio2Face-3D worker.

The job logic lives in worker/handler.py; this file registers it with RunPod.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker"))

import runpod  # noqa: E402
from handler import handler  # noqa: E402  (worker/handler.py)

if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})