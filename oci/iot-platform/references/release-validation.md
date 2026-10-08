# Public Skill Release Validation

Use this checklist before calling the `oci-iot-platform` skill ready to share.

## Automated Checks

From the repository root, run:

```bash
bash oci/iot-platform/tests/smoke.sh
```

```bash
bash oci/iot-platform/tests/redaction_scan.sh
```

## Content Review

Check for:

- no internal tenancy names
- no private network-access or MCP bootstrap instructions
- no team-specific account setup
- no secrets or real OCIDs in examples
- no environment-specific behavior stated as a platform rule

## Manual Validation Scenarios

Validate at least one clean or minimally configured operator environment with a documented OCI CLI authentication method. A separate tenancy is useful but not required when one is not available; the validation must prove the workflow can run without internal profiles, private setup, or MCP dependencies. Include a nondefault method such as `security_token` when available, and verify that every subsequent command carries the selected auth context. Do not require a config profile for a principal method that does not use one.

1. `IOT_DOMAIN_ID` bootstrap, including `--auth security_token` when using a security-token profile
2. read-only discovery of domains and twins
3. model creation and readback
4. adapter creation and readback
5. twin instance creation and readback
6. test publish flow and content verification using a test-owned auth resource; do not reuse an existing certificate or secret
7. confirm the HTTPS publish URL includes the adapter `inboundEnvelope.referenceEndpoint`; posting to the bare device host is not a valid publish test
8. confirm normal publishing-device twins are `DIRECT` unless the validation intentionally covers a gateway/downstream topology

Also exercise the workflow routing offline with synthetic or explicitly
selected local inputs:

- Offline modeling or analysis of exported data must not require credentials,
  an IoT domain, network access, Data API, or a database.
- Offline catalog search should use only the explicitly selected raw model
  exports, retain root/interface/component scope, and explain issues and
  coverage limits. An empty result must not imply absence from OCI; index
  creation time must not imply source freshness. No dependency fetch or
  background scan is part of this task.
- A current-twin request should route to OCI CLI and preserve the selected
  operator authentication context. Cover both a workstation profile-based
  method (such as API key or session authentication) and a principal method
  that does not require a local profile.
- With no target domain supplied, the skill must ask for clarification or keep
  any discovery bounded and separately authorized; it must not invent a target
  or imply that static context proves the domain exists.
- Historized, raw, rejected, and command-record requests should route to the
  optional data-access guidance. When its separate identity, retention, or
  network prerequisites are unknown, report the gap without falling back to
  automatic login, SQLcl, tunnel setup, MCP, or a live read.

These offline scenarios validate routing only. They do not establish live
credentials, IAM access, target tenancy, domain availability, network
connectivity, data retention, or service compatibility, and they do not replace
the operator-environment and data-access validation required for release.

If Data API or direct DB guidance ships in the release, validate at least one example there too.

For the bundled managed Flow Runtime guidance, the smoke check runs the
network-free fixture contract. Before claiming live compatibility, inspect the
selected region, runtime version, managed palette, permissions, and network
path; the offline fixtures and pinned sample-package source do not establish
those conditions. Exercise a bounded Flow Runtime scenario only with separate
approval for its exact live effects, and verify effective deployment or
downstream delivery rather than treating an accepted request as completion.

Also verify operator-resilience guidance remains public-safe and covers:

- bounded list pagination and lifecycle-state filtering, with no unbounded fleet scans
- SDK and CLI capability drift checks, including documented fallbacks when one surface lacks a feature
- gateway-aware twin validation, including child or downstream device context where relevant
- direct-vs-indirect instance creation guidance that does not use `INDIRECT` to avoid auth setup
- relationship direction and source/target filtering, not only broad relationship listing
- work-request status, log, and error inspection for asynchronous operations
- publish rejection triage for topic, auth, schema, domain, and lifecycle-state failures
- publish endpoint triage for missing or mismatched adapter reference endpoint paths
- raw-command final-state validation after command submission, not only accepted requests
- cleanup ordering that removes relationships, twins, adapters, and models safely
- optional MCP guidance that recognizes tool families and fallback rules without requiring MCP install or private bootstrap
- Data API collection guidance for snapshot, raw, historized, rejected, and raw-command records

## Release Blockers

Do not release if any of these are true:

- the skill requires internal-only tooling
- MCP is treated as required instead of optional
- MCP guidance omits direct CLI or SDK fallback behavior
- the smoke checks fail
- redaction scanning finds likely secrets
- the examples depend on undocumented tenant assumptions
- operator examples silently fall back to default CLI authentication or assume
  a named user must exist in the resource tenancy
- the default workflow cannot be followed with public docs plus OCI CLI
- default list guidance uses unbounded fleet scans before filters or `--limit`
- newer CLI flags are documented without a `oci ... --help` drift check or SDK fallback
- raw-command acceptance is treated as final completion evidence
- publish examples skip final twin-content or rejected-data verification
- publish examples omit the adapter reference endpoint path or imply that the bare device host is enough
- instance creation examples use `INDIRECT` to avoid supplying a direct-auth resource
- cleanup guidance omits dependency ordering or destructive-operation approval
- managed Flow Runtime and public sample-package nodes are presented as
  interchangeable without target compatibility evidence
