# Safety and live-operation gates

Read this reference before proposing or performing any operation that could
access or mutate OCI IoT, a broker, database, queue, device, subscriber,
notification, credential, deployment, or runtime state.

## Default boundary

Public-source inspection, sanitized examples, flow drafting, and offline
validation are not authorization to connect to a live system. A flow export or
fixture proves only what its local checks exercise.

## Approval gate

Immediately before an approved live operation, confirm:

- the exact target, scope, and owner;
- whether the action is read-only or mutating;
- the authentication method without exposing credentials;
- the rollback, restoration, or cleanup plan;
- source freshness and target-region assumptions; and
- affected flows, subscriptions, devices, commands, queues, databases, or
  deployments.

If a material item is missing, report the gap and remain offline. Treat full
flow replacement, subscription changes, command delivery, diagnostic replay,
and cleanup as operationally significant actions.

## Separately authorized checks

Do not treat approval for one step as approval for the next. The following
need independently confirmed targets, effects, evidence, and rollback or
cleanup as applicable:

1. runtime, version, region, and palette inventory;
2. editor or import inspection in a disposable runtime;
3. resource-principal reads;
4. one bounded ingress or batch message;
5. normalization and history confirmation;
6. one bounded command with an active disposable subscriber;
7. notification publication and separate subscriber-delivery observation;
8. a named lifecycle or configuration operation;
9. network, File Storage, or logging configuration changes; and
10. complete-flow replacement with an external backup, current ETag,
    `if-match`, stale-precondition stop, rollback artifact, and readback.

For a Flow Runtime property or `networkConfig` replacement, capture the whole
current resource and its resource ETag, preserve every intended subnet, NSG,
mount, log, tag, and property, use `if-match`, stop on a stale precondition,
and re-read effective state. Never retry by overwriting a newer resource.

## Sensitive material

Keep secrets, tokens, OCIDs, private keys, certificates, real connection
strings, live hostnames, generated runtime state, and production payloads out
of skill assets, version control, prompts, logs, and test output. Use clearly
sanitized identifiers in examples. Never infer a live target from a public
sample endpoint or an offline fixture.

For service-specific operational limits, recheck the current
[Flow Runtime documentation](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/flow-runtimes.htm)
and the approved target environment.
