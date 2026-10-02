#!/usr/bin/env bash
# Offline acceptance only. No OCI CLI or curl network commands are invoked.
set -euo pipefail

SKILL_TEST_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PYTHONDONTWRITEBYTECODE=1
export PYTHONNOUSERSITE=1
export PYTHONPYCACHEPREFIX="${PYTHONPYCACHEPREFIX:-${TMPDIR:-/tmp}/oci-iot-acceptance-pycache}"

echo "[1/5] installed skill smoke and deterministic contracts"
bash "$SKILL_TEST_ROOT/tests/smoke.sh"
echo "[2/5] operator helper behavior with synthetic inputs and mock clients"
python3 "$SKILL_TEST_ROOT/tests/test_operator_helpers.py"
echo "[3/5] integrated negative and package-boundary regressions"
node "$SKILL_TEST_ROOT/tests/test_flow_runtime_integration.mjs"
echo "[4/5] installed Markdown link targets"
python3 "$SKILL_TEST_ROOT/tests/check_local_links.py"
echo "[5/5] secret and provenance scan"
bash "$SKILL_TEST_ROOT/tests/redaction_scan.sh"
echo "offline acceptance checks passed"
