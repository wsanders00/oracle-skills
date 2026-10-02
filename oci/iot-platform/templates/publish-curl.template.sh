#!/usr/bin/env bash
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

curl -sS --fail -u "${DEVICE_USER}:${DEVICE_SECRET}" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}" \
  "${URL}"

echo
