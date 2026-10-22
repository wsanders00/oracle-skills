# Example: bounded command and notification flow

This is a pure offline model of the normalized monitoring scenario. Queue, SQL,
command, and Notifications stages are fakes; no device, database/AQ, command,
topic, or subscriber is contacted.

## Flow shape

```text
fake NORMALIZED_DATA dequeue -> identity/threshold filter -> fake send command
  -> bounded status poll -> final/retry port -> format notification
```

Select `NORMALIZED_DATA`, require a subscriber identity and configured target
twin, validate the record's twin/device/external-key fields, and filter the
target digital-twin identity before evaluating a threshold. Preserve the input
`recordId` separately as `sourceRecordId`. The Send Command stage returns a
distinct `rawCommandDataRecordId`; the status stage obtains `DELIVERY_STATUS`
from SQL, binding it as SQL variable `recordId` from the message property
`rawCommandDataRecordId` in `RAW_COMMAND_DATA.ID = :recordId`. Do not fabricate
an accepted or rejected status in the send response. Carry both IDs through
every status and notification result, and treat a missing command ID or
mismatched SQL row ID as `bad-response`.

The SQL statuses `ACCEPTED`, `PREPARED`, `SENT`, `PENDING`, and `RESPONDED`
remain non-final and poll at most the configured count and before the deadline.
An empty SQL result (`[]`) is an explicit retry/poll transition with the same
command ID; it may later complete, but repeated no-row results become terminal
`deadline` when the poll or time bound is reached.
Completed, rejected, refused, expired, malformed, not-responded, and deadline
results are terminal and use the final output. A transient missing Send Command
response may use an explicit attempt/time-bounded reconciliation policy; it is
not permission to resend. A terminal state never returns to retry. Never retry
an accepted-but-unconfirmed command without reconciliation.

The formatter emits a sanitized title and body such as:

```text
OCI IoT command result
sourceRecordId=r-poll rawCommandDataRecordId=cmd-poll status=completed deviceType=hvacs externalKey=child-02
```

Publishing that body would prove only Notifications publication acceptance.
Subscriber delivery and rendering require separate evidence.

Run the [normalized monitoring cases](../assets/monitoring/normalized-monitoring-cases.json)
and [command cases](../assets/commands/command-notification-cases.json) with
`node scripts/verify-workflows.mjs` from the installed skill's `flow-runtime/`
subdirectory. The deterministic check proves state
transitions, correlation, empty-result retry/deadline bounds, and formatting—not
OCI service behavior.

## Live handoff

Before a live test, separately approve database/AQ queue and subscriber access,
command-invoke policy, an active disposable device subscription and response
window, Notifications policy/topic, and subscriber confirmation. Keep command
payloads, credentials, and production identifiers outside the package.
