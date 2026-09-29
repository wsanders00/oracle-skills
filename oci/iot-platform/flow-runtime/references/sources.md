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
Package-specific behavior in this skill is pinned to release `0.6.0` at commit
`d1f886fed04f456b28527d578be140fbc7a6c2f1`. That exact-revision contract does
not prove the package is installed, permitted, or compatible with a selected
Flow Runtime. Source IDs and claim ownership are recorded in the package-local
[coverage contract](../tests/coverage-contract.json).

## OCI IoT

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
- [Pinned Oracle node package revision](https://github.com/oracle-samples/node-red-nodes/tree/d1f886fed04f456b28527d578be140fbc7a6c2f1)
- [Pinned Oracle node reference](https://github.com/oracle-samples/node-red-nodes/blob/d1f886fed04f456b28527d578be140fbc7a6c2f1/docs/node-reference.md)
- [Pinned Oracle package manifest anchors](https://github.com/oracle-samples/node-red-nodes/blob/d1f886fed04f456b28527d578be140fbc7a6c2f1/oci-nodes/package.json#L17-L33)
- [Pinned Oracle optional-node reference anchors](https://github.com/oracle-samples/node-red-nodes/blob/d1f886fed04f456b28527d578be140fbc7a6c2f1/docs/node-reference.md#L592-L729)
- [Node-RED messages](https://nodered.org/docs/user-guide/messages)
- [Writing Function nodes](https://nodered.org/docs/user-guide/writing-functions)
- [Node-RED context](https://nodered.org/docs/user-guide/context)
- [Node-RED error handling](https://nodered.org/docs/user-guide/handling-errors)
- [Node-RED flow structure](https://nodered.org/docs/developing-flows/flow-structure)
- [Node-RED importing and exporting flows](https://nodered.org/docs/user-guide/editor/workspace/import-export)
- [MQTT 5.0 specification](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html)
