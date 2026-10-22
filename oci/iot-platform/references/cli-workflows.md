# OCI IoT CLI Workflows

Use this file for the public, CLI-first operator path. For large fleets, gateway topology, publish failures, raw commands, or cleanup, pair these commands with [resilience-guidance.md](resilience-guidance.md). Choose the CLI signer and applicable global options for the execution environment using [operator-authentication.md](operator-authentication.md); these examples do not imply that every OCI CLI auth mode has been exercised against every IoT command.

## Inputs To Gather

- `IOT_DOMAIN_ID`
- `OCI_CLI_PROFILE` only when the chosen auth mode uses a named OCI CLI config profile
- `OCI_CLI_AUTH` when selecting a non-default CLI auth mode
- `OCI_REGION` when not derivable from the domain
- the target compartment OCID when listing domain groups or Flow Runtimes
- resource identifiers already known by the user:
  - digital twin model ID
  - digital twin adapter ID
  - digital twin instance ID
  - digital twin relationship ID
  - work request ID

For the examples below, initialize the optional global CLI arguments once in the same Bash shell. Leave the array empty if no explicit profile or auth mode is needed; add only the options that apply to the selected execution context. Reuse it unchanged for each OCI command so the same signer is used throughout.

```bash
OCI_CLI_GLOBAL_ARGS=()
# Uncomment and set only when applicable:
# OCI_CLI_GLOBAL_ARGS+=(--profile "<oci_profile>")
# OCI_CLI_GLOBAL_ARGS+=(--auth "<oci_cli_auth>")
```

If only `IOT_DOMAIN_ID` is known, derive the rest first using those same optional arguments:

```bash
bash scripts/derive_domain_context.sh "${OCI_CLI_GLOBAL_ARGS[@]}" \
  --iot-domain-id <iot_domain_ocid>
```

The helper accepts `--profile` and `--auth` when needed. Omit `--auth` when relying on the CLI default. Do not assume a named profile is required for instance, resource, or workload identity authentication.
For a CLI session/security token, use Oracle's
[token-based CLI authentication guide](https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/clitoken.htm)
to create or refresh the session, validate it with `oci session validate`, and
then include the selected `--profile` and `--auth security_token` consistently
in `OCI_CLI_GLOBAL_ARGS`.

## Command Capability Check

Check local CLI help before relying on newer filters or topology options:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot digital-twin-instance list --help
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot digital-twin-instance create --help
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot digital-twin-relationship list --help
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot digital-twin-instance invoke-raw-json-command --help
```

If a documented CLI flag is missing locally, use the Python SDK or a narrower CLI fallback and call out the drift.

## Read-First Discovery

List the domain:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot domain get \
  --iot-domain-id <iot_domain_ocid> \
  --output json
```

List domain groups only when needed for a specific target compartment. This
command is compartment-scoped and does not perform root-tenancy discovery;
gather the intended compartment and region along with the operator auth context
before running it. Start with a bounded first page and use filters supported by
the installed CLI's `--help` output:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> domain-group list \
  --compartment-id <target_compartment_ocid> \
  --lifecycle-state ACTIVE \
  --limit 100 \
  --output json
```

List active digital twin instances with a bounded first page:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-instance list \
  --iot-domain-id <iot_domain_ocid> \
  --lifecycle-state ACTIVE \
  --limit 100 \
  --output json
```

List active models:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-model list \
  --iot-domain-id <iot_domain_ocid> \
  --lifecycle-state ACTIVE \
  --limit 100 \
  --output json
```

List active adapters:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-adapter list \
  --iot-domain-id <iot_domain_ocid> \
  --lifecycle-state ACTIVE \
  --limit 100 \
  --output json
```

Use `--all` only after confirming the domain is small enough or the operator needs complete inventory.

## Managed Flow Runtime Discovery

The Flow Runtime list command requires a compartment OCID even when filtering
by IoT domain. Confirm the compartment belongs to the intended target tenancy;
do not infer it from the caller's profile or authentication mode. Check the
installed CLI's `oci iot flow-runtime list --help` before relying on filters.

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> flow-runtime list \
  --compartment-id <target_compartment_ocid> \
  --iot-domain-id <iot_domain_ocid> \
  --lifecycle-state ACTIVE \
  --limit 100 \
  --output json
