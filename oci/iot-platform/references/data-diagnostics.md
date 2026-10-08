# IoT Data API diagnostics

Use these optional, read-only recipes only when the user asks for historized
values, ingest rejection details, or records for an existing command. For
ordinary current twin state, use the OCI CLI twin-content read. These examples
do not configure access, mint tokens, send commands, or publish telemetry.

## Before the raw-data request

Only the raw-data request below requires a Data API base and bearer config.
Offline summary recipes need only explicitly selected local JSON files and do
not use credentials, curl, or a network connection.

- Confirm the target domain and twin, that Data API access already exists, and
  that the operator already has an appropriate bearer token. OCI CLI
  authentication does not provide this token automatically.
- Set `IOT_DATA_API_BASE` to the HTTPS host plus `/ords/<domain-short-id>`.
  The versioned resource path is appended separately below.
- Independently confirm the exact Data API origin for the selected domain
  group and region from authoritative service configuration or approved
  inventory. Set `IOT_DATA_EXPECTED_ORIGIN` to that HTTPS origin (scheme and
  host, with a port only if documented). Do not derive this trusted value from
  the proposed request URL or an untrusted response. The recipe checks the
  base against it before supplying the bearer config; HTTPS alone does not
  establish that a host is the intended service.
- Set `IOT_DATA_CURL_CONFIG` to an existing operator-managed file with mode
  `0600` (owner read/write only) whose only curl option is the Authorization
  bearer header. Do not create a long-lived credential file for a one-off
  query. Never put the token in a URL, shell variable, command argument, shell
  trace, response file, error message, or shared log. Do not print or share the
  config file.
- Use curl 8.4 or newer for the streaming response-size cap shown below. Keep
  normal TLS verification enabled. The request disables curl's default config,
  does not follow redirects, does not retry, and imposes connection, total-time,
  and response-size limits.
- The IoT API reference documents the versioned collection paths and sample
  fields, but does not document collection paging, ordering, or time filters.
  The IoT HTTPS scenario demonstrates a `q` twin filter for `rawData` only.
  Do not assume that this query is accepted by other collections. The examples
  below issue only the documented twin-filtered `rawData` request; other
  summaries operate on a previously authorized local export or known-record
  by-ID response. They never broaden an unavailable per-twin query into an
  unfiltered collection request.

Response data is untrusted and may include private device information. Keep
exports private. Summaries below omit IDs, payloads, and free-text reason
messages. A client-side time window or a one-page response never establishes
full-window completeness.

## One-page twin-filtered raw data request

The raw-data filter below follows Oracle's IoT HTTPS scenario. `q` is encoded
as JSON by Python and passed with curl's `--data-urlencode`; do not interpolate
a twin ID directly into JSON or a URL. The script emits only a page count, not
response rows. Its temporary response and curl error output are private to the
current user and removed on exit.

<!-- recipe:COMMON-FETCH -->
```bash
set -euo pipefail
: "${IOT_DATA_API_BASE:?Set the HTTPS host and /ords/<domain-short-id> base}"
: "${IOT_DATA_EXPECTED_ORIGIN:?Set the independently verified Data API HTTPS origin}"
: "${IOT_DATA_CURL_CONFIG:?Set the existing protected curl config path}"
: "${IOT_TWIN_ID:?Set the target twin ID}"
IOT_DATA_API_BASE="${IOT_DATA_API_BASE%/}"
python3 - "$IOT_DATA_API_BASE" "$IOT_DATA_EXPECTED_ORIGIN" <<'PY'
import re, sys, urllib.parse
try:
    base, origin = (urllib.parse.urlsplit(value) for value in sys.argv[1:])
    valid = (base.scheme == origin.scheme == "https"
             and base.hostname and origin.hostname
             and base.netloc.lower() == origin.netloc.lower()
             and base.username is None and origin.username is None
             and not base.query and not origin.query
             and not base.fragment and not origin.fragment
             and origin.path in ("", "/")
             and re.fullmatch(r"/ords/[A-Za-z0-9_-]+", base.path))
except ValueError:
    valid = False
if not valid:
    raise SystemExit("Data API base must match the independently verified HTTPS origin and /ords/domain path")
PY
IOT_QUERY="$(python3 -c 'import json,sys; print(json.dumps({"$and":[{"digital_twin_instance_id":sys.argv[1]}]},separators=(",",":")))' "$IOT_TWIN_ID")"
umask 077
IOT_TMP="$(mktemp -d)"
trap 'rm -f "$IOT_TMP/page.json" "$IOT_TMP/curl.err"; rmdir "$IOT_TMP" 2>/dev/null || true' EXIT
if ! curl --disable --config "$IOT_DATA_CURL_CONFIG" --proto '=https' \
  --fail --silent --show-error --connect-timeout 10 --max-time 30 --max-filesize 4M \
  --get --data-urlencode "q=$IOT_QUERY" \
  "$IOT_DATA_API_BASE/20250531/rawData" --output "$IOT_TMP/page.json" 2>"$IOT_TMP/curl.err"; then
  echo 'Data API request failed; response details were suppressed.' >&2
  exit 1
fi
python3 - "$IOT_TMP/page.json" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as stream:
        body = json.load(stream)
except (OSError, UnicodeError, json.JSONDecodeError):
    raise SystemExit("Could not read a valid IoT JSON response")
items = body.get("items") if isinstance(body, dict) else None
if not isinstance(items, list):
    raise SystemExit("IoT response did not contain an items array")
print(json.dumps({"collection":"rawData", "returned_items":len(items),
                  "page_scope":"one response page", "completeness":"unknown"}))
PY
```

