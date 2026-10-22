# Example: review a safe Flow Runtime replacement

This is a portable review walkthrough, not an executable OCI procedure. It
models a full flow-document replacement and a separate resource network update
without calling OCI.

## Scenario

The candidate flow `flows-candidate-b` adds a tab and changes a config node. The
runtime currently reports `flows-current-a`, resource ETag `etag-a`, subnet
`<subnet-a>`, NSG `<nsg-a>`, and a File Storage mount named `history`.

1. Retrieve and externally back up the complete current flows document. Record
   its checksum and the resource ETag.
2. Review the candidate as a complete document. Confirm tabs, wires,
   config-node references, permitted modules, and credential-backed references.
3. Submit a conditional replacement with `if-match: etag-a`; this is a
   synchronous mutation of the complete flows document.
4. Re-retrieve the effective flows document and compare its checksum with the
   candidate. Do not call that comparison a health or delivery test.
5. For a later network change, retrieve the current resource and ETag again.
   Include the required subnet, every NSG, and the `history` mount in the
   complete `networkConfig` replacement. Omitting the field preserves it;
   supplying a partial object does not.
6. For any resource property change, send `if-match` only when it is present
   and exactly equals that retrieval's current ETag. A missing or mismatched
   value stops before the request; do not let a simulated success stand in for
   that comparison.
7. If either conditional request returns HTTP `412`, stop. Re-retrieve and
   review the newer state; never retry the stale candidate. After a successful
   resource update, re-read and compare subnet, every intended NSG and mount,
   logging, scale, tags, and the changed property.

The [flow cases](../assets/runtime/flow-document-cases.json), [network
cases](../assets/runtime/network-config-cases.json), and [resource property
cases](../assets/runtime/resource-property-cases.json) exercise matching,
mismatched, stale-412, missing-ETag, preserve, replacement, removal, and
readback outcomes. They prove only local decision logic.

## Approval handoff

Before a live operation, obtain explicit approval for the runtime and
compartment, backup destination, interruption window, candidate document,
resource properties, IAM, rollback/restore, and post-change evidence. The
placeholders above are intentionally not usable identifiers.

Source anchors: `C2`, `C3`, `C4`, `C14`, `C15`, and `C16` in the package
[source guide](../references/sources.md). Recheck the [managed editor](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/node-red.htm)
and [Flow Runtime overview](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/flow-runtimes.htm)
before live use.
