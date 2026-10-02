# Managed and compatibility-gated node contracts

Read this reference before designing a workflow around Oracle Database/AQ,
OCI IoT, Object Storage, Notifications, or other Oracle nodes. A label in an
Oracle scenario or on GitHub is not proof that a node is installed in the
selected managed Flow Runtime.

Use this page as the router and managed-role summary. For exact identity and
authentication collisions, read the [node capability matrix](node-capability-matrix.md).
For observed type selection, read the [managed node selection boundary](node-reference.md).
For conditional package fields and state boundaries, read the focused
[Database/AQ](database-and-aq-node-contracts.md) or
[IoT/OCI](iot-and-oci-node-contracts.md) contract only when that surface is in
scope and its particular implementation contract is established for the target.

## Selected managed runtime first

The primary workflow is authoring and operating flows in OCI IoT. Record the
selected runtime/region, exact registered node type, owning module/version,
configuration-parent type and relevant node-help fields. Use that evidence to
choose inputs, outputs and authentication. Keep documented roles, observed
availability and tested behavior as separate facts.

An observed `oci-config` or `iot-send-command` in a managed runtime remains a
managed target node for this workflow; its name also occurring in the public
sample package does not establish sample implementation equivalence. A node
absent from the inspected palette is unavailable on that target. Report that
limit and evaluate an independently supported path if the user needs one.

For a sample detail, require affirmative evidence for the relevant fields,
outputs and authentication in the selected implementation. Module permission,
a package pin, a familiar type name or matching version alone is insufficient.
If that evidence is missing, continue managed-node discovery through target
help and approved inspection; do not apply the sample detail or recommend an
installation to make the palette resemble an example.

## Classification rules

- **Managed documented:** Oracle's current Flow Runtime editor documents the
  node in the service-controlled palette. Still inspect the target palette and
  service version before live use.
- **Official-scenario:** Oracle uses the role in a published scenario, but the
  scenario does not guarantee that the node is available in every runtime.
- **Sample-package:** behavior comes from the public
  `oracle-samples/node-red-nodes` package. The detailed contracts are pinned to
  release `0.6.0`; treat mutable `main` as discovery-only and keep live use
  gated until the target permits that module/version.
- **Generic core:** standard Node-RED semantics only; do not infer OCI
  authorization, persistence, or service reachability.