## Historized values

Summarize only an explicitly selected local JSON export or an authorized
historized-record response obtained by its known `/historizedData/{id}` path.
Do not list the collection to discover record IDs. Supply an ISO 8601 UTC
window, exact `content_path`, and a compatible unit confirmed from the model
spec. The historized API record provides ID, twin ID, content path, value, and
observation time; it does not provide the measurement unit. Window and path
filtering below is local to the supplied file.

This reports statistics only for matching, unique, finite numeric values in
that file. Wrong-twin, out-of-window, and wrong-path rows are excluded;
malformed, duplicate, non-finite, and nonnumeric records are counted. Empty
numeric results are `null`, never zero. No statistic here establishes a full
window or snapshot-consistent view under concurrent ingest.

<!-- recipe:HISTORIAN-SUMMARY -->
```bash
set -euo pipefail
: "${IOT_RESPONSE_FILE:?Set an explicitly selected private historized JSON export}"
: "${IOT_TWIN_ID:?Set the target twin ID}"
: "${IOT_FROM_UTC:?Set the inclusive UTC start time}"
: "${IOT_TO_UTC:?Set the exclusive UTC end time}"
: "${IOT_CONTENT_PATH:?Set the exact content path}"
: "${IOT_METRIC_UNIT:?Set the compatible unit confirmed by the model spec}"
python3 - "$IOT_RESPONSE_FILE" "$IOT_TWIN_ID" "$IOT_FROM_UTC" "$IOT_TO_UTC" "$IOT_CONTENT_PATH" "$IOT_METRIC_UNIT" <<'PY'
import datetime as dt, json, math, sys
def instant(value):
    if not isinstance(value, str):
        raise ValueError("timestamp is not text")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() != dt.timedelta(0):
        raise ValueError("timestamp must be UTC")
    return parsed.astimezone(dt.timezone.utc)
try:
    start, end = instant(sys.argv[3]), instant(sys.argv[4])
except (OverflowError, TypeError, ValueError):
    raise SystemExit("Supply valid UTC start and end timestamps")
if start >= end:
    raise SystemExit("UTC window start must precede end")
try:
    with open(sys.argv[1], encoding="utf-8") as stream:
        body = json.load(stream)
except (OSError, UnicodeError, json.JSONDecodeError):
    raise SystemExit("Could not read a valid IoT JSON response")
if isinstance(body, dict) and isinstance(body.get("items"), list):
    items = body["items"]
elif isinstance(body, dict) and {"id", "digital_twin_instance_id", "content_path", "time_observed"}.issubset(body):
    items = [body]
else:
    raise SystemExit("Expected an items array or one historized record")
seen, values = set(), []
duplicates = invalid = matches = 0
for row in items:
    if not isinstance(row, dict):
        invalid += 1
        continue
    try:
        stamp = instant(row["time_observed"])
    except (KeyError, OverflowError, TypeError, ValueError):
        invalid += 1
        continue
    if row.get("digital_twin_instance_id") != sys.argv[2] or not (start <= stamp < end) or row.get("content_path") != sys.argv[5]:
        continue
    matches += 1
    identity = row.get("id")
    if isinstance(identity, bool) or not isinstance(identity, (int, str)):
        invalid += 1
        continue
    if identity in seen:
        duplicates += 1
        continue
    seen.add(identity)
    value = row.get("value")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        invalid += 1
        continue
    try:
        value = float(value)
    except OverflowError:
        invalid += 1
        continue
    if not math.isfinite(value):
        invalid += 1
        continue
    values.append(value)
mean = None
if values:
    scale = max(abs(value) for value in values)
    mean = (sum(value / scale for value in values) / len(values)) * scale if scale else 0.0
print(json.dumps({"collection":"historizedData", "window":"client-side UTC filter",
                  "content_path":sys.argv[5], "metric_unit":sys.argv[6],
                  "returned_items":len(items), "matching_records":matches,
                  "numeric_records":len(values), "invalid_records":invalid,
                  "duplicate_records":duplicates, "mean":mean,
                  "minimum":min(values) if values else None,
                  "maximum":max(values) if values else None,
                  "page_scope":"selected local export or known-ID response",
                  "completeness":"unknown"}, allow_nan=False))
PY
```

