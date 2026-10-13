#!/usr/bin/env bash
# Worker entrypoint. GPU preparation happens lazily on the first job (status: worker/prepare.py).
set -euo pipefail
cd /opt/worker/worker
if [ "${PREPARE_ON_START:-1}" = "1" ]; then
  # Warm the cache in the background so the first request waits less. Failures surface on the first job.
  (python3 -c "import prepare; prepare.ensure_prepared()" || true) &
fi
exec python3 -u handler.py
