import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const loadJson = async (path) => JSON.parse(await readFile(resolve(packageRoot, path), "utf8"));
const sampleRevision = "d1f886fed04f456b28527d578be140fbc7a6c2f1";
const qosValid = (value) => value !== null && value !== undefined && value !== "" && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 2;
const normalizeQos = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 2 ? parsed : fallback;
};
const positiveInteger = (value) => Number.isInteger(value) && value > 0;
const nonnegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const reservedObjectKeys = new Set(["__proto__", ["constr", "uctor"].join(""), "prototype"]);
const hasReservedObjectKey = (value) => plainObject(value) && Object.keys(value).some((key) => reservedObjectKeys.has(key));
const parseBoundedPositiveInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) return fallback;
  return Math.min(Math.floor(parsed), maximum);
};

// Mirror the pinned SQL node's lexical blanking pass. Keeping character
// positions stable prevents quoted text, identifiers, and comments from
// masquerading as binds or statement separators.
const stripSqlForScan = (sql) => {
  let output = "";
  let state = "normal";
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1] ?? "";
    if (state === "normal") {
      if (character === "'") { state = "single-quote"; output += " "; continue; }
      if (character === '"') { state = "double-quote"; output += " "; continue; }
      if (character === "-" && next === "-") { state = "line-comment"; output += "  "; index += 1; continue; }
      if (character === "/" && next === "*") { state = "block-comment"; output += "  "; index += 1; continue; }
      output += character;
      continue;
    }
    if (state === "single-quote") {
      if (character === "'" && next === "'") { output += "  "; index += 1; continue; }
      if (character === "'") state = "normal";
      output += " ";
      continue;
    }
    if (state === "double-quote") {
      if (character === '"') state = "normal";
      output += " ";
      continue;
    }
    if (state === "line-comment") {
      if (character === "\n" || character === "\r") { state = "normal"; output += character; }
      else output += " ";
      continue;
    }
    if (character === "*" && next === "/") { state = "normal"; output += "  "; index += 1; }
    else output += character === "\n" || character === "\r" ? character : " ";
  }
  return output;
};
const anonymousPlsqlBlock = (sql) => /^\s*(?:begin|declare)\b[\s\S]*\bend\s*;?\s*$/i.test(sql ?? "");
const editorStatementChain = (sql) => {
  if (anonymousPlsqlBlock(sql)) return false;
  return stripSqlForScan(sql).split(";").map((part) => part.trim()).filter(Boolean).length > 1;
};
const bindPlaceholders = (sql) => {
  const sanitized = stripSqlForScan(sql);
  const named = [...sanitized.matchAll(/(^|[^:]):([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[2]);
  const positional = [...sanitized.matchAll(/(^|[^:]):([0-9]+)\b/g)].map((match) => Number(match[2]));
  return { named, positional };
};

const identity = await loadJson("assets/nodes/node-identity-cases.json");
const database = await loadJson("assets/nodes/database-aq-contract-cases.json");
const iot = await loadJson("assets/nodes/iot-node-contract-cases.json");
const optional = await loadJson("assets/nodes/optional-oci-node-contract-cases.json");

for (const [fixture, id] of [
  [identity, "node-identity-cases-v1"],
  [database, "database-aq-contract-cases-v1"],
  [iot, "iot-node-contract-cases-v1"],
  [optional, "optional-oci-node-contract-cases-v1"]
]) {
  assert.equal(fixture.fixtureId, id, `${id}: fixture identity mismatch`);
  assert.equal(fixture.scope, "offline-example", `${id}: scope must remain offline-example`);
  assert.ok(Array.isArray(fixture.cases) && fixture.cases.length > 0, `${id}: cases are missing`);
  assert.equal(new Set(fixture.cases.map(({ caseId }) => caseId)).size, fixture.cases.length, `${id}: case IDs must be unique`);
  assert.ok(Array.isArray(fixture.cannotProve) && fixture.cannotProve.length > 0, `${id}: cannotProve is required`);
}

const identityDecision = (item) => {
  const { name, surfaceContext } = item;
  if (name === "iot-config" && surfaceContext === "managed-editor") return { decision: "classify-source-role", classification: "managed-documented", documentedNodeLabel: "iot-config", paletteLabel: "OCI Config", sourceOwner: "O1", authenticationFamily: "oci-configuration", targetSelection: "requires-selected-target-observation" };
  if (name === "iot-config" && surfaceContext === "sample-package-device-mqtt" && /treated as OCI Config/i.test(item.request)) return { decision: "reject", reason: "authentication-family-mismatch", classification: "sample-package", authenticationFamily: "device-mqtts", mustNotBe: "managed-documented", sourceOwner: "S4", sourceIds: ["O7", "S4"] };
  if (name === "iot-config" && surfaceContext === "sample-package-device-mqtt") return { decision: "select-but-gate", classification: "sample-package", canonicalName: "iot-config", paletteLabel: "sample device MQTT config", sourceOwner: "S4", sourceIds: ["O7", "S4"], authenticationFamily: "device-mqtts", configurationParent: null, targetGate: "immutable-package-and-target-palette" };
  if (name === "oci-config" && surfaceContext === "sample-package-oci-rest" && /telemetry device session/i.test(item.request)) return { decision: "reject", reason: "authentication-family-mismatch", classification: "sample-package", authenticationFamily: "oci-api", mustNotAuthenticate: "device-mqtts", sourceOwner: "S4", sourceIds: ["O7", "S4"] };
  if (name === "oci-config" && surfaceContext === "sample-package-oci-rest") return { decision: "select-but-gate", classification: "sample-package", canonicalName: "oci-config", paletteLabel: "sample OCI config", sourceOwner: "S4", sourceIds: ["O7", "S4"], authenticationFamily: "oci-api", configurationParent: null, targetGate: "immutable-package-and-target-palette" };
  if (name === "iot-config" && surfaceContext === null) return { decision: "clarify", reason: "ambiguous-name", candidateIdentities: ["managed-iot-config", "sample-device-iot-config"], authenticationFamilies: ["oci-configuration", "device-mqtts"], sourceOwners: ["O1", "S4"] };
  if (name === "sql") return { decision: "select", classification: "managed-documented", sourceOwner: "O1", configurationParent: "managed-db-connection", authenticationFamily: "oracle-database", targetGate: "managed-palette-and-database-contract" };
  if (name === "Object Storage download") return { decision: "select-but-gate", classification: "official-scenario", sourceOwner: "C11", exactPaletteIdentity: "not-established", targetGate: "scenario-role-and-target-palette", offlineAllowed: true };
  if (name === "OCI Notifications publication") return { decision: "select-but-gate", classification: "official-scenario", sourceOwner: "C12", exactPaletteIdentity: "not-established", targetGate: "scenario-role-and-target-palette", publicationIsNotSubscriberDelivery: true, offlineAllowed: true };
  if (name === "iot-subscribe") return { decision: "reject-normative-use", classification: "sample-package", sourceOwner: "S4", sourceIds: ["O7", "S4"], reason: "immutable-reference-required", immutableRevision: sampleRevision, selectedRevision: "main", mutableMainSatisfiesGate: false, targetGate: "pinned-source-target-gated" };
  if (name === "mqtt in") return { decision: "reject-claim", classification: "generic-core", sourceOwner: "N2", sourceIds: ["N2", "M1"], reason: "generic-semantics-do-not-prove-oci-device-session", authenticationFamily: "generic-broker" };
  if (name === "Fusion SCM") return { decision: "route-elsewhere", classification: "routed-elsewhere", sourceOwner: "none", reason: "outside-skill-boundary" };
  return { decision: "route-elsewhere", classification: "routed-elsewhere", sourceOwner: "none", reason: "self-hosted-or-unverified-module" };
};

const managedTargetDecision = (item) => {
  const target = item.target ?? {};
  if (target.product === "standalone-node-red") return { decision: "route-outside-managed-runtime", reason: "standalone-runtime-is-not-managed-target", liveAcceptance: "not-established", authorization: "not-granted" };
  if (target.paletteStatus !== "inspected") return { decision: "inspect-palette", availability: "unknown", liveCompatibility: "unproven", authorization: "not-granted" };
  const node = target.node ?? {};
  if (!node.type) return { decision: "inspect-palette", availability: "unknown", liveCompatibility: "unproven", authorization: "not-granted" };
  if (node.available !== true) return { decision: "unavailable", selectedNodeType: node.type, availability: "absent-on-selected-target", liveCompatibility: "unproven", authorization: "not-granted" };
  if (!target.moduleIdentity || !target.moduleVersion || !target.runtimeVersion || !target.runtimeProvenance) return { decision: "inspect-target-provenance", selectedNodeType: node.type, availability: "observed", liveCompatibility: "unproven", authorization: "not-granted" };

  const evidence = target.targetContractEvidence;
  if (!evidence) {
    return { decision: "compatibility-gate", selectedNodeType: node.type, contract: "unverified", reason: "affirmative-target-contract-evidence-required", liveCompatibility: "unproven", authorization: "not-granted" };
  }
  const exactImplementation = evidence.status === "verified"
    && ["target-inspection", "immutable-package-implementation"].includes(evidence.kind)
    && typeof evidence.reference === "string" && evidence.reference.length > 0
    && typeof evidence.provenance === "string" && evidence.provenance.length > 0
    && evidence.targetRuntimeProvenance === target.runtimeProvenance
    && evidence.nodeType === node.type
    && evidence.moduleIdentity === target.moduleIdentity
    && evidence.moduleVersion === target.moduleVersion
    && Array.isArray(evidence.fields) && evidence.fields.length > 0
    && Array.isArray(evidence.outputs) && evidence.outputs.length > 0
    && typeof evidence.auth === "string" && evidence.auth.length > 0;
  if (!exactImplementation) {
    return { decision: "compatibility-gate", selectedNodeType: node.type, contract: "unverified-for-selected-target", reason: "module-identity-or-version-mismatch", liveCompatibility: "unproven", authorization: "not-granted" };
  }
  return {
    decision: "plan-bounded-managed-test",
    selectedNodeType: node.type,
    contract: evidence.kind === "target-inspection" ? "verified-exact-target" : "verified-matching-immutable-implementation",
    liveCompatibility: "unproven-until-live-test",
    liveAcceptance: "not-run",
    authorization: "not-granted"
  };
};

for (const item of identity.cases) assert.deepEqual(identityDecision(item), item.expected, `${item.caseId}: identity decision mismatch`);
assert.equal(identity.targetSelectionCases.length, 9, "managed target-selection case count changed without an explicit review");
for (const item of identity.targetSelectionCases) assert.deepEqual(managedTargetDecision(item), item.expected, `${item.caseId}: managed target-selection decision mismatch`);
assert.equal(identity.samplePackageGate.immutableRevision, sampleRevision, "identity fixture sample revision mismatch");
assert.equal(identity.samplePackageGate.mutableMainSatisfiesGate, false, "mutable main must not satisfy the sample-package gate");

const databaseDecision = (item) => {
  const input = item.input;
  if (item.area === "authentication") {
    if (input.firstDriver) return { decision: "continue-initialized-mode", initializedMode: input.firstDriver, warning: input.firstDriver !== input.laterDriver, restartRequiredToSwitch: true };
    if (input.driver) return { decision: "inspect-target", nativeClientRequired: input.driver === "thick", scope: "pro" + "cess-wide", liveEvidence: "required" };
    if (String(input.family).startsWith("db-token-") && input.externalAuth !== true) return { decision: "reject", reason: "external-auth-required" };
    return { decision: "selected", liveEvidence: "required" };
  }
  if (item.area === "transaction") {
    if (input.downstream && input.state !== "active") return { decision: "reject", reason: "transaction-context-already-ended" };
    if (input.downstream) return { connectionAcquisitions: 1, sameContext: true, durable: false };
    if (input.operation === "begin" && input.state === "unacquired") return { state: "active", connectionAcquired: true, connectionAcquisitions: 1, durable: false };
    if (input.operation === "commit" && input.state === "active") return { state: "committed", durable: true, closed: true };
    if (input.operation === "rollback" && input.state === "active") return { state: "rolled-back", durable: false, closed: true };
    if (input.operation === "timeout" && input.state === "active") return { state: "timed-out", rollbackAttempted: true, closed: true, retry: "selected-recovery-only" };
    return { state: "already-ended", retry: false, newConnection: false };
  }
  if (item.area === "enqueue") {
    const batchCount = Array.isArray(input.payload) ? input.payload.length : 0;
    if (Array.isArray(input.delivery)) return { decision: "reject", reason: "mutually-exclusive-delivery" };
    if (input.delivery === "buffered" && input.payloadType === "JSON") return { decision: "reject", reason: "buffered-json-not-supported", beforeDispatch: true };
    if (input.recipientMode && !input.recipients) return { decision: "accepted-shape", recipientsUsed: false, recipientsOptional: true, dequeueSubscriberUsed: false };
    if (input.recipientMode) return { decision: "accepted-shape", recipientsUsed: true, recipientsOptional: true, dequeueSubscriberUsed: false };
    if (input.recipients && input.subscriber) return { decision: "accepted-shape", recipientsUsed: true, subscriberUsedBy: "dequeue-only" };
    if (input.passThrough) return { decision: "accepted-shape", correlationId: input.correlationId, passThrough: true, consumerProcessed: false };
    if (input.transactionMode === "transaction-owned" && input.operation === "commit") return { queueAcceptance: "accepted-in-transaction", batchCount, durable: true, commitOwner: "end-transaction", consumerProcessed: false };
    if (input.transactionMode === "transaction-owned") return { queueAcceptance: "accepted-in-transaction", durable: false, queueMutation: "not-proven", consumerProcessed: false };
    if (input.transactionMode === "standalone" && input.commit === "failure") return { decision: "error", durable: "uncertain", retry: "reconcile-first", closed: true };
    if (input.transactionMode === "standalone") return { queueAcceptance: "accepted", batchCount, explicitCommit: true, durable: true, closed: true, consumerProcessed: false };
    if (input.delivery === "buffered") return { decision: "accepted-shape", durabilityPolicy: "buffered", restartDurability: "false" };
    return { decision: "accepted-shape", durabilityPolicy: input.delivery, batchCount };
  }
  if (item.area === "dequeue") {
    const records = Array.isArray(input.records) ? input.records : null;
    if (input.queue === "multi-consumer" && !input.subscriber) return { decision: "reject", reason: "subscriber-required" };
    const hasDequeueBehavior = input.mode !== undefined || input.operation !== undefined || input.transactionContext !== undefined || input.payloadType !== undefined || input.batchSize !== undefined;
    if (input.queue === "multi-consumer" && !hasDequeueBehavior) return { decision: "accepted-shape", subscriberUsed: true, enqueueRecipientsUsed: false };
    if (input.mode === "continuous") {
      if (input.shutdown) return { decision: "stopped", break: true, closed: true, retry: false };
      const maxRetries = input.maxRetries ?? input.maxReconnectAttempts;
      if (maxRetries === null || maxRetries === undefined || (Number.isInteger(maxRetries) && maxRetries <= 0)) return { decision: "reject", reason: "finite-max-retries-required", sourceNormalization: "unlimited" };
      if (!Number.isInteger(maxRetries)) return { decision: "reject", reason: "max-retries-must-be-integer", sourceNormalization: Math.max(0, Math.floor(Number(maxRetries) || 0)) };
      const normalizedRetryDelayMs = input.retryDelayMs === undefined ? undefined : Number(input.retryDelayMs);
      if (input.retryDelayMs !== undefined && (!Number.isFinite(normalizedRetryDelayMs) || normalizedRetryDelayMs < 0)) return { decision: "reject", reason: "retry-delay-must-be-nonnegative", sourceNormalization: 5000 };
      if (input.attempts !== undefined && input.attempts >= maxRetries) return { decision: "terminal", reason: "reconnect-exhausted", retry: false };
      if (records?.length === 0) return { decision: "listening", commit: false, outputs: 0 };
      if (records) return { decision: "accepted", batchCount: records.length, commit: "automatic-before-send", rollbackProtection: false, outputs: records.length };
      return { decision: "accepted-shape", retryBounded: true, ...(Object.hasOwn(input, "maxRetries") ? { maxRetries } : {}), ...(Object.hasOwn(input, "maxReconnectAttempts") ? { maxReconnectAttempts: input.maxReconnectAttempts } : {}), ...(Object.hasOwn(input, "retryDelayMs") ? { retryDelayMs: normalizedRetryDelayMs } : {}) };
    }
    if (records?.length === 0 && input.mode === "transactional" && (input.transactionContext === null || input.transactionContext === undefined)) return { decision: "no-work", retry: false, queueFailure: false, commit: true, autoCommit: true, closed: true, outputs: 0 };
    if (records?.length === 0 && input.mode === "transactional" && input.transactionContext === "active") return { decision: "no-work", retry: false, queueFailure: false, commit: false, autoCommit: false, commitOwner: "end-transaction", outputs: 0 };
    if (records?.length === 0) return { decision: "no-work", retry: false, queueFailure: false, commit: false };
    if (input.operation === "remove" && input.transactionOutcome === "commit") return { read: true, removed: true, durableRemoval: true, commitOwner: "end-transaction" };
    if (input.operation === "remove" && input.transactionOutcome === "rollback") return { read: true, removed: false, visibleAfterRollback: true };
    if (input.operation === "browse" && input.transactionContext === null) return { decision: "accepted", read: true, removed: false, durableRemoval: false, autoCommit: true, closed: true, outputs: records.length };
    if (input.operation === "browse") return { read: true, removed: false, lock: false };
    if (input.operation === "locked") return { read: true, removed: false, lock: true, commitRule: "selected-target-contract" };
    if (input.transactionContext === null && input.mode === "transactional") return { decision: "accepted", batchCount: records.length, autoCommit: true, durableRemoval: true, closed: true, outputs: records.length };
    if (input.transactionContext === "active") return { decision: "accepted-in-transaction", autoCommit: false, commitOwner: "end-transaction", durableRemoval: false };
    if (input.payloadType === "JSON") return { payloadType: "JSON", output: "object" };
    if (input.payloadType === "RAW") return { payloadType: "RAW", output: "bytes-or-selected-decode" };
    if (input.payloadType === "ADT") return { payloadType: "ADT", output: "typed-shape-requires-target-contract" };
    if (input.batchSize === 0) return { decision: "accepted-shape", sourceNormalizedBatchSize: 1, portableWarning: true };
    if (input.batchSize !== undefined) return { decision: "accepted-shape", batchSize: input.batchSize, blocking: input.blocking, boundedWait: Number.isFinite(input.blockTimeoutMs) && input.blockTimeoutMs > 0, batchCount: records?.length ?? 0 };
  }
  if (item.area === "sql") {
    const statement = input.statement ?? input.sql;
    if (input.correlationId && input.statement === "<redacted>") return { error: { code: "DB_SQL_ERROR", stage: "sql", correlationId: input.correlationId, safeMessage: "database operation failed" }, leaks: { sql: false, binds: false, connectionString: false, driverStack: false } };
    if (input.source === "Editor" && typeof statement === "string") {
      if (/(?:^|[\r\n])\s*\/\s*$/.test(statement)) return { preflight: "reject", reason: "trailing-sql-tool-slash", bindValidation: "not-executed", beforeDispatch: true, secretsLeaked: false };
      if (editorStatementChain(statement)) return { preflight: "reject", reason: "single-statement-required", bindValidation: "not-executed", beforeDispatch: true, ...(input.binds && Object.keys(input.binds).length < (input.placeholders?.length ?? 0) ? { secretsLeaked: false } : {}) };
    }
    if (input.source === "msg.sql" && (statement === null || statement === undefined) && !input.editorRule) return { decision: "reject", reason: "msg.sql-required" };
    const parsed = typeof statement === "string" ? bindPlaceholders(statement) : {
      named: (input.placeholders ?? []).map((name) => String(name).replace(/^:/, "")).filter((name) => !/^\d+$/.test(name)),
      positional: (input.placeholders ?? []).map((name) => String(name).replace(/^:/, "")).filter((name) => /^\d+$/.test(name)).map(Number)
    };
    if (input.bindMode === "mixed" || (parsed.named.length > 0 && parsed.positional.length > 0)) return { decision: "reject", reason: "mixed-bind-placeholders" };
    let successfulBindDecision = null;
    if (input.bindMode || input.binds !== undefined || parsed.named.length > 0 || parsed.positional.length > 0) {
      const uniqueNamed = [...new Set(parsed.named)];
      const uniquePositional = [...new Set(parsed.positional)].sort((left, right) => left - right);
      const positionalMax = uniquePositional.length ? Math.max(...uniquePositional) : 0;
      const positionalSequenceIsExact = uniquePositional.every((position, index) => position === index + 1);
      const effectiveBindMode = input.bindMode
        ?? (uniqueNamed.length > 0 ? "named" : uniquePositional.length > 0 ? "positional" : plainObject(input.binds) ? "named" : Array.isArray(input.binds) ? "positional" : null);
      const parity = effectiveBindMode === "named"
        ? parsed.positional.length === 0 && plainObject(input.binds) && uniqueNamed.length === Object.keys(input.binds).length && uniqueNamed.every((name) => Object.hasOwn(input.binds, name))
        : effectiveBindMode === "positional" && parsed.named.length === 0 && positionalSequenceIsExact && Array.isArray(input.binds) && positionalMax === input.binds.length;
      if (!parity) return { decision: "reject", reason: "bind-parity-mismatch", ...(!input.bindMode ? { bindValidation: "failed", beforeDispatch: true } : {}), ...(effectiveBindMode === "positional" && Array.isArray(input.binds) && input.binds.length > positionalMax ? { sourceBehavior: "extra-value-not-established-as-rejected" } : {}) };
      successfulBindDecision = input.source === "msg.sql" && /^\s*(?:BEGIN|DECLARE)\b/i.test(statement ?? "")
        ? { decision: "accepted-shape", source: "msg.sql", editorRuleApplied: false, anonymousPlsqlAllowed: true, bindParity: true }
        : { decision: "accepted-shape", bindParity: true, ...(effectiveBindMode === "positional" ? { orderPreserved: true } : {}), source: input.source };
    }
    if (["committed", "rolled-back", "closed"].includes(input.transactionState)) return { decision: "reject", reason: "transaction-context-already-ended", ...(successfulBindDecision ? { bindValidation: "passed", beforeDispatch: true } : {}) };
    if (input.rowLimit !== undefined) return input.rowCount <= input.rowLimit
      ? { decision: "accepted-shape", ...(successfulBindDecision ? { bindValidation: "passed" } : {}), rows: true, metadata: true, rowLimitEnforced: true, ...(successfulBindDecision ? { rowOutcome: "within-limit" } : {}) }
      : { decision: "error-or-truncation-selected", ...(successfulBindDecision ? { bindValidation: "passed" } : {}), rowLimitEnforced: true, ...(successfulBindDecision ? { rowOutcome: "over-limit" } : {}) };
    if (input.transactionState === "active") return { decision: "accepted-shape", sameTransaction: true, durable: false };
    if (input.statementKind === "DML" && input.transactionState === "none") return { decision: "accepted-non-durable", durable: false, commitRequired: true, closeOutcome: "rolls-back" };
    if (successfulBindDecision && input.source === "Editor" && input.statementKind) return { preflight: "accepted", statementKind: input.statementKind, ...(input.statementKind === "DML" ? { durability: "transaction-dependent" } : {}), bindParity: true };
    if (successfulBindDecision) return successfulBindDecision;
    if (input.source === "Editor") {
      const anonymousStarts = typeof statement === "string" ? [...statement.matchAll(/\b(?:BEGIN|DECLARE)\b/gi)].length : 0;
      if (anonymousPlsqlBlock(statement) && anonymousStarts > 1) return { preflight: "accepted", statementKind: input.statementKind ?? "anonymous-PLSQL", sourceBehavior: "regex-heuristic-accepts-concatenated-blocks", portablePolicy: "not-source-claim" };
      return { preflight: "accepted", statementKind: input.statementKind ?? "SELECT", ...(input.statementKind === "DML" ? { durability: "transaction-dependent" } : {}) };
    }
    if (input.source === "msg.sql" && input.editorRule) return { decision: "separate-source-contract", editorRuleApplied: false, anonymousPlsqlAllowed: true };
    if (input.source === "msg.sql") return { source: "msg.sql", editorPreflight: "does-not-apply-in-pinned-sample", decision: "selected-source-policy-required" };
  }
  assert.fail(`${item.caseId}: unknown database case input`);
};

for (const item of database.cases) assert.deepEqual(databaseDecision(item), item.expected, `${item.caseId}: database/AQ decision mismatch`);
for (const sourceId of ["O7", "S4"]) assert.equal(database.sourceEvidence.find((item) => item.sourceId === sourceId)?.immutableRef, sampleRevision, `database fixture ${sourceId} pin mismatch`);
assert.deepEqual(databaseDecision({ area: "transaction", input: { state: "closed", operation: "commit" } }), { state: "already-ended", retry: false, newConnection: false }, "ended transaction must not become durable by case naming");
assert.deepEqual(databaseDecision({ area: "sql", input: { source: "Editor", statement: "SELECT 1; SELECT 2;", binds: {} } }), { preflight: "reject", reason: "single-statement-required", bindValidation: "not-executed", beforeDispatch: true }, "SQL structure must be derived from input rather than case ID");
assert.deepEqual(databaseDecision({ area: "dequeue", input: { queue: "multi-consumer", subscriber: "fixture", mode: "continuous", maxRetries: 0, records: [{ id: 1 }] } }), { decision: "reject", reason: "finite-max-retries-required", sourceNormalization: "unlimited" }, "multi-consumer validation must not bypass finite retry policy");
assert.deepEqual(databaseDecision({ area: "dequeue", input: { queue: "multi-consumer", subscriber: "fixture", mode: "continuous", maxRetries: 3, shutdown: true } }), { decision: "stopped", break: true, closed: true, retry: false }, "multi-consumer validation must not bypass shutdown");
assert.deepEqual(databaseDecision({ area: "sql", input: { source: "Editor", statement: "SELECT :x FROM dual", bindMode: "named", binds: { x: 1 }, transactionState: "closed" } }), { decision: "reject", reason: "transaction-context-already-ended", bindValidation: "passed", beforeDispatch: true }, "successful SQL bind validation must not bypass ended transaction state");
assert.deepEqual(databaseDecision({ area: "sql", input: { source: "Editor", statement: "SELECT :x FROM dual", binds: {}, transactionState: "active" } }), { decision: "reject", reason: "bind-parity-mismatch", bindValidation: "failed", beforeDispatch: true }, "SQL placeholders must be checked when binds are supplied without an explicit bind mode");

const validFilter = (filter) => {
  if (typeof filter !== "string" || !filter.trim()) return { valid: false, reason: "topic required" };
  const levels = filter.split("/");
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    if (level.includes("+") && level !== "+") return { valid: false, reason: "plus wildcard must occupy one complete level" };
    if (level.includes("#") && (level !== "#" || index !== levels.length - 1)) return { valid: false, reason: "hash wildcard must be one complete final level" };
  }
  return { valid: true };
};

const sourceTopicSuffix = (filter, received) => {
  if (filter.endsWith("/#")) {
    const prefix = filter.slice(0, -2);
    return received.startsWith(`${prefix}/`) ? received.slice(prefix.length + 1) : received;
  }
  return received.split("/").at(-1);
};

const parseLocationRecordId = (value) => {
  if (!value) return null;
  const pathname = new URL(value, "https://example.invalid").pathname;
  const encoded = pathname.split("/").filter(Boolean).at(-1) ?? "";
  try { return decodeURIComponent(encoded) || null; } catch { return encoded || null; }
};

const durationPattern = /^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/;
const relationshipKey = (value) => {
  const raw = String(value ?? "").trim();
  const arrow = raw.indexOf("->");
  const colon = raw.indexOf(":");
  if (arrow < 1 || colon <= arrow + 2 || colon >= raw.length - 1) return null;
  const source = raw.slice(0, arrow).trim();
  const target = raw.slice(arrow + 2, colon).trim();
  const contentPath = raw.slice(colon + 1).trim();
  return source && target && contentPath ? { source, target, contentPath } : null;
};

const iotDecision = (item) => {
  const input = item.input;
  if (item.family === "identity") {
    if (!input.surface) return { route: "clarify", reason: "iot-config may mean managed OCI Config or sample device MQTTS config" };
    if (input.surface === "managed-editor") return { classification: "managed-documented", authFamily: "oci-api", deviceMqttSession: false, childRoles: ["telemetry", "subscribe", "send command"] };
    if (input.nodeType === "iot-config") return { classification: "sample-package", authFamily: "device-mqtts", deviceMqttSession: true, targetGate: "target-palette-inspection" };
    return { classification: "sample-package", authFamily: "oci-api", deviceMqttSession: false, targetGate: "target-palette-inspection" };
  }
  if (item.family === "device-mqtt") {
    if (input.clientIds) return new Set(input.clientIds).size === input.simultaneousSessions ? { valid: true } : { valid: false, route: "reject", reason: "client ID must be unique per simultaneous session", risk: "collision-or-reconnect" };
    if (input.proxyConfigured && !input.selectedNodeSupportsProxy) return { valid: false, route: "compatibility-gate", reason: "proxy behavior is not implied by TLS" };
    return { valid: input.authFamily === "device-mqtts" && input.tls === true && input.port === 8883 && Number.isInteger(input.reconnectAttempts), transport: "MQTTS", risk: "none-offline", cannotProve: ["certificate-validity", "broker-connectivity", "session-persistence"] };
  }
  if (item.family === "telemetry") {
    const topic = String(input.configuredTopic || "").trim() || String(input.messageTopic || "").trim();
    if (!topic) return { valid: false, route: "node-error", reason: "No topic" };
    const configuredQos = Object.hasOwn(input, "configuredQos") ? normalizeQos(input.configuredQos, 1) : normalizeQos(input.qos, 1);
    const runtimeOverride = Object.hasOwn(input, "configuredQos") && input.qos !== undefined && input.qos !== null;
    const runtimeQos = runtimeOverride ? normalizeQos(input.qos, null) : null;
    const qos = runtimeOverride && runtimeQos !== null ? runtimeQos : configuredQos;
    const base = {
      valid: true,
      topic,
      qos,
      ...(Object.hasOwn(input, "configuredQos") && !runtimeOverride && Object.hasOwn(input, "messageTopic") ? { topicSource: input.configuredTopic ? "configured" : "msg.topic", ...(input.configuredTopic ? { messageTopicIgnored: true } : {}) } : {}),
      ...(runtimeOverride && runtimeQos === null ? { qosAction: "invalid-runtime-override-fell-back-to-configured", warning: true } : {})
    };
    const sourceTreatsAsObject = typeof input.payload === "object";
    if (input.payload === null && input.insertTimestamp) return { valid: false, route: "node-error", reason: "null-payload-timestamp-TypeError", beforePublish: true };
    const payload = sourceTreatsAsObject ? structuredClone(input.payload) : { value: input.payload };
    let timestampAction = "preserved";
    if (input.insertTimestamp && payload.time == null) {
      payload.time = input.timestamp;
      timestampAction = "inserted";
    }
    return { ...base, payload, ...(input.insertTimestamp || (payload !== null && Object.hasOwn(payload, "time")) ? { timestampAction } : {}), ...(timestampAction === "inserted" ? { timestampUnits: "epoch-microseconds" } : (payload !== null && Object.hasOwn(payload, "time") ? { timestampUnits: "epoch-microseconds-source-value-unchanged" } : {})), ...(!sourceTreatsAsObject ? { payloadAction: "wrapped-non-object" } : {}), acceptance: "transport-only" };
  }
  if (item.family === "subscription") {
    if (!input.filter) return { valid: true, acknowledgement: "none", route: "explicit-response-node-required" };
    const filter = validFilter(input.filter);
    if (!filter.valid) return { valid: false, route: "reject", reason: filter.reason };
    if (!input.receivedTopic) {
      const normalizedQos = normalizeQos(input.qos, null);
      return { valid: true, effectiveQos: normalizedQos ?? 1, qosAction: normalizedQos === null ? "invalid-config-fell-back-to-1" : "selected", payloadMode: "original-string", acknowledgement: "receipt-only" };
    }
    let payload = input.payload;
    let payloadMode = "original-string";
    if (typeof input.payload === "string") {
      try { payload = JSON.parse(input.payload); payloadMode = "parsed-json"; } catch { payloadMode = "original-string"; }
    } else payloadMode = "parsed-json";
    return { valid: true, payloadMode, ...(payloadMode === "parsed-json" ? { payload } : {}), fullTopic: input.receivedTopic, topicSuffix: sourceTopicSuffix(input.filter, input.receivedTopic), acknowledgement: "receipt-only" };
  }
  if (item.family === "send-command") {
    if (input.authFamily && input.authFamily !== "oci-api") return { valid: false, route: "reject", reason: "OCI API authentication required" };
    const requestDuration = String(input.requestDuration ?? "").trim().toUpperCase();
    if (!durationPattern.test(requestDuration)) return { valid: false, route: "node-error", reason: "Request Duration must be a valid ISO 8601 duration" };
    if (!String(input.requestEndpoint ?? "").trim()) return { valid: false, route: "node-error", reason: "Request Endpoint is required" };
    let responseDuration;
    if (input.waitForResponse) {
      if (!String(input.responseEndpoint ?? "").trim()) return { valid: false, route: "node-error", reason: "Response Endpoint is required when Wait for Response is enabled" };
      responseDuration = String(input.responseDuration ?? "").trim().toUpperCase();
      if (!durationPattern.test(responseDuration)) return { valid: false, route: "node-error", reason: "Response Duration must be a valid ISO 8601 duration" };
    }
    const location = input.apiResponse?.location ?? null;
    const recordId = parseLocationRecordId(location);
    const completed = input.waitForResponse && input.apiResponse?.rawCommandResponse?.status === "COMPLETED";
    return {
      valid: true,
      state: completed ? "completed" : "accepted-unconfirmed",
      requestEndpoint: String(input.requestEndpoint).trim(),
      responseEndpoint: input.waitForResponse ? String(input.responseEndpoint).trim() : "omitted",
      ...(location || input.waitForResponse ? { requestDuration } : {}),
      ...(input.waitForResponse ? { responseDuration } : {}),
      commandStatusLocation: location,
      recordId,
      ...(recordId ? { rawCommandDataRecordId: recordId } : {}),
      ...(input.apiResponse?.opcRequestId ? { opcRequestId: input.apiResponse.opcRequestId } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      polling: "not-performed-by-node",
      completion: completed ? "api-response-evidence" : "unknown"
    };
  }
  if (item.family === "object-storage") {
    if (input.operation === "download" && input.download === "success") return { classification: "official-scenario", download: "success", index: input.initialIndex + 1, outputType: "Buffer", textEncoding: input.encoding, metadataPreserved: ["objectName", "etag"], acceptance: "object-storage-only", deviceHostPublication: "unknown" };
    if (input.operation === "download") return { classification: "official-scenario", download: "error", index: input.initialIndex, route: "Catch", reason: "advance only after download success" };
    return { classification: "official-scenario", upload: "accepted", acceptance: "object-storage-only", deviceHostPublication: "not-proven" };
  }
  if (item.family === "notifications") return input.publish === "accepted" ? { classification: "official-scenario", publishResult: "accepted", messageId: input.messageId, subscriberDelivery: "unknown", route: "publication-accepted" } : { classification: "official-scenario", publishResult: "error", route: "Catch", subscriberDelivery: "not-attempted" };
  if (item.family === "optional-ords") {
    if (!positiveInteger(input.timeoutMs)) return { valid: false, route: "reject", reason: "poll timeout must be finite" };
    const validBounds = positiveInteger(input.pollIntervalMs) && positiveInteger(input.timeoutMs) && positiveInteger(input.concurrency) && nonnegativeInteger(input.queueLimit);
    const refreshes = (input.responses ?? []).filter(({ status }) => status === 401).length;
    return { classification: "sample-package-compatibility-gated", validBounds: validBounds && refreshes <= 1, refreshOn401: "once", polls: Math.min((input.responses ?? []).length, Math.ceil(input.timeoutMs / input.pollIntervalMs) + 1), route: "compatibility-gate", reason: "target palette/version and module permission remain unverified" };
  }
  if (item.family === "optional-digital-twin") {
    if (input.mode) return { mode: input.mode, contentReturned: input.content !== undefined, metadata: ["etag", "opcRequestId"], crudEstablished: false, route: "compatibility-gate" };
    if (Object.hasOwn(input, "topLevelContent") && !plainObject(input.topLevelContent)) return { valid: false, route: "Catch", reason: "Missing or invalid content. Provide an object in msg.content or msg.payload.content", precedence: "defined-msg.content-including-null" };
    if (Object.hasOwn(input, "configuredRelationshipKey")) {
      const explicitTopLevel = input.topLevelRelationshipKey !== undefined && input.topLevelRelationshipKey !== null;
      let selectedKey = explicitTopLevel ? input.topLevelRelationshipKey : input.configuredRelationshipKey;
      if (selectedKey === undefined || selectedKey === null || selectedKey === "") selectedKey = input.payloadRelationshipKey;
      const precedence = explicitTopLevel && input.topLevelRelationshipKey === "" && input.configuredRelationshipKey
        ? "explicit-empty-top-level-bypasses-default-and-falls-through-to-payload"
        : (!explicitTopLevel && input.configuredRelationshipKey ? "configured-default-before-payload-key" : "empty-top-level-and-default-fall-through-to-payload");
      return { valid: relationshipKey(selectedKey) !== null, selectedKey, precedence, route: "compatibility-gate" };
    }
    const parsed = relationshipKey(input.relationshipKey);
    if (!parsed) return { valid: false, route: "Catch", reason: "Invalid relationshipKey format. Expected sourceTwinId->targetTwinId:contentPath" };
    if (Object.hasOwn(input, "messageContent")) return { valid: true, keyShape: "sourceTwinOcid->targetTwinOcid:contentPath", parsed, contentUsed: "message", updateAcceptance: "unknown", route: "compatibility-gate" };
    return { valid: true, keyShape: "sourceTwinOcid->targetTwinOcid:contentPath", parsed, parserNote: "implementation accepts extra delimiters after the first -> and first :", route: "compatibility-gate" };
  }
  if (item.family === "logging") {
    if (input.runtimeConsoleLogging === false) return { route: "flow-originated-logging", runtimeConsoleLogging: "separate-contract", apiAcceptance: input.upload, searchability: "unknown" };
    if (input.runtimeConsoleLogging === true) return { route: "runtime-system-console", flowLogging: "not-selected", searchability: "target-specific" };
    return { apiAcceptance: input.upload, searchability: "unknown", downstreamAnalytics: "unknown" };
  }
  if (item.family === "routing" && input.selectedStage === "official-sql") return { route: "database-sql-contract", ords: "not-selected", reason: "official SQL polling and optional ORDS polling are distinct" };
  return { route: "outside-skill", reason: "Fusion SCM, self-hosted administration, and arbitrary community modules are routed elsewhere" };
};

for (const item of iot.cases) assert.deepEqual(iotDecision(item), item.expected, `${item.caseId}: IoT/OCI decision mismatch`);
for (const sourceId of ["O7", "S4"]) assert.equal(iot.sourceEvidence.find((item) => item.sourceId === sourceId)?.immutableRef, sampleRevision, `IoT fixture ${sourceId} pin mismatch`);
assert.deepEqual(iot.contract.deviceMqtt.qos, [0, 1, 2], "IoT QoS contract mismatch");
assert.equal(iot.contract.optionalExtensions.runtimeLoggingDistinct, true, "runtime and flow-originated logging must remain distinct");

const runtimeFirst = (input, name) => {
  const runtime = input.msg?.[name];
  if (runtime !== undefined && runtime !== null && runtime !== "") return runtime;
  const direct = input[name];
  if (direct !== undefined && direct !== null && direct !== "") return direct;
  return input.config?.[name] ?? "";
};
const nestedValue = (data, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], data);
const present = (value) => value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
const invalidOrdsRelativePath = (value) => {
  const path = String(value ?? "").trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//");
};
const httpsUrlValidation = (value, label) => {
  try {
    const url = new URL(String(value ?? "").trim());
    return url.protocol === "https:" ? null : `${label} must use HTTPS`;
  } catch {
    return `${label} must be a valid HTTPS URL`;
  }
};
const normalizeOrdsHeaderValue = (value, label) => {
  if (Array.isArray(value)) return value.map((item) => normalizeOrdsHeaderValue(item, label)).join(", ");
  if (value === undefined || value === null || typeof value === "object") throw new Error(`${label} must be a string, number, boolean, or array of those values`);
  return String(value);
};
const normalizeOrdsHeaders = (value, label) => {
  if (value === undefined || value === null || value === "") return {};
  if (!plainObject(value)) throw new Error(`${label} must be an object`);
  if (hasReservedObjectKey(value)) throw new Error(`${label} must not contain reserved keys`);
  return Object.fromEntries(Object.entries(value).map(([name, headerValue]) => [name, normalizeOrdsHeaderValue(headerValue, `${label}.${name}`)]));
};
const parseConfiguredOrdsHeaders = (rawValue) => {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) return {};
  let parsed;
  try { parsed = JSON.parse(trimmed); } catch { throw new Error("Headers must be valid JSON"); }
  return normalizeOrdsHeaders(parsed, "Headers");
};
const resolveOrdsQuery = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (hasReservedObjectKey(parsed)) throw new Error("Query must not contain reserved keys");
      return JSON.stringify(parsed);
    } catch (error) {
      if (/reserved keys/.test(error.message)) throw error;
      return trimmed;
    }
  }
  if (typeof value === "object") {
    if (hasReservedObjectKey(value)) throw new Error("msg.query must not contain reserved keys");
    return JSON.stringify(value);
  }
  return String(value);
};
const normalizeOrdsQueryParam = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};
const ordsCommandData = (data) => {
  if (data === null || typeof data !== "object") return data;
  if (["delivery_status", "deliveryStatus", "DELIVERY_STATUS"].some((name) => data[name] !== undefined && data[name] !== null)) return data;
  if (Array.isArray(data.items) && data.items.length > 0) return data.items[0];
  if (data.item !== null && typeof data.item === "object") return data.item;
  if (data.value !== null && typeof data.value === "object") return data.value;
  return data;
};
const ordsDeliveryStatus = (data) => {
  const row = ordsCommandData(data);
  const value = row?.delivery_status ?? row?.deliveryStatus ?? row?.DELIVERY_STATUS;
  return value === undefined || value === null ? null : String(value).toUpperCase();
};
const ordsCustomComplete = (response, input) => {
  const successProperty = input.successProperty || "items";
  const successMode = input.successMode || "notEmpty";
  const successValue = input.successValue || "";
  const value = nestedValue(response, successProperty);
  if (successMode === "exists") return value !== undefined && value !== null;
  if (successMode === "equals") return String(value) === String(successValue);
  return present(value);
};
const optionalDecision = (item) => {
  const input = item.input;
  if (item.family === "oci-object-storage") {
    const objectFields = ["operation", "namespace", "bucketName", "objectName", "filePath", "contentType", "downloadOutput", "encoding"];
    const effective = Object.fromEntries(objectFields.map((name) => [name, runtimeFirst(input, name) || ({ operation: "upload", downloadOutput: "buffer", encoding: "utf8" }[name] ?? "")]));
    if (!effective.namespace) return { decision: "node-error", message: "No namespace configured or provided in msg.namespace", route: "Catch", serviceCall: false, validationOrder: 1 };
    if (!effective.bucketName) return { decision: "node-error", message: "No bucket name configured or provided in msg.bucketName", route: "Catch", serviceCall: false, validationOrder: 2 };
    if (!effective.objectName) return { decision: "node-error", message: "No object name configured or provided in msg.objectName", route: "Catch", serviceCall: false };
    if (!["upload", "download"].includes(effective.operation)) return { decision: "node-error", message: `Unsupported operation: ${effective.operation}. Use 'upload' or 'download'.`, route: "Catch", apiCall: false };
    const runtimeValuesOverrideConfigured = Boolean(input.config && input.msg && objectFields.some((name) => input.msg[name] !== undefined && input.msg[name] !== null && input.msg[name] !== ""));
    if (effective.operation === "download") {
      const runtimeOperationProvided = input.msg?.operation !== undefined && input.msg?.operation !== null && input.msg?.operation !== "";
      if (input.config) return {
        decision: "accepted-shape",
        effectiveOperation: "download",
        branch: "download",
        runtimeOperationProvided,
        ...(runtimeOperationProvided && input.config.operation !== "download" ? { runtimeOperationOverridesConfigured: true } : {}),
        serviceCall: "getObject",
        fileWritten: effective.filePath,
        outputType: effective.downloadOutput
      };
      return { decision: "accepted-shape", fileWritten: effective.filePath, payload: { content: input.bytes, savedToPath: effective.filePath, outputType: effective.downloadOutput }, metadata: ["eTag", "contentType", "contentLength", "versionId", "opcRequestId"] };
    }
    const runtimePayload = input.msg?.payload ?? input.payload;
    if (runtimePayload !== null && runtimePayload !== undefined) return {
      decision: "accepted-shape",
      ...(runtimeValuesOverrideConfigured ? { effective } : {}),
      bodySource: "msg.payload",
      fileRead: false,
      ...(runtimeValuesOverrideConfigured ? { runtimeValuesOverrideConfigured: true } : { payloadSummary: ["eTag", "versionId", "opcRequestId", "statusCode"] })
    };
    if (!effective.filePath) return { decision: "node-error", message: "No upload body found in msg.payload and no file path configured/provided", route: "Catch", apiCall: false };
    return { decision: "accepted-shape", ...(runtimeValuesOverrideConfigured ? { effective, runtimeValuesOverrideConfigured: true } : {}), bodySource: "filePath", fileRead: true, noSecretPath: true };
  }
  if (item.family === "oci-notification") {
    const topic = input.msg?.topicOcid || input.config?.topicOcid || "";
    if (!topic) return { decision: "node-error", message: "No Topic OCID configured or provided in msg.topicOcid", route: "Catch", serviceCall: false };
    const title = input.msg?.title || input.config?.msgTitle || "";
    const body = input.config?.msgBody || (typeof input.msg?.payload === "string" ? input.msg.payload : JSON.stringify(input.msg?.payload));
    if (input.messageId) return { decision: "accepted-shape", body, title, output: { messageId: input.messageId, statusCode: 200 }, subscriberDelivery: "unknown" };
    if (input.msg?.topicOcid && input.msg?.title) return { decision: "accepted-shape", topic, title, body };
    return { body, runtimeBodyOverride: false, reason: "node exposes msg.title/topicOcid overrides but no msg.body override" };
  }
  if (item.family === "ords-config") {
    const configSupplied = ["baseUrl", "tokenUrl", "clientIdPresent", "clientSecretPresent", "credentialsPresent"].some((name) => Object.hasOwn(input, name));
    if (configSupplied) {
      const missing = [];
      if (!String(input.baseUrl ?? "").trim()) missing.push("Base URL");
      if (!String(input.tokenUrl ?? "").trim()) missing.push("Token URL");
      if (input.credentialsPresent !== true && input.clientIdPresent !== true) missing.push("Client ID");
      if (input.credentialsPresent !== true && input.clientSecretPresent !== true) missing.push("Client Secret");
      if (missing.length) return { decision: "config-error", route: "node-error", reasons: missing.map((name) => `missing ${name}`), serviceCall: false };
      const invalidUrl = httpsUrlValidation(input.baseUrl, "Base URL") ?? httpsUrlValidation(input.tokenUrl, "Token URL");
      if (invalidUrl) return { decision: "config-error", route: "node-error", reason: invalidUrl, serviceCall: false };
    }
    if (input.newPoll) return input.activePolls >= input.maxConcurrentPolls && input.queuedPolls >= input.maxQueuedPolls ? { decision: "reject", reason: "ORDS poll queue is full", activePolls: input.activePolls, queuedPolls: input.queuedPolls, unboundedQueue: false } : { decision: "accepted-shape" };
    if (input.responses) {
      const first401 = input.responses[0] === 401;
      const second401 = input.responses[1] === 401;
      return first401 && !second401 ? { decision: "accepted-shape", tokenRefreshes: 1, requests: 2, genericRetry: false, finite: true } : { decision: "reject", tokenRefreshes: first401 ? 1 : 0, genericRetry: false, finite: true };
    }
    return {
      decision: "accepted-shape",
      requestTimeoutMs: parseBoundedPositiveInteger(input.requestTimeoutMs, 30000, 1000, 300000),
      tokenExpiryFallbackMins: parseBoundedPositiveInteger(input.tokenExpiryFallbackMins, 60, 1, 1440),
      maxConcurrentPolls: parseBoundedPositiveInteger(input.maxConcurrentPolls, 5, 1, 100),
      maxQueuedPolls: parseBoundedPositiveInteger(input.maxQueuedPolls, 100, 0, 10000),
      bounded: true
    };
  }
  if (item.family === "oci-ords-request") {
    const endpoints = { rawData: "/20250531/rawData", rejectedData: "/20250531/rejectedData", snapshotData: "/20250531/snapshotData", historizedData: "/20250531/historizedData", rawCommandData: "/20250531/rawCommandData" };
    const operation = input.msg?.operation || input.config?.operation || input.operation || "custom";
    if (operation !== "custom" && !endpoints[operation]) return { decision: "node-error", route: "Catch", reason: `Unsupported ORDS operation: ${operation}`, tokenAcquisition: false };
    const configuredMethod = String(input.config?.method || input.method || "GET").trim().toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(configuredMethod)) return { decision: "node-error", route: "Catch", reason: `Unsupported ORDS method: ${configuredMethod}`, tokenAcquisition: false };
    const method = String(input.msg?.method || input.method || input.config?.method || "GET").trim().toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) return { decision: "node-error", route: "Catch", reason: `Unsupported ORDS method: ${method}`, tokenAcquisition: false };
    const customPath = input.msg && input.msg.customPath !== undefined ? input.msg.customPath : (input.customPath !== undefined ? input.customPath : input.config?.customPath);
    const basePath = operation === "custom" ? String(customPath ?? "").trim() : endpoints[operation];
    if (!basePath) return { decision: "node-error", route: "Catch", reason: "No ORDS endpoint configured", tokenAcquisition: false };
    if (operation === "custom" && invalidOrdsRelativePath(customPath)) return { decision: "node-error", route: "Catch", reason: "Custom ORDS endpoints must be a relative ORDS path", tokenAcquisition: false };
    const recordId = input.msg?.recordId !== undefined ? input.msg.recordId : (input.recordId ?? input.config?.recordId);
    const recordIdText = String(recordId ?? "").trim();
    const path = recordIdText ? `${basePath.replace(/\/+$/, "")}/${recordIdText}` : basePath;
    const selectedQuery = input.msg && input.msg.query !== undefined ? input.msg.query : (input.query !== undefined ? input.query : input.config?.query);
    let queryQ;
    try {
      queryQ = resolveOrdsQuery(selectedQuery);
      if (plainObject(input.msg?.queryParams)) {
        if (hasReservedObjectKey(input.msg.queryParams)) throw new Error("msg.queryParams must not contain reserved keys");
        if (Object.hasOwn(input.msg.queryParams, "q")) queryQ = normalizeOrdsQueryParam(input.msg.queryParams.q);
      }
      parseConfiguredOrdsHeaders(input.config?.headers ?? input.headers);
      if (input.msg?.headers !== undefined) normalizeOrdsHeaders(input.msg.headers, "msg.headers");
    } catch (error) {
      return { decision: "node-error", route: "Catch", reason: error.message, tokenAcquisition: false };
    }
    const queryLimit = plainObject(input.msg?.queryParams) ? normalizeOrdsQueryParam(input.msg.queryParams.limit) : undefined;
    let configuredBodyPresent = false;
    if (!["GET", "HEAD"].includes(method) && !["GET", "HEAD"].includes(configuredMethod)) {
      const configuredBodyText = String(input.config?.body ?? input.configuredBody ?? "").trim();
      if (configuredBodyText) {
        try { JSON.parse(configuredBodyText); } catch { return { decision: "node-error", route: "Catch", reason: "Body must be valid JSON", tokenAcquisition: false }; }
        configuredBodyPresent = true;
      }
    }
    const bodySource = ["GET", "HEAD"].includes(method) ? "none" : configuredBodyPresent ? "configured-body" : "msg.payload";
    if (input.config && input.msg) return {
      decision: "accepted-shape",
      path,
      method,
      ...(queryQ !== undefined ? { queryQ } : {}),
      ...(queryLimit !== undefined ? { queryLimit } : {}),
      headerCaseInsensitiveRuntimeWins: true,
      bodySource
    };
    if (operation === "rawCommandData") return { decision: "accepted-shape", path, queryParamQ: queryQ, oneShot: true, polling: false, outputFields: ["payload", "statusCode", "responseHeaders", "ordsUrl", "ordsOperation"] };
    return { decision: "accepted-shape", relativePath: true, bodySource, oneShot: true };
  }
  if (item.family === "oci-ords-poll") {
    const pollType = input.msg?.pollType || input.config?.pollType || input.pollType || "commandStatus";
    const recordId = input.msg?.recordId !== undefined ? input.msg.recordId : (input.recordId ?? input.config?.recordId);
    const customPath = input.msg?.customPath !== undefined ? input.msg.customPath : (input.customPath ?? input.config?.customPath);
    if (pollType === "commandStatus" && !recordId) return { decision: "node-error", route: "Catch", reason: "No Raw Command Data record ID configured or provided in msg.recordId", requests: 0 };
    if (pollType !== "commandStatus" && !String(customPath ?? "").trim()) return { decision: "node-error", route: "Catch", reason: "No custom ORDS path configured or provided in msg.customPath", requests: 0 };
    if (pollType !== "commandStatus" && invalidOrdsRelativePath(customPath)) return { decision: "node-error", route: "Catch", reason: "Custom ORDS endpoints must be a relative ORDS path", requests: 0 };
    if (input.config && input.msg) {
      const configuredIntervalMs = parseBoundedPositiveInteger(input.config.intervalMs, 2000, 1, 300000);
      const configuredTimeoutMs = parseBoundedPositiveInteger(input.config.timeoutMs, 60000, 1, 3600000);
      const intervalMs = parseBoundedPositiveInteger(input.msg.intervalMs, configuredIntervalMs, 1, 300000);
      const timeoutMs = parseBoundedPositiveInteger(input.msg.timeoutMs, configuredTimeoutMs, 1, 3600000);
      const path = pollType === "commandStatus" ? `/20250531/rawCommandData/${String(recordId).trim()}` : String(customPath).trim();
      const selectedQuery = input.msg.query !== undefined ? input.msg.query : input.config.query;
      let queryQ = resolveOrdsQuery(selectedQuery);
      let queryLimit;
      if (plainObject(input.msg.queryParams)) {
        if (hasReservedObjectKey(input.msg.queryParams)) return { decision: "node-error", route: "Catch", reason: "msg.queryParams must not contain reserved keys", requests: 0 };
        if (Object.hasOwn(input.msg.queryParams, "q")) queryQ = normalizeOrdsQueryParam(input.msg.queryParams.q);
        queryLimit = normalizeOrdsQueryParam(input.msg.queryParams.limit);
      }
      return { decision: "accepted-shape", path, intervalMs, timeoutMs, ...(queryQ !== undefined ? { queryQ } : {}), ...(queryLimit !== undefined ? { queryLimit } : {}), finite: true };
    }
    const intervalMs = parseBoundedPositiveInteger(input.intervalMs, 2000, 1, 300000);
    const timeoutMs = parseBoundedPositiveInteger(input.timeoutMs, 60000, 1, 3600000);
    const maxAttempts = Math.ceil(timeoutMs / intervalMs);
    const eligibleResponses = (input.responses ?? []).slice(0, maxAttempts);
    if (pollType === "commandStatus") {
      const terminalStatuses = ["COMPLETED", "FAILED", "EXPIRED", "NOT_RESPONDED", "REFUSED"];
      const waitFor = input.waitFor ?? "terminal";
      const completeAt = eligibleResponses.findIndex((response) => {
        const row = ordsCommandData(response);
        const status = ordsDeliveryStatus(row);
        if (waitFor === "completed") return status === "COMPLETED";
        if (waitFor === "response") return present(row?.response_data ?? row?.responseData ?? row?.RESPONSE_DATA) || terminalStatuses.includes(status);
        return terminalStatuses.includes(status);
      });
      const statusIndex = completeAt >= 0 ? completeAt : eligibleResponses.length - 1;
      const deliveryStatus = statusIndex >= 0 ? ordsDeliveryStatus(eligibleResponses[statusIndex]) : null;
      if (completeAt < 0 && eligibleResponses.length < maxAttempts) return { decision: "insufficient-timeline", path: `/20250531/rawCommandData/${input.recordId}`, pollComplete: false, pollTimedOut: "unproven", pollAttempts: eligibleResponses.length, deliveryStatus, finite: true };
      return { decision: "accepted-shape", path: `/20250531/rawCommandData/${input.recordId}`, pollComplete: completeAt >= 0, pollTimedOut: completeAt < 0, pollAttempts: completeAt >= 0 ? completeAt + 1 : eligibleResponses.length, deliveryStatus, finite: true };
    }
    const completeAt = eligibleResponses.findIndex((response) => ordsCustomComplete(response, input));
    if (completeAt < 0 && eligibleResponses.length < maxAttempts) return { decision: "insufficient-timeline", pollComplete: false, pollTimedOut: "unproven", pollAttempts: eligibleResponses.length, genericRetry: false };
    return { decision: "bounded-result", pollComplete: completeAt >= 0, pollTimedOut: completeAt < 0, pollAttempts: completeAt >= 0 ? completeAt + 1 : eligibleResponses.length, genericRetry: false };
  }
  if (item.family === "oci-logging") {
    if (input.serializedBytes >= 1048576) return { decision: "node-error", route: "Catch", reason: "Log entry data exceeds 1 MB limit", apiCall: false };
    if (input.config) return { decision: "accepted-shape", logId: input.config.logId || input.msg.logId, logSource: input.msg.logSource || input.config.logSource, logType: input.msg.logType || input.config.logType, severity: input.msg.severity || input.config.severity, reason: "logId uses node-first fallback while non-empty source/type/severity runtime values override" };
    if (input.payloadSource === "payload") return { decision: "accepted-shape", api: "LoggingClient.putLogs", bodySource: "msg.payload", existingLevelPreserved: true, existingTimestampPreserved: true };
    const mapping = input.mappings.find((entry) => entry.logField === "device");
    return { decision: "accepted-shape", api: "LoggingClient.putLogs", mappingDevice: input.msg.dequeued[mapping.value], generatedFields: ["timestamp", "level"], maxBytesExclusive: 1048576, output: ["opcRequestId", "statusCode"] };
  }
  if (item.family === "oci-log-analytics") {
    if (input.serializedBytes >= 1048576) return { decision: "node-error", route: "Catch", reason: "Log payload exceeds 1 MB safety limit", apiCall: false };
    if (input.config) return { decision: "accepted-shape", namespace: input.config.namespace || input.msg.namespace, logGroupOcid: input.config.logGroupOcid || input.msg.logGroupOcid, logSourceName: input.config.logSourceName || input.msg.logSourceName, entityOcid: input.config.entityOcid || input.msg.entityOcid, severity: input.msg.severity || input.config.severity, reason: "configured non-empty identifiers win; runtime severity overrides" };
    if (input.payloadSource === "payload") return { decision: "accepted-shape", api: "LogAnalyticsClient.uploadLogEventsFile", bodySource: "msg.payload", existingLevelPreserved: true, existingTimestampPreserved: true };
    const mapping = input.mappings.find((entry) => entry.logField === "device");
    return { decision: "accepted-shape", api: "LogAnalyticsClient.uploadLogEventsFile", contentType: "application/octet-stream", payloadType: "JSON", mappingDevice: input.msg[mapping.value], output: ["requestId", "statusCode"] };
  }
  if (item.family === "identity-distinction" && input.nodeType === "iot-get-content") return { iotApi: "getDigitalTwinInstanceContent", iotUsesOrds: false, snapshotPath: input.otherNode.path, snapshotIsTwinContentAlias: false, route: "keep-separate" };
  if (item.family === "identity-distinction") return { path: "/20250531/snapshotData", oneShot: true, polling: false, digitalTwinCrud: false, iotGetContentSelected: false, route: "ORDS-contract" };
  assert.fail(`${item.caseId}: unknown optional OCI case input`);
};

