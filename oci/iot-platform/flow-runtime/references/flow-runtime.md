# OCI IoT Flow Runtime

Read this reference when a request concerns the OCI-managed Node-RED resource,
its lifecycle, properties, capacity, schemas, or service boundary. Use the
linked focused references for editor collaboration, replacement, IAM, network,
storage, and operational recovery.

## Current evidence

OCI IoT Flow Runtime is a compartment-scoped OCI resource associated with an
IoT domain. It provides a managed Node-RED runtime for flows that can connect
IoT devices, applications, storage, queues, notifications, and external
endpoints. OCI controls the managed runtime software, and palette contents can
depend on service version. Do not infer arbitrary self-hosted modules.

The current primary references are:

- [IoT Flow Runtimes](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/flow-runtimes.htm)
  for the resource and management surface.
- [Creating a Flow Runtime](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/create-iot-flow-runtime.htm)
  and [updating its properties](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/update-iot-flow-runtime.htm)
  for current editable properties and operation behavior.
- [Using the IoT Flow Runtime Editor](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/node-red.htm)
  for editor access, permitted modules, OCI nodes, and authentication options.
- [OCI IoT Platform overview](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/overview.htm)
  for domain, device host, data host, and digital-twin context.

## Resource model

Classify an operation before suggesting it:

| Operation | Mutation | Expected completion evidence |
| --- | --- | --- |
| List/get, get flows, inspect editor | No | Current response plus request time and target identity |
| Create, move, update properties, activate, deactivate, delete | Yes | Work request terminal state and re-read effective resource state |
| Replace the complete flows document | Yes | Synchronous response, current ETag, and re-read effective flows |

Creation and property updates can include display name, description, scale,
logging configuration, network configuration, File Storage mounts, and tags.
Do not hard-code region availability, capacity implications, quotas, or
service-limit values. Check the current documentation and selected region at
use time, and describe scale changes as potentially interrupting until the
target-specific behavior is confirmed.

Each runtime can read its associated IoT schema and has a runtime-specific
read-write schema for flow data. Do not imply that the IoT schema is writable.
Keep application data out of ephemeral local storage when it must survive
deactivation, activation, or managed software updates.

## Guidance pattern

When explaining or designing a Flow Runtime workflow:

1. Identify the domain and whether the flow is operating on the device host,
   data host, or an external system.
2. Identify the managed node surface actually available in the target runtime.
   Map documented roles to exact registered types and inspect the relevant
   target help; use [managed node selection](node-reference.md#managed-target-selection)
   before applying conditional sample-package details.
3. For editor or flows work, use [editor and flow collaboration](flows-editor-and-collaboration.md).
4. For identity, reachability, or persistence, use
   [IAM, network, and storage](iam-network-and-storage.md).
5. Classify lifecycle mutations, expected interruption, backup, work-request,
   and effective-state evidence using [delivery and recovery](delivery-and-recovery.md).
6. Keep local examples limited to message shape, routing, and deterministic
   transformation unless a separate live test has been approved.

The bundled offline example is intentionally weaker than a Flow Runtime: it
contains only core Node-RED nodes and has no IAM, persistence, service
lifecycle, broker, or OCI connection.

## Do not overclaim

Do not infer a target region, limit, managed Node-RED version, scale behavior,
or compatibility relationship between the managed palette and the public
Oracle sample node package. Mark those as unresolved until a current primary
source or a separately approved target-environment check establishes them.
An offline fixture is never evidence of live resource health.
