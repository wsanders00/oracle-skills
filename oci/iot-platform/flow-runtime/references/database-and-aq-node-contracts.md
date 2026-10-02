# Database and AQ node contracts

Read this reference when a flow uses the managed Database connection, begin
transaction, end transaction, enqueue, dequeue, or SQL roles. These contracts
preserve the boundaries that change a flow design; they are not a database
driver manual and they do not authorize a connection or queue operation.

## Evidence and source boundary

Oracle's managed Flow Runtime editor documents the six Database/AQ roles under
its managed palette (`db-connection`, `begin transaction`, `end transaction`,
`enqueue`, `dequeue`, and `sql`). That establishes the managed role inventory,
not every field, driver option, payload shape, output property, or version
behavior. The public Oracle sample package and its node reference (`O7` and
`S4`) are separate source surfaces. Package-specific details here are pinned
to release `0.6.0` at commit
`d1f886fed04f456b28527d578be140fbc7a6c2f1`; they are normative only for that
exact revision and must not be attributed to the managed service.

Claim owner: `FR-DB-AQ-DETAIL-001` (pinned official-repository behavior; recheck
the target palette, selected module/version, database driver, and AQ version
before live use). The managed role inventory is also summarized in
[`managed-node-reference.md`](managed-node-reference.md).

The portable contract in
[`database-aq-contract-cases.json`](../assets/nodes/database-aq-contract-cases.json)
is a deterministic model. It proves classification, state transitions,
payload/bind validation, finite retry decisions, and safe error projection
only. It does not open a database connection, mutate a queue, commit a
transaction, execute SQL, or prove target output shapes.

## Choose the authentication and driver family first

Keep database authentication separate from OCI API authentication and from
device MQTT credentials. A database connection configuration must select and
verify one authentication family for the target:

| Family | Decision boundary | What remains unproven offline |
| --- | --- | --- |
| Basic (user/password) | The selected connection config supplies a database principal and a network connect descriptor. Keep values outside flows, fixtures, and exports. | Credential validity, account state, grants, endpoint reachability |
| DB Token — Config File | Uses OCI config-file authentication; profile, config path, scope, and any proxy target must be selected. | Config contents, token acquisition, grants, endpoint reachability |
| DB Token — Instance Principal | Uses the runtime instance principal to obtain a database token. | Instance identity, token acquisition, grants, endpoint reachability |
| DB Token — Resource Principal | Uses the runtime resource principal/token callback to obtain a database token. | Resource identity, token acquisition, grants, endpoint reachability |
| DB Token — Session Token | Uses the OCI session-token provider and selected config-file profile. | Session-token validity, config contents, grants, endpoint reachability |
| DB Token — API Key | Uses OCI API-key material (fingerprint, private key, region, tenancy, and user). | Key validity, token acquisition, grants, endpoint reachability |

The pinned source names these six `authType` values: `basic`, `config`,
`instancePrincipal`, `resourcePrincipal`, `sessionToken`, and `simple`. A DB
Token family requires the node's external-auth setting. DB Token/IAM
authentication is not the same family as OCI IoT API credentials or device
MQTTS credentials, and neither is interchangeable with a database password.

Thin versus thick is a driver boundary, not a promise made by the managed node:

- A thin path normally keeps the driver in-process and does not require a
  separately installed native Oracle Client. Confirm the selected node's
  implementation and supported connection features.
- A thick path depends on a compatible native client and its libraries,
  architecture, wallet/TLS configuration, and runtime loading rules. A local
  Node.js installation or an Oracle sample package cannot prove that the
  managed Flow Runtime contains those dependencies.
- Do not silently switch driver family after a connection failure. Record the
  selected family, connect descriptor form, TLS/wallet requirement, and target
  runtime/driver versions as a compatibility gate.

