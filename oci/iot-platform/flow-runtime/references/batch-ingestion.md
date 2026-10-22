# Batch Object Storage ingestion

Read this reference when a flow must turn a sequence of Object Storage objects
into device-host messages. The documented scenario is a useful shape, not proof
that the Object Storage node is installed in a selected Flow Runtime.

Claim owner: `FR-BATCH-001` (scenario/target-specific; recheck at
implementation and against the target palette before live use). The primary
source is Oracle's [batch Object Storage ingestion scenario](https://docs.oracle.com/en-us/iaas/Content/internet-of-things/ingest-batch-data-flow-runtime.htm).

## Shape and state contract

Keep transport and transformation stages distinct:

```text
Inject or scheduler -> prepare object name -> Object Storage download
  -> advance index -> Buffer-to-UTF-8 -> CSV rows -> transform row -> MQTT-OUT
```

The object index is state and is one-based. Compute exactly
`iot-data-${index}.csv` from an index beginning at `1`, validate that the
requested object name matches that derivation, download it, and advance the
index only after the download has returned a successful body. A missing or
denied download must not skip the object. After a
successful download, index advancement is independent of row acceptance: an
empty object or CSV/row error can still advance the object index while emitting
explicit error or quarantine evidence. If a workflow instead retries malformed
objects, make that a selected policy and fence it against an unbounded loop.

Oracle's scenario uses sequential names such as `iot-data-<counter>.csv`
(starting at counter `1`) and a CSV contract with `deviceType`, `externalId`,
`time`, device metrics, and `mode`. The documented integer `time` values are
Unix epoch microseconds (not milliseconds); convert with an integer-safe
microseconds-to-milliseconds operation before formatting ISO UTC. Retain an
already valid ISO UTC string. The Object Storage node returns a Buffer;
the scenario converts it to UTF-8 text before the CSV node. The compact fixture
uses `externalKey` and `timestamp` as sanitized aliases so its expected rows
stay readable; an implementation must map the selected scenario's `externalId`
and `time` fields deliberately rather than assuming aliases.

The portable fixture uses a fake download map and a base64 representation of
the returned bytes. Decode with the equivalent of `Buffer` to UTF-8 before CSV
parsing; do not parse a byte representation as if it were already text. It
accepts these illustrative columns:

```text
deviceType,externalKey,timestamp,temperature,humidity
```

`gateway` maps to the illustrative `data` topic. `hvacs` maps to
`hvacs/<externalKey>`. These fixed names and fields are example scenario
contracts, not universal OCI IoT schemas. Validate every required header,
non-empty identity, supported type, numeric metric, and timestamp before
forming an output payload. Preserve the source timestamp; receipt time is
separate evidence and must not replace observation time.

Timestamp boundaries in the fixture are deliberately explicit: an ISO-8601
UTC string and a non-negative integer Unix epoch in microseconds (carried as a
CSV string) are accepted and normalized to an ISO UTC string. Reject negative,
unsafe, out-of-Date-range integers, and calendar-invalid ISO values rather
than letting a date library normalize them to another observation. Required numeric CSV cells must be
non-empty; do not let `Number("")` silently become zero. Other timestamp forms
are a row error until a selected adapter contract says otherwise.

## Failure-safe pseudocode

```text
index := current index (starts at 1)
name := prepareName(index) // exactly iot-data-<index>.csv
if requested name != name: emit invalid-object-name; keep index
download := fakeOrSupportedObjectDownload(name)
if download is missing or unsuccessful: emit terminal/retry evidence; keep index
else:
  index := index + 1
  text := bytesToUtf8(download.body)
  parsed := parseCsv(text)
  for each row: validate -> transform -> emit MQTT output or quarantine evidence
```

Do not increment before `download` succeeds. Do not infer Object Storage
authorization, object existence, network reachability, MQTT acceptance,
device-host publication, adapter normalization, persistence, or history from
the offline transform.

## Offline cases

Use [batch-ingestion-cases.json](../assets/batch/batch-ingestion-cases.json)
with the focused verifier. It covers gateway and child rows, byte decoding,
missing and malformed columns, supported and unsupported types, both timestamp
forms, empty and multi-row objects, missing objects, and a download failure with
an unchanged index.

## Live-only gates

Before a live batch check, separately approve the exact runtime, region,
palette/version, Object Storage namespace/bucket/object scope, resource
principal policy, subnet/DNS/TLS reachability, target device-host topic, and
cleanup/replay effects. Observe each stage independently: download response,
decoded row, accepted publish, adapter-normalized value, and history. A
successful object read or MQTT publish does not establish downstream state.
