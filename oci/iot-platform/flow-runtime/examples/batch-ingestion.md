# Example: offline batch ingestion

This example mirrors the documented Object Storage scenario with a fake
download stage. It is an offline contract, not an Object Storage client or a
claim that the selected Flow Runtime has that scenario node.

## Flow shape

```text
Inject index -> prepare object name -> fake download -> bytes to UTF-8
  -> parse CSV -> transform rows -> Debug MQTT output
```

The object index is one-based and derives the requested name as
`iot-data-<index>.csv`. The name is validated before download, and the index
advances only after a successful fake download. Missing or failed downloads
leave the index unchanged, allowing a caller to retry or quarantine
deliberately. Empty objects and malformed rows produce explicit errors; they do
not silently become telemetry.

## Illustrative transformation

For a gateway row:

```text
gateway,gw-01,2026-01-15T14:00:00.000Z,21.5,45.2
```

the deterministic output is topic `data` and a JSON payload retaining the
source time. The Oracle numeric `time` field is epoch microseconds and is
converted safely to ISO UTC; an ISO UTC input is retained. A child HVAC row
targets `hvacs/<externalKey>`. These topics,
columns, and device names are illustrative scenario values; validate the
selected adapter/model and device-host contract before adapting them.

Required metric cells must be non-empty; unsafe/out-of-range timestamps and
empty numeric cells are rejected. Use
[batch-ingestion-cases.json](../assets/batch/batch-ingestion-cases.json)
and run `node scripts/verify-workflows.mjs` from the installed skill's
`flow-runtime/` subdirectory.
The verifier proves CSV decoding, validation, row mapping, and failure-safe
index advancement only. It cannot prove Object Storage authorization,
reachability, MQTT/device-host publication, adapter normalization, persistence,
or history.

## Live handoff

A live test needs separate approval for the target runtime and palette,
resource-principal Object Storage access, object scope, network path, output
topic, and any replay or cleanup effect. Capture download, decoded, accepted,
normalized, and historized evidence independently.
