# Optional OCI node contracts (pinned sample package)

Use this reference when a flow names one of the optional OCI service or ORDS
nodes below. These are **sample-package** contracts, not managed Flow Runtime
palette guarantees. The source is Oracle's `oci-nodes` package release `0.6.0`
at commit `d1f886fed04f456b28527d578be140fbc7a6c2f1` (source IDs `O7`/`S4`).
The package pin makes the recorded behavior attributable to one immutable
revision; it does not establish that a selected Flow Runtime permits the
module, dependencies, or target API. Start managed-node discovery with the
[selected target](node-reference.md#managed-target-selection). A managed node
with the same registered type remains usable through its own verified
contract; apply a sample detail only after its applicability is established.

This reference owns `FR-SCENARIO-NODE-CONTRACTS-001`,
`FR-IOT-EXTENSIONS-001`, and `FR-FLOW-LOGGING-NODES-001` for the exact pinned
package behaviors below. Scenario ownership and target availability remain
separate evidence.

## Exact identity and source ownership

The package manifest registers each exact node type. The node HTML file owns
the palette label and configuration-parent type; the node JS file owns runtime
resolution, API call, and output behavior. The pinned [package manifest](https://github.com/oracle-samples/node-red-nodes/blob/d1f886fed04f456b28527d578be140fbc7a6c2f1/oci-nodes/package.json#L17-L33)
and [node reference](https://github.com/oracle-samples/node-red-nodes/blob/d1f886fed04f456b28527d578be140fbc7a6c2f1/docs/node-reference.md#L592-L729)
are the source-owned records.

| Exact type | Palette label | Configuration parent | Auth/API family | Source-owned implementation anchors |
| --- | --- | --- | --- | --- |
| `oci-object-storage` | `object storage` | `oci-config` | OCI SDK Object Storage | `oci-nodes/nodes/oci-object-storage.html:37-55`; `oci-nodes/nodes/oci-object-storage.js:82-140, 165-262` |
| `oci-notification` | `notification` | `oci-config` | OCI SDK Notifications data plane | `oci-nodes/nodes/oci-notification.html:37-52`; `oci-nodes/nodes/oci-notification.js:41-116` |
| `ords-config` | `ORDS Config` (config node) | none | HTTPS OAuth 2.0 client credentials | `oci-nodes/nodes/ords-config.html:37-54`; `oci-nodes/nodes/ords-config.js:40-59, 219-249, 330-477` |
| `oci-ords-request` | `ords request` | `ords-config` | ORDS bearer token | `oci-nodes/nodes/oci-ords-request.html:37-73`; `oci-nodes/nodes/oci-ords-request.js:40-137, 139-171` |
| `oci-ords-poll` | `ords poll` | `ords-config` | ORDS bearer token | `oci-nodes/nodes/oci-ords-poll.html:37-60`; `oci-nodes/nodes/oci-ords-poll.js:92-220` |
| `oci-logging` | `logging` | `oci-config` | OCI Logging Ingestion API (`LoggingClient.putLogs`) | `oci-nodes/nodes/oci-logging.html:125-141`; `oci-nodes/nodes/oci-logging.js:43-77, 97-191` |
| `oci-log-analytics` | `log analytics` | `oci-config` | OCI Log Analytics `uploadLogEventsFile` | `oci-nodes/nodes/oci-log-analytics.html:130-147`; `oci-nodes/nodes/oci-log-analytics.js:43-96, 98-209` |

The official Flow Runtime scenarios still own workflow roles: `C11` uses an
Object Storage batch download/upload role and `C12` uses a Notifications
publication role. Those scenario records do not establish these exact package
types. Conversely, package registration does not establish a managed palette.
Keep both records visible.

## Target gate and cannot-prove boundary

Record evidence for the relevant configuration fields, output shape and
authentication in the target implementation. Matching package names and
versions or permission to install a module does not establish equivalence.

Before live use, record all of the following for the selected Flow Runtime:
target runtime/version and region, exact palette label/type, permitted module
and dependency versions (the package declares `oci-sdk` `2.137.0` and `mqtt`
`5.15.2`), authentication context, network route, endpoint/object/topic/log
policy, and explicit live approval. A passing offline case is only a shape and
routing check.

Offline evidence cannot prove package installation or compatibility, dependency
permission, OCI credentials/IAM/resource principal, endpoint or network/TLS
reachability, Object Storage/Notifications acceptance or subscriber delivery,
ORDS token validity/response, digital-twin effective state, Logging ingestion,
Log Analytics indexing/searchability, or any real OCID, URL, secret, file, or
runtime state.

## Decision contract

### Object Storage: `oci-object-storage`

Required effective values are `namespace`, `bucketName`, and `objectName`.
Resolution is runtime-first: for each field, a non-null, non-empty `msg` value
wins, and the configured value is the fallback (`msg.namespace`,
`msg.bucketName`, `msg.objectName`, `msg.operation`, `msg.filePath`,
`msg.contentType`, `msg.downloadOutput`, and `msg.encoding`). Operation is
`upload` or `download`; the source default is `upload`. Resolve operation and
the three required identifiers before branch selection. Thus configured `operation=download` takes the download branch
when `msg.operation` is absent, while a non-empty runtime operation overrides
the configured operation and then selects its own branch. This per-field
resolution is independent of upload body selection.

Validation order is namespace, bucket name, then object name. Missing values
route to Catch with `No namespace configured or provided in msg.namespace`,
`No bucket name configured or provided in msg.bucketName`, or `No object name
configured or provided in msg.objectName`, respectively; no client/service
call is made. The editor documents an absolute file path for download output;
fixture paths remain synthetic and do not establish filesystem permissions.
An operation other than `upload` or `download` errors instead of falling
through to upload. The pinned implementation obtains its client after the
three identifier checks but before operation and upload-body validation, so
those later validation failures prove no Object Storage API call—not that
credential/client initialization was avoided.

For upload, `msg.payload` wins whenever it is present (including an empty
string, `0`, or `false`); only a null/undefined payload falls back to reading
`filePath`. Objects are JSON-stringified; Buffers, strings, streams, readers,
and `Uint8Array` values retain their byte-oriented behavior. The success
payload is a summary with `eTag`, `versionId`, `opcRequestId`, and
`statusCode`. If neither payload nor file path is available, the node errors
before `putObject` rather than attempting an empty or undefined upload.

For download, the response body is collected to a Buffer. `downloadOutput` is
`buffer` by default or explicitly converted to text using `encoding`. With no
file path, that Buffer/string is `msg.payload`; with a file path, the exact
path is written and `msg.payload` becomes `{ content, savedToPath, outputType }`
while `msg.savedToPath` is also set. Download metadata is added to `msg`:
`eTag`, `contentType`, `contentLength`, `versionId`, `opcRequestId`, and
`statusCode`. The editor documentation requires an absolute file path; keep
paths synthetic in fixtures and verify target filesystem policy separately.
Object Storage success is not device-host publication or downstream delivery.

### Notifications: `oci-notification`

The effective topic is `msg.topicOcid || configured topicOcid`; an empty topic
is an error. The effective title is `msg.title || configured msgTitle`, so a
non-empty runtime title wins but an empty runtime title does not clear a
configured title. Body has no runtime `msg.body` override: configured `msgBody`
wins when non-empty, otherwise a string payload is used directly and all other
payloads are JSON-stringified. The node calls `publishMessage` with
`{ topicId, messageDetails: { title, body } }` and outputs the SDK
`publishResult` as `msg.payload` plus `msg.statusCode`. Publication acceptance
is not topic fan-out or subscriber receipt.

### ORDS config: `ords-config`

`baseUrl` and `tokenUrl` are required HTTPS URLs. Client ID and client secret
are required Node-RED credentials; scope is optional. The implementation
checks required values before URL validation, so missing-credential and
non-HTTPS cases are distinct configuration errors. Validation parses a URL
and then checks its normalized protocol, so malformed `https:` is invalid and
an uppercase `HTTPS://` spelling remains HTTPS. Defaults and clamps are
driven by the config inputs and remain finite: request timeout `30,000 ms` in
`[1,000, 300,000]`, token fallback expiry `60` minutes in `[1, 1,440]`, max
concurrent polls `5` in `[1, 100]`, and max queued polls `100` in
`[0, 10,000]`. Invalid values use the documented default and values above the
maximum use the upper clamp, rather than creating an unbounded loop.

The config caches an OAuth token, coalesces concurrent token acquisition, and
refreshes once after a request receives `401`; it does not provide a generic
retry loop. Child paths must be relative; headers/query maps are plain objects
without reserved keys. Closing the config aborts active fetches and rejects
queued polls.

### One-shot ORDS: `oci-ords-request`

The operation defaults to `custom`. Presets map exactly to these relative paths:

| Operation | Relative path |
| --- | --- |
| `rawData` | `/20250531/rawData` |
| `rejectedData` | `/20250531/rejectedData` |
| `snapshotData` | `/20250531/snapshotData` |
| `historizedData` | `/20250531/historizedData` |
| `rawCommandData` | `/20250531/rawCommandData` |

In `custom` mode, `customPath` is required, trimmed, and relative; any URI
scheme and a leading `//` are rejected. An explicitly supplied `null` runtime
path does not fall back to configuration. A non-empty `recordId` is trimmed
and appended as raw path text; `/` characters therefore create multiple path
segments when the path is encoded. Use slash-free record IDs when one segment
is required. Runtime
`msg.operation`, `msg.method`, `msg.recordId`, and `msg.customPath` override
their configured counterparts. Runtime `msg.query` replaces configured query
JSON; `msg.queryParams` then extends/overwrites query keys (including `q`).
Null, undefined, and empty query-parameter values are omitted, while object
values are JSON-serialized. Non-object or array `msg.queryParams` values are
ignored. A whitespace-only record ID is not appended.
Configured headers are parsed first and `msg.headers` merges second with
case-insensitive runtime precedence. Configured headers must be JSON text;
configured `null` is treated as empty. Runtime headers normally use an object,
while `null`, `undefined`, and `""` are accepted as an empty map.
Header values must be strings, numbers, booleans, or arrays of those scalar
values; object, `null`, and `undefined` values are rejected. Reserved object
keys are rejected. The
configured method is validated before a runtime method override. Parsed query
objects also reject reserved keys. A configured JSON body is used for a
body-capable configured method; otherwise a body-capable runtime method falls
back to `msg.payload`. Blank configured body text is absent; nonblank invalid
JSON routes to Catch. `GET` and `HEAD` send no body.

Success passes through a copied message with response body in `msg.payload`,
`statusCode`, `responseHeaders`, `ordsUrl`, and `ordsOperation`. Validation and
HTTP errors use Catch/error handling; one-shot means no polling or implicit
resend.

### Bounded polling: `oci-ords-poll`

`commandStatus` requires a record ID from configuration or `msg.recordId` and
polls `/20250531/rawCommandData/<recordId>`. `custom` requires a relative
`customPath` from configuration or `msg.customPath` and stops on a dot-path
condition (`notEmpty`, `exists`, or `equals`). Runtime interval and timeout
override configuration, are floored/clamped to interval `[1, 300000]` ms and
timeout `[1, 3600000]` ms, and are always finite. Shared `ords-config`
concurrency and queue limits apply; a full queue fails fast.
Omitted bounds use `2000` ms and `60000` ms defaults; invalid runtime values
fall back to normalized configured values, and numeric text is accepted. The
pinned source treats a whitespace-only command record ID as present and then
trims it into `/20250531/rawCommandData/`; preserve that as source fidelity,
not as a recommended portable input.

Command polling recognizes delivery fields in a direct row or response
envelopes whose command object is `items[0]`, `item`, or `value`. `terminal`
stops on exactly `COMPLETED`, `FAILED`,
`EXPIRED`, `NOT_RESPONDED`, or `REFUSED`; `completed` requires `COMPLETED`;
`response` stops on present `response_data` (including when no delivery status
is present) or one of those terminal states. `CANCELED` is not a source-defined
delivery terminal. When response data alone completes a poll, the resulting
`deliveryStatus` field is explicitly `null` and must never be rendered as the
string `UNDEFINED`. The poll establishes a deadline
before its first request and checks the next interval against that deadline
after each response, so a terminal response is returned even when it arrives
at the deadline; otherwise the last nonterminal response is a timed-out
bounded result. Output includes the last body, `pollComplete`, `pollTimedOut`,
`pollAttempts`, `deliveryStatus`, status, headers, and URL. A timeout is not
completion evidence. Likewise, an offline response sequence that ends before
the finite attempt budget is exhausted is an incomplete timeline, not proof
that the source node timed out.

### Distinguish `iot-get-content` from ORDS snapshots

`iot-get-content` is a separate package node (`oci-config` parent) that calls
the OCI IoT SDK `getDigitalTwinInstanceContent` with a digital-twin instance
OCID and `shouldIncludeMetadata` flag. It returns current twin content plus
`etag`, `opcRequestId`, `statusCode`, and the resolved twin ID. It does not use
ORDS, IoT Data API paths, or polling.

`oci-ords-request` operation `snapshotData` is a generic one-shot HTTPS GET
shortcut for `/20250531/snapshotData`; its output is the ORDS response body and
HTTP metadata. A snapshot response is not proof of current digital-twin
content, and `iot-get-content` is not an alias for the ORDS snapshot endpoint.

### Two distinct logging APIs

`oci-logging` targets OCI Custom Logs using `LoggingClient.putLogs`. It requires
an effective `logId` (`config` first, then `msg.logId`), defaults source to
`node-red` and type to `application.events`, and lets non-empty runtime
`msg.logSource`, `msg.logType`, and `msg.severity` override their config. With
the default mappings source, rows read `msg.dequeued`, any `msg` path, or a
static value; with `payloadSource=payload`, `msg.payload` is serialized
directly. Object data receives a generated timestamp and default level when
missing. The serialized entry must be below 1 MiB. Output is a summary with
`opcRequestId` and `statusCode`.

`oci-log-analytics` targets Log Analytics using `uploadLogEventsFile`. Its
effective `namespace`, `logGroupOcid`, and `logSourceName` are configuration
first, then runtime fallback; all three are required. `entityOcid` follows the
same precedence, while runtime `msg.severity` overrides configured severity.
Mappings versus direct payload have the same source behavior and the serialized
log payload must be below 1 MiB. The upload body carries `logEvents`, source,
records, and optional entity/metadata. The request declares payload type
`JSON` while sending the serialized buffer as `application/octet-stream`;
output is a summary with `requestId` and `statusCode`.

Neither API is Flow Runtime system-console logging. API acceptance does not
prove indexing, retention, searchability, analytics, or downstream alerting.

The deterministic [optional-node cases](../assets/nodes/optional-oci-node-contract-cases.json)
exercise these precedence, output, error, identity, distinction, and bound
rules without network, OCI SDK, ORDS, filesystem, logging, or subscriber
calls.
