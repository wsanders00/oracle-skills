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

The helper accepts `--profile`, `--auth`, and `--region` when needed. Supply `--region <oci_region>` when the domain is outside the CLI default region; the selection is forwarded to both domain and domain-group reads. Omit `--auth` when relying on the CLI default. Do not assume a named profile is required for instance, resource, or workload identity authentication.
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

## Selected model fetch to catalog

Use this Bash recipe from the skill directory for an explicitly selected model
OCID, region and the existing `OCI_CLI_GLOBAL_ARGS` signer options above. It does
not discover models. An OCID alone proves neither tenancy nor domain membership;
use trusted supplied metadata, or a separately authorized model metadata GET when
membership must be established. The command uses the supported
[specification GET](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/get-digital-twin-model-specs.htm).
`--query data --output json` projects the full spec from the CLI response envelope.
The inline check verifies the projected shape; the catalog owns deeper validation.

Initialize one private directory outside source in the same shell. Each
`fetch_selected` invocation requests exactly one explicit OCID and stages a fresh
file. Failed selections never enter the successful path array. Client timeouts
are not a hard wall-clock or download-size bound; the 1 MiB check is after download.

<!-- recipe: MODEL-FETCH-SETUP -->
```bash
umask 077
MODEL_TASK_DIR=$(mktemp -d "/tmp/iot-model-fetch.XXXXXX") || exit 1
MODEL_FILES=()
MODEL_SEQUENCE=0
fetch_selected() {
  local selected_id="$1" stage target
  MODEL_SEQUENCE=$((MODEL_SEQUENCE + 1))
  stage="$MODEL_TASK_DIR/$MODEL_SEQUENCE.staged"
  target="$MODEL_TASK_DIR/$MODEL_SEQUENCE.json"
  if oci "${OCI_CLI_GLOBAL_ARGS[@]}" --region "$OCI_REGION" \
      --no-retry --connection-timeout 10 --read-timeout 60 \
      iot digital-twin-model get-spec --digital-twin-model-id "$selected_id" \
      --query data --output json >"$stage" 2>"$MODEL_TASK_DIR/$MODEL_SEQUENCE.error" &&
    python3 - "$stage" 2>>"$MODEL_TASK_DIR/$MODEL_SEQUENCE.error" <<'PY'
import json, pathlib, sys
try:
    with pathlib.Path(sys.argv[1]).open("rb") as source:
        raw = source.read(1024 * 1024 + 1)
    if not raw or len(raw) > 1024 * 1024:
        raise ValueError("size")
    value = json.loads(raw)
    items = value if isinstance(value, list) else [value]
    if not items or not all(isinstance(item, dict) and
        (item.get("@type") == "Interface" or
         isinstance(item.get("@type"), list) and "Interface" in item["@type"])
        for item in items):
        raise ValueError("shape")
except (ValueError, OSError, RecursionError):
    sys.exit(1)
PY
  then
    mv "$stage" "$target" || return 1
    MODEL_FILES+=("$target")
    printf 'selected=%s status=exported path=%s\n' "$selected_id" "$target"
  else
    printf 'selected=%s status=failed\n' "$selected_id"
  fi
}
```

Choose a region and fetch one selected model. For a small explicit set, repeat
only the `fetch_selected` call with each chosen OCID in this same shell; each
exported summary maps its successful path back to that selected OCID. Report
failed and intentionally skipped selections separately from catalog issues.

<!-- recipe: MODEL-FETCH-SELECT -->
```bash
OCI_REGION="<oci_region>"
fetch_selected "<model_ocid>"
```

Run one catalog command on the successful paths. Optionally add literal
`--name temp` to search telemetry names. The existing limits are 32 files and
8 MiB total; hitting a limit is partial coverage, never a complete batch.
Referenced interfaces are unresolved unless explicitly supplied as additional
selections. Exit 0 with no matches is not proof of absence in the domain;
exit 2 requires inspecting partial coverage. Zero exports is acquisition failure
and stops before the catalog is invoked. Source freshness remains unknown.

<!-- recipe: MODEL-FETCH-CATALOG -->
```bash
if [ "${#MODEL_FILES[@]}" -eq 0 ]; then
  printf 'acquisition failed: zero successful exports\n' >&2
  exit 1
fi
python3 scripts/model_spec_index.py "${MODEL_FILES[@]}"
```

