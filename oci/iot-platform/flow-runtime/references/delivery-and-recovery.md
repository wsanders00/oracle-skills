# Delivery, interruption, and recovery contracts

Read this reference when a flow sends telemetry, dequeues work, publishes a
command or notification, or must recover after an interruption. These are
layered contracts; no offline case proves live delivery.

## Layer evidence instead of one green result

Record a correlation key and evidence timestamp at each stage:

`received → decoded → accepted → normalized → historized → presented`

Transport acknowledgement proves only that a transport accepted a request.
It does not prove adapter evaluation, digital-twin normalization, database
history, command completion, notification topic publication, or subscriber
delivery. Empty dequeue is no-work; it is not proof that a queue is broken.

## Bounded delivery state

For every outbound message or command, preserve source identity and validated
body before dispatch. Model at least `prepared`, `accepted`, `rejected`,
`timed_out`, `accepted_unconfirmed`, and terminal `completed`/`refused` states.
Retry only bounded transient failures. If acceptance is uncertain, reconcile
by correlation key before retrying; fence stale workers. Malformed,
unsupported, oversized, or terminally refused input goes to quarantine/final
output and cannot re-enter retry.

For command polling, preserve the command request/response correlation or
record ID on every transition, set a fixed maximum poll count and deadline,
and route final and retry outcomes to distinct output ports. A response that
was accepted by the command endpoint is not device completion. `refused`,
`expired`, `bad_response`, `not_responded`, and deadline exhaustion are
terminal or bounded-retry decisions according to the selected contract; never
use an unbounded loop.

For Notifications, formatting a title/body and publishing to a Notifications
topic are separate from subscriber delivery. Record topic publication
acceptance and subscriber confirmation as separate evidence stages. The
resource principal must have the target topic policy, but a local formatter
cannot prove that policy or delivery.

Use [delivery/recovery cases](../assets/runtime/delivery-recovery-cases.json)
for deterministic state transitions, retry fencing, deadline bounds, and
publication-versus-delivery separation.

## Interruption and restore

Flow replacement, deactivation/activation, and managed software updates can
interrupt processing. Before an intentional change, back up the complete flow
document and persist required state outside local runtime storage. After the
change, re-read lifecycle and effective flow state, inspect node/configuration
availability, and run only approved bounded checks. Recovery of a flow export
does not restore changed data, queue history, command outcomes, credentials,
or downstream subscriber effects.

If a worker stops after a send but before recording the result, do not blindly
replay. Reconcile the target using the preserved correlation key, then decide
whether a bounded retry is safe. Exactly-once processing is not promised by a
generic Node-RED flow, MQTT QoS, queue operation, or notification publication.

## Offline and live boundaries

Offline fixtures can prove serialization, state transition tables, correlation
preservation, quarantine, bounded polling, and notification formatting. They
cannot prove broker/device reachability, OCI IAM/resource-principal access,
adapter normalization, queue visibility/expiry, command execution, database
commit, Notifications publication, or subscriber delivery.

| Claim ID | Owner | Source IDs / anchor | Sensitivity | Recheck |
| --- | --- | --- | --- | --- |
| `FR-DELIVERY-001` | this reference | `O1`, `S4`, `N2`, `N4` — node messages and error boundaries | stable/target-specific | implementation and promotion; inspect selected node contract for live use |
| `FR-RECOVERY-001` | this reference | `O1`, `O2`, `N3` — backup, interruption, persistence boundary | mutable service | implementation, promotion, and before recovery guidance |
| `FR-EVIDENCE-001` | this reference | `O6`, `C6`, `C7`, `C8`, `C12` — layered diagnosis/ops evidence | mutable/target-specific | implementation, promotion, and target inspection for live use |

## Live gate

Live delivery requires separately approved target, identity and policy, network
route, payload/topic, queue or device state, bounded send/poll count, deadline,
rollback/quarantine plan, and evidence collection. For commands, explicitly
approve command-invoke policy and active device subscription. For
Notifications, explicitly approve topic publication policy and subscriber
confirmation. Stop when any gate is missing.
