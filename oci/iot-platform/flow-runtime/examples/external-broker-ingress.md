# Example: offline external-broker ingress transform

This is a self-contained illustration of one Oracle-documented ingress
scenario. Its topic names and payload fields are example data, not universal
OCI IoT contracts. Confirm the selected device-host, adapter, model, managed
palette, and runtime version before adapting it to a target environment.

The example is offline. It does not connect to a broker or OCI.

## Shape

The live pattern is conceptually:

```text
MQTT-IN -> Function route/serialize -> MQTT-OUT
```

The bundled flow replaces transport nodes with Inject and Debug nodes:

```text
Inject sanitized message -> Function route/serialize -> Debug
```

Use the [core-node flow](../assets/node-red/oci-iot-ingress-core.json) and
[deterministic cases](../assets/oci-iot/telemetry-ingress-cases.json). They
model only core Node-RED message transformation.

## Illustrative input

```json
{
  "topic": "source/hvacs/example-hvac-01",
  "qos": 1,
  "payload": {
    "time": "2026-01-15T14:00:00.123Z",
    "temperature": 72.5,
    "humidity": 45.2,
    "mode": "cool"
  }
}
```

The Function validates the supported example topic shapes, rejects malformed
topics and payloads, requires an explicit UTC observation time, maps the HVAC
example to `hvacs/example-hvac-01`, and serializes the payload. MQTT shared
subscriptions use `$share/<group>/...` in the subscription filter; the broker
normally delivers the original publication topic in `msg.topic`. The prefixed
fixture is only a defensive fallback for a wrapper that exposes the configured
filter and is not normal MQTT delivery semantics.

## Validate the package

From the installed skill's `flow-runtime/` subdirectory:

```bash
node scripts/verify-portable.mjs
```

If Node-RED is available locally, the flow may also be imported and triggered.
Do not add a real broker, credential, device host, or OCI resource to this
example. For live design, start with Oracle's
[external-broker ingress scenario](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/ingress-iot-flow-runtime.htm)
and validate the target contract separately.
