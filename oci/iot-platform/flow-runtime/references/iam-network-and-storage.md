# IAM, network, and storage boundaries

Read this reference when a Flow Runtime needs OCI services, a private subnet,
File Storage, Object Storage, or persistence. Static JSON and an accepted
resource update do not prove effective access.

## Distinct authorization principals

Keep the caller of a control-plane operation, a person using the editor, and
the running Flow Runtime separate:

1. The calling principal needs grants for the requested Flow Runtime operation
   (such as list/get/create/update/move, activate/deactivate/delete, or complete
   flows replacement). Its OCI CLI or SDK authentication may be a user-based
   credential or an available workload principal; do not assume a named user
   exists in the resource tenancy. Check the actual method and cross-tenancy
   grants when the credential and resource tenancies differ.
2. A person opening the managed editor uses OCI Console single sign-on and
   needs the appropriate Viewer or Editor permission to inspect or deploy
   flows. This editor session is not the Flow Runtime resource principal.
3. A Flow Runtime resource principal is the runtime's identity when a supported
   OCI node calls another OCI service. Add the runtime to an appropriate dynamic
   group and grant only the target action on the required compartment/resource.

The [OCI IoT policy reference](https://docs.oracle.com/en-us/iaas/Content/Identity/policyreference/iot-policy-reference.htm)
and the editor's OCI Config guidance are the current policy sources. Do not
embed API keys, config files, tokens, OCIDs, or private keys in flow JSON.
Device MQTT credentials are a third identity boundary and must not be reused
as OCI REST credentials.

## Private-subnet reachability

Choose a private subnet with routes and NSG rules for every required endpoint.
For outbound internet access, the Oracle network guidance uses a NAT gateway;
for File Storage, the mount target must be reachable from the runtime subnet
with required NFS rules. Check DNS, TLS, protocol, port, route table, NSG,
service gateway/NAT, and endpoint policy in that order. An attached subnet or
NSG proves configuration only, not reachability.

The supplied `networkConfig` is a **complete replacement**. Omitting the field
preserves the existing configuration; supplying an object replaces subnet and
all NSGs/mounts represented by that object; passing `null` removes the network
configuration. Therefore retrieve the current resource first, preserve every
required NSG and mount in the candidate, and condition the resource update on
the current resource ETag/`if-match` just as for flow replacement. The
`if-match` value must be present and exactly equal to the ETag from that
retrieval; if the ETag is missing or the values differ, stop before sending a
request (regardless of any locally simulated response). If the service returns
stale-precondition HTTP `412`, stop without retrying the old candidate. After a
matching successful update, re-read effective resource state and compare the
subnet, every intended NSG and mount, logging configuration, scale, tags, and
other intended properties.

Use [network cases](../assets/runtime/network-config-cases.json) for preserve,
replace, remove, matching-ETag, stale-ETag, and effective-readback decisions.
Use placeholders only; no fixture contains real OCIDs or endpoints.

## Resource property updates

An update may change display name, description, scale, logging configuration,
network configuration, File Storage mounts, or tags. Treat omitted ordinary
properties as preserved according to the current API contract, but treat a
present `networkConfig` as a full replacement. Preserve unrelated properties
in an explicit candidate when the client/API semantics require a full object.
Every property mutation follows the same conditional transition:

```text
retrieve current resource + currentEtag
  -> missing currentEtag or ifMatch != currentEtag: abort, request not sent
  -> matching ifMatch + HTTP 412: abort, no retry
  -> matching successful update: re-read and compare effective resource
```

The [resource-property cases](../assets/runtime/resource-property-cases.json)
exercise matching, mismatched, missing-ETag, and stale-412 transitions. The
successful cases include readback for the intended property plus preservation
of network subnet/NSGs/mounts, logging, scale, and tags; they are deterministic
offline transitions, not evidence that an OCI update succeeded.

`scale` is a capacity selection, not a measured throughput promise. Recheck
service limits, compartment quotas, regional availability, and target runtime
version immediately before a live operation. Property/lifecycle changes may
return a work request; wait for its terminal state and re-read the resource.

## Persistence choices

| Store | Appropriate boundary | Recovery warning |
| --- | --- | --- |
| Local runtime filesystem | Temporary scratch only | Ephemeral across deactivation/activation and software updates; do not keep the only copy |
| File Storage | Shared ordinary filesystem paths under `/mnt/` | Requires export, mount target, subnet/NSG/NFS reachability; configuration does not prove mount access |
| Object Storage | Discrete batch/archive objects | Requires node compatibility, bucket/object policy, resource principal, and network reachability |
| Database/AQ | Transactional records, queues, or application state | Requires selected connection/transaction ownership and explicit commit/rollback/retry semantics |

File Storage mount paths must be relative and contain no leading slash,
trailing slash, or traversal segment. The service prefixes them with `/mnt/`;
for example, `history` becomes `/mnt/history`. A runtime supports at most five
mounts according to the current documentation. Validate these rules offline
with [mount-path cases](../assets/runtime/file-storage-mount-cases.json).

Before deactivation, activation, or managed software update, move required
local files to persistent storage and back up the complete flows document.

## Logs, metrics, events, and effective state

Debug sidebar output is a flow diagnostic, not OCI runtime logging. Configure
the runtime's system-console logs and validate delivery separately. Metrics
show service measurements, and lifecycle events/work requests show state
transitions; none substitutes for re-reading the effective runtime or flow
document. Capture request ID, work-request ID, resource ETag, lifecycle state,
configuration checksum, and evidence timestamp without logging secrets.

| Claim ID | Owner | Source IDs / anchor | Sensitivity | Recheck |
| --- | --- | --- | --- | --- |
| `FR-IAM-001` | this reference | `C9`, `O1` — calling principal, editor permissions, and OCI Config/resource principal | mutable service | implementation, promotion, and before live policy guidance |
| `FR-NETWORK-001` | this reference | `C4`, `S2` — subnet/NSG and scenario connectivity | target-specific | inspect selected VCN, routes, NSGs, endpoints for every live use |
| `FR-RESOURCE-CONCURRENCY-001` | this reference | `C16` — conditional resource update with current ETag/`if-match` | mutable CLI/API | implementation, promotion, and before live use |
| `FR-STORAGE-001` | this reference | `C5`, `O2` — mounts, ephemeral local storage, schema access | mutable service | implementation, promotion, and at least every 90 days |
| `FR-EFFECTIVE-STATE-001` | this reference | `C4`, `C5`, `C6`, `C7`, `C8` — config and operational evidence | mutable/target-specific | implementation, promotion, and target inspection for live use |

## Live gate

Network, IAM, storage, logging, database, queue, device, and notification
access each require separate approval. A read-only inspection should precede
any update; a mutating update requires exact scope, current resource ETag,
backup/preservation plan, bounded work-request wait, rollback, and effective
state readback. Remain offline when target region, endpoint, policy, palette,
or mount prerequisites are unknown.