```

Change or omit the lifecycle filter when investigating an `INACTIVE` or
`FAILED` runtime; the example above is not a complete inventory.

Read the exact runtime before planning a deployment:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> flow-runtime get \
  --iot-flow-runtime-id <iot_flow_runtime_ocid> \
  --output json
```

The complete flows document is a separate, potentially sensitive read. If it
is needed, use `flow-runtime get-flows --iot-flow-runtime-id` only for an
authorized exact runtime and keep the response out of shared logs and Git.
Use the [Flow Runtime reference](../flow-runtime/references/flow-runtime.md)
and [editor guide](../flow-runtime/references/flows-editor-and-collaboration.md)
for lifecycle, saved-versus-effective-state, and replacement boundaries.

## Full CLI Surface Awareness

For complete command-family coverage, see [platform-surface.md](platform-surface.md). The public CLI includes domain and domain-group lifecycle operations, data-retention changes, data-access configuration, work requests, all digital twin resource CRUD, digital twin content reads, and raw binary/json/text command invocation.

Use help before high-risk or less common operations:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot domain change-data-retention-period --help
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot domain configure-apex-data-access --help
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot domain configure-direct-data-access --help
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot domain configure-ords-data-access --help
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot domain-group configure-data-access --help
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot digital-twin-instance invoke-raw-json-command --help
```

Do not provide an executable mutation for delete, compartment move, data-access configuration, retention changes, raw commands, or publish validation until the user approves that specific operation.

## Inspect Twin Content

Get instance metadata:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-instance get \
  --digital-twin-instance-id <digital_twin_instance_ocid> \
  --output json
```

Get latest content with metadata:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-instance get-content \
  --digital-twin-instance-id <digital_twin_instance_ocid> \
  --should-include-metadata true \
  --output json
```

Normalize exported JSON locally when helpful:

```bash
python3 scripts/twin_tools.py last-known \
  --input twin-content.json \
  --timestamp-key _metadata.timeLastHeard
```

If the content response has metadata but no current values, treat that as incomplete evidence and check publish/rejected-data paths before claiming the twin is healthy.

## Create A Model

Start from the neutral template:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-model create \
  --iot-domain-id <iot_domain_ocid> \
  --display-name "Temperature Sensor v1" \
  --spec file://templates/model.temperature-sensor.template.json \
  --wait-for-state ACTIVE
```

Verify both metadata and stored spec:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-model get \
  --digital-twin-model-id <digital_twin_model_ocid> \
  --output json
```

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-model get-spec \
  --digital-twin-model-id <digital_twin_model_ocid> \
  --output json
```

## Create An Adapter

Use the neutral adapter template and update endpoint, timestamp mapping, and payload fields first.

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-adapter create \
  --iot-domain-id <iot_domain_ocid> \
  --digital-twin-model-id <digital_twin_model_ocid> \
  --display-name "Temperature Adapter" \
  --from-json file://templates/adapter.default.template.json \
  --wait-for-state ACTIVE
```

Verify:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-adapter get \
  --digital-twin-adapter-id <digital_twin_adapter_ocid> \
  --output json
```

## Create A Publishing Twin Instance

Update the instance template with the model, adapter, external key, and auth identifier first. For `DIRECT` twins, use an auth identifier owned by the test or deployment being validated; do not borrow an existing certificate or secret for release validation.

Do not default to `INDIRECT` connectivity to avoid supplying `authId`. If the user simply asks for a device or publishing twin and does not mention gateway routing, treat `DIRECT` as the likely default and explain that direct twins require an auth resource such as a Vault secret or certificate. Only create an `INDIRECT` twin when the user explicitly asks for an indirectly connected, downstream, or gateway-routed device, or when they provide a gateway twin and state that the new twin should use it.

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-instance create \
  --iot-domain-id <iot_domain_ocid> \
  --connectivity-type DIRECT \
  --from-json file://templates/instance.template.json \
  --wait-for-state ACTIVE
```

Verify:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-instance get \
  --digital-twin-instance-id <digital_twin_instance_ocid> \
  --output json
```

## Gateway-Aware Instances

Gateway routing is an explicit topology choice, not a substitute for publishing-device auth setup. Before creating an indirect twin, confirm the user intends a downstream device and identify the gateway twin.

