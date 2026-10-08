# OCI IoT Data Access

Use this file only when the user explicitly needs data-plane access beyond the default OCI CLI workflows.

## Scope

This reference covers advanced and optional paths:

- IoT Data API
- ORDS-backed queries
- direct database access
- APEX-oriented workspace access

These paths usually require separate authentication, networking, or tenancy setup beyond normal CLI usage.

## When To Use This Path

Use advanced data access when the user asks for one of these:

- historized values
- raw ingestion records
- rejected telemetry details
- command round-trip data
- APEX workspace changes

Do not default to this path for ordinary digital twin inspection.

## Prerequisite Checklist

Confirm which of these already exist:

- an IoT domain group and domain
- IAM policy allowing the requested access
- OAuth client details for the Data API path
- network path for database access, when direct DB access is required
- any required private network connectivity

If these prerequisites are missing, say so clearly before giving commands.

## Data API / ORDS Notes

- Treat the Data API and ORDS flows as separate from the control plane.
- Keep tokens, client secrets, and user passwords out of logs and shared transcripts.
- Prefer narrow, task-specific queries rather than broad dumps.
- Verify the user actually needs raw, rejected, or historized records before steering them here.
- Use the domain-group short ID and domain short ID to form the ORDS/Data API base path.
- Treat snapshot, raw, historized, rejected, and raw-command data as separate collections with different verification value.
- Use only documented collection filters. Do not replace an unavailable targeted filter with a broader request unless that scope is separately authorized.
- Fetch a record by ID when a list response omits payload details needed for diagnosis.

For a read-only, one-page twin-filtered `rawData` request and offline historian,
rejected-ingest, or existing-command summaries, use
[Data diagnostics](data-diagnostics.md). The documented `q` twin filter is
shown for `rawData`; the IoT API reference does not list query parameters for
the other collections. Do not broaden an unavailable per-twin query into an
unfiltered collection request. Client-side windows over a selected local export
do not establish full-window completeness.

Typical Data API base URL shape:

```text
https://<domain_group_short_id>.data.iot.<region>.oci.oraclecloud.com/ords/<domain_short_id>
```

Common collection paths:

- `/snapshotData` for latest normalized twin snapshots
- `/rawData` for accepted raw ingestion records
- `/historizedData` for historized records when retention is enabled
- `/rejectedData` for rejected ingest details
- `/rawCommandData` for raw-command request and response records

Optional MCP servers may provide wrappers for these collections, token minting, and latest-state summaries. Use them only when already available and still treat returned bearer tokens as secrets.

## Direct Database Access Notes

Direct database access is powerful but operationally heavier than the CLI path.

Typical prerequisites include:

- a reachable network path
- tenancy permissions
- token-based database access
- the correct schema context for the requested task

If the user only needs current twin state, prefer `digital-twin-instance get-content` instead.

## Data Access Configuration

Treat data-access configuration as a mutation on the IoT domain or domain group. The public CLI includes separate domain commands for APEX, DIRECT, and ORDS access, plus domain-group data access configuration. These are not default troubleshooting steps.

Before suggesting them:

- identify whether the user needs APEX, ORDS/Data API, direct database, or VCN-scoped access
- read the existing domain or domain-group configuration
- inspect the relevant `oci iot domain ... --help` or `oci iot domain-group ... --help` output
- confirm the IAM, identity-domain, VCN, or workspace prerequisites
- ask for explicit approval before making the change

## APEX Notes

APEX-related work should be treated as separate from core digital twin operations.

Before suggesting workspace changes:

- confirm that the user actually needs APEX access
- separate workspace actions from IoT control-plane actions
- avoid implying APEX is part of the default public skill path

## Guidance For Responses

When using this reference:

1. State that the workflow is advanced or optional.
2. List the prerequisites that are assumed.
3. Give the smallest command set needed for the task.
4. Include a verification step.
5. Say whether a CLI/API fallback exists if an optional MCP helper was used.

## Sources and limits

The IoT Data API contract and collection paths are documented in the
[IoT Data API reference](https://docs.oracle.com/en-us/iaas/tools/internet-of-things/data-api/index.html)
(retrieved 2026-10-08). Its listed resources use the versioned
`/20250531/<collection>` path below the `/ords/<domain-short-id>` base. Its
examples show bearer authorization, collection fields, and by-ID resources.
The documented `q` twin filter and bearer access pattern are shown for `rawData`
in [Scenario: Connecting IoT Data to ORDS](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/connect-iot-ords.htm)
and for IoT data inspection in [Scenario: Sending Structured Data in a Default
Format using HTTPS](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/structured-default-https.htm)
(both retrieved 2026-10-08). The public API reference does not list query
parameters per collection. If `rawData` rejects this filter, stop; do not retry
with an unfiltered collection request.

These sources do not establish IoT-collection support for `limit`, `offset`,
`hasMore`, ordering, or time filters. General ORDS paging documentation is not
proof of those IoT-specific contracts. Do not infer that a response page is a
complete window, even if a field resembles a continuation flag. Recheck the
IoT API contract before publishing additional query parameters.
