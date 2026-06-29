#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$ROOT_DIR/templates/publish-curl.template.sh"
GUIDANCE="$ROOT_DIR/references/cli-workflows.md"
FAILURES=0

fail() {
  echo "FAIL: $*" >&2
  FAILURES=$((FAILURES + 1))
}

TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/oci-iot-publish-guidance.XXXXXX")"
trap 'rm -rf "$TEST_TMP"' EXIT
FAKE_BIN="$TEST_TMP/bin"
FAKE_CURL_CAPTURE="$TEST_TMP/curl-argv.txt"
mkdir -p "$FAKE_BIN"

cat >"$FAKE_BIN/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail

: "${FAKE_CURL_CAPTURE:?set FAKE_CURL_CAPTURE}"
: "${FAKE_CURL_HTTP_STATUS:?set FAKE_CURL_HTTP_STATUS}"
: "${FAKE_CURL_BODY:?set FAKE_CURL_BODY}"
: "${FAKE_CURL_EXIT:?set FAKE_CURL_EXIT}"

first_option="${1:-}"
user_option_count=0
user_value=""
fail_option_count=0
write_out=""
authorization_header_count=0
location_option_count=0
output_file=""

while (($# > 0)); do
  option="$1"
  shift
  case "$option" in
    -u | --user)
      user_option_count=$((user_option_count + 1))
      if (($# > 0)); then
        user_value="$1"
        shift
      else
        user_value="<missing>"
      fi
      ;;
    --user=*)
      user_option_count=$((user_option_count + 1))
      user_value="${option#--user=}"
      ;;
    -u?*)
      user_option_count=$((user_option_count + 1))
      user_value="${option#-u}"
      ;;
    --fail)
      fail_option_count=$((fail_option_count + 1))
      ;;
    -w | --write-out)
      if (($# > 0)); then
        write_out="$1"
        shift
      fi
      ;;
    --write-out=*)
      write_out="${option#--write-out=}"
      ;;
    -w?*)
      write_out="${option#-w}"
      ;;
    -o | --output)
      if (($# > 0)); then
        output_file="$1"
        shift
      fi
      ;;
    --output=*)
      output_file="${option#--output=}"
      ;;
    -o?*)
      output_file="${option#-o}"
      ;;
    -H | --header)
      if (($# > 0)); then
        header="$1"
        shift
        if [[ "$header" =~ ^[Aa]uthorization:[[:space:]]*[Bb]asic ]]; then
          authorization_header_count=$((authorization_header_count + 1))
        fi
      fi
      ;;
    --header=*)
      header="${option#--header=}"
      if [[ "$header" =~ ^[Aa]uthorization:[[:space:]]*[Bb]asic ]]; then
        authorization_header_count=$((authorization_header_count + 1))
      fi
      ;;
    -H?*)
      header="${option#-H}"
      if [[ "$header" =~ ^[Aa]uthorization:[[:space:]]*[Bb]asic ]]; then
        authorization_header_count=$((authorization_header_count + 1))
      fi
      ;;
    -L | --location | --location-trusted | -*L*)
      location_option_count=$((location_option_count + 1))
      ;;
  esac
done

write_out_has_http_code=0
if [[ "$write_out" == *'%{http_code}'* ]]; then
  write_out_has_http_code=1
fi

{
  printf 'first_option=%s\n' "$first_option"
  printf 'user_option_count=%s\n' "$user_option_count"
  printf 'user_value=%s\n' "$user_value"
  printf 'fail_option_count=%s\n' "$fail_option_count"
  printf 'write_out_has_http_code=%s\n' "$write_out_has_http_code"
  printf 'authorization_header_count=%s\n' "$authorization_header_count"
  printf 'location_option_count=%s\n' "$location_option_count"
} >"$FAKE_CURL_CAPTURE"