List active gateway twins:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-instance list \
  --iot-domain-id <iot_domain_ocid> \
  --connectivity-type GATEWAY \
  --lifecycle-state ACTIVE \
  --limit 100 \
  --output json
```

Create an indirect twin only after the gateway twin is active:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-instance create \
  --iot-domain-id <iot_domain_ocid> \
  --connectivity-type INDIRECT \
  --gateways '["<gateway_twin_ocid>"]' \
  --digital-twin-model-id <digital_twin_model_ocid> \
  --digital-twin-adapter-id <digital_twin_adapter_ocid> \
  --display-name "<display_name>" \
  --external-key "<external_key>" \
  --wait-for-state ACTIVE
```

Verify the created instance and confirm `connectivityType` and `gateways`.

## Create A Relationship

Only create a relationship after confirming the source model defines the content path and both twins are active.

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-relationship create \
  --iot-domain-id <iot_domain_ocid> \
  --source-digital-twin-instance-id <source_twin_ocid> \
  --target-digital-twin-instance-id <target_twin_ocid> \
  --content-path <relationship_name>
```

Verify with source, target, and content-path filters:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-relationship list \
  --iot-domain-id <iot_domain_ocid> \
  --source-digital-twin-instance-id <source_twin_ocid> \
  --target-digital-twin-instance-id <target_twin_ocid> \
  --content-path <relationship_name> \
  --lifecycle-state ACTIVE \
  --limit 100 \
  --output json
```

If no relationship appears, check the reverse direction before creating another relationship.

## Work Request Inspection

Use work requests for asynchronous failures or long-running operations:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> work-request get \
  --work-request-id <work_request_ocid> \
  --output json
```

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> work-request list-errors \
  --work-request-id <work_request_ocid> \
  --limit 100 \
  --output json
```

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> work-request list-logs \
  --work-request-id <work_request_ocid> \
  --limit 100 \
  --output json
```

After inspecting the work request, read the target resource again. A queued or accepted operation is not final-state proof.

## Device Connectivity And Publish Testing

The bundled template covers HTTPS publish testing. Oracle also documents MQTTs device-connect paths for structured publish and command response workflows. When MQTTs is in scope, use the official device-connect documentation and samples for topic/auth details; do not adapt the HTTPS template by guessing MQTT behavior.

## Publish Test Telemetry Over HTTPS

Choose the auth mode first.

The HTTPS publish URL path must match the adapter `inboundEnvelope.referenceEndpoint`. For the bundled adapter template, `referenceEndpoint` is `/sampletopic`, so the publish URL is:

```text
https://<domain-short-id>.device.iot.<region>.oci.oraclecloud.com/sampletopic
```

Posting to the bare device host returns `404 Not Found`; that usually means the path is missing or does not match the adapter endpoint.

For vault-secret-backed basic auth, start from:

```bash
bash templates/publish-curl.template.sh
```

For certificate-based publishing, switch to an mTLS client flow instead of `curl -u`.

After publishing, verify the twin content again. For basic validation, `digital-twin-instance get-content` with metadata is enough to prove the publish updated the twin:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-instance get-content \
  --digital-twin-instance-id <digital_twin_instance_ocid> \
  --should-include-metadata true \
  --output json
```

If content did not update, check adapter endpoint path, payload content type, timestamp mapping, and auth mode. Rejected-data, snapshot, historized, or ORDS/Data API checks are optional advanced evidence paths and require separate Data API or `OCI_IOT_ORDS_*` credentials.

## Invoke A Raw JSON Command

Raw-command acceptance is not the same as device completion. Include response fields when a response is expected:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-instance invoke-raw-json-command \
  --digital-twin-instance-id <digital_twin_instance_ocid> \
  --request-endpoint <request_endpoint> \
  --request-duration PT30S \
  --response-endpoint <response_endpoint> \
  --response-duration PT30S \
  --request-data-content-type application/json \
  --request-data file://command-request.json
```

Verify final state through command response records, device-side evidence, or a fresh twin read.

## Cleanup Ordering

For teardown, read dependencies first, then delete in this order:

1. relationships
2. digital twin instances
3. adapters with no active dependent instances
4. models with no active dependent adapters or instances

Ask for explicit approval before destructive operations, and verify each resource reaches `DELETED` or disappears from active listings.
