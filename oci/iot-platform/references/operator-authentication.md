# OCI IoT Operator Authentication

Choose authentication for the person or process running the OCI CLI from its execution context. This is operator/control-plane authentication for OCI API calls; it does not configure a device, data client, editor, MCP server, or IoT runtime identity.

## Choose By Execution Context

| Where the command runs | Common CLI choice | Notes |
| --- | --- | --- |
| Developer workstation or other interactive shell | API key from an OCI CLI config profile, or a CLI session/security token | Use the intended local config profile when multiple profiles exist. A session token has its own lifecycle and may need refresh. |
| OCI Compute instance | Instance principal | The instance must be in a context where instance-principal authentication is available, and its dynamic group must have the required policy grants. |
| OCI Functions or another OCI resource supporting resource principals | Resource principal | Use only where that execution service supplies a resource principal and the resource has the required policy grants. |
| OKE workload | OKE workload identity where configured; otherwise the identity method supported by that workload | Follow the cluster and workload identity setup for the environment. Do not assume a local workstation profile is available inside a pod. |
| Service acting on behalf of a signed-in OCI user | Instance OBO user only where supported and configured | This is a specific delegated identity flow, not a generic substitute for a user profile. |

OCI CLI documents `api_key`, `instance_obo_user`, `instance_principal`, `oke_workload_identity`, `resource_principal`, and `security_token` as `--auth` choices. API key config authentication is the CLI default. Use only a mode supported by the installed CLI and the execution environment; this list does not claim every mode has been validated with every IoT command. See the [OCI CLI global options](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/oci.html) and [CLI environment variables](https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/clienvironmentvariables.htm).

## Profiles And Target Tenancy

A profile is a named section of the OCI CLI configuration file. It supplies configuration for an authentication method; it is not itself an identity or a tenancy selector. Use `--profile <profile>` only when the chosen mode needs a named profile or when the intended configuration is not the CLI default. Use `--auth <mode>` when explicitly choosing a non-default CLI authentication mode; the CLI also supports `OCI_CLI_AUTH`.

Keep the signer context distinct from the target resource:

- The credentials or runtime identity identify the calling principal and, for user/API-key or session flows, are associated with a credential tenancy.
- The IoT domain OCID identifies the target resource. It may belong to a different tenancy from the calling principal.
- OCI IAM policies and the applicable cross-tenancy trust configuration must grant that principal the required access to the target compartment or resource.

Do not infer that an operator needs a named user in the target tenancy. Ask which execution context and principal are available, which IoT domain or tenancy contains the target resource, and whether the principal has been granted access. Verify the target tenancy through resource metadata and compartment ancestry or trusted operator context; an OCID alone does not establish its tenancy. Do not assume the credentials and resource share a tenancy.

## Keep Other Authentication Boundaries Separate

- **IoT CLI operator:** authenticates control-plane calls such as listing domains, reading twins, and managing IoT resources.
- **Device publishing:** uses the device's IoT publish credentials, such as the configured basic-auth secret or client certificate for mTLS. An instance `authId` is not the CLI operator's auth mode.
- **Data API or database client:** uses the credentials and grants for that data access path. OCI CLI authentication does not automatically authenticate SQL, ORDS, APEX, or another data client.
- **MCP server:** may use its own configured credentials or delegate OCI CLI/API calls. Its authentication is determined by that server's setup and does not follow merely from an available CLI profile.
- **Human editor:** signs in through the editor's own SSO/session flow; that does not establish OCI CLI credentials.
- **IoT Flow Runtime or other deployed runtime:** uses the runtime's configured resource identity and policies. Local operator credentials do not transfer to the running service.

For a CLI workflow, pass the selected `--profile` and `--auth` options consistently to the discovery helper and subsequent `oci` commands when those options apply. For device or data-plane testing, choose and verify that separate authentication path independently.