http_error=0
if ((10#$FAKE_CURL_HTTP_STATUS >= 400)); then
  http_error=1
fi

if ((fail_option_count == 0 || http_error == 0)); then
  if [[ -n "$output_file" ]]; then
    printf '%s' "$FAKE_CURL_BODY" >"$output_file"
  else
    printf '%s' "$FAKE_CURL_BODY"
  fi
fi

if [[ -n "$write_out" ]]; then
  rendered_write_out="${write_out//%\{http_code\}/$FAKE_CURL_HTTP_STATUS}"
  printf '%b' "$rendered_write_out"
fi

if ((FAKE_CURL_EXIT != 0)); then
  exit "$FAKE_CURL_EXIT"
fi

if ((fail_option_count > 0 && http_error > 0)); then
  exit 22
fi
FAKE_CURL
chmod +x "$FAKE_BIN/curl"

run_template() {
  local http_status="$1"
  local stdout_file="$2"
  local stderr_file="$3"
  local curl_exit="${4:-0}"

  env \
    PATH="$FAKE_BIN:$PATH" \
    FAKE_CURL_CAPTURE="$FAKE_CURL_CAPTURE" \
    FAKE_CURL_HTTP_STATUS="$http_status" \
    FAKE_CURL_BODY="fake-response-body" \
    FAKE_CURL_EXIT="$curl_exit" \
    DEVICE_USER="test-device-user" \
    DEVICE_SECRET="test-device-secret" \
    DOMAIN_SHORT_ID="example-domain" \
    OCI_REGION="us-phoenix-1" \
    bash "$TEMPLATE" >"$stdout_file" 2>"$stderr_file"
}

ACCEPTED_STDOUT="$TEST_TMP/accepted.stdout"
ACCEPTED_STDERR="$TEST_TMP/accepted.stderr"
if ! run_template 202 "$ACCEPTED_STDOUT" "$ACCEPTED_STDERR"; then
  fail "publish template must succeed for 202 Accepted"
fi

if ! rg -Fxq 'first_option=--disable' "$FAKE_CURL_CAPTURE"; then
  fail "--disable must be the first curl option"
fi

if ! rg -Fxq 'user_option_count=1' "$FAKE_CURL_CAPTURE" ||
  ! rg -Fxq 'user_value=test-device-user:test-device-secret' "$FAKE_CURL_CAPTURE"; then
  fail "publish curl must pass exactly one credential option with the quoted device credentials"
fi

if ! rg -Fxq 'fail_option_count=0' "$FAKE_CURL_CAPTURE"; then
  fail "publish curl must not use --fail because exact status gating preserves error bodies"
fi

if ! rg -Fxq 'write_out_has_http_code=1' "$FAKE_CURL_CAPTURE"; then
  fail "publish curl must capture the HTTP status with --write-out and %{http_code}"
fi

if ! rg -Fxq 'authorization_header_count=0' "$FAKE_CURL_CAPTURE"; then
  fail "publish curl must not pass a manual Basic Authorization header"
fi

if ! rg -Fxq 'location_option_count=0' "$FAKE_CURL_CAPTURE"; then
  fail "publish curl must not follow redirects"
fi

if ! rg -Fq 'fake-response-body' "$ACCEPTED_STDOUT"; then
  fail "publish template must preserve the response body"
fi

if ! rg -Fxq 'HTTP status: 202' "$ACCEPTED_STDOUT"; then
  fail "202 responses must print their exact HTTP status"
fi

if ! rg -Fqi 'verify twin content' "$ACCEPTED_STDOUT"; then
  fail "202 Accepted must print the twin-content verification reminder"
fi

if rg -n -i 'Authorization:[[:space:]]*Basic' "$TEMPLATE" >/dev/null; then
  fail "publish template must not construct an Authorization: Basic header"
fi

if rg -n -i '(^|[^[:alnum:]_])base64([^[:alnum:]_]|$)' "$TEMPLATE" >/dev/null; then
  fail "publish template must not generate a Base64 credential value"
fi

REDIRECT_STDOUT="$TEST_TMP/redirect.stdout"
REDIRECT_STDERR="$TEST_TMP/redirect.stderr"
if run_template 302 "$REDIRECT_STDOUT" "$REDIRECT_STDERR"; then
  fail "publish template must reject an unexpected 302 response"
fi

if ! rg -Fq 'fake-response-body' "$REDIRECT_STDOUT"; then
  fail "publish template must preserve the body of an unexpected response"
fi

if ! rg -Fxq 'HTTP status: 302' "$REDIRECT_STDOUT"; then
  fail "302 responses must print their exact HTTP status"
fi

if rg -Fqi 'verify twin content' "$REDIRECT_STDOUT"; then
  fail "unexpected responses must not print the twin-content success reminder"
fi

if ! rg -qi 'unexpected HTTP status 302.*expected 202 Accepted' "$REDIRECT_STDERR"; then
  fail "unexpected responses must report the received and expected HTTP statuses on stderr"
fi

SERVER_ERROR_STDOUT="$TEST_TMP/server-error.stdout"
SERVER_ERROR_STDERR="$TEST_TMP/server-error.stderr"
if run_template 500 "$SERVER_ERROR_STDOUT" "$SERVER_ERROR_STDERR"; then
  fail "publish template must reject an unexpected 500 response"
fi

if ! rg -Fq 'fake-response-body' "$SERVER_ERROR_STDOUT"; then
  fail "publish template must preserve a 500 response body"
fi

if ! rg -Fxq 'HTTP status: 500' "$SERVER_ERROR_STDOUT"; then
  fail "500 responses must print their exact HTTP status"
fi

if rg -Fqi 'verify twin content' "$SERVER_ERROR_STDOUT"; then
  fail "500 responses must not print the twin-content success reminder"
fi

if ! rg -qi 'unexpected HTTP status 500.*expected 202 Accepted' "$SERVER_ERROR_STDERR"; then
  fail "500 responses must report the received and expected HTTP statuses on stderr"
fi

TRANSPORT_STDOUT="$TEST_TMP/transport.stdout"
TRANSPORT_STDERR="$TEST_TMP/transport.stderr"
TRANSPORT_EXIT=0
run_template 000 "$TRANSPORT_STDOUT" "$TRANSPORT_STDERR" 7 || TRANSPORT_EXIT=$?

if ((TRANSPORT_EXIT != 7)); then
  fail "transport failures must return the original curl exit code"
fi

if ! rg -Fq 'fake-response-body' "$TRANSPORT_STDOUT"; then
  fail "transport failures must preserve any response body"
fi

if ! rg -Fxq 'HTTP status: 000' "$TRANSPORT_STDOUT"; then
  fail "transport failures with curl status 000 must print that exact status"
fi

if ! rg -qi 'transport failure.*curl exit 7' "$TRANSPORT_STDERR"; then
  fail "transport failures must clearly report the original curl exit code on stderr"
fi

if rg -Fqi 'unexpected HTTP status' "$TRANSPORT_STDERR"; then
  fail "transport failures must be handled before HTTP status rejection"
fi

if rg -Fqi 'verify twin content' "$TRANSPORT_STDOUT"; then
  fail "transport failures must not print the twin-content success reminder"
fi

PUBLISH_GUIDANCE="$(sed -n \
  '/^## Publish Test Telemetry Over HTTPS$/,/^## Invoke A Raw JSON Command$/p' \
  "$GUIDANCE")"

if ! printf '%s\n' "$PUBLISH_GUIDANCE" |
  rg -Fq 'bash templates/publish-curl.template.sh'; then
  fail "publish guidance must direct users to the bundled template"
fi

if ! printf '%s\n' "$PUBLISH_GUIDANCE" |
  rg -Fqi 'Basic auth for test validation only'; then
  fail "publish guidance must limit Basic auth to test validation"
fi

if ! printf '%s\n' "$PUBLISH_GUIDANCE" |
  rg -Fqi 'Oracle recommends mTLS certificates for production'; then
  fail "publish guidance must recommend mTLS certificates for production"
fi

if ! printf '%s\n' "$PUBLISH_GUIDANCE" |
  rg -Fq 'https://docs.oracle.com/en-us/iaas/Content/internet-of-things/structured-default-https.htm'; then
  fail "publish guidance must link to the official structured HTTPS documentation"
fi

if printf '%s\n' "$PUBLISH_GUIDANCE" |
  rg -n -i 'Authorization:[[:space:]]*Basic' >/dev/null; then
  fail "publish guidance must not include an executable manual Basic Authorization header"
fi

if ! printf '%s\n' "$PUBLISH_GUIDANCE" |
  rg -Fqi 'Do not hand-build a Basic Authorization header'; then
  fail "publish guidance must warn against hand-built Basic Authorization headers"
fi

if ! printf '%s\n' "$PUBLISH_GUIDANCE" |
  rg -qi 'wrapped or multiline Base64'; then
  fail "publish guidance must warn about wrapped or multiline Base64 output"
fi

if ! printf '%s\n' "$PUBLISH_GUIDANCE" |
  rg -qi '202 Accepted.*ingress acceptance only.*not.*(final-state|twin-update) proof'; then
  fail "publish guidance must describe 202 Accepted as ingress-only, not final-state proof"
fi

if ! printf '%s\n' "$PUBLISH_GUIDANCE" | awk '
  /digital-twin-instance get-content/ { in_command = 1 }
  in_command && /--should-include-metadata true/ { found = 1 }
  in_command && /^```$/ { in_command = 0 }
  END { exit(found ? 0 : 1) }
'; then
  fail "publish guidance must retain get-content with --should-include-metadata true"
fi

if ((FAILURES > 0)); then
  echo "publish guidance checks failed: $FAILURES" >&2
  exit 1
fi

echo "publish guidance checks passed"
