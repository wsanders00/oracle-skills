# Source guide

Use these primary sources to check OCI IoT and portable Node-RED claims. The
mutable Oracle service and CLI sources used by the coverage contract were
rechecked on 2026-09-16. That date does not guarantee current behavior.
Recheck mutable service and CLI claims at promotion, at least every 90 days,
and immediately before executable guidance. Recheck stable conceptual sources
at promotion and at least every 180 days. Target region, runtime version,
limits, palette contents, IAM, and network compatibility require inspection of
the selected target for every live use; elapsed time cannot establish them.

The public Oracle repository's mutable `main` branch is a discovery pointer.
Package-specific behavior in this skill is pinned to release `0.8.0` at commit
`cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb`. That exact-revision contract does
not prove the package is installed, permitted, or compatible with a selected
Flow Runtime. Source IDs and claim ownership are recorded in the package-local
[coverage contract](../tests/coverage-contract.json).

## OCI IoT

The managed catalogue, November 10 release, limits overview and database
privilege scenario were rechecked on 2026-11-17. Other source dates retain their
own recorded scope; this refresh does not establish live target compatibility.

- [Managed Flow Runtime node reference](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/flow-runtime-node-reference.htm)
- [November 10 Flow Runtime release](https://docs.oracle.com/en-us/iaas/releasenotes/internet-of-things/update-11102026.htm)
- [Same-domain database privilege delegation](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/grant-flow-runtime-privileges.htm)

- [OCI IoT Platform overview](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/overview.htm)
- [IoT Flow Runtimes](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/flow-runtimes.htm)
- [Using the IoT Flow Runtime Editor](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/node-red.htm)
- [Creating an IoT Flow Runtime](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/create-iot-flow-runtime.htm)
- [Updating an IoT Flow Runtime](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/update-iot-flow-runtime.htm)
- [Getting the complete flows document](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/get-iot-flow-runtime-flows.htm)
- [Replacing the complete flows document](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/update-iot-flow-runtime-flows.htm)
- [Conditional flows replacement CLI](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/iot/flow-runtime/update-flows.html)
- [Conditional Flow Runtime resource update CLI](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/iot/flow-runtime/update.html)
- [Flow Runtime network access](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/configure-iot-flow-runtime-network-access.htm)
- [Flow Runtime File Storage access](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/configure-iot-flow-runtime-storage-access.htm)
- [Flow Runtime logging](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/configure-logs-flow-runtimes.htm)
- [IoT metrics](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/metrics-reference.htm)
- [IoT events](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/events.htm)
- [IoT IAM policy reference](https://docs.oracle.com/en-us/iaas/Content/Identity/policyreference/iot-policy-reference.htm)
- [External-broker ingress scenario](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/ingress-iot-flow-runtime.htm)
- [Batch Object Storage ingestion scenario](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/ingest-batch-data-flow-runtime.htm)
- [Normalized monitoring, commands, and Notifications scenario](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/egress-iot-flow-runtime.htm)
- [IoT domain database schema](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/iot-domain-database-schema.htm)
- [Flow Runtime scenario setup](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/flow-runtime-scenario-setup.htm)
- [Creating a Digital Twin Adapter](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/create-digital-twin-adapter.htm)
- [Gateway target and contentRoot](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/gateway-target-content-root.htm)
- [JQ adapter mapping reference](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/jq-adapter-mapping-reference.htm)
- [OCI IoT troubleshooting](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/troubleshooting.htm)

## Node-RED and MQTT

- [Oracle-maintained OCI nodes](https://github.com/oracle-samples/node-red-nodes)
- [Oracle node reference](https://github.com/oracle-samples/node-red-nodes/blob/main/docs/node-reference.md)
- [Pinned Oracle node package revision](https://github.com/oracle-samples/node-red-nodes/tree/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb)
- [Pinned Oracle node reference](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/docs/node-reference.md)
- [Pinned Oracle package manifest anchors](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/package.json#L13-L65)
- [Pinned Oracle optional-node reference anchors](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/docs/node-reference.md#L1034-L1311)
- [Node-RED messages](https://nodered.org/docs/user-guide/messages)
- [Writing Function nodes](https://nodered.org/docs/user-guide/writing-functions)
- [Node-RED context](https://nodered.org/docs/user-guide/context)
- [Node-RED error handling](https://nodered.org/docs/user-guide/handling-errors)
- [Node-RED flow structure](https://nodered.org/docs/developing-flows/flow-structure)
- [Node-RED importing and exporting flows](https://nodered.org/docs/user-guide/editor/workspace/import-export)
- [MQTT 5.0 specification](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html)

## Sample 0.8.0 disposition

The [changelog](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/CHANGELOG.md) and actual code at the pin
are the refresh inputs. The `sample_refresh` record in the
[coverage contract](../tests/coverage-contract.json) pairs every changed behavior
with immutable file/line anchors and synthetic fixture IDs. Managed selection
gates, Notifications and the two logging APIs retain their existing coverage.
The former sample 0.6.0 pin is historical and superseded for selected contracts.

| Changed behavior | Immutable source | Fixture family |
| --- | --- | --- |
| twin-identity | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/lib/iot-identity.js#L6-L23) | `iot-node-contract-cases.json` |
| relationship-fallback | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/nodes/iot-update-relationship.js#L140-L162) | `iot-node-contract-cases.json` |
| telemetry-failure | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/nodes/iot-telemetry.js#L108-L135) | `iot-node-contract-cases.json` |
| subscription-isolation | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/nodes/iot-config.js#L199-L213) | `iot-node-contract-cases.json` |
| key-validation | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/nodes/oci-config.js#L45-L59) | `iot-node-contract-cases.json` |
| client-lifecycle | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/lib/oci-client.js#L42-L115) | `iot-node-contract-cases.json` |
| provider-lifecycle | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/nodes/oci-config.js#L81-L172) | `iot-node-contract-cases.json` |
| error-projection | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/lib/oci-error.js#L1-L107) | `iot-node-contract-cases.json` |
| driver-default | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/db-nodes/nodes/db-connection.js#L125-L139) | `database-aq-contract-cases.json` |
| enqueue-owner | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/db-nodes/nodes/enqueue.js#L46-L165) | `database-aq-contract-cases.json` |
| recipients | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/db-nodes/lib/oracle-aq.js#L82-L105) | `database-aq-contract-cases.json` |
| condition | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/db-nodes/lib/oracle-aq.js#L126-L186) | `database-aq-contract-cases.json` |
| transaction-registry | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/db-nodes/lib/db-transaction.js#L24-L164) | `database-aq-contract-cases.json` |
| sql-bind-scan | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/db-nodes/nodes/sql.js#L45-L225) | `database-aq-contract-cases.json` |
| response-limit | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/lib/oci-response.js#L1-L108) | `optional-oci-node-contract-cases.json` |
| token-lifetime | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/nodes/ords-config.js#L356-L377) | `optional-oci-node-contract-cases.json` |
| poll-lifecycle | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/nodes/oci-ords-poll.js#L203-L321) | `optional-oci-node-contract-cases.json` |
| ords-containment | [source](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/oci-nodes/nodes/ords-config.js#L185-L216) | `optional-oci-node-contract-cases.json` |

[API Request, Monitoring, Streaming/Kafka, Queue, Functions, Vault and Certificates](https://github.com/oracle-samples/node-red-nodes/blob/cfcf58aa1a6b0139c23336c7ea5c75f81a4b45cb/docs/node-reference.md)
are discovery-only families at this version. Their full behavior is outside
this skill's fixtures; package dependencies are not skill dependencies.

- [September 2026 IoT release](https://docs.oracle.com/en-us/iaas/releasenotes/internet-of-things/update-09292026.htm)

Sample releases `0.8.0` and `0.8.1` are marked prerelease in the [release list](https://github.com/oracle-samples/node-red-nodes/releases). This skill retains its pinned `0.8.0` contracts; adopting or testing `0.8.1` behavior is deferred.
