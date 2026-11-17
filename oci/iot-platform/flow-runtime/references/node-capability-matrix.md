# Node capability and identity matrix

Use this matrix when a flow request names an Oracle or Node-RED node. A
palette label is not an identity proof: resolve the source surface, exact node
type, configuration parent, authentication family, and target gate before
describing a node as usable.

## Evidence boundary

The managed editor record (`O1`) is authoritative for the documented managed
roles. The official scenario records (`C11`, `C12`) establish workflow roles,
not a portable palette or module installation. The Oracle sample repository
(`O7`, with node-reference record `S4`) is a separate source surface. The
manifest now pins both package records to commit
`cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb` (release `0.8.0`), so
package-specific behavior may be normative for that exact source revision.
It is still not a managed-service guarantee: a mutable `main` URL cannot
replace the pin, and the selected Flow Runtime palette, version, region,
dependency permission, and authentication policy remain target gates.

For the requested target, establish palette/module availability and the relevant
implementation contract separately. An inspected managed type can differ from
the documentation's role label. Keep sample details conditional until evidence
establishes their applicability; matching names or version numbers alone is
insufficient. Use the [managed target selection](node-reference.md#managed-target-selection)
route first.

## Source anchors

| Source ID | Immutable/source locator | Anchor used by this matrix |
| --- | --- | --- |
| `O1` | [managed Flow Runtime editor](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/flow-runtime-node-reference.htm) | Shared Configuration Nodes; OCI IoT Nodes; OCI Services Nodes |
| `O7` | [pinned Oracle sample-package revision](https://github.com/oracle-samples/node-red-nodes/tree/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb) | package node identities and configuration families; release `0.8.0` |
| `S4` | [pinned package node reference](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/docs/node-reference.md) plus the pinned `oci-nodes/package.json` and node JS/HTML files | exact package node type names, palette labels, configuration parents, fields, outputs, and device/cloud split |
| `C11` | [batch Object Storage scenario](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/ingest-batch-data-flow-runtime.htm) | sequential object download and device-host ingestion role |
| `C12` | [monitoring, command, and Notifications scenario](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/egress-iot-flow-runtime.htm) | SQL command status and Notifications publication roles |
| `N1`, `N2`, `N4`, `M1` | Node-RED message/function/error and MQTT references listed in [the source guide](sources.md) | generic-core semantics only; no OCI identity inference |

## Classification rules

| Classification | What the source establishes | What it does not establish |
| --- | --- | --- |
| `managed-documented` | The current managed editor documents the role in its service-controlled palette. | A selected runtime's region, version, palette, IAM, or endpoint behavior. |
| `official-scenario` | Oracle uses the role in a published Flow Runtime scenario. | An exact node type/label, installation, version, permission, or delivery. |
| `sample-package` | The Oracle sample package is the source of the named package node. | Managed availability or package behavior without an immutable revision. |
| `generic-core` | The behavior is standard Node-RED semantics. | OCI authentication, persistence, service reachability, or managed palette membership. |
| `routed-elsewhere` | The request is outside this skill's managed OCI boundary. | Any OCI-specific contract for that request. |

Every matrix record has exactly one classification and one `sourceOwner`.
Records with similarly named nodes remain separate records.

## Identity and authentication matrix

Managed-editor rows identify documentation roles. Use inspected registered
types and configuration parents when constructing the target flow; do not
copy these role labels as a universal runtime registration map. Sample rows
identify types from the pinned package and retain that source ownership even
when similarly named nodes are observed in a managed target.

Managed and sample `iot-config` both configure device MQTT. Resolve the source surface and target applicability without inventing a device-versus-signer distinction between those two records. `oci-config` is the separate OCI signer.

| Source surface | Documented role / package node type | Palette label or role | Source configuration parent (verify target) | Authentication family | Classification | Source owner | Claim ID | Target gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Managed editor | `db-connection` | `DB Connection` | none (config parent) | oracle-database | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `begin-transaction` | `begin transaction` | `db-connection` | oracle-database | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `end-transaction` | `end transaction` | `db-connection` | oracle-database | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `enqueue` | `enqueue` | `db-connection` | oracle-database | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `dequeue` | `dequeue` | `db-connection` | oracle-database | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `sql` | `sql` | `db-connection` | oracle-database | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `iot-config` | `IoT Device` | none (config parent) | device-mqtts | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-config` | `OCI Config` | none (config parent) | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `iot-telemetry` | `telemetry` | `iot-config` | device-mqtts | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `iot-subscribe` | `subscribe` | `iot-config` | device-mqtts | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `iot-send-command` | `send command` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `iot-get-content` | `get content` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `iot-update-relationship` | `update relationship` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-object-storage` | `object storage` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-notification` | `notification` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-api-request` | `api request` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-functions-invoke` | `functions invoke` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-monitoring-publish` | `monitoring publish` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-monitoring-query` | `monitoring query` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-logging` | `logging` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-log-analytics` | `log analytics` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-queue-config` | `Queue Config` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-queue-out` | `queue out` | `oci-queue-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-queue-in` | `queue in` | `oci-queue-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-queue-ack` | `queue ack` | `oci-queue-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-streaming-config` | `Streaming Config` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-streaming-in` | `streaming in` | `oci-streaming-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-streaming-out` | `streaming out` | `oci-streaming-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-streaming-commit` | `streaming commit` | `oci-streaming-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-kafka-config` | `Kafka Config` | none (config parent) | kafka-sasl | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-kafka-producer` | `kafka producer` | `oci-kafka-config` | kafka-sasl | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-kafka-consumer` | `kafka consumer` | `oci-kafka-config` | kafka-sasl | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-kafka-commit` | `kafka commit` | `oci-kafka-config` | kafka-sasl | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `ords-config` | `ORDS Config` | none (config parent) | oauth | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-ords-request` | `ords request` | `ords-config` | oauth | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-ords-poll` | `ords poll` | `ords-config` | oauth | `managed-documented` | `O1` | `FR-NODES-001` | enabled; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-certificate` | `certificate` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | disabled-by-default; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `oci-vault-secret` | `vault secret` | `oci-config` | oci-api | `managed-documented` | `O1` | `FR-NODES-001` | disabled-by-default; inspect selected target version, palette/help, identity and permissions |
| Managed editor | `scm-server` | `SCM Server` | none (config parent) | fusion-oauth | `managed-documented` | `O1` | `FR-NODES-001` | permitted-add-on; inspect selected target version, palette/help, identity and permissions |
| Sample package | `iot-config` | sample device MQTT config (pinned `S4`, release `0.8.0`) | none (device-MQTTS config parent) | Device credentials/certificate and MQTTS session; not OCI API authentication | `sample-package` | `S4` | `FR-NODES-001` | Pinned source is exact-revision evidence; inspect permitted module/version and target palette |
| Sample package | `iot-telemetry` | sample device telemetry (pinned `S4`, release `0.8.0`) | sample `iot-config` | Device MQTTS credentials/session | `sample-package` | `S4` | `FR-NODES-001` | Same target-palette gate; transport acceptance is not normalization/history |
| Sample package | `iot-subscribe` | sample device subscription (pinned `S4`, release `0.8.0`) | sample `iot-config` | Device MQTTS credentials/session | `sample-package` | `S4` | `FR-NODES-001` | Same target-palette gate; receipt is not command acknowledgement |
| Sample package | `oci-config` | sample OCI config (pinned `S4`, release `0.8.0`) | none (cloud REST config parent) | OCI SDK/API authentication | `sample-package` | `S4` | `FR-NODES-001` | Same target-palette gate; do not use as proof of managed `OCI Config` |
| Sample package | `iot-send-command` | sample cloud command (pinned `S4`, release `0.8.0`) | sample `oci-config` | OCI SDK/API authentication | `sample-package` | `S4` | `FR-NODES-001` | Same target-palette gate; accepted request is not device completion |
| Sample package | `iot-get-content` | sample digital-twin content read (pinned `S4`, release `0.8.0`) | sample `oci-config` | OCI SDK/API authentication | `sample-package` | `S4` | `FR-NODES-001` | Same target-palette gate; current twin content via IoT SDK is distinct from `oci-ords-request` `snapshotData` HTTP preset and is not full twin CRUD |
| Sample package | `iot-update-relationship` | sample relationship-content update (pinned `S4`, release `0.8.0`) | sample `oci-config` | OCI SDK/API authentication | `sample-package` | `S4` | `FR-NODES-001` | Same target-palette gate; exact update shape comes from pinned source |
| Sample package | `oci-object-storage` | `object storage` (pinned `S4`, release `0.8.0`) | sample `oci-config` | OCI SDK/API authentication | `sample-package` | `S4` | `FR-NODES-001` | Inspect target palette/module permission, split OCI SDK dependencies, Object Storage policy, and file-path/runtime boundary; this is the package implementation of the separate `C11` scenario role |
| Sample package | `oci-notification` | `notification` (pinned `S4`, release `0.8.0`) | sample `oci-config` | OCI SDK/API authentication | `sample-package` | `S4` | `FR-NODES-001` | Inspect target palette/module permission, split OCI SDK dependencies, topic policy, and subscriber evidence; this is the package implementation of the separate `C12` scenario role |
| Sample package | `ords-config` | `ORDS Config` (config node; pinned `S4`, release `0.8.0`) | none (config parent) | ORDS OAuth client credentials | `sample-package` | `S4` | `FR-NODES-001` | Inspect target module/version and approve HTTPS base/token endpoints, credential handling, and bounded poll capacity |
| Sample package | `oci-ords-request` | `ords request` (pinned `S4`, release `0.8.0`) | sample `ords-config` | ORDS OAuth bearer token from `ords-config` | `sample-package` | `S4` | `FR-NODES-001` | Same target gate; verify IoT Data API version presets or approved relative custom path |
| Sample package | `oci-ords-poll` | `ords poll` (pinned `S4`, release `0.8.0`) | sample `ords-config` | ORDS OAuth bearer token from `ords-config` | `sample-package` | `S4` | `FR-NODES-001` | Same target gate; require finite interval/timeout and bounded shared concurrency/queue limits |
| Sample package | `oci-logging` | `logging` (pinned `S4`, release `0.8.0`) | sample `oci-config` | OCI SDK/API authentication | `sample-package` | `S4` | `FR-NODES-001` | Inspect target palette/module permission, split OCI SDK dependencies, Custom Log policy, and `<1 MB` log-entry bound |
| Sample package | `oci-log-analytics` | `log analytics` (pinned `S4`, release `0.8.0`) | sample `oci-config` | OCI SDK/API authentication | `sample-package` | `S4` | `FR-NODES-001` | Inspect target palette/module permission, split OCI SDK dependencies, namespace/log-group/source policy, and `<1 MB` log-entry bound |
| Official scenario | Object Storage download/upload role | batch object retrieval/publication role; exact palette identity is not established by `C11` | scenario-defined credentials/config (not established) | Runtime/resource principal and Object Storage policy are live concerns | `official-scenario` | `C11` | `FR-SCENARIO-NODES-001` | Inspect target palette and resource-principal policy; keep Buffer/text and object-acceptance stages separate |
| Official scenario | OCI Notifications publication role | formatted alert publication role; exact palette identity is not established by `C12` | scenario-defined credentials/config (not established) | Runtime/resource principal and Notifications policy are live concerns | `official-scenario` | `C12` | `FR-SCENARIO-NODES-001` | Inspect target palette/topic policy; publication acceptance is not subscriber delivery |
| Managed editor | `db-connection` | `Database connection` | none (config parent) | Configured Oracle Database connection; exact mechanism is target-specific | `managed-documented` | `O1` | `FR-DB-001` | Inspect target palette/version and selected database authentication/driver contract |
| Managed editor | `begin transaction` | `begin transaction` | managed `db-connection` | Database connection context | `managed-documented` | `O1` | `FR-DB-001` | Select transaction owner, timeout, rollback, and live database policy |
| Managed editor | `end transaction` | `end transaction` | managed `db-connection` plus transaction context | Database connection context | `managed-documented` | `O1` | `FR-DB-001` | Select commit/rollback and release behavior; commit is not delivery acknowledgement |
| Managed editor | `enqueue` | `enqueue` | managed `db-connection` plus selected transaction | Database connection context | `managed-documented` | `O1` | `FR-DB-001` | Select queue type, durability, transaction ownership, and bounded recovery |
| Managed editor | `dequeue` | `dequeue` | managed `db-connection` plus selected queue/subscriber | Database connection context | `managed-documented` | `O1` | `FR-DB-001` | Select read/lock/remove mode, subscriber, visibility, and finite retry bound |
| Managed editor | `sql` | `sql` | managed `db-connection` plus selected transaction | Database connection context | `managed-documented` | `O1` | `FR-DB-001` | Select bind/source and explicit DML commit owner; execution remains live evidence |
| Generic Node-RED | `mqtt in` | MQTT input | generic MQTT broker config | Broker credentials/TLS, if any, are generic runtime concerns | `generic-core` | `N2` | `FR-NODE-IDENTITY-001` | Do not infer OCI device host, managed palette, or device MQTTS support |
| Generic Node-RED | `mqtt out` | MQTT output | generic MQTT broker config | Broker credentials/TLS, if any, are generic runtime concerns | `generic-core` | `N2` | `FR-NODE-IDENTITY-001` | Do not infer OCI device host, managed palette, or device MQTTS support |
| Generic Node-RED | `function` | Function | none | none implied | `generic-core` | `N1` | `FR-NODE-IDENTITY-001` | Validate pure message shape; runtime wrapper behavior requires target inspection |
| Generic Node-RED | `catch` | Catch | none | none implied | `generic-core` | `N4` | `FR-NODE-IDENTITY-001` | Route errors; do not infer service or delivery outcomes |
| Generic Node-RED | `status` | Status | none | none implied | `generic-core` | `N4` | `FR-NODE-IDENTITY-001` | Route statuses; do not infer service or delivery outcomes |

## Selection rules

1. Resolve source context and target identity. Managed `iot-config` is IoT Device;
   managed `oci-config` is OCI Config. Sample names have the same auth split,
   but matching names do not prove full implementation equivalence.
2. Device MQTT, OCI signer, ORDS OAuth, Kafka SASL and Fusion OAuth are separate
   identities. Operator/editor access does not supply a runtime identity.
3. A documented node is not evidence of availability on an uninspected target.
   Keep pinned sample fields conditional until target applicability is established.
4. Preserve each configuration parent; reject device nodes wired to `oci-config`
   and signer nodes wired to `iot-config` before designing live operations.
5. Keep transport/service acceptance separate from downstream evidence:
   telemetry acceptance is not normalization/history; subscription receipt is
   not command acknowledgement; command request acceptance is not device
   completion; Notification publication is not subscriber delivery.
6. Fusion SCM is a permitted managed add-on, not a default installed dependency;
   route full Fusion workflows, self-hosted administration and arbitrary modules separately. Do not fill an identity gap by
   importing a generic or legacy node contract.

## Evidence and target gate

The companion [identity cases](../assets/nodes/node-identity-cases.json) are
deterministic offline cases for the collision, classification, source-owner,
and immutable-reference boundaries. Existing [managed inventory](../assets/nodes/managed-node-inventory.json)
and [compatibility gates](../assets/nodes/compatibility-gates.json) provide the
broader managed-role and live-gate context.

The exact optional package identities and field/precedence/output contracts are
in [optional OCI node contracts](optional-oci-node-contracts.md), with
deterministic cases in
[optional OCI node contract cases](../assets/nodes/optional-oci-node-contract-cases.json).

Offline cases can prove classification, name disambiguation, parent/auth
separation, and refusal to elevate mutable sample content. They cannot prove
palette availability, package compatibility, IAM, network reachability,
database/queue state, device session, service acceptance, normalization,
device completion, or subscriber delivery.
