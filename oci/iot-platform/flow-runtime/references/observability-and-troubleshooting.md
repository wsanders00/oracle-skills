# Observability and troubleshooting

Read this reference when a Flow Runtime flow is inactive, loses data, or
produces an unexpected command or notification. Claim owner: `FR-OBSERVE-001`
(mutable service; recheck at implementation, promotion, and at least every 90
days). Use Oracle's [IoT troubleshooting guide](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/troubleshooting.htm),
[metrics reference](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/metrics-reference.htm),
[events reference](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/events.htm),
and [managed editor guide](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/node-red.htm)
for current service terminology.

## Evidence stages

Keep these stages separate; a green status or accepted transport response is
not downstream proof:

| Stage | Evidence to capture | What it does not prove |
| --- | --- | --- |
| Received | input identity, topic/object, arrival time | decode or delivery |
| Decoded | input type, validated fields, source time | transport acceptance |
| Accepted | target identity, response/request ID | normalization or history |
| Normalized | twin identity, fields, rejection reason | persistence or presentation |
| Historized | source time and history query result | current snapshot or delivery |
| Presented | displayed value and age | upstream correctness |

Use one correlation ID from source through transform, queue record, command,
and notification. Record source observation time separately from receipt,
normalization, and presentation times. Evidence packets must contain bounded
metadata and redacted summaries, never credentials or full production payloads.

## Read-only-first decision trees

Every branch begins with inspection. A restart, redeploy, replay, or
configuration change is a gated hypothesis and must not be the default remedy.

### Runtime inactive or work request failed

```text
Inspect runtime lifecycle state, latest work request state/error, request ID,
and effective flow/configuration
  -> work request still running: wait/observe within its bounded window
  -> failed: preserve error and request evidence; check IAM/network/config
  -> active but no flow activity: inspect deployed document, inputs, logs/metrics
  -> evidence identifies a reversible hypothesis: request separate approval
     for change/redeploy, capture backup, then re-read effective state
```

Do not call a submitted work request complete. Lifecycle completion and
effective deployed state are separate evidence.

### Editor access or Deploy failure

```text
Inspect target identity, user role, session/error/request ID, and runtime state
  -> access denied/expired: resolve user IAM/session ownership (no credential dump)
  -> editor loads but Deploy fails: inspect flow validation and work request/logs
  -> concurrent edit suspected: retrieve current document, review/merge explicitly
  -> change proposed: gate Deploy and verify effective flow after completion
```

Viewer/Editor access and runtime resource-principal access are different
permissions.

### Invalid or incomplete flows JSON

```text
Read current complete flows document and preserve an external backup
  -> parse/schema/wire error: stop; repair offline and review
  -> valid but incomplete document: stop; do not replace the whole runtime
  -> current document changed: retrieve fresh ETag and re-review
  -> approved replacement: use if-match, stop on stale precondition/412,
     then re-read the effective document
```

Never treat a partial export as a safe merge. Credentials are references and
may require separate reconfiguration after restore.

### External endpoint or shared MQTT failure

```text
Inspect target/topic, client identity (unique or approved shared group),
subscription shape, last received evidence, and sanitized TLS/network errors
  -> no connection: inspect DNS, route, NSG, port/TLS and endpoint contract
  -> shared group only: inspect group prefix, member/client IDs, and ownership
  -> received but rejected: inspect topic/payload validation and QoS contract
  -> accepted transport but no downstream value: continue at normalize/history
```

Do not infer broker or device-host reachability from a local fixture.

### File Storage activation or mount failure

```text
Inspect effective storage configuration, lifecycle/work request state,
mount path, subnet/NSG/route, and resource-principal policy
  -> config absent/replaced: compare with captured prior configuration
  -> mount path invalid/unavailable: validate path and target file system
  -> access failure: inspect IAM and network evidence without secret material
  -> change/retry proposed: obtain separate approval, then re-read effective state
```

Static configuration proves neither mount availability nor read/write access.
Local runtime storage is ephemeral; choose File Storage, Object Storage, or a
database deliberately for durable state.

### Resource-principal 401/403/NotAuthorizedOrNotFound

