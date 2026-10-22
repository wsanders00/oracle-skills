# Operations and diagnostics

Read this reference for managed-runtime capability checks, telemetry evidence,
replay, recovery, and troubleshooting. These are diagnostic patterns, not
claims about an untested runtime or authorization for a live operation.

## Capability probes

When managed behavior is uncertain, use a small non-publishing probe in an
approved target. Record the runtime and node versions, input type, available
globals, return behavior, asynchronous completion behavior, module
availability, and empty or failed result shape.

A probe qualifies only the exact surface tested. Do not turn it into a
workaround for an unsupported module or assume that local Node.js behavior,
`Buffer`, top-level `await`, arbitrary npm modules, shell access, or local
runtime configuration is available. Keep decoding pure and move I/O to
documented supported nodes.

## Evidence stages

A green status, accepted transport response, or snapshot row is not proof of
correct telemetry. Track the stages separately:

| Stage | Question | Limit of the evidence |
| --- | --- | --- |
| Received | Did the intended message reach the intended input? | Does not prove decoding or delivery. |
| Decoded | Did the transform produce a validated canonical value? | Does not prove transport or normalization. |
| Accepted | Did the target accept the request? | Does not prove normalization, history, or presentation. |
| Normalized | Did the intended target fields receive the expected values? | Check identity, fields, and rejection details. |
| Historized | Was the observation stored with its intended source time? | Verify separately from the current snapshot. |
| Presented | Does the consumer show the intended observation and age? | Presentation can lag, transform, or hide upstream failures. |

Use a stable correlation key and evidence timestamp at every stage.

## Route matrices

Make gateway-to-child routing inspectable before changing mappings. Record the
input, authenticated gateway, external key, child association, envelope root
or `contentRoot`, source path, target field, timestamp path, expected result,
and the evidence boundary.

Change one route hypothesis at a time. Payload validation, editor acceptance,
runtime normalization, history, and presentation are distinct checks. Consult
the current [gateway target](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/gateway-target-content-root.htm)
and [JQ mapping](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/jq-adapter-mapping-reference.htm)
references for the selected adapter instead of generalizing from an example.

## Timestamp provenance and replay

Name the clock at every hop: source observation, gateway receipt, ingress
receipt, republish, normalization, and presentation refresh. Preserve source
observation time when that is the contract, including precision and timezone.
Never describe a receipt clock as independently measured sensor time.

Replay is a side effect, not a neutral read. Prefer a disposable target. For an
approved live replay, pin the source identity, target, send count, time window,
and cleanup or review plan. An old sample can look current if a flow substitutes
a later receipt time, and replay can affect snapshots or history.

## Delivery, retry, and quarantine

Where durable recovery is required, define an explicit state model:

1. Preserve source identity and the validated body before dispatch.
2. Distinguish accepted, rejected, timed-out, and accepted-but-unconfirmed
   outcomes.
3. Reconcile an uncertain send before retrying and fence stale workers.
4. Retry only bounded transient failures; route malformed, oversized, or
   unsupported input to a terminal quarantine path.

Do not promise exactly-once processing. Transport acknowledgement, consumer
delivery, and application side effects are different contracts. Qualify MQTT
QoS, retained state, sessions, shared consumers, reconnect behavior, and
ordering against the actual endpoint and client.

## Flow replacement and recovery

Treat managed flow replacement as replacement of the complete flow document,
not as an extra backup slot. Preserve the authoritative export and inventory
its node versions, config-node references, adapters, models, schedules, wires,
and secret-backed references. Keep secret recovery procedural; exports must not
contain secret values.

A prior flow export cannot undo changed data, restore model history, or prove
that credentials and managed connections can be re-established. Test
restoration in isolation when possible and state what remains unproven. Recheck
the current [managed editor](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/node-red.htm)
and [Flow Runtime](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/flow-runtimes.htm)
documentation before replacement.

## Layered diagnosis

Diagnose the narrowest failing layer first:

1. Access and route: safe DNS, network, TLS, authentication, and authorization
   signals without exposing credentials.
2. Source freshness: last intended arrival and source time.
3. Decode: input type, identity, size, wrapper, schema, and transform output.
4. Transport: intended target and acceptance outcome.
5. Normalize and historize: rejection reason, target fields, source time,
   snapshot, and history.
6. Present: displayed value and age compared with normalized evidence.

Use scoped Catch, Status, and logging paths where supported. Preserve
correlation without logging full messages or secret-bearing configuration. A
restart is a hypothesis with a cost, not a default response. Node-RED's
[message](https://nodered.org/docs/user-guide/messages),
[error-handling](https://nodered.org/docs/user-guide/handling-errors), and
[flow-structure](https://nodered.org/docs/developing-flows/flow-structure)
guidance provides portable semantics but does not emulate OCI behavior.

## Ownership boundaries

This skill may explain documented managed Flow Runtime lifecycle, managed
nodes, OCI host and twin roles, and bounded service checks. Route self-hosted
installation, process management, filesystem ownership, arbitrary palette
installation, and local broker administration to self-hosted Node-RED
guidance. Treat database transaction ownership, queue retry or expiry policy,
and driver-object lifetimes as separate selected-contract work rather than
universal OCI Flow Runtime behavior.