Consume the catalog and selection/status/path summaries before cleanup. Raw
exports and service errors stay private in `MODEL_TASK_DIR`; do not paste them
into reports. Remove only this task-owned directory with
`rm -r -- "$MODEL_TASK_DIR"` after results are consumed, or explicitly retain it
when requested and report its private location and cleanup owner. This recipe
provides selected-input/name search, not complete domain coverage.

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
  --device-key deviceId --device-id <device_id> \
  --timestamp-key _metadata.timeLastHeard
```

Use both `--device-key` and `--device-id` to select one device; both values
must be nonblank. Omit both to retain the all-record behavior. A partial or
blank filter is rejected before the input file is read.

If the content response has metadata but no current values, treat that as incomplete evidence and check publish/rejected-data paths before claiming the twin is healthy.

## Resource Create Completion

Model, adapter, instance, and relationship creates return resources. Capture the
returned resource ID. Where supported, `--wait-for-state ACTIVE` polls that
resource with GET; it is not a work-request waiter. Read resource metadata after
the waiter, the stored model spec for models, and filtered relationship listings
for relationships. A successful create response alone does not establish all
application behavior or device connectivity.

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

Use work-request inspection only when the operation documents or returns a work request. Do not infer a work-request ID from a resource-returning create or its ACTIVE waiter:

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

The template requires curl 7.76+ (`--fail-with-body`) and a `base64` executable.
It validates the domain short ID and region as ASCII DNS labels, then constructs
the commercial-realm HTTPS host. Take both values from the selected domain's
authoritative metadata: syntax validation does not establish domain ownership
or authorize use of its credentials. The reference endpoint is a path on that
origin; query strings, fragments, URL inputs, whitespace and control characters
are rejected, and curl URL globbing is disabled.

It preserves HTTP error bodies and returns failure on HTTP or transport errors.
Basic Authorization is supplied through curl stdin. `curl -q` ignores curlrc
settings, TLS verification remains enabled, HTTPS-only transport is enforced,
and the request has 10-second connection and 30-second total timeouts. Redirects
and retries are not enabled. A timeout can leave delivery unknown; observe the
device/service state before considering any separately authorized retry. Shell
tracing is disabled before credential expansion. Do not add tracing, credential
arguments, or redirects to this flow; error bodies may still contain service data.

For certificate-based publishing, use an mTLS client flow. Follow Oracle's
certificate procedure for the actual subject, key protection, and issuance
requirements. In OpenSSL, `v3_req` is a configuration section selecting requested
extensions, not a literal extension name for `-addext`. Select it explicitly
with `-config` and `-reqexts`, and inspect the CSR before submitting it.

This disposable offline example requests CA:FALSE and was verified with OpenSSL
4.0.3. Run it in a new temporary directory; its unencrypted synthetic key is only
for this check. It does not issue a certificate or test an mTLS handshake.

<!-- CSR-SYNTHETIC -->
```bash
cat > csr-check.cnf <<'EOF'
[req]
prompt = no
distinguished_name = subject
[subject]
CN = synthetic-device.invalid
[v3_req]
basicConstraints = critical,CA:FALSE
EOF
openssl req -new -newkey rsa:2048 -noenc -keyout synthetic.key \
  -out synthetic.csr -config csr-check.cnf -reqexts v3_req
openssl req -in synthetic.csr -noout -text -verify
```
<!-- /CSR-SYNTHETIC -->

After publishing, verify the twin content again. For basic validation, `digital-twin-instance get-content` with metadata is enough to prove the publish updated the twin:

```bash
oci "${OCI_CLI_GLOBAL_ARGS[@]}" iot --region <oci_region> digital-twin-instance get-content \
  --digital-twin-instance-id <digital_twin_instance_ocid> \
  --should-include-metadata true \
  --output json
```

If content did not update, check adapter endpoint path, payload content type, timestamp mapping, and auth mode. Rejected-data, snapshot, historized, or ORDS/Data API checks are optional advanced evidence paths and require separate Data API or `OCI_IOT_ORDS_*` credentials.

## Data API Base And Complete Requests

Keep `IOT_DATA_API_BASE` as the unversioned domain base:
`https://<domain-group-short-id>.data.iot.<region>.oci.oraclecloud.com/ords/<domain-short-id>`.
A complete request adds exactly one `/20250531/<collection>` suffix, for example
`<IOT_DATA_API_BASE>/20250531/rawData`. Do not put the version or collection in
the base supplied to the [diagnostics recipes](data-diagnostics.md).
These reads require the separately authorized Data API access path.

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

## Sources

- [Oracle digital twin certificates, Step 3](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/digital-twin-instance-certificate.htm)
- [OpenSSL req options and configuration](https://docs.openssl.org/3.0/man1/openssl-req/)