The [managed editor documentation](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/node-red.htm)
lists Oracle Database (`db-nodes`) and OCI (`oci-nodes`) groups. The public
[Oracle node repository](https://github.com/oracle-samples/node-red-nodes) and
[node reference](https://github.com/oracle-samples/node-red-nodes/blob/main/docs/node-reference.md)
are separate compatibility evidence.

## Managed documented inventory

The labels below are documented palette labels/canonical roles, not a portable
list of exact registered types. Map each role to the inspected target. Message
fields, queue names, SQL, and credentials are placeholders; they are not a
portable universal schema.

| Documented role / palette label | Class | Workflow role (target fields require evidence) | Auth context | Transaction/ack/error boundary |
| --- | --- | --- | --- | --- |
| `db-connection` / Database connection | managed documented | config node; downstream DB nodes use the shared connection | configured Oracle Database connection | Connection failure is node/runtime evidence; no message acknowledgement implied |
| `begin transaction` | managed documented | `msg` → same `msg` plus transaction/connection context | Database connection | Acquires connection and begins transaction; failure routes to node error path |
| `end transaction` | managed documented | `msg` → same `msg` after commit or rollback | Database connection/transaction context | Commits or rolls back and releases connection; commit is not an external delivery ack |
| `enqueue` | managed documented | `msg` → queue submission result/continuation | Database connection and configured transactional event queue | Enqueue participates in selected transaction; distinguish accepted, rollback, and error |
| `dequeue` | managed documented | queue read → message or empty result | Database connection and configured queue | Empty is a valid no-work result; do not treat it as a failed dequeue |
| `sql` | managed documented | SQL request in `msg` → rows/result/error | Database connection | SQL side effects depend on transaction ownership; define commit/rollback explicitly |
| `iot-config` / OCI Config | managed documented | config node consumed by OCI IoT nodes | Config file, instance principal, resource principal, or API key according to target | Configuration/test-connection failure is distinct from downstream service response |
| `telemetry` | managed documented | validated flow message → OCI IoT telemetry request/result | linked OCI Config; resource principal when supported | Transport acceptance is not normalization, history, or presentation evidence |
| `subscribe` | managed documented | subscription source → incoming `msg` | linked OCI Config and selected source | Subscription/reconnect/ack semantics are endpoint-specific; inspect target |
| `send command` | managed documented | command request → response/status result | linked OCI Config and command policy | Preserve command correlation; accepted request is not device completion |

Use [managed-node inventory](../assets/nodes/managed-node-inventory.json) as a
self-describing offline contract. It records input/output examples, required
evidence, and explicit `cannot_prove` boundaries for each role.

### Database and AQ ownership

Select one transaction owner and document it. The selected node help and
established target contract own operational fields and outputs. The focused
[Database/AQ contract](database-and-aq-node-contracts.md) contains conditional
pinned-package connection, commit/rollback, SQL-source, enqueue/dequeue and
finite-retry details. Apply a detail only where target evidence establishes it;
do not infer it from this inventory table.

### OCI IoT authentication

Device MQTT credentials and OCI REST authentication are separate boundaries.
The focused [IoT/OCI contract](iot-and-oci-node-contracts.md) separates shared
workflow evidence from conditional package telemetry, subscription and command
details. Do not use a device identity as an OCI API credential or copy either
credential family into a flow export.

## Official scenarios and sample-package gates

Object Storage and Notifications have documented roles in Oracle's scenarios:
Object Storage supplies discrete batch objects; Notifications publishes an
alert message. These are **official-scenario** roles until the target palette
inspection confirms usable nodes. A scenario diagram does not establish
installation, version, permissions, bucket/topic access, or delivery.

The pinned public sample package contains additional Object Storage,
Notifications, Logging, ORDS, digital-twin content, relationship, Database/AQ,
and OCI node contracts. Classify each as **sample-package** unless the selected
runtime evidence establishes the actual node identity and selected contract.
Availability does not change the provenance of sample-package details. The pinned revision is
exact-source evidence, not a managed-service or target-availability guarantee.

Use [compatibility gates](../assets/nodes/compatibility-gates.json) before a
dependent workflow. A gate records target runtime/version/region, palette
type/label and module version, relevant target-contract evidence, immutable
package commit or release (if applicable), authentication path and live approval.
If a required field is unknown, keep the dependent operation offline and report
which availability or contract fact is missing.

The [node compatibility walkthrough](../examples/runtime-node-compatibility.md)
shows how to apply the classification gate without claiming target
availability.

## Evidence and freshness

Offline assets can prove message-shape decisions, transaction state diagrams,
correlation preservation, and refusal/error routing. They cannot prove palette
availability, IAM, database/AQ state, service reachability, adapter
normalization, command delivery, device completion, or Notifications subscriber
delivery.

| Claim ID | Owner | Source IDs / anchor | Sensitivity | Recheck |
| --- | --- | --- | --- | --- |
| `FR-NODES-001` | this reference | `O1`, `O7`/`S4` — managed palette and pinned Oracle package reference | target-specific | inspect selected runtime/version/palette; keep exact-revision behavior separate from target availability |
| `FR-DB-001` | this reference | `O1` — db-nodes inventory and transaction roles | target-specific | inspect target palette/version and selected database contract |
| `FR-IOT-NODES-001` | this reference | `O1`, `S4` — OCI Config, telemetry, subscribe, command roles | target-specific | inspect target palette/version and auth policy for every live use |
| `FR-SCENARIO-NODES-001` | this reference | `C11`, `C12` — Object Storage and Notifications scenario roles | scenario/target-specific | recheck scenario and target palette before live use |

## Live gate

Before enabling a node, separately approve the exact runtime, module/version,
region, IAM/resource-principal policy, network route, endpoint, payload,
transaction and retry plan, and cleanup. A successful offline fixture is not a
live health check.
