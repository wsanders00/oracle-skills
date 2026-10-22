# IoT, OCI, and scenario node contracts

Read this reference when a flow publishes device telemetry, receives device
messages, sends a command, uses an Object Storage or Notifications scenario
role, or considers an ORDS, digital-twin, or flow-originated logging node. It
contains managed workflow evidence boundaries and conditional pinned-package
contracts. Resolve the selected managed node through its target help before
using package-specific fields.

## Managed flow evidence

Select the exact registered type, owning module/version and configuration
parent from the managed target. Verify its input/output and authentication
contract for the requested operation. A managed `oci-config` or
`iot-send-command` is usable through that contract even when equivalence to
the sample package is unknown. If a telemetry or subscription type is absent,
record the target limitation and evaluate an independently supported route.

For publication, distinguish submitted request, transport/service acceptance,
adapter normalization and current/history readback. For subscription, verify
the actual source and protocol before applying MQTT rules. For commands,
distinguish request acceptance, returned correlation and observed device
completion. These evidence stages apply across implementations; exact message
properties, defaults, precedence and output fields do not.

The implementation details below belong to the pinned sample package unless
explicitly attributed to an Oracle scenario. Apply a detail only where
affirmative evidence establishes it for the selected managed implementation.
Matching type names or versions alone does not satisfy that check.

## Source ownership and classification

The managed Flow Runtime editor documentation (source `O1`) owns the four
managed palette roles: `iot-config` (palette label **OCI Config**),
`telemetry`, `subscribe`, and `send command`. Oracle's published workflow
pages own the scenario roles: Object Storage in `C11` and Notifications in
`C12`. The public Oracle node reference (`S4`) is a separate package source;
it is not evidence that a package node is installed in a managed runtime.

The source manifest pins the Oracle sample package to release `0.6.0`, commit
`d1f886fed04f456b28527d578be140fbc7a6c2f1`, and the node-reference file at
that commit. This makes package-specific behavior attributable to that exact
source revision, but it still does **not** prove that the selected Flow
Runtime palette/version accepts the module. Keep package guidance
compatibility-gated and do not turn a sample-package node into a managed
service guarantee.