Driver mode is process-wide in one Node-RED runtime. The first database
connection that initializes node-oracledb chooses Thin or Thick; a later node
requesting the other mode continues with the initialized mode and logs a
warning. Thick is the source node's default. Restart the runtime to switch
mode. This is a source/runtime boundary, not a per-config guarantee.

Do not place usernames, passwords, wallets, private keys, connection strings,
tokens, or bind values in a flow export or committed fixture. Use placeholders
and safe correlation IDs only.

## Transaction ownership and lifetime

Select one transaction owner. The `begin transaction`/`end transaction` pair
is the explicit owner in the model below: begin acquires a connection and a
transaction context; database/AQ work reuses that context; end commits or
rolls back and closes/releases it. If a selected node has different ownership,
document that exact behavior before using it.

```text
unacquired --begin--> active --end(commit)--> committed --close--> closed
                         |
                         +--end(rollback)--> rolled_back --close--> closed
                         +--timeout--------> rollback/close attempt
```

The transaction handle is runtime state, not ordinary `msg.payload`. Preserve
it through the supported node path; do not assume that cloning or serializing
a message preserves a driver handle. Reuse means the SQL/enqueue/dequeue node
uses the already-acquired context, not that a second connection is silently
opened. Keep transactions short and do not hold one across slow HTTP, MQTT,
or OCI calls unless the selected contract explicitly requires and bounds that
coupling.

Commit is the transaction boundary for database work and persistent AQ
messages. Before commit, an offline model may say only
`accepted-in-transaction`; it may not say durable. Rollback must make pending
database work and persistent AQ messages ineligible for durable visibility.
Buffered AQ messages remain transient even when the node or transaction path
reports commit; check the selected target's buffered enqueue semantics rather
than inferring durability or rollback behavior. Timeout, connection loss,
commit failure, and a context that has already ended are distinct outcomes
requiring a selected recovery decision; blind retry can duplicate an enqueue
or DML operation. An already-ended context is terminal for that handle and
must not be reused.

## Enqueue: payload, recipient, delivery, and commit

Treat enqueue as queue acceptance, not consumer processing. Capture these
fields in the selected contract:

- Payload shape is one of the selected AQ-compatible forms (the fixture uses
  `JSON`, `RAW`, and `ADT` classifications). Validate serialization and size
  before enqueue; do not infer an ADT schema from a JSON example.
- A single-consumer queue does not need a subscriber selector. Enqueue
  `Recipients` is optional in the pinned source (`Required: No`); when supplied,
  the source passes it to AQ as recipients. For a multi-consumer target,
  recommend configuring the intended recipients explicitly when the selected
  queue contract calls for that routing, but do not claim that omission is a
  source-level validation failure. `Recipients` is not the dequeue `Subscriber`
  (consumer name); keep these fields distinct.
