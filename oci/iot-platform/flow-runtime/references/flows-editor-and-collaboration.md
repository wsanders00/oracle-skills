# Managed editor, collaboration, and flow documents

Read this reference for authoring, reviewing, backing up, or replacing a
managed OCI IoT Flow Runtime flow document. The examples are decision records;
they do not connect to OCI or deploy anything.

## Editor and sessions

Open the editor from the Flow Runtime details page. Console SSO authenticates
the editor session; do not invent a second Node-RED login. IAM determines
whether the session is a Viewer or Editor. A Viewer can inspect but cannot
deploy. A session has an expiry indicator and an explicit extension/sign-out
control, so check the session before a long review.

Multiple authorized users have separate browser sessions, not character-level
co-editing. Coordinate one deploy owner, keep related work on separate tabs,
and review/merge a newer deployed configuration if another user deploys while
your tab has undeployed changes. Deploy is a mutation of the active flow
document; an editor save or a local export is not evidence of deployment.

The managed editor and node palette are documented by [Oracle's Flow Runtime
editor](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/node-red.htm)
and [Flow Runtime overview](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/flow-runtimes.htm).
Recheck those pages for the selected runtime version and region.

## The complete-document contract

There is one current, complete opaque `flows.json` document per runtime. It
may contain multiple tabs and config nodes. The management-side Flows tab and
the update-flows API or CLI replace that complete document; they are not a
second backup slot or a patch. Interactive Node-RED editor Import is different:
it can add nodes to the current flow or a new flow, and Deploy then mutates the
active document. Do not describe editor import alone as a complete restore or
use it when the intended operation is verified whole-document replacement. A
valid JSON document can still fail later because a node, config node,
credential, adapter, or permitted module is absent.

Before replacement:

1. Retrieve the current complete document and its current resource ETag.
2. Save a point-in-time backup outside the runtime and record runtime OCID,
   version, retrieval time, reason, and a checksum. Restrict backup access.
3. Review tabs, wires, config-node references, node/module versions, schedules,
   adapters, model assumptions, and secret-backed references.
4. Validate the candidate as complete JSON and confirm that no secret values
   are embedded. A flow export may retain endpoints/configuration while not
   retaining credentials required to reconnect.
5. Replace only with the retrieved ETag as `if-match` (or equivalent
   conditional header).
6. On a stale precondition/HTTP `412`, stop. Re-retrieve, compare, and obtain
   a new review; never retry the old document over newer deployed state.
7. After a matching replacement, re-retrieve the effective flows document and
   compare its checksum/identity with the intended candidate. Then inspect the
   editor and test approved critical paths. A successful request alone is not
   effective-state evidence.

The replacement operation is synchronous; resource lifecycle and property
operations commonly return work requests. Keep those evidence paths separate.
The Oracle task pages are represented by source IDs `C2`, `C3`, and `C15`, and
the Node-RED editor import behavior by `S10`, in the package [source
guide](sources.md). Recheck exact CLI/API syntax before any live use.

## Offline replacement cases

Use [flow document cases](../assets/runtime/flow-document-cases.json) to test
the decision logic. The fixture proves backup ordering, complete-document
replacement, matching/stale ETags, abort behavior, and effective-state
readback only as a pure local model. It cannot prove OCI authorization,
credential restoration, deploy success, runtime health, or effective deployed
state.

The [safe replacement walkthrough](../examples/runtime-safe-replacement.md)
combines the flow and resource concurrency boundaries without providing an
executable live command.

| Case | Expected decision | Effect if live |
| --- | --- | --- |
| `matching-etag-replacement` | Replace, then read back | Replaces every flow/config node in the runtime |
| `stale-etag-aborts` | Stop on `412`; no retry | Leaves newer active state untouched |
| `missing-etag-aborts` | Stop before mutation | No request should be sent |
| `backup-before-replacement` | Backup precedes candidate submission | Creates an external backup artifact |
| `effective-state-readback` | Read back and compare after success | Performs a second read; does not prove message delivery |

## Runtime lifecycle and property actions

Use [resource-operation cases](../assets/runtime/resource-operation-cases.json)
and [property cases](../assets/runtime/resource-property-cases.json) to keep
action effects explicit. `list` and `get` are read-only. `create`, `update`,
`move`, `activate`, `deactivate`, and `delete` change resource state or
placement; `update-flows` changes the complete flow document. Activate,
deactivate, create, update, move, and delete should be tracked by their work
request where the API returns one; wait for the documented terminal state and
then re-read the resource. Flow replacement is modeled separately as
synchronous.

For every proposed mutation, record:

- exact runtime and scope, actor and IAM permission;
- candidate properties or complete document and current ETag;
- expected interruption, work-request, and rollback/restore effect;
- backup or preservation of logs, NSGs, mounts, and flows; and
- the effective-state readback and evidence timestamp.

Service limits and regional availability are mutable target facts. Inspect the
selected region, current service limits, compartment quota, scale/capacity
options, and runtime version for each live use. Do not hard-code a limit from
an offline case or describe scale as a proven throughput guarantee.

## Managed software and palette boundary

OCI manages the runtime software, including the managed Node-RED runtime.
Palette Manager can manage only node modules and versions the service permits;
it is not a runtime-software update mechanism. An announced software update
can deactivate/reactivate the runtime, pause processing, and make the editor
temporarily unavailable. Before the update, move required local files to
persistent storage and back up flows. After activation, verify lifecycle state,
editor, flows, permitted nodes, and configured logs. If the deadline is missed,
the service may leave the runtime Inactive until activation applies the update.

Use [software update cases](../assets/runtime/software-update-cases.json) for
preflight/post-check ordering. This is an offline interruption model, not
evidence that an update succeeded.

### Sources and freshness

| Claim ID | Owner | Source IDs / anchor | Sensitivity | Recheck |
| --- | --- | --- | --- | --- |
| `FR-FLOWS-001` | this reference | `O1`, `S10`, `C2`, `C3` — editor import destinations; get/replace complete flows | mutable service | implementation, promotion, and before replacement guidance |
| `FR-CONCURRENCY-001` | this reference | `C15` — conditional flows replacement (`if-match`) | mutable CLI/API | implementation, promotion, and before live use |
| `FR-EDITOR-001` | this reference | `O1`, `S10` — SSO, roles, sessions, collaboration, Deploy, import destinations | mutable service | implementation, promotion, and at least every 90 days |

### Live gate

Do not provide an executable mutation as the default response. A live change
requires separately approved target/scope, current source and target-version
checks, IAM, backup, ETag, bounded interruption, rollback/restore plan, and
post-change effective-state evidence. Placeholders such as
`<flow-runtime-ocid>`, `<flows-document>`, and `<current-etag>` are not real
credentials or authorization.