| Surface | Exact identity | Classification | Authentication boundary | Source owner and gate |
| --- | --- | --- | --- | --- |
| Managed editor | `iot-config` / **OCI Config** | managed-documented | OCI configuration (for example, the target's supported config-file, instance-principal, resource-principal, or API-key mode) | `O1`; inspect target palette/version and policy |
| Managed editor | `telemetry` | managed-documented | linked managed OCI Config | `O1`; inspect target palette/version and endpoint policy |
| Managed editor | `subscribe` | managed-documented | linked managed OCI Config | `O1`; inspect target palette/version and source permissions |
| Managed editor | `send command` | managed-documented | linked managed OCI Config and command policy | `O1`; inspect target palette/version and response contract |
| Oracle sample package | `iot-config` | sample-package | device-side MQTTS credentials/certificate and TLS session | `S4` at pinned `0.6.0` commit; target palette gate required |
| Oracle sample package | `iot-telemetry` | sample-package | device-side MQTTS session | `S4` at pinned `0.6.0` commit; target palette gate required |
| Oracle sample package | `iot-subscribe` | sample-package | device-side MQTTS session | `S4` at pinned `0.6.0` commit; target palette gate required |
| Oracle sample package | `oci-config` | sample-package | OCI SDK/API authentication | `S4` at pinned `0.6.0` commit; target palette gate required |
| Oracle sample package | `iot-send-command` | sample-package | OCI SDK/API authentication | `S4` at pinned `0.6.0` commit; target palette gate required |
| Oracle scenario | Object Storage download/upload role | official-scenario | runtime resource principal and Object Storage policy | `C11`; node installation, policy, and reachability are live-only |
| Oracle scenario | Notifications publication role | official-scenario | runtime resource principal and Notifications policy | `C12`; topic existence and subscriber delivery are live-only |
| Optional package role | ORDS, digital-twin content/relationship, Logging, or Log Analytics | sample-package / compatibility-gated | selected package auth configuration | `S4`; immutable revision and target palette inspection required |

The name `iot-config` alone is ambiguous. Ask whether the request means
managed **OCI Config** or sample-package **device MQTTS** configuration. Never
use OCI API credentials as device credentials, and never use a device MQTTS
certificate or password as OCI API authentication. The sample `oci-config` is
the cloud/API family; it is not an alias for either meaning of `iot-config`.

These contracts support `FR-IOT-TRANSPORT-001`,
`FR-SCENARIO-NODE-CONTRACTS-001`, `FR-IOT-EXTENSIONS-001`, and
`FR-FLOW-LOGGING-NODES-001`. The broader managed-versus-sample classification
remains owned by `FR-NODES-001`.

## Device MQTTS transport

Use this section only when the selected source is the device-side package
family (`iot-config`, `iot-telemetry`, or `iot-subscribe`). A device session
has a separate credential/certificate boundary, a TLS transport boundary, and
a client identity boundary:

- Keep username/password, client certificate, private key, and CA material in
  the target's approved credential mechanism; use synthetic placeholders in
  flow examples. MQTTS normally means TLS and the documented device port
  `8883` for this package family, but the target/package revision remains the
  authority.
- Assign a unique client ID to each simultaneously connected client. A
  duplicate ID is a collision/reconnect risk, not a harmless naming detail.
  A shared subscription group does not remove the requirement for unique
  client IDs across runtime instances.
- Treat persistent session, reconnect count/backoff, keepalive, connect and
  operation timeouts as selected policy. Do not present an unbounded reconnect
  loop as a default. A proxy is not implied by TLS; if the selected node does
  not support a proxy, stop at a compatibility gate rather than silently
  routing through one.
- QoS is per operation and must be one of `0`, `1`, or `2`. An override must
  be validated before transport. QoS acceptance is a protocol/service stage,
  not proof of device application processing.

The managed `telemetry` and `subscribe` roles are not evidence of an MQTTS
client session. Conversely, a successful local/device MQTT session does not
prove OCI API authorization, adapter normalization, or history persistence.

## Telemetry publication

For managed publication, use the selected publisher's supported topic, payload
and authentication fields. Do not infer its transport, timestamp behavior or
QoS from a documentation role or the sample node.

### Conditional pinned `iot-telemetry` implementation

The following transformation and precedence rules describe the pinned package
only; they are not a contract for every managed telemetry node:

1. Resolve the topic using the source implementation's precedence: a non-empty
   configured `Topic` wins; only when it is blank is trimmed `msg.topic` used.
   Reject an absent topic rather than inventing a device identity.
2. Preserve the source payload transformation. The pinned `iot-telemetry`
   node wraps a non-object payload as `{value: payload}` and passes an object
   through; it does not validate a telemetry schema. Because JavaScript's
   `typeof null` is `object`, a null payload is serialized and passed through
   unchanged when auto-timestamp is off, but auto-timestamp attempts
   `payload.time` and fails with a TypeError before publish. Arrays also take
   the object branch and are serialized as arrays unchanged; an auto-timestamp
   assignment to an array's named `time` property is not included by
   `JSON.stringify`.
3. The pinned package's `addTimestamp` option inserts
   `Math.floor(Date.now() * 1000)` (epoch **microseconds**) when
   `payload.time == null`; this includes both missing and explicit `null`.
   Existing values—including strings, zero, milliseconds, or other units—are
   preserved without unit or range validation. Auto-timestamp is disabled by
   default. A fixture timestamp is synthetic and deterministic; do not replace
   a source timestamp without an explicit policy.
4. The configured QoS is normalized with `Number(...)` and defaults to `1` if
   invalid; configured `null` or an empty string therefore normalizes to `0`.
   A runtime `msg.qos` of `0`, `1`, `2`, numeric text, or an empty string
   overrides it (the empty string normalizes to `0`); runtime `null` or
   `undefined` is ignored. Any other invalid runtime value warns and falls back
   to the configured QoS. It does not route that invalid override
   to a node error. QoS selection is independent
   of payload shape: null and array payloads retain the same valid configured
   or runtime QoS behavior whenever the payload stage itself does not fail.
5. Treat publish/service acceptance as the end of this node contract. It does
   not prove digital-twin adapter normalization, data-host persistence,
   historization, downstream application consumption, or device processing.

The external-broker topic rewrite in the existing ingress fixture is a pure
preparation example. It is not a telemetry publish and does not establish
device-host acceptance.

## Subscription and command-response boundaries

For a managed subscription, establish its actual source, protocol, filters and
outputs first. Apply the MQTT wildcard rules below only to an established MQTT
path.

### Conditional pinned `iot-subscribe` implementation

The package node uses a device MQTTS session. Its parser, topic suffix and QoS
details are conditional package behavior:

- `+` occupies exactly one complete topic level; it cannot be embedded in a
  level such as `sensor+`.
- `#` occupies a complete level and must be the final level. `a/#` is valid;
  `a/#/b`, `a#`, and `a/#suffix` are invalid.
- The pinned package's subscription QoS is normalized to `0`, `1`, or `2`,
  falling back to `1` for invalid configuration; configured `null` or an empty
  string normalizes through `Number(...)` to `0`. Preserve the full received
  topic. `iot-config` attempts `JSON.parse(message.toString())` before calling
  the subscriber: every valid JSON value (object, array, number, boolean, or
  `null`) is emitted as the parsed value, while invalid JSON is emitted as the
  original string.
- The pinned `topicSuffix` implementation is exact: for a pattern ending in
  `/#`, remove that literal prefix plus slash and return the remainder; for a
  fixed topic, a `+` pattern, or the exact `#` pattern, return the last segment
  of the received topic. Thus `devices/a/#` plus `devices/a/cmd/open` yields
  `cmd/open`, while `#` plus `devices/a/cmd` yields `cmd`. The source matcher
  also accepts `devices/a` for `devices/a/#`; in that edge the suffix is the
  full received topic (`devices/a`), not an empty suffix.

Receipt of a subscribed message is not a command acknowledgement. The
subscription node does not automatically publish a response. A flow that
acknowledges a command must have an explicit response-publication node and a
separate topic/payload contract, with correlation preserved.

## Send-command contract

For a managed command, verify the selected node's configuration parent, request
and response fields, duration bounds, output correlation and error handling.
Design from that contract and establish completion independently of request
acceptance. A familiar node name does not select the implementation below.

### Conditional pinned `iot-send-command` implementation

Link the package node to its selected OCI API configuration and supply the
exact request endpoint.
`Request Endpoint` is required and may be overridden by `msg.requestEndpoint`;
it is the endpoint/topic the device or gateway subscribes to. Do not synthesize
an endpoint from a device MQTT host. `Response Endpoint` is a separate,
optional field: it is required and sent only when `Wait for Response` is
enabled, may be overridden by `msg.responseEndpoint`, and is omitted from the
output when wait is disabled.

The pinned source validates `Request Duration` on every call. It validates and
sends `Response Duration` only when wait is enabled. The accepted syntax is
the source regex after upper-casing: `P` followed by one or more numeric
date/time components (`Y`, `M`, `W`, `D`, and optionally `T` with `H`, `M`, or
seconds, including fractional seconds). Source examples include `PT10M`,
`PT1H`, and `P1D`; lowercase is normalized. The regex is syntax validation,
not proof of a positive or operationally bounded elapsed time. Record the
wait-for-response choice:

- **No wait:** call the request endpoint with request duration only. Report
  request acceptance plus `requestEndpoint`, `opcRequestId` when returned, and
  any returned `commandStatusLocation`/`recordId`; completion is not known.
- **Wait:** include response endpoint and response duration in the API request.
  The node waits through the OCI API response; it does **not** poll a status
  endpoint. Return the API response and any returned location/record ID.

`commandStatusLocation` is the location returned by the API, not the response
endpoint. When present, the pinned node parses the final URL path segment into
`recordId` and `rawCommandDataRecordId`; these are correlation evidence only.
They may be absent, and they must not be confused with `responseEndpoint`.

An accepted request is an `accepted-unconfirmed` state. A returned record ID is
correlation evidence, not device completion. A refused request, invalid
duration, missing endpoint, malformed response, or timeout follows the Catch
or node-error path. The send-command node itself has no status poll loop.
Reconciliation of an uncertain request must be bounded and must not resend
automatically unless idempotency is established.

The official monitoring scenario's SQL status polling is a distinct contract:
it reads a selected database record (and requires the database/AQ transaction
rules). It must not be silently replaced by an optional ORDS poller.

## Official-scenario Object Storage and Notifications roles

### Object Storage

`C11` establishes the batch workflow role, not a guaranteed palette node. A
download contract resolves a namespace, bucket, object name, and (if the node
supports it) a file path. Download success must precede sequential-index
advance. A failed, missing, or malformed object leaves the index unchanged and
routes to the selected error/Catch path.

The node output is commonly a Buffer for object bytes. Choose an encoding
explicitly (for example, UTF-8) before text/CSV parsing and retain metadata
such as object name, size, ETag, or request ID only when the selected node
actually returns it. Upload is a separate operation: resolve the destination
object and content, and treat service acceptance as the upload result. Neither
download nor upload proves device-host publication, adapter normalization,
database persistence, or subscriber delivery.

Resource-principal policy, namespace/bucket/object existence, network route,
module installation, and effective service response are live-only evidence.

### Notifications

`C12` establishes the notification role. Resolve the topic and title/body from
the prepared message, then allow only documented runtime overrides. Keep the
publish result and returned message ID/correlation in the output. A failed
publish follows Catch/error routing and must not be presented as a successful
alert.

Notifications publication acceptance proves only that the service accepted a
publish request. It does not prove topic fan-out, subscriber receipt, email or
SMS delivery, downstream processing, or retention. Topic policy, target
existence, network reachability, resource-principal authorization, and
subscriber confirmation remain live-only checks.

## Optional compatibility-gated OCI extensions

These roles are useful only after an immutable package revision, exact files
and headings, target palette/version, dependency review, authentication
context, and live approval are recorded. Without those facts, the cases in
the companion fixture are bounded shape examples only.

- **ORDS:** an `ords-config` role owns endpoint/token/client-secret
  configuration; base and token URLs must be HTTPS and both OAuth client
  credentials are required. Its timeout and polling limits are input-driven,
  finite defaults/bounds. A one-shot request returns status/body/headers or a
  Catch error; polling uses a deadline-aware finite interval, concurrency, and
  queue limits. A `401` may trigger one explicit token refresh/retry, not a
  generic retry loop. Command polling terminals are exactly `COMPLETED`,
  `FAILED`, `EXPIRED`, `NOT_RESPONDED`, and `REFUSED`; `CANCELED` is not an
  invented terminal. Never place tokens, client secrets, endpoint URLs, OCIDs,
  or response bodies containing secrets in fixtures.
- **Digital-twin content and command/data modes:** distinguish raw command,
  raw data, rejected data, snapshot, historized data, and custom relative-path
  request modes. A content-read role returns content plus only the metadata,
  ETag, and request ID actually supplied by the selected node. These roles do
  not establish full digital-twin CRUD, adapter normalization, or history
  correctness.
- **Relationship-content update:** the key is the exact string form
  `sourceTwinOcid->targetTwinOcid:contentPath`; each parsed part must be
  non-empty after trimming. The pinned parser splits at the first `->` and
  first `:`, so extra delimiters inside a part are currently accepted by the
  implementation even though they are outside the intended grammar. The
  implementation's effective key precedence is also narrower than the prose
  fallback: a non-null `msg.relationshipKey` is selected first (an exact empty
  string then permits `msg.payload.relationshipKey`), otherwise the configured
  default is selected; the payload key is not consulted when a non-empty
  configured default already exists. Content uses `msg.content` whenever the
  property exists (even `null`), otherwise `msg.payload.content` whenever the
  payload is a plain object (even when that property is absent), otherwise the
  configured JSON-object default. A successful update is service acceptance
  only; it is not proof of a complete relationship or digital-twin CRUD
  workflow.
- **Flow-originated logging:** OCI Custom Logging and Log Analytics upload
  roles are distinct from Flow Runtime system-console logging configuration.
  Upload acceptance is an API stage; log searchability, indexing, retention,
  analytics, and downstream alerts are separate evidence. Do not route a
  request for runtime logs to a flow-originated logging node or vice versa.

All optional polling and queue behavior must have finite bounds. A local case
may prove the state transition and redaction rule, but not token validity,
endpoint reachability, OCID existence, API acceptance, log searchability, or
effective digital-twin state.

## Offline evidence and cannot-prove boundary

The companion [IoT/OCI node contract cases](../assets/nodes/iot-node-contract-cases.json)
exercise authentication-family selection, topic and wildcard validation, QoS,
timestamp and payload decisions, command acknowledgement stages, scenario
node boundaries, and bounded optional extensions. They are deterministic and
network-free.

Offline cases can prove classification, input/output shape, explicit routing,
correlation preservation, bounded state transitions, and refusal of ambiguous
or unsafe designs. They cannot prove:

- managed palette installation, sample module availability, package/version
  compatibility, or target region support;
- OCI IAM/resource-principal policy, API keys, device credentials,
  certificate validity, token refresh, endpoint reachability, or network/TLS
  behavior;
- MQTT broker/device delivery, persistent-session or reconnect behavior,
  device command completion, telemetry normalization, digital-twin history, or
  database/AQ state;
- Object Storage or Notifications service acceptance, subscriber delivery,
  ORDS responses, relationship/content effective state, or Logging/Log
  Analytics indexing and searchability; or
- any production OCID, endpoint, payload, secret, or generated runtime state.

Before live use, inspect the target palette and version and separately approve
the exact authentication, network, endpoint, topic/object policy, transaction,
retry, correlation, observability, and cleanup plan. Passing the fixture is
offline readiness only.

## Routing examples

| Request shape | Route |
| --- | --- |
| “Use `iot-config`” with no further context | Ask whether managed OCI Config or sample device MQTTS config is intended |
| Publish telemetry | Select the supported publisher in the managed target; use verified fields and separate service acceptance from normalization/history; consult package details only when applicable |
| Subscribe to commands | Validate wildcard/QoS and parsed-versus-string output; design explicit command-response publication |
| Send a command and know whether it completed | Use managed send-command plus its documented status/correlation contract; keep accepted request separate from completion |
| Poll command status | Use the selected official SQL flow contract or an explicitly gated ORDS extension; do not merge them |
| Download/upload Object Storage or publish Notifications | Route to the official-scenario role and require the target palette/live policy gate |
| Read content/update a relationship or call ORDS | Use only the optional compatibility-gated extension contract |
| “Show runtime logs” vs “send flow logs to OCI” | Route the former to Flow Runtime system-console logging and the latter to a flow-originated logging role |
| Fusion SCM, self-hosted Node-RED, or arbitrary community module | Route outside this skill; do not broaden the contract |
