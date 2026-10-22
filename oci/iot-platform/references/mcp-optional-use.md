# Optional OCI IoT MCP Use

Use this reference only when the user's environment already exposes an OCI IoT MCP server. The public skill must stay useful without MCP; do not make MCP installation, private server bootstrap, or private credentials part of the default workflow.

## When MCP Helps

Prefer the OCI CLI for public, repeatable command sequences. Use MCP as an optional accelerator when the task needs joined context or operator-friendly wrappers, such as:

- resolving an IoT domain or twin from friendly selectors
- inspecting how a twin maps to its domain, domain group, model, adapter, and gateway topology
- checking latest snapshot, historized, raw-command, and rejected-data records together
- passively validating whether a twin is reporting data
- waiting for a raw-command result or a snapshot update
- avoiding unbounded relationship traversal by using page-aware or bounded helpers
- checking gateway-aware fields before diagnosing indirect device telemetry

## Tool Families To Recognize

An OCI IoT MCP server may expose these categories. Names vary by implementation, so inspect the tool list in the active client instead of assuming every tool exists.

Control plane:

- IoT domain and domain group get/list/create/update/delete
- compartment moves
- data retention changes
- data access configuration
- work request get/list/log/error inspection
- digital twin model, adapter, instance, and relationship CRUD
- digital twin instance content reads
- raw-command invocation
- read-only Flow Runtime inventory and metadata/flow-document reads when the
  connected server advertises `list_iot_flow_runtimes_page`,
  `get_iot_flow_runtime`, and `get_iot_flow_runtime_flows`

Data plane:

- token or domain-context helpers for the IoT Data API
- raw data list/get
- snapshot data list
- historized data list/get
- rejected data list/get
- raw command data list/get

Agent-oriented wrappers:

- domain context derivation
- latest twin state
- platform context for a twin
- passive twin readiness validation
- recent raw command and rejected-data lookups for a twin
- raw command invocation plus wait
- wait for twin snapshot update

## Auth Mode Pinning

Inspect the connected server's advertised tools and configured auth mode; these
names and behaviors describe the accepted server implementation, not a promise
that every MCP server exposes them. For the accepted implementation, prefer the
canonical `OCI_MCP_AUTH_TYPE`; deprecated `OCI_IOT_AUTH_TYPE` remains a
lower-precedence compatibility alias. If both are set, the canonical variable
wins. For an API-key profile:

```bash
OCI_CONFIG_PROFILE=<customer_api_key_profile>
OCI_MCP_AUTH_TYPE=api_key
OCI_REGION=<oci_region>
```

If MCP calls fail with `401 NotAuthenticated`, verify the operator-selected
profile, region, and auth mode through the environment owner. Do not inspect
private profiles or credentials. Set the auth mode that matches the connected
server's actual supported mode; do not assume the API-key example applies to
every deployment.

## Optional Flow Runtime Reads

When advertised, `list_iot_flow_runtimes_page` requires `compartment_id` and
accepts optional domain/runtime/display-name/lifecycle filters, `page`, a
bounded `limit` from 1 through 100, sorting, and request ID. Each call reads one
SDK page. Pass its `opc_next_page` as `page` to continue, even when `items` is
empty. Continue only as far as the task needs; the tool does not scan all pages
automatically. `get_iot_flow_runtime` and `get_iot_flow_runtime_flows` take a
runtime OCID and optional request ID.

The accepted server returns `{"ok": true, "data": ...}` or
`{"ok": false, "error": ...}` envelopes. List data includes items and page
metadata. Each GET has its own response ETag: the flows ETag belongs to the
flows read and is distinct from runtime metadata ETag and any Node-RED revision.
The complete SDK-decoded flow document can include tabs, configuration nodes,
unknown fields, endpoints, and sensitive settings, while omitting secrets. It
is not an original-byte backup or proof that credential-backed nodes can be
restored. Do not automatically save or log it. Any graph analysis remains
read-only skill-side analysis, not MCP deployment support.

Runtime metadata and node-type inventory do not establish the installed
managed palette, module versions, node contracts, or target compatibility.
Use the managed editor and target-specific evidence gates for those facts.
On missing tools, errors, or unsupported arguments, use the documented CLI/SDK
fallback. Reads remain subject to the connected server's actual auth mode and
the operator's existing IAM grants; do not change auth, IAM, or service state.

## Gateway-Aware Patterns

Gateway-aware MCP surfaces should preserve these instance fields:

- `connectivity_type`: `DIRECT`, `INDIRECT`, `GATEWAY`, or `NONE`
- `gateways`: gateway digital twin instance OCIDs for indirect twins
- `auth_id`, `external_key`, model IDs, adapter IDs, lifecycle state, and tags when available

Use these fields to reason about topology:

1. For an `INDIRECT` twin, resolve each gateway ID before diagnosing telemetry.
2. For a `GATEWAY` twin, use a bounded indirect-child lookup; do not assume one page contains every child.
3. For missing data, verify adapter endpoint paths, external keys, payload mapping, rejected-data records, and gateway topology before blaming the platform.
4. For relationship checks, filter by source, target, content path, and lifecycle state before broad listing.

## Safety Rules

- MCP tool calls run with the authority of the configured OCI profile or bearer token.
- Treat returned Data API bearer tokens as secrets.
- Prefer read-only MCP calls first.
- Ask for explicit approval before create, update, delete, data-access configuration, compartment moves, raw-command invocation, or publish-like actions.
- Treat asynchronous acceptance and raw-command `202` responses as incomplete until final state is verified.
- For basic publish validation, a digital twin instance content read with metadata is sufficient when it shows the updated state. MCP Data API or ORDS helpers are optional and may require separate `OCI_IOT_ORDS_*` credentials.
- Distinguish that current control-plane twin-content read from an ORDS-backed `snapshotData` query or wrapper; they use different data paths and evidence.
- If MCP output conflicts with CLI or SDK behavior, verify with a direct read and state the discrepancy.
- For Flow Runtime tools, treat a missing advertised tool or `ok: false` result as unavailable/failed for this task and fall back to CLI/SDK guidance. An empty list page with `opc_next_page` is still a continuation point; request another bounded page only when needed.

## Response Pattern

When using MCP, tell the user:

1. Which MCP tool family was used.
2. Why MCP was useful compared with direct CLI.
3. What final-state evidence was verified.
4. Which direct CLI or SDK command would be the fallback if MCP is unavailable.

## Sources

- Accepted OCI IoT MCP source at `8efe88db7db9beaeea4145fc6ab49d2efa4efb54`:
  its `README.md` Flow Runtime inspection and configuration sections and
  `server.py` tool definitions. These implementation-specific names are
  optional and must be confirmed in the connected tool catalog.
- Oracle [managed editor and backup guidance](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/node-red.htm).
