#!/usr/bin/env bash
# Manually (re)build the model cache on this GPU, e.g. from a RunPod GPU pod with the same network volume.
set -euo pipefail
cd /opt/worker/worker
if [ "${1:-}" = "--rebuild" ]; then rm -rf "${MODEL_DIR:-/runpod-volume/mationfacelab-a2x}/engines"; fi
python3 prepare.py
