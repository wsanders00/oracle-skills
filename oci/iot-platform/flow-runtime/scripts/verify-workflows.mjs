import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(packageRoot, path), "utf8"));
const readText = async (path) => readFile(resolve(packageRoot, path), "utf8");

const batch = await readJson("assets/batch/batch-ingestion-cases.json");
const monitoring = await readJson("assets/monitoring/normalized-monitoring-cases.json");
const commands = await readJson("assets/commands/command-notification-cases.json");

assert.equal(batch.scope, "offline-example");
assert.deepEqual(batch.oracleScenario.objectNamePattern, "iot-data-<counter>.csv (counter begins at 1)");
assert.deepEqual(batch.contract.columns, ["deviceType", "externalKey", "timestamp", "temperature", "humidity"]);
assert.deepEqual(batch.contract.oracleColumnAliases, { externalKey: "externalId", timestamp: "time" });
assert.equal(batch.contract.timestamp.numericUnit, "microseconds");
assert.equal(batch.contract.timestamp.numeric, "non-negative integer Unix epoch microseconds represented as a CSV string");
assert.equal(batch.contract.indexAdvance, "only after a successful object download");
assert.ok(batch.cases.length >= 15, "batch fixture should cover success and adversarial failure families");

const splitCsv = (line) => {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (character === '"') {
      if (quoted && line[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      fields.push(field); field = "";
    } else field += character;
  }
  if (quoted) throw new Error("malformed CSV quote");
  fields.push(field);
  return fields;
};

const prepareObjectName = (index) => {
  if (!Number.isSafeInteger(index) || index < 1) return null;
  return `iot-data-${index}.csv`;
};

const parseTimestamp = (raw) => {
  const value = String(raw ?? "").trim();
  if (/^\d+$/.test(value)) {
    // Oracle's documented batch sample uses Unix epoch microseconds. Use BigInt
    // so an unsafe Number conversion cannot silently change the observation time.
    const micros = BigInt(value);
    const maxSafeInteger = 9007199254740991n;
    const maxDateMilliseconds = 8640000000000000n;
    if (micros > maxSafeInteger || micros > maxDateMilliseconds * 1000n) return null;
    const milliseconds = micros / 1000n;
    const date = new Date(Number(milliseconds));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/);
  if (!iso) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const [, year, month, day, hour, minute, second] = iso;
  if (date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)
    || date.getUTCHours() !== Number(hour)
    || date.getUTCMinutes() !== Number(minute)
    || date.getUTCSeconds() !== Number(second)) return null;
  return date.toISOString();
};

