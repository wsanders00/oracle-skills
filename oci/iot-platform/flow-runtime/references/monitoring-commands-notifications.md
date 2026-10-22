# Normalized monitoring, commands, and Notifications

Read this reference for the normalized-data monitoring scenario and its bounded
command/status/notification path. Claim owner: `FR-MONITOR-001`
(scenario/target-specific; recheck at implementation and against the selected
palette before live use). See Oracle's [normalized monitoring, command, and
Notifications scenario](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/egress-iot-flow-runtime.htm).

## Normalized-data input

Select the `NORMALIZED_DATA` queue explicitly. A raw queue record is not a
normalized record, even if it happens to contain similarly named fields. The
illustrative record shape is:

```json
{
  "recordId": "r-05",
  "twinId": "twin-01",
  "deviceType": "hvacs",
  "externalKey": "child-01",
  "sourceTime": "2026-01-15T14:00:00.000Z",
  "metrics": { "temperature": 70 }
}
```

In Oracle's scenario, normalized events expose `digitalTwinInstanceId`,
`contentPath`, `value`, and `timeObserved`. The compact fixture aliases these
to `twinId`, `metrics`, and `sourceTime` so the identity/threshold function
remains pure; preserve the selected runtime's field names at the managed
Dequeue boundary.

Require the intended subscriber identity and queue type, handle an empty
dequeue as a no-op, and validate identity/source time before threshold logic.
Filter the digital-twin identity first; a high metric for another twin must not
trigger a command. Below-threshold, wrong-identity, wrong-queue, and malformed
records have explicit terminal/no-op outcomes.

## Command state machine

The flow shape is:

```text
dequeue NORMALIZED_DATA -> identity/filter/threshold -> send command
  -> preserve source recordId + returned command ID -> query status
  -> final or bounded retry
  -> format notification
```

Treat command request and status response as separate contracts. Preserve the
normalized source record's `recordId` in a separate `sourceRecordId` context
field. The Send Command node returns only a distinct
`rawCommandDataRecordId`; do not invent an accepted/rejected send status. The
SQL status query binds that returned command ID under the SQL placeholder name
`recordId` and must query `RAW_COMMAND_DATA` with `WHERE ID = :recordId`.
Compare every returned status row's `ID` with the bound command ID. A missing
command ID or a missing/mismatched status ID is `bad-response`, not a successful
command.

The documented flow supplies a request endpoint and response endpoint to the
managed IoT Send Command node. Keep those endpoint and bind properties separate
from queue selection and from the device-side subscriber. Carry both
`sourceRecordId` and `rawCommandDataRecordId` through status and notification
formatting so an alert can identify the triggering normalized event and the
command record independently.

The SQL node's bind contract is explicit (the domain short ID remains a
placeholder):

```sql
SELECT ID, DELIVERY_STATUS, TIME_FINISHED
  FROM <domain-short-id>__IOT.RAW_COMMAND_DATA
 WHERE ID = :recordId
```

Bind variable `recordId` from the message property `rawCommandDataRecordId`.
This SQL bind name is deliberately separate from both the source event's
`recordId` and the command record's message property. Never bind the normalized
source `recordId` to this query.

The fixture expresses that mapping as `bindName: recordId` and
`bindValueSource: rawCommandDataRecordId`.

The offline state model is deterministic:

| Observed result | Next state | Output | Notification |
| --- | --- | --- | --- |
| accepted/prepared/sent/pending/responded (from SQL) | poll | internal | after terminal result |
| empty SQL result (`[]`) | retry/poll | internal until limit/deadline | after terminal result |
| missing response | missing | retry (bounded) | yes, if surfaced |
| completed | completed | final | yes |
| rejected/refused/expired | same terminal state | final | yes |
| malformed status or correlation | bad-response | final | yes |
| not-responded | not-responded | final | yes |
| poll limit or deadline reached | deadline | final | yes |

`pollLimit` and a deadline are hard bounds. The documented
`RAW_COMMAND_DATA.DELIVERY_STATUS` values `ACCEPTED`, `PREPARED`, `SENT`,
`PENDING`, and `RESPONDED` are non-final and continue polling; `COMPLETED`,
`REJECTED`, `REFUSED`, `EXPIRED`, `BAD_RESPONSE`, and `NOT_RESPONDED` are
final. An empty SQL result is a successful
query with no visible status row, so it takes an explicit retry/poll transition
while carrying the same `rawCommandDataRecordId`; it becomes `deadline` when
either bound is exhausted. A terminal state never re-enters the retry path. If
a selected workflow chooses to reconcile a transient missing Send Command
response, require an explicit attempt counter and elapsed time, stop at either
bound, and do not resend a command whose acceptance is uncertain. The fixture's
missing-response retry represents reconciliation or operator handoff, not a
second command submission.

Fixture state labels are lower-case for readability. Map them deliberately to
the selected runtime's status field; `deadline` corresponds to the scenario's
synthetic `POLL_TIMEOUT`, not a database delivery status.

## Notification boundary and formatting

Formatting is pure and should include only sanitized source identity, command
identity, and outcome, for example:

```text
title: OCI IoT command result
body: sourceRecordId=r-poll rawCommandDataRecordId=cmd-poll status=completed deviceType=hvacs externalKey=child-02
```

Publishing a notification to an OCI Notifications topic proves only that the
publication request reached that service and was accepted. It does not prove a
subscriber received, acknowledged, or rendered the message. Confirm delivery
with separately authorized subscriber evidence. Do not log complete payloads,
credentials, or command contents when a correlation and bounded summary are
sufficient.

## Offline fixtures and live gaps

Run [normalized-monitoring-cases.json](../assets/monitoring/normalized-monitoring-cases.json)
and [command-notification-cases.json](../assets/commands/command-notification-cases.json)
with the focused verifier. Fake queue, SQL, command, and notification stages
exercise filtering, correlation, every terminal/non-final outcome, empty SQL
result retry then completion, no-row deadline exhaustion, poll bounds, and
final-versus-retry routing. They do not emulate OCI acceptance or success.

A live check separately requires database/AQ access and queue/subscriber
selection, command-invoke policy, an active disposable device subscription and
bounded response timing, Notifications policy/topic publication, and subscriber
confirmation. Target-specific managed-node availability remains an inspection
gap until checked in the selected runtime.
