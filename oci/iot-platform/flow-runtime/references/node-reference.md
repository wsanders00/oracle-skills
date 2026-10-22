# Managed IoT node selection and compatibility

Read the [managed node router](managed-node-reference.md) and
[node capability matrix](node-capability-matrix.md) for the current inventory,
exact identities, and authentication boundaries. This reference explains why
the managed palette and public Oracle package must not be treated as one
surface.

## Managed target selection

This skill supports OCI IoT-managed Flow Runtimes. Select a workflow from the
target's exact registered types and owning modules, then verify the required
configuration parent, fields, outputs and authentication in node help or
established managed-runtime evidence. Oracle documentation roles guide discovery;
they do not replace that mapping.

| Evidence | Next action | Claim allowed |
| --- | --- | --- |
| Palette/module inspection missing | Inspect the selected managed target under a read-only scope | Availability unknown |
| Required type absent in inspected palette | Report unavailable on that target; evaluate a supported alternative separately | Target-specific absence |
| Exact type present; operational contract unknown | Inspect node help and relevant configuration; prepare a bounded test | Available node, behavior unverified |
| Target contract established | Design with the supported fields and separately approve integration tests | Applicable contract, live result still unverified |
| Sample name/version matches; implementation contract unverified | Keep sample details conditional and continue managed-node discovery | No sample equivalence |

For example, a managed palette may register `oci-config` and
`iot-send-command` while documentation uses an `iot-config`/OCI Config role.
Keep the observed identity and configuration parent; do not rename it or choose
sample credentials because a type name matches a package reference. Confirm
the selected node's actual authentication options.

## Local and managed acceptance

Local validators and a standalone Node-RED harness can exercise pure message
logic. A matching local version does not establish managed IAM, configuration,
deployment, persistence or node integration. Use the selected OCI IoT runtime
for those acceptance results. This skill does not administer standalone
Node-RED, install arbitrary modules or change driver/runtime versions to match
a sample. Missing capabilities are reported for the target, not repaired by
assuming a different deployment surface.

## Keep node surfaces distinct

There are two evidence sets that must not be silently merged:

- The managed Flow Runtime editor documents an OCI-controlled palette with
  current OCI nodes presented as configuration, telemetry, subscription, and
  command nodes.
- The public [Oracle-maintained Node-RED node package](https://github.com/oracle-samples/node-red-nodes)
  documents nodes such as `iot-config`, `iot-telemetry`, `iot-subscribe`,
  `iot-send-command`, and `oci-config`, plus examples and package
  dependencies.

The package-specific contracts in this skill use the [pinned Oracle node
reference](https://github.com/oracle-samples/node-red-nodes/blob/d1f886fed04f456b28527d578be140fbc7a6c2f1/docs/node-reference.md)
from release `0.6.0`. That makes them normative for the exact source revision,
but does not prove the package or version is available in a particular managed
Flow Runtime. Verify the relevant implementation/field contract as well as
availability before using those details. Preserve the sample source owner even
when a particular detail has been verified for a managed target.

## Authentication boundary

Treat device-side MQTT configuration and cloud-side OCI REST configuration as
different concerns:

- Device-side telemetry and subscription flows use the device connection
  configuration documented for the applicable node surface.
- Cloud-side command or relationship operations use OCI REST authentication
  and their own configuration boundary.

Never copy credentials, certificates, tokens, OCIDs, real hosts, or connection
strings into a flow export, fixture, prompt, log, or committed artifact. Use
named placeholders only when a separately approved live operation requires
them, and keep their values outside the skill and version control.

## Portable message behavior

Use Node-RED message conventions deliberately: `msg.topic` identifies the
route, `msg.payload` carries the data, and error paths should be observable
through Catch or equivalent handling. Validate topic and payload contracts in
a pure transformation before handing data to a transport or OCI-specific node.
Do not use a mutable repository branch as a managed-service guarantee. The
recorded immutable release/commit supports exact-source behavior only; it does
not satisfy the target palette gate.

For current claims, consult the [OCI Node-RED editor documentation](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/node-red.htm),
the [pinned Oracle node reference](https://github.com/oracle-samples/node-red-nodes/blob/d1f886fed04f456b28527d578be140fbc7a6c2f1/docs/node-reference.md),
and the [Node-RED message documentation](https://nodered.org/docs/user-guide/messages).