for (const item of optional.cases) assert.deepEqual(optionalDecision(item), item.expected, `${item.caseId}: optional OCI decision mismatch`);
for (const sourceId of ["O7", "S4"]) assert.equal(optional.sourceEvidence.find((item) => item.sourceId === sourceId)?.immutableRef, sampleRevision, `optional OCI fixture ${sourceId} pin mismatch`);
assert.deepEqual(optionalDecision({ family: "oci-ords-poll", input: { pollType: "commandStatus", recordId: "fixture", intervalMs: 1000, timeoutMs: 1000, responses: [{ items: [{ delivery_status: "COMPLETED" }] }] } }), { decision: "accepted-shape", path: "/20250531/rawCommandData/fixture", pollComplete: true, pollTimedOut: false, pollAttempts: 1, deliveryStatus: "COMPLETED", finite: true }, "ORDS command envelope must be resolved before terminal evaluation");
assert.deepEqual(optionalDecision({ family: "oci-ords-poll", input: { pollType: "commandStatus", waitFor: "response", recordId: "fixture", intervalMs: 1000, timeoutMs: 1000, responses: [{ response_data: "ok" }] } }), { decision: "accepted-shape", path: "/20250531/rawCommandData/fixture", pollComplete: true, pollTimedOut: false, pollAttempts: 1, deliveryStatus: null, finite: true }, "ORDS response completion must preserve a null delivery status");
assert.deepEqual(optionalDecision({ family: "oci-object-storage", input: { config: { operation: "download", namespace: "fixture-ns", bucketName: "fixture-bucket", objectName: "fixture-object", downloadOutput: "buffer" }, msg: {}, bytes: "fixture-bytes" } }), { decision: "accepted-shape", effectiveOperation: "download", branch: "download", runtimeOperationProvided: false, serviceCall: "getObject", fileWritten: "", outputType: "buffer" }, "Object Storage must dispatch from the resolved configured operation");

console.log(`verified ${identity.cases.length} source-role identity, ${identity.targetSelectionCases.length} managed-target selection, ${database.cases.length} database/AQ, ${iot.cases.length} core IoT/OCI, and ${optional.cases.length} optional OCI node capability cases`);
