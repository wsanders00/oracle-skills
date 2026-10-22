#!/usr/bin/env bash
set +x  # Disable inherited tracing before expanding any credentials.
set -euo pipefail

# Required env:
#   DEVICE_USER
#   DEVICE_SECRET
#   DOMAIN_SHORT_ID
#   OCI_REGION
# Optional env:
#   REFERENCE_ENDPOINT (default: /sampletopic)

: "${DEVICE_USER:?set DEVICE_USER}"
: "${DEVICE_SECRET:?set DEVICE_SECRET}"
: "${DOMAIN_SHORT_ID:?set DOMAIN_SHORT_ID}"
: "${OCI_REGION:?set OCI_REGION}"

REFERENCE_ENDPOINT="${REFERENCE_ENDPOINT:-/sampletopic}"
if [[ "$REFERENCE_ENDPOINT" == *"://"* || "$REFERENCE_ENDPOINT" == *[[:space:]]* ]]; then
  echo "REFERENCE_ENDPOINT must be a path without whitespace or a URL scheme" >&2
  exit 2
fi
while [[ "$REFERENCE_ENDPOINT" == /* ]]; do
  REFERENCE_ENDPOINT="${REFERENCE_ENDPOINT#/}"
done
REFERENCE_ENDPOINT="/$REFERENCE_ENDPOINT"
URL="https://${DOMAIN_SHORT_ID}.device.iot.${OCI_REGION}.oci.oraclecloud.com${REFERENCE_ENDPOINT}"
TS="$(date -u +"%Y-%m-%dT%H:%M:%S").000000Z"

PAYLOAD="$(cat <<JSON
{
  "time": "${TS}",
  "temperature": 23.5
}
JSON
)"

# curl 7.76+ supports --fail-with-body. Fail closed before sending credentials.
command -v base64 >/dev/null || { echo "base64 is required" >&2; exit 2; }
CURL_VERSION="$(curl -q --version)"
if [[ ! "$CURL_VERSION" =~ ^curl\ ([0-9]+)\.([0-9]+)\. ]]; then
  echo "Cannot determine curl version; curl 7.76+ is required" >&2
  exit 2
fi
if (( BASH_REMATCH[1] < 7 || (BASH_REMATCH[1] == 7 && BASH_REMATCH[2] < 76) )); then
  echo "curl 7.76+ is required for --fail-with-body" >&2
  exit 2
fi
BASIC_AUTH="$(printf '%s' "${DEVICE_USER}:${DEVICE_SECRET}" | base64 | tr -d '\r\n')"
# -q must be first: ignore curlrc settings (including trace and redirects).
# Header input is stdin; neither plaintext nor encoded credentials enter argv.
printf 'Authorization: Basic %s\n' "$BASIC_AUTH" | \
  curl -q -sS --fail-with-body --header @- \
    -H "Content-Type: application/json" \
    -d "${PAYLOAD}" \
    "${URL}"

echo