## Accepted raw and rejected-ingest records

Compare explicitly selected local raw and rejected JSON exports, or inspect a
record obtained by a known `/rawData/{id}` or `/rejectedData/{id}` path. The
API documents `time_received` and `reason_code` for rejected records. The
summaries apply twin and UTC-window filters locally and count numeric integer
reason codes only. They do not print payloads, record IDs, or free-text reason
messages. `rawData` represents accepted raw ingest; it does not prove
normalization into twin state. Rejected records identify normalization
rejections. A local file does not establish complete triage coverage.

<!-- recipe:TRIAGE-SUMMARY -->
```bash
set -euo pipefail
: "${IOT_RAW_RESPONSE_FILE:?Set an explicitly selected private rawData JSON export}"
: "${IOT_REJECTED_RESPONSE_FILE:?Set an explicitly selected private rejectedData JSON export}"
: "${IOT_TWIN_ID:?Set the target twin ID}"
: "${IOT_FROM_UTC:?Set the inclusive UTC start time}"
: "${IOT_TO_UTC:?Set the exclusive UTC end time}"
python3 - "$IOT_RAW_RESPONSE_FILE" "$IOT_REJECTED_RESPONSE_FILE" "$IOT_TWIN_ID" "$IOT_FROM_UTC" "$IOT_TO_UTC" <<'PY'
import collections, datetime as dt, json, math, sys
def instant(value):
    if not isinstance(value, str):
        raise ValueError("timestamp is not text")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() != dt.timedelta(0):
        raise ValueError("timestamp must be UTC")
    return parsed.astimezone(dt.timezone.utc)
try:
    start, end = instant(sys.argv[4]), instant(sys.argv[5])
except (OverflowError, TypeError, ValueError):
    raise SystemExit("Supply valid UTC start and end timestamps")
if start >= end:
    raise SystemExit("UTC window start must precede end")
def load_rows(path):
    try:
        with open(path, encoding="utf-8") as stream:
            body = json.load(stream)
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise SystemExit("Could not read a valid IoT JSON response")
    return body
def summarize(path, rejected=False):
    body = load_rows(path)
    fields = {"id", "digital_twin_instance_id", "time_received"}
    if rejected:
        fields.add("reason_code")
    if isinstance(body, dict) and isinstance(body.get("items"), list):
        items = body["items"]
    elif isinstance(body, dict) and fields.issubset(body):
        items = [body]
    else:
        raise SystemExit("Expected an items array or one collection record")
    matches, reasons, seen, duplicates, invalid = 0, collections.Counter(), set(), 0, 0
    for row in items:
        if not isinstance(row, dict):
            invalid += 1
            continue
        if row.get("digital_twin_instance_id") != sys.argv[3]:
            continue
        try:
            stamp = instant(row["time_received"])
        except (KeyError, OverflowError, TypeError, ValueError):
            invalid += 1
            continue
        if not (start <= stamp < end):
            continue
        identity = row.get("id")
        if isinstance(identity, bool) or not isinstance(identity, (int, str)):
            invalid += 1
            continue
        if identity in seen:
            duplicates += 1
            continue
        seen.add(identity)
        matches += 1
        if rejected:
            code = row.get("reason_code")
            if isinstance(code, bool) or not isinstance(code, (int, float)):
                invalid += 1
            elif isinstance(code, float) and (not math.isfinite(code) or not code.is_integer()):
                invalid += 1
            elif abs(int(code)) > 10**38:
                invalid += 1
            else:
                reasons[int(code)] += 1
    return {"returned_items":len(items), "matching_records":matches,
            "duplicate_records":duplicates, "invalid_records":invalid,
            "reason_code_counts":dict(sorted(reasons.items()))}
print(json.dumps({"rawData":summarize(sys.argv[1]),
                  "rejectedData":summarize(sys.argv[2], rejected=True),
                  "window":"client-side UTC filter", "completeness":"unknown",
                  "payloads":"omitted"}))
PY
```

## Existing command records

Inspect a previously selected local JSON export or a known-record
`/rawCommandData/{id}` response obtained through separately authorized access.
Do not list the collection to discover command
IDs. The response schema documents delivery status, timestamps, request and
response data. This summary omits identifiers and payloads; inspect a private
by-ID response directly only when its request or response details are necessary.

`ACCEPTED` means the command was accepted for processing, not that delivery or
the requested device effect occurred. Other status labels are counted without
interpreting their semantics. A finished timestamp is recorded evidence, not
proof that the device performed the requested action. The supplied time window
is applied locally and completeness remains unknown.