- Select `persistent` or `buffered` delivery. They are different durability
  policies; the portable contract rejects a request that selects both rather
  than guessing which wins. The pinned source documentation prohibits
  `buffered` delivery for JSON payloads; reject that combination before
  dispatch (or surface the selected target's equivalent validation error).
  The pinned editor also says the current buffered implementation requires
  Thick driver mode. Buffered RAW/ADT is not durable across a database
  restart. Verify exact restrictions and queue configuration in the target AQ
  contract.
- Distinguish delivery mode as well as standalone versus transaction-owned
  operation. For `persistent` delivery, a transaction-owned enqueue becomes
  durable only after its owning transaction commits; rollback leaves no durable
  enqueue in the model. The pinned enqueue node's standalone path opens its own
  connection, enqueues, explicitly commits, and closes it, so a successful
  standalone `persistent` enqueue reaches the database commit boundary. For
  `buffered` delivery, acceptance or a successful node/transaction commit does
  not make the message persistent: buffered messages reside in Oracle shared
  memory and can be lost on database restart. Verify which delivery modes the
  selected AQ queue and transaction path support; do not infer persistent
  durability or transactional rollback protection for buffered messages. A
  commit failure is an error/uncertain outcome, not a success to retry blindly.
- Pass-through means the downstream message keeps its correlation and
  non-secret fields while the enqueue result is attached in the documented
  result location. It does not mean the consumer has read or processed the
  message.

The evidence sequence is `prepared → accepted-in-transaction → committed` (or
`rolled-back`/`error`). Keep enqueue acceptance, transaction commit, dequeue
read, consumer processing, and downstream publication as separate stages.

## Dequeue: read, lock, remove, and continuous operation

Choose the dequeue mode before writing downstream processing:

| Mode | Contract to state | Offline boundary |
| --- | --- | --- |
| transactional | A read occurs in a selected transaction; state whether it browses, locks, or removes and what commit/rollback does. | No queue visibility or lock is proven |
| continuous | A long-lived consumer reconnects and stops on an explicit retry bound or shutdown signal. The pinned node auto-commits each nonempty batch before sending and has no rollback protection. For a multi-consumer queue, `Subscriber` is applied as consumer metadata; if it is absent, the source stops on the AQ consumer-name error rather than treating the queue as single-consumer. | No listener, reconnect, expiry, subscriber, or delivery is proven |

For transactional dequeue, keep these operations distinct:

- `browse` reads without implying removal.
- `locked` reserves/locks according to the selected AQ contract; a lock is not
  removal and must have an explicit commit/rollback release rule.
- `remove` marks the selected message for removal; durable removal is not
  claimed until the owning transaction commits. Rollback visibility is a
  target-specific check, represented as an expected transition only in the
  offline model.
- Standalone transactional dequeue auto-commits and closes its connection, but
  standalone `browse` still reads without removal: the commit does not turn a
  browse into durable removal. The owned connection is committed and closed
  even when dequeue returns no messages; an empty dequeue inside an existing
  transaction leaves commit or rollback to that transaction's owner.

Multi-consumer dequeue requires `Subscriber` (the AQ consumer name). Missing
subscriber configuration is a validation error, not an empty queue. This is
distinct from enqueue `Recipients`. Empty dequeue is a valid no-work result
and must not spin or be reported as queue failure.

Model payload decoding explicitly as `JSON`, `RAW`, or `ADT`, including the
output shape and any byte/text conversion. Batch size, blocking/wait behavior,
and output ordering are selected options, not universal promises.

The source calls the retry bound `Max Retries`. Its default is `0`, and `0`
means unlimited; missing and negative values normalize to the same unlimited
value, while a fractional value is silently floored. Retry delay defaults to
5000 ms; a negative delay falls back to that default, a non-negative fraction
is accepted, and numeric text is converted to a number. These source
normalizations are unsafe as a portable policy. Require an explicitly supplied
positive integer retry bound and a
non-negative finite delay in offline guidance; reject `0`, missing, negative,
fractional, or otherwise unbounded retry-bound input rather than silently
normalizing it, and reject negative delay input rather than silently falling
back. After a finite bound is exhausted, emit terminal
`reconnect-exhausted`; on shutdown, interrupt the blocking dequeue/retry wait,
close the consumer, and stop without creating another retry.

Continuous mode commits each nonempty batch immediately after `deqMany` and
before it sends output messages. It has no rollback protection: a downstream
failure cannot return those already committed removals. A successful read or
send still does not prove consumer processing or downstream delivery.

Transactional mode without `msg.transaction.connection` is also standalone:
the pinned node opens its own connection, dequeues, auto-commits, and closes.
With an active transaction context, dequeue leaves commit/rollback to the
explicit end-transaction owner.

## SQL source, binds, results, and transaction behavior

Separate the SQL source modes:

1. **Editor mode** uses SQL configured in the editor. Its contract includes a
   preflight check that accepts one statement: `SELECT`, one DML statement, or
   one anonymous PL/SQL block. It rejects chained statements and a trailing
   SQL-tool `/` terminator. This is an editor UX/preflight rule, not a database
   security boundary.
2. **`msg.sql` mode** obtains the statement at runtime from the message. In the
   pinned sample revision, the Editor-mode single-statement guard does not
   apply and anonymous PL/SQL blocks are allowed. Keep its source, bind
   selection, validation, and error behavior separate. A dynamic source still
   needs an approved statement policy, bind validation, row/size limit, and
   safe Catch path before live use.

For either source, record whether binds are named or positional and require
exact parity: named placeholders require an object, positional placeholders
require an array, every placeholder has one value, no value is silently
ignored, and the selected order/name is preserved. Reject mixed named and
positional placeholders. The selected bind mode must agree with the parsed
placeholder family, positional indexes must be contiguous from `:1`, and
supplied values are rejected as extras even when a statement contains no
placeholders and omits an explicit bind mode. The source preflights an Editor SQLcl slash or
statement chain before it evaluates binds, so combined structure-plus-bind
cases must show the structure rejection first and no dispatch, even when a
message also carries an active transaction or a row-limit overflow; result
limit handling and transaction execution are not reached. Bind validation then
precedes transaction execution: valid named binds still reach an ended-
transaction rejection, while an active transaction with placeholders but no
bind mode/binds is rejected for bind parity before the shared connection is
used. A bind-parity mismatch is the portable reason selected by this fixture;
`missing-bind-mode` is an equivalent portable label only when documented by a
consumer. A successful bind must continue to the selected row-limit outcome,
not be misclassified as a bind failure. An anonymous PL/SQL block is accepted
by the pinned source's start/end regular-expression heuristic; that heuristic
is not a parser and can accept concatenated blocks such as two `BEGIN ... END;`
blocks. A portable policy may reject concatenated blocks, but that stricter
rule must be explicitly labeled portable rather than attributed to the pinned
source. SQL appended after `END;` is a chain and is rejected when the heuristic
does not classify the full text as an anonymous block. Bind scanning ignores
placeholders in string literals and line/block comments. Neither SQL nor bind
values may appear in Catch output. The source checks required bind
names/counts but does not establish that extra object/array values are
rejected; the portable contract rejects extras to prevent silently ignored
values. A bind mismatch is a validation error, not a reason to concatenate
values into SQL.

Query results should preserve documented row data plus result metadata (for
example, row count and column metadata) without claiming that a row is a
durable side effect. Apply an explicit finite row limit and route overflow as
an error or truncation outcome according to the selected contract. Reusing an
active transaction means the SQL node participates in that context. A
standalone DML statement without an explicit commit must be reported as
`accepted-non-durable`/`commit-required`, never as durably committed.

A Catch-path projection may include only a safe code, stage, correlation ID,
and bounded human-readable message. It must omit the SQL text, bind names,
bind values, connection strings, and driver stack details that can expose
secrets.

## Offline and live boundaries

The cases asset covers transaction transitions, enqueue/dequeue shape and
visibility decisions, finite continuous retries and shutdown, SQL bind/source
rules, Editor-mode preflight, `msg.sql` separation, and safe errors. The fake
stages do not perform a connection, enqueue, dequeue, SQL execution, lock,
commit, rollback, or close.

Cannot prove offline:

- database authentication, thin/thick availability, wallet/TLS, grants,
  connection pools, driver cleanup, or endpoint reachability;
- AQ queue existence, payload schema/size limits, recipients, persistence,
  visibility, lock/remove behavior, expiry, consumer delivery, or commit
  durability;
- SQL execution plans, row metadata, DML effects, isolation, commit behavior,
  PL/SQL results, or node-specific `msg.sql` validation; and
- target palette availability, runtime/package compatibility, network/IAM,
  downstream processing, or recovery after a crash.

Before a live check, separately approve the exact runtime and palette/version,
database endpoint and authentication family, driver/thin-thick choice,
least-privilege grants, queue/subscriber and payload contract, transaction and
retry bounds, observation/cleanup plan, and any DML or queue side effect.