const parseRequiredNumber = (raw) => {
  const value = String(raw ?? "").trim();
  if (value.length === 0) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const transformBatchCase = (testCase) => {
  const expectedObjectName = prepareObjectName(testCase.initialIndex);
  if (!expectedObjectName || testCase.objectName !== expectedObjectName) {
    return { download: "invalid-object-name", index: testCase.initialIndex, rows: [], errors: ["invalid object name"] };
  }
  if (testCase.download === "error") return { download: "error", index: testCase.initialIndex, rows: [], errors: ["download failed"] };
  if (!Object.hasOwn(testCase, "objectBytesBase64")) return { download: "missing", index: testCase.initialIndex, rows: [], errors: ["object not found"] };

  // A successful download is the only point at which the sequential index advances.
  const nextIndex = testCase.initialIndex + 1;
  const text = Buffer.from(testCase.objectBytesBase64, "base64").toString("utf8");
  if (text.length === 0) return { download: "success", index: nextIndex, rows: [], errors: ["empty object"] };
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((line, index, all) => line.length > 0 || index !== all.length - 1);
  let headers;
  try {
    headers = splitCsv(lines[0]);
  } catch {
    return { download: "success", index: nextIndex, rows: [], errors: ["malformed CSV"] };
  }
  const errors = [];
  for (const required of batch.contract.columns) if (!headers.includes(required)) errors.push(`missing column: ${required}`);
  if (errors.length > 0) return { download: "success", index: nextIndex, rows: [], errors };

  const positions = Object.fromEntries(batch.contract.columns.map((column) => [column, headers.indexOf(column)]));
  const rows = [];
  for (const line of lines.slice(1)) {
    let values;
    try {
      values = splitCsv(line);
    } catch {
      errors.push("malformed CSV row");
      continue;
    }
    if (values.length !== headers.length) { errors.push("malformed row columns"); continue; }
    const deviceType = values[positions.deviceType].trim();
    const externalKey = values[positions.externalKey].trim();
    const sourceTime = parseTimestamp(values[positions.timestamp]);
    if (!batch.contract.supportedDeviceTypes.includes(deviceType)) { errors.push(`unsupported device type: ${deviceType}`); continue; }
    if (!externalKey) { errors.push("missing external key"); continue; }
    if (!sourceTime) { errors.push("invalid timestamp"); continue; }
    const temperature = parseRequiredNumber(values[positions.temperature]);
    const humidity = parseRequiredNumber(values[positions.humidity]);
    if (temperature === null) { errors.push("invalid number: temperature"); continue; }
    if (humidity === null) { errors.push("invalid number: humidity"); continue; }
    const payloadObject = { deviceType, externalKey, time: sourceTime, temperature, humidity };
    rows.push({
      topic: deviceType === "gateway" ? "data" : `hvacs/${externalKey}`,
      payload: JSON.stringify(payloadObject), sourceTime, deviceType, externalKey
    });
  }
  return { download: "success", index: nextIndex, rows, errors };
};

for (const testCase of batch.cases) {
  assert.deepEqual(transformBatchCase(testCase), testCase.expected, `batch case failed: ${testCase.name}`);
}
// Hardcoded invariants keep fixture and logic from being weakened together.
assert.equal(prepareObjectName(1), "iot-data-1.csv");
assert.equal(prepareObjectName(0), null);
assert.equal(transformBatchCase(batch.cases.find(({ name }) => name === "missing object")).index, 11);
assert.equal(transformBatchCase(batch.cases.find(({ name }) => name === "download failure leaves index unchanged")).index, 12);
assert.equal(transformBatchCase(batch.cases.find(({ name }) => name === "requested object does not match counter")).download, "invalid-object-name");
assert.equal(parseTimestamp("1768485600000000"), "2026-01-15T14:00:00.000Z");
assert.equal(parseTimestamp("9007199254740992"), null);
assert.equal(parseTimestamp("8640000000000000001"), null);
assert.equal(parseTimestamp("2026-02-30T12:00:00Z"), null);
assert.equal(parseRequiredNumber(""), null);

const identitySegment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const monitoringResult = (testCase) => {
  if (!testCase.subscriberId) return { route: "final", reason: "subscriber-required", commands: [], recordId: null };
  if (testCase.queueType !== monitoring.contract.queueType) return { route: "final", reason: "queue-type-mismatch", commands: [], recordId: null };
  if (testCase.records.length === 0) return { route: "final", reason: "empty-dequeue", commands: [], recordId: null };
  if (typeof testCase.targetTwinId !== "string" || !identitySegment.test(testCase.targetTwinId)) return { route: "final", reason: "target-twin-required", commands: [], recordId: null };
  const record = testCase.records[0];
  if (!record || !identitySegment.test(String(record.twinId ?? "")) || !identitySegment.test(String(record.deviceType ?? "")) || !identitySegment.test(String(record.externalKey ?? ""))) {
    return { route: "final", reason: "invalid-identity", commands: [], recordId: record?.recordId ?? null };
  }
  if (record.twinId !== testCase.targetTwinId) return { route: "final", reason: "twin-mismatch", commands: [], recordId: null };
  if (!record.recordId || !parseTimestamp(record.sourceTime)) return { route: "final", reason: "invalid-source-time", commands: [], recordId: record.recordId ?? null };
  if (!Number.isFinite(record.metrics?.temperature)) return { route: "final", reason: "invalid-metric", commands: [], recordId: record.recordId };
  if (record.metrics.temperature < monitoring.contract.threshold.value) return { route: "final", reason: "below-threshold", commands: [], recordId: record.recordId };
  return { route: "command", reason: "threshold", commands: [{ sourceRecordId: record.recordId, twinId: record.twinId, deviceType: record.deviceType, externalKey: record.externalKey, requestEndpoint: `${record.deviceType}/${record.externalKey}/command/setMode`, responseEndpoint: `${record.deviceType}/${record.externalKey}/command/response`, command: "setMode", value: "eco" }], recordId: record.recordId };
};

assert.equal(monitoring.scope, "offline-example");
assert.equal(monitoring.contract.targetTwinIdentityRequired, true);
for (const testCase of monitoring.cases) assert.deepEqual(monitoringResult(testCase), testCase.expected, `monitoring case failed: ${testCase.name}`);
const thresholdCase = monitoring.cases.find(({ name }) => name === "normalized threshold emits correlated command");
assert.equal(thresholdCase.expected.commands[0].sourceRecordId, thresholdCase.expected.recordId, "source correlation must remain distinct in command context");

const terminalStatuses = new Set(["completed", "rejected", "refused", "expired", "bad-response", "not-responded"]);
const nonFinalStatuses = new Set(["accepted", "prepared", "sent", "pending", "responded"]);
const formatNotification = (testCase, state, rawCommandDataRecordId) => ({
  title: "OCI IoT command result",
  body: `sourceRecordId=${testCase.recordId} rawCommandDataRecordId=${rawCommandDataRecordId ?? "none"} status=${state} deviceType=${testCase.deviceType} externalKey=${testCase.externalKey}`
});
const commandOutput = (testCase, state, route, polls, rawCommandDataRecordId, transitions) => ({
  state, route, polls, transitions,
  sourceRecordId: testCase.recordId,
  rawCommandDataRecordId,
  notification: formatNotification(testCase, state, rawCommandDataRecordId)
});
const commandResult = (testCase) => {
  const response = testCase.commandResponse;
  if (!response) {
    const attempt = testCase.reconciliationAttempt;
    const elapsedMs = testCase.elapsedMs;
    if (!Number.isInteger(attempt) || attempt < 1 || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
      return commandOutput(testCase, "bad-response", "final", 0, null, ["bad-response"]);
    }
    const retryWithinAttemptLimit = attempt < commands.contract.pollLimit;
    const retryWithinDeadline = elapsedMs + commands.contract.pollIntervalMs <= commands.contract.deadlineMs;
    return retryWithinAttemptLimit && retryWithinDeadline
      ? commandOutput(testCase, "missing", "retry", 0, null, ["missing"])
      : commandOutput(testCase, "deadline", "final", 0, null, ["deadline"]);
  }
  const sqlBinds = { [commands.contract.sql.bindName]: response[commands.contract.sql.bindValueSource] };
  const commandId = sqlBinds[commands.contract.sql.bindName];
  if (!commandId) return commandOutput(testCase, "bad-response", "final", 0, null, ["bad-response"]);

  let polls = 0;
  const transitions = [];
  for (const statusResult of testCase.statusResults ?? []) {
    if (polls >= commands.contract.pollLimit) break;
    if ((polls + 1) * commands.contract.pollIntervalMs > commands.contract.deadlineMs) break;
    polls += 1;
    if (!Array.isArray(statusResult)) {
      transitions.push("bad-response");
      return commandOutput(testCase, "bad-response", "final", polls, commandId, transitions);
    }
    // A successful SQL query can return no rows while the command record is
    // not visible yet. Treat that empty result as a bounded retry, not as a
    // fabricated command status or terminal success.
    if (statusResult.length === 0) {
      transitions.push("retry");
      continue;
    }
    if (statusResult.length !== 1) {
      transitions.push("bad-response");
      return commandOutput(testCase, "bad-response", "final", polls, commandId, transitions);
    }
    const statusRow = statusResult[0];
    if (!statusRow || statusRow.ID !== commandId) {
      transitions.push("bad-response");
      return commandOutput(testCase, "bad-response", "final", polls, commandId, transitions);
    }
    const status = String(statusRow.DELIVERY_STATUS ?? "").toLowerCase().replaceAll("_", "-");
    if (terminalStatuses.has(status)) {
      transitions.push(status);
      return commandOutput(testCase, status, "final", polls, commandId, transitions);
    }
    if (!nonFinalStatuses.has(status)) {
      transitions.push("bad-response");
      return commandOutput(testCase, "bad-response", "final", polls, commandId, transitions);
    }
    transitions.push(status);
  }
  transitions.push("deadline");
  return commandOutput(testCase, "deadline", "final", polls, commandId, transitions);
};

assert.equal(commands.scope, "offline-example");
assert.deepEqual(commands.contract.sendResponseFields, ["rawCommandDataRecordId"]);
assert.equal(commands.contract.sql.table, "RAW_COMMAND_DATA");
assert.equal(commands.contract.sql.bindName, "recordId");
assert.equal(commands.contract.sql.bindValueSource, "rawCommandDataRecordId");
assert.equal(commands.contract.sql.predicate, "ID = :recordId");
assert.equal(commands.contract.sql.emptyResult, "retry");
assert.deepEqual(commands.contract.missingResponse, { action: "reconcile-without-resend", attemptField: "reconciliationAttempt", elapsedField: "elapsedMs" });
assert.deepEqual(commands.contract.notification.bodyFields, ["sourceRecordId", "rawCommandDataRecordId", "status", "deviceType", "externalKey"]);
assert.ok(commands.contract.pollLimit > 0 && commands.contract.pollIntervalMs > 0 && commands.contract.deadlineMs > 0);
assert.ok(commands.cases.length >= 19, "command fixture should cover source statuses and bounded missing responses");
for (const state of ["accepted", "prepared", "sent", "pending", "responded", "missing", "completed", "rejected", "refused", "expired", "bad-response", "not-responded", "deadline"]) assert.equal(commands.contract.states.includes(state), true, `missing command state: ${state}`);
for (const testCase of commands.cases) {
  assert.deepEqual(commandResult(testCase), testCase.expected, `command case failed: ${testCase.name}`);
  assert.equal(testCase.expected.notification.body.includes(`sourceRecordId=${testCase.recordId}`), true, `source correlation missing: ${testCase.name}`);
  if (testCase.commandResponse) assert.equal(Object.hasOwn(testCase.commandResponse, "status"), false, `send response must not invent status: ${testCase.name}`);
  if (testCase.commandResponse?.[commands.contract.sql.bindValueSource]) {
    assert.notEqual(testCase.commandResponse[commands.contract.sql.bindValueSource], testCase.recordId, `SQL bind must not reuse source record ID: ${testCase.name}`);
    assert.equal(testCase.commandResponse[commands.contract.sql.bindValueSource], testCase.expected.rawCommandDataRecordId, `SQL bind must use returned command record ID: ${testCase.name}`);
  }
  if (testCase.expected.rawCommandDataRecordId) assert.equal(testCase.expected.notification.body.includes(`rawCommandDataRecordId=${testCase.expected.rawCommandDataRecordId}`), true, `command correlation missing: ${testCase.name}`);
  assert.ok(testCase.expected.polls <= commands.contract.pollLimit, `poll bound exceeded: ${testCase.name}`);
}
assert.deepEqual(new Set(commands.cases.map(({ expected }) => expected.state)), new Set(["completed", "missing", "rejected", "refused", "expired", "bad-response", "not-responded", "deadline"]));
assert.equal(commands.cases.some(({ expected }) => expected.route === "retry"), true, "fixture must exercise retry output");
assert.ok(commands.cases.some(({ name }) => name === "missing command record ID"));
assert.ok(commands.cases.some(({ name }) => name === "mismatched SQL command record ID"));
for (const status of ["prepared", "sent", "pending", "responded"]) {
  const testCase = commands.cases.find(({ name }) => name === `SQL ${status} then completed`);
  assert.deepEqual([testCase.expected.state, testCase.expected.route, testCase.expected.transitions], ["completed", "final", [status, "completed"]], `${status} must remain non-final until completion`);
}
const boundedMissing = commands.cases.find(({ name }) => name === "missing command response within reconciliation bounds");
assert.deepEqual([boundedMissing.reconciliationAttempt, boundedMissing.elapsedMs, boundedMissing.expected.state, boundedMissing.expected.route], [1, 0, "missing", "retry"], "missing command response must use a bounded reconciliation retry");
for (const name of ["missing command response attempt limit", "missing command response deadline"]) {
  const testCase = commands.cases.find((item) => item.name === name);
  assert.deepEqual([testCase.expected.state, testCase.expected.route], ["deadline", "final"], `${name} must terminate`);
}
const emptyRetry = commands.cases.find(({ name }) => name === "empty SQL status result retries then completes");
assert.deepEqual([emptyRetry.expected.state, emptyRetry.expected.route, emptyRetry.expected.polls, emptyRetry.expected.transitions], ["completed", "final", 2, ["retry", "completed"]], "empty SQL result retry contract failed");
const emptyDeadline = commands.cases.find(({ name }) => name === "empty SQL status result reaches deadline");
assert.deepEqual([emptyDeadline.expected.state, emptyDeadline.expected.route, emptyDeadline.expected.polls, emptyDeadline.expected.transitions], ["deadline", "final", 2, ["retry", "retry", "deadline"]], "empty SQL result deadline contract failed");
for (const testCase of commands.cases) if (["completed", "rejected", "refused", "expired", "bad-response", "not-responded", "deadline"].includes(testCase.expected.state)) assert.equal(testCase.expected.route, "final", `terminal state re-entered retry: ${testCase.name}`);

const reference = await readText("references/monitoring-commands-notifications.md");
assert.match(reference, /rawCommandDataRecordId/);
assert.match(reference, /RAW_COMMAND_DATA/);
assert.match(reference, /WHERE ID = :recordId/);
assert.match(reference, /bindName/);
assert.match(reference, /bindValueSource/);
for (const status of ["ACCEPTED", "PREPARED", "SENT", "PENDING", "RESPONDED", "COMPLETED", "REJECTED", "REFUSED", "EXPIRED", "BAD_RESPONSE", "NOT_RESPONDED"]) assert.match(reference, new RegExp(`\\b${status}\\b`), `reference is missing status ${status}`);

console.log(`verified batch (${batch.cases.length}), normalized monitoring (${monitoring.cases.length}), and bounded command/notification (${commands.cases.length}) offline cases`);