```text
Inspect exact service target, operation, region/compartment, runtime identity,
request ID, and policy evaluation/error class
  -> 401: inspect runtime authentication/resource-principal setup
  -> 403: inspect least-privilege policy and target ownership
  -> NotAuthorizedOrNotFound: distinguish missing target from hidden access
  -> proposed policy/config change: gate it; re-test read-only first
```

Do not paste OCIDs, tokens, or full authorization headers into an evidence
packet.

### Raw data present but normalized/history absent

```text
Start after Received/Accepted evidence; inspect raw payload, adapter/model,
twin identity, source time, normalized rejection, and history query
  -> raw absent: return to ingress/transport
  -> raw present, decode invalid: repair payload contract and replay only if gated
  -> decoded but not normalized: inspect adapter mapping/model/identity
  -> normalized but no history: inspect persistence/history path and source time
  -> history present but UI stale: inspect presentation refresh/cache and age
```

Do not accept ingress success as proof of adapter evaluation or history.

### Invalid queue/object selection or payload

```text
Inspect queue type/subscriber, object name/index, response type, byte/text type,
headers, required columns, size, and correlation
  -> wrong queue or subscriber: stop and correct selection through review
  -> missing object: preserve unchanged index and object evidence
  -> bytes parsed as CSV without UTF-8 conversion: fix offline transform
  -> malformed row/schema: quarantine or terminal-fail by stated policy
```

### Command refusal, timeout, or missing status

```text
Inspect normalized record ID, command request/response ID, target device,
subscription state, status rows, attempt count, and deadline
  -> refused/rejected/expired: terminal final route; do not retry automatically
  -> response missing: bounded retry/reconciliation only with same correlation
  -> accepted/prepared/sent/pending/responded: poll only within count/deadline bound
  -> no response by bound: terminal not-responded/deadline evidence
  -> status ID mismatch or malformed: terminal bad-response
```

### Notification publish versus subscriber delivery

```text
Inspect formatted title/body, topic identity, publication request/response ID,
and publish timestamp
  -> publication not accepted: inspect Notifications policy/target and stop
  -> publication accepted: separately inspect subscriber endpoint and delivery
  -> no subscriber confirmation: report presentation unproven; do not republish
     repeatedly without an approved idempotency/retry policy
```

### Missing runtime log records

```text
Inspect effective log configuration, category/level, time window, runtime ID,
request/correlation ID, and service log availability
  -> logging not configured: record gap; configuration change is gated
  -> configured but empty: compare UTC window and stage-specific correlation
  -> records exist: correlate with lifecycle/metric/event/work-request evidence
  -> no records after checks: report observability gap, not flow success
```

The Node-RED Debug sidebar is authoring-session evidence; it is not the same as
managed runtime logs, metrics, or events.

## Evidence packet template

Copy this structure into an approved, redacted incident record. Keep values
sanitized and bounded.

```yaml
target:
  runtime: <sanitized-runtime-id>
  region: <region>
  compartment: <sanitized-compartment>
  source_identity: <device-or-object-summary>
request:
  request_id: <request-id>
  work_request_id: <work-request-id-or-none>
  operation: <read-only-operation>
  observed_state: <state-and-time>
correlation:
  record_id: <record-or-command-id>
  source_time: <observation-time-or-unknown>
  evidence_time_utc: <collection-time>
stages:
  received: <proven|unproven>
  decoded: <proven|unproven>
  accepted: <proven|unproven>
  normalized: <proven|unproven>
  historized: <proven|unproven>
  presented: <proven|unproven>
logs:
  search_window_utc: <start/end>
  runtime_log_reference: <sanitized-reference>
  summary: <redacted-bounded-summary>
last_independently_proven_stage: <stage>
live_gap_or_next_gated_hypothesis: <explicit-gap>
```

## Boundary

These trees and the [operations and diagnostics](experience-derived-guidance.md)
reference organize evidence; they do not prove service health, IAM,
reachability, adapter normalization, database/AQ behavior, command response,
notification delivery, or effective deployed state. Follow the
[live-operation gates](safety-and-live-gates.md) before any access, replay,
restart, redeploy, configuration change, or cleanup.