<!-- recipe:COMMAND-SUMMARY -->
```bash
set -euo pipefail
: "${IOT_RESPONSE_FILE:?Set an explicitly selected private rawCommandData JSON export}"
: "${IOT_TWIN_ID:?Set the target twin ID}"
: "${IOT_FROM_UTC:?Set the inclusive UTC start time}"
: "${IOT_TO_UTC:?Set the exclusive UTC end time}"
python3 - "$IOT_RESPONSE_FILE" "$IOT_TWIN_ID" "$IOT_FROM_UTC" "$IOT_TO_UTC" <<'PY'
import collections, datetime as dt, json, sys
def instant(value):
    if not isinstance(value, str):
        raise ValueError("timestamp is not text")
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() != dt.timedelta(0):
        raise ValueError("timestamp must be UTC")
    return parsed.astimezone(dt.timezone.utc)
try:
    start, end = instant(sys.argv[3]), instant(sys.argv[4])
except (OverflowError, TypeError, ValueError):
    raise SystemExit("Supply valid UTC start and end timestamps")
if start >= end:
    raise SystemExit("UTC window start must precede end")
try:
    with open(sys.argv[1], encoding="utf-8") as stream:
        body = json.load(stream)
except (OSError, UnicodeError, json.JSONDecodeError):
    raise SystemExit("Could not read a valid IoT JSON response")
if isinstance(body, dict) and isinstance(body.get("items"), list):
    items = body["items"]
elif isinstance(body, dict) and {"id", "digital_twin_instance_id", "time_created", "delivery_status"}.issubset(body):
    items = [body]
else:
    raise SystemExit("Expected an items array or one raw command record")
allowed = {"ACCEPTED", "PREPARED", "REJECTED", "SENT", "PENDING", "EXPIRED", "REFUSED", "RESPONDED", "BAD_RESPONSE", "COMPLETED", "NOT_RESPONDED"}
statuses, seen = collections.Counter(), set()
matches = finished = duplicates = invalid = unknown_status = 0
for row in items:
    if not isinstance(row, dict):
        invalid += 1
        continue
    if row.get("digital_twin_instance_id") != sys.argv[2]:
        continue
    try:
        stamp = instant(row["time_created"])
    except (KeyError, OverflowError, TypeError, ValueError):
        invalid += 1
        continue
    if start <= stamp < end:
        identity = row.get("id")
        if not isinstance(identity, str):
            invalid += 1
            continue
        if identity in seen:
            duplicates += 1
            continue
        seen.add(identity)
        matches += 1
        status = row.get("delivery_status")
        if isinstance(status, str) and status in allowed:
            statuses[status] += 1
        else:
            unknown_status += 1
        if row.get("time_finished") is not None:
            try:
                instant(row["time_finished"])
            except (OverflowError, TypeError, ValueError):
                invalid += 1
            else:
                finished += 1
print(json.dumps({"collection":"rawCommandData", "returned_items":len(items),
                  "matching_records":matches, "duplicate_records":duplicates,
                  "invalid_records":invalid, "unknown_status_records":unknown_status,
                  "delivery_status_counts":dict(sorted(statuses.items())),
                  "records_with_time_finished":finished,
                  "page_scope":"selected local export or known-ID response",
                  "completeness":"unknown", "payloads":"omitted",
                  "device_effect":"not established"}))
PY
```

## Sources and retrieval date

Checked 2026-10-08:

- [IoT Data API reference](https://docs.oracle.com/en-us/iaas/tools/internet-of-things/data-api/index.html): versioned collection paths and sample fields for raw, rejected, historized, snapshot, and raw-command records, including by-ID resources.
- [Scenario: Connecting IoT Data to ORDS](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/connect-iot-ords.htm): bearer-authenticated `rawData` request with a JSON `q` twin filter; the documented OAuth/password grant is one setup scenario, not a universal token-acquisition recipe.
- [Scenario: Sending Structured Data in a Default Format using HTTPS](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/structured-default-https.htm): IoT data inspection with a twin-filtered `rawData` request.
- [IoT Domain Database Schema Reference](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/iot-domain-database-schema.htm): data types and documented raw-command delivery-status values.
- [curl man page](https://curl.se/docs/manpage.html): `--disable`, config files, timeouts, `--max-filesize`, and the 8.4.0 streaming size-limit behavior.

The IoT API documentation does not settle collection-specific filtering beyond
the documented `rawData` example, nor paging, ordering, or server-side time
windows. General ORDS paging guidance is not substituted for an IoT contract.
These examples make one raw-data request and summarize only explicitly
selected local files for the other collections. Never expand them into page
loops or claim full-window statistics until current IoT-specific documentation
establishes the relevant query and continuation contract.
