# Example: select managed nodes and gate sample details

An Oracle scenario shows an Object Storage download node followed by a
Notifications publication node. That diagram establishes the workflow role,
not that either node is installed in a particular managed runtime.

Use the [managed target selection](../references/node-reference.md#managed-target-selection)
route before selecting implementation details:

1. Record target runtime version, region, exact registered node types, owning
   modules/versions and configuration-parent types from a
   read-only inspection.
2. Map the workflow to the observed managed types and their node help. An
   observed `oci-config` or `iot-send-command` is not renamed to a documentation
   label. A required type absent from the inspected palette is unavailable on
   that target, even if a local installation or sample reference contains it.
   Keep the source classification of each documented role or package detail;
   availability does not change its provenance.
3. For a sample node, pin an immutable commit or release and record the
   permitted module/version. Require affirmative evidence that the relevant
   fields, outputs and authentication apply in the selected implementation;
   matching names or versions alone is insufficient. A mutable `main` link is
   illustrative only. If sample equivalence is unknown, continue with the
   managed node's supported contract.
4. Record the authentication context and resource-principal policy separately
   from user access to the editor. Record required bucket/topic permissions and
   network reachability as live gates.
5. Keep the transformation and formatter offline until every unknown field is
   resolved. If a gate is unknown, report an availability gap rather than
   claiming the flow is deployable.

The [compatibility-gate fixture](../assets/nodes/compatibility-gates.json)
contains self-describing records for Object Storage, Notifications, and a
sample-package node. The [managed inventory](../assets/nodes/managed-node-inventory.json)
contains the documented Database/AQ and OCI IoT roles.

Source anchors: `O1`, `O7`, `S4`, `C11`, and `C12` in the package [source
guide](../references/sources.md). Consult the [managed editor](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/node-red.htm)
and [Oracle node reference](https://github.com/oracle-samples/node-red-nodes/blob/main/docs/node-reference.md)
for the current evidence; target compatibility remains a live inspection.
