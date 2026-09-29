# OCI IoT topic and payload contracts

Read this reference when a flow maps external topics to an OCI IoT device host
or prepares telemetry for a digital-twin adapter.

## External ingress shape

The current documented external-broker scenario uses:

```text
source/<device-type>/<external-key>
```

The bundled example supports these mappings:

| External topic | Device-host topic | Meaning |
| --- | --- | --- |
| `source/gateway/<external-key>` | `data` | Gateway telemetry |
| `source/hvacs/<external-key>` | `hvacs/<external-key>` | HVAC telemetry |

An external subscription may use `source/+/+`. A shared subscription filter
may use this group prefix:

```text
$share/<group>/source/+/+
```

The `$share/<group>/` prefix belongs to the subscription filter. A conforming
broker normally delivers the original publication topic, such as
`source/hvacs/<external-key>`, in `msg.topic`; do not require the prefix there.
The bundled transform accepts a prefixed `msg.topic` only as a defensive
compatibility fallback for a node or wrapper that exposes the configured
filter rather than the publication topic. Confirm that behavior in the
selected target instead of treating the fallback as normal MQTT semantics.

Validate the exact shape before routing. Reject empty segments, unsupported
device types, malformed shared-subscription prefixes, and empty external keys.
Use a unique MQTT client ID for each simultaneously connected client. Treat
shared-subscription support, QoS acknowledgement, session state, retained
messages, ordering, TLS trust, endpoint, and port as selected broker and target
contracts rather than promises made by the offline transform.

The primary evidence is Oracle's [external-broker ingress scenario](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/ingress-iot-flow-runtime.htm)
and [Flow Runtime scenario setup](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/flow-runtime-scenario-setup.htm).

## Payload boundary

The offline fixture requires a JSON object with an explicit UTC observation time
and serializes the accepted object for a later transport node. This is a
determinism rule for local verification. It does not imply that the live
scenario must obtain time in exactly the same way.

Do not claim that topic routing alone performs digital-twin normalization. A
structured payload reaches normalized telemetry through a selected digital-
twin adapter and model. Consult [Creating a Digital Twin Adapter](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/create-digital-twin-adapter.htm)
before documenting a normalized-data contract.

For a gateway/child flow, preserve the authenticated gateway, external child
key, selected adapter, expected `contentRoot`, and target digital-twin identity
as distinct evidence. Raw acceptance is not normalization or history. Preserve
the source observation timestamp; never substitute broker or flow receipt time
and describe it as sensor time.

## Offline example assets

- [Core-node flow fixture](../assets/node-red/oci-iot-ingress-core.json)
- [Ingress cases](../assets/oci-iot/telemetry-ingress-cases.json)
- [Worked example](../examples/external-broker-ingress.md)

These artifacts prove only deterministic local routing and serialization. They
do not connect to a broker or OCI and do not validate IAM, adapters, queues,
commands, persistence, or deployment.
