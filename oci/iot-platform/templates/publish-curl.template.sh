#!/usr/bin/env bash
set +x  # Disable inherited tracing before expanding any credentials.
set -euo pipefail
export LC_ALL=C

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

validate_dns_label() {
  local name="$1" value="$2"
  if (( ${#value} < 1 || ${#value} > 63 )) || \
     [[ "$value" == -* || "$value" == *- || "$value" == *[!A-Za-z0-9-]* ]]; then
    echo "$name must be a 1-63 character ASCII DNS label" >&2
    exit 2
  fi
}

# These fields become authority components. Validate before URL construction or
# any credential encoding; they must come from the selected domain metadata.
validate_dns_label DOMAIN_SHORT_ID "$DOMAIN_SHORT_ID"
validate_dns_label OCI_REGION "$OCI_REGION"

REFERENCE_ENDPOINT="${REFERENCE_ENDPOINT:-/sampletopic}"
if [[ "$REFERENCE_ENDPOINT" == *"://"* || "$REFERENCE_ENDPOINT" == *\?* || \
      "$REFERENCE_ENDPOINT" == *\#* || "$REFERENCE_ENDPOINT" =~ [[:space:][:cntrl:]] ]]; then
  echo "REFERENCE_ENDPOINT must be a path without a URL, query, fragment, whitespace, or control character" >&2
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
  curl -q -sS --fail-with-body --globoff --proto '=https' \
    --connect-timeout 10 --max-time 30 --header @- \
    -H "Content-Type: application/json" \
    -d "${PAYLOAD}" \
    "${URL}"

echo
