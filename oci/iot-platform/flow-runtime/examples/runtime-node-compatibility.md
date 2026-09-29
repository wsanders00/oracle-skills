# Example: gate a scenario node before use

An Oracle scenario shows an Object Storage download node followed by a
Notifications publication node. That diagram establishes the workflow role,
not that either node is installed in a particular managed runtime.

Use this sequence:

1. Record target runtime version, region, and exact palette labels from a
   read-only inspection.
2. Classify each role as `official-scenario` until the palette confirms a
   managed documented node. If the node comes from
   `oracle-samples/node-red-nodes`, classify it as `sample-package`.
3. For a sample node, pin an immutable commit or release and record the
   permitted module/version. A mutable `main` link is illustrative only.
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
