import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

// This verifier intentionally models only the package-local contracts. It has
// no OCI, network, host-wide, or runtime dependencies.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = async (path) => JSON.parse(await readFile(resolve(packageRoot, path), "utf8"));
const expectFixture = (fixture, id) => {
  assert.equal(fixture.fixtureId, id, `${id}: fixture ID mismatch`);
  assert.equal(fixture.scope, "offline-example", `${id}: fixture must remain offline`);
};
const casesById = (fixture) => new Map(fixture.cases.map((item) => [item.caseId, item]));

const flow = await readJson("assets/runtime/flow-document-cases.json");
const network = await readJson("assets/runtime/network-config-cases.json");
const operations = await readJson("assets/runtime/resource-operation-cases.json");
const properties = await readJson("assets/runtime/resource-property-cases.json");
const mounts = await readJson("assets/runtime/file-storage-mount-cases.json");
const updates = await readJson("assets/runtime/software-update-cases.json");
const delivery = await readJson("assets/runtime/delivery-recovery-cases.json");
const nodes = await readJson("assets/nodes/managed-node-inventory.json");
const gates = await readJson("assets/nodes/compatibility-gates.json");

for (const [fixture, id] of [
  [flow, "runtime-flow-document-cases-v1"],
  [network, "runtime-network-config-cases-v1"],
  [operations, "runtime-resource-operation-cases-v1"],
  [properties, "runtime-resource-property-cases-v1"],
  [mounts, "runtime-file-storage-mount-cases-v1"],
  [updates, "runtime-software-update-cases-v1"],
  [delivery, "runtime-delivery-recovery-cases-v1"],
  [nodes, "managed-node-inventory-v1"],
  [gates, "node-compatibility-gates-v1"]
]) expectFixture(fixture, id);

// Complete flow replacement is conditional and replaces one opaque document.
const decideFlow = (testCase) => {
  const { current, candidate, preflight, ifMatch, response, readback } = testCase;
  if (!current?.etag) return { decision: "abort", requestSent: false };
  if (!preflight?.backupSaved) return { decision: "abort", requestSent: false, reason: "backup-required" };
  if (preflight.candidateIsCompleteJson !== true || preflight.secretsEmbedded === true) {
    return { decision: "abort", requestSent: false, reason: "candidate-preflight-failed" };
  }
  if (ifMatch !== current.etag) {
    return { decision: "abort", retry: false, effectiveFlowsDocumentId: current.flowsDocumentId };
  }
  if (response?.status === 412) {
    return { decision: "abort", retry: false, effectiveFlowsDocumentId: current.flowsDocumentId };
  }
  if (response?.status === 200) {
    const readbackMatches = readback?.flowsDocumentId === candidate.flowsDocumentId
      && readback?.checksum === candidate.checksum;
    return readbackMatches
      ? { decision: "replace-and-confirm", readbackMatches: true }
      : { decision: "escalate", reason: "effective-state-mismatch", retry: false };
  }
  return { decision: "replace", request: "PUT-complete-flows", readbackRequired: true, effectiveFlowsDocumentId: candidate.flowsDocumentId };
};

assert.ok(Array.isArray(flow.cases) && flow.cases.length >= 6, "flow fixture needs replacement cases");
assert.deepEqual(flow.cannotProve, ["IAM authorization", "credential restoration", "runtime health", "effective deployed state"]);
for (const testCase of flow.cases) assert.deepEqual(decideFlow(testCase), testCase.expected, `flow case failed: ${testCase.caseId}`);
const flowCases = casesById(flow);
for (const id of ["matching-etag-replacement", "stale-etag-aborts", "missing-etag-aborts", "backup-before-replacement", "effective-state-readback", "readback-mismatch-escalates"]) {
  assert.ok(flowCases.has(id), `flow fixture missing required case: ${id}`);
}
assert.equal(flowCases.get("stale-etag-aborts").expected.retry, false, "stale flow ETag must not retry");
assert.equal(flowCases.get("missing-etag-aborts").expected.requestSent, false, "missing flow ETag must stop before request");
assert.equal(flowCases.get("matching-etag-replacement").expected.request, "PUT-complete-flows", "flow replacement must be complete");
assert.equal(flowCases.get("matching-etag-replacement").expected.readbackRequired, true, "flow replacement needs readback");
assert.equal(flowCases.get("effective-state-readback").expected.readbackMatches, true, "flow readback must compare identity/checksum");

// Resource/network updates distinguish ordinary omission from complete
// networkConfig replacement. Every mutation is fenced by an exact current
// resource ETag. A mismatch aborts before interpreting any simulated response;
// a stale 412 is an observed abort and is never retried.
assert.deepEqual(network.requiredFieldsWhenPresent, ["subnetId"]);
assert.deepEqual(network.limitsToRecheck, ["networkSecurityGroupIds maximum", "target regional availability", "route and endpoint policy"]);
const networkDecision = (testCase) => {
  const candidateHasNetwork = Object.hasOwn(testCase.candidate ?? {}, "networkConfig");
  if (!candidateHasNetwork) return { decision: "preserve", mutation: false, effectiveReadback: false };
  if (typeof testCase.currentEtag !== "string" || testCase.currentEtag.length === 0) {
    return { decision: "abort", reason: "missing-current-etag", requestSent: false };
  }
  if (typeof testCase.ifMatch !== "string" || testCase.ifMatch.length === 0) {
    return { decision: "abort", reason: "missing-if-match", requestSent: false };
  }
  // Do this before response handling: a fixture must not self-mask a stale
  // candidate by supplying a simulated 200/success response.
  if (testCase.ifMatch !== testCase.currentEtag) {
    return { decision: "abort", reason: "etag-mismatch", retry: false, requestSent: false, preserveCurrentState: true };
  }
  if (testCase.response?.status === 412) {
    return { decision: "abort", reason: "stale-precondition", retry: false, requestSent: true, preserveCurrentState: true };
  }
  if (testCase.candidate.networkConfig === null) {
    if (testCase.response?.status === 200) {
      const readbackMatches = testCase.readback?.networkConfig === null
        && testCase.readback?.logConfig === testCase.current?.logConfig
        && testCase.readback?.scale === testCase.current?.scale
        && isDeepStrictEqual(testCase.readback?.tags, testCase.current?.tags);
      return readbackMatches
        ? { decision: "remove-and-confirm", mutation: true, effectiveReadback: true, readbackMatches: true }
        : { decision: "escalate", reason: "effective-state-mismatch", retry: false };
    }
    return { decision: "remove", mutation: true, effectiveReadback: true };
  }
  assert.equal(typeof testCase.candidate.networkConfig, "object", `${testCase.caseId}: networkConfig must be an object or null`);
  assert.equal(typeof testCase.candidate.networkConfig.subnetId, "string", `${testCase.caseId}: replacement needs subnetId`);
  assert.ok(Array.isArray(testCase.candidate.networkConfig.networkSecurityGroupIds), `${testCase.caseId}: replacement needs NSGs`);
  if (Object.hasOwn(testCase.candidate.networkConfig, "fileStorageMounts")) {
    assert.ok(Array.isArray(testCase.candidate.networkConfig.fileStorageMounts), `${testCase.caseId}: fileStorageMounts must be an array when represented`);
  }
  const currentMounts = testCase.current?.fileStorageMounts ?? [];
  const candidateNetwork = testCase.candidate.networkConfig;
  const expectedReadback = {
    subnetId: candidateNetwork.subnetId,
    networkSecurityGroupIds: candidateNetwork.networkSecurityGroupIds,
    fileStorageMounts: candidateNetwork.fileStorageMounts ?? [],
    logConfig: testCase.current?.logConfig,
    scale: testCase.current?.scale,
    tags: testCase.current?.tags
  };
  if (testCase.response?.status === 200) {
    const readbackMatches = isDeepStrictEqual(testCase.readback, expectedReadback);
    return readbackMatches
      ? {
          decision: "replace-complete-and-confirm",
          ...(currentMounts.length > 0 && (!Object.hasOwn(candidateNetwork, "fileStorageMounts") || candidateNetwork.fileStorageMounts.length === 0)
            ? { mounts: "removed-if-not-included" } : {}),
          mutation: true,
          effectiveReadback: true,
          readbackMatches: true
        }
      : { decision: "escalate", reason: "effective-state-mismatch", retry: false };
  }
  return {
    decision: "replace-complete",
    ...(currentMounts.length > 0 && (!Object.hasOwn(testCase.candidate.networkConfig, "fileStorageMounts") || testCase.candidate.networkConfig.fileStorageMounts.length === 0)
      ? { mounts: "removed-if-not-included" } : {}),
    mutation: true,
    effectiveReadback: true
  };
};
assert.ok(Array.isArray(network.cases) && network.cases.length >= 9, "network fixture needs replacement and readback-mismatch cases");
for (const testCase of network.cases) {
  const actual = networkDecision(testCase);
  for (const [key, value] of Object.entries(testCase.expected)) assert.deepEqual(actual[key], value, `network case failed: ${testCase.caseId} (${key})`);
}
const networkCases = casesById(network);
for (const id of ["preserve-network", "replace-network-preserving-mount", "replace-network-removes-unlisted-mount", "remove-network", "readback-mismatch-escalates", "mismatched-resource-etag-aborts", "stale-resource-etag-aborts", "stale-resource-etag-412-aborts", "missing-resource-etag-aborts"]) assert.ok(networkCases.has(id), `network fixture missing required case: ${id}`);
const preserving = networkCases.get("replace-network-preserving-mount");
assert.deepEqual(preserving.candidate.networkConfig.fileStorageMounts, preserving.current.fileStorageMounts, "network replacement must preserve represented mounts");
for (const nsg of preserving.current.networkSecurityGroupIds) assert.ok(preserving.candidate.networkConfig.networkSecurityGroupIds.includes(nsg), `network replacement must preserve existing NSG ${nsg}`);
for (const mount of preserving.current.fileStorageMounts) assert.ok(preserving.candidate.networkConfig.fileStorageMounts.some((candidateMount) => JSON.stringify(candidateMount) === JSON.stringify(mount)), `network replacement must preserve mount ${mount.mountPath}`);
assert.equal(networkCases.get("stale-resource-etag-aborts").expected.retry, false, "stale resource ETag must not retry");
assert.equal(networkCases.get("missing-resource-etag-aborts").expected.requestSent, false, "missing resource ETag must stop before request");
assert.equal(networkCases.get("mismatched-resource-etag-aborts").expected.requestSent, false, "mismatched resource ETag must stop before request");
const networkReadbackMismatch = networkCases.get("readback-mismatch-escalates");
assert.equal(networkReadbackMismatch.response?.status, 200, "network readback mismatch must model an acknowledged response");
assert.notEqual(networkReadbackMismatch.readback?.subnetId, networkReadbackMismatch.candidate?.networkConfig?.subnetId, "network mismatch fixture must differ from intended subnet");
assert.deepEqual(networkReadbackMismatch.expected, { decision: "escalate", reason: "effective-state-mismatch", retry: false }, "network readback mismatch must escalate without retry");
assert.deepEqual(
  [networkCases.get("stale-resource-etag-412-aborts").response?.status, networkCases.get("stale-resource-etag-412-aborts").expected.decision, networkCases.get("stale-resource-etag-412-aborts").expected.retry],
  [412, "abort", false],
  "HTTP 412 network precondition must abort without retry"
);
assert.deepEqual(
  networkDecision({ ...preserving, currentEtag: "etag-new", ifMatch: "etag-a", response: { status: 200 } }),
  { decision: "abort", reason: "etag-mismatch", retry: false, requestSent: false, preserveCurrentState: true },
  "network ETag mismatch must not be masked by a simulated success"
);
for (const testCase of network.cases.filter(({ expected }) => expected.mutation === true)) {
  assert.equal(typeof testCase.currentEtag, "string", `${testCase.caseId}: successful resource update needs current ETag`);
  assert.equal(testCase.ifMatch, testCase.currentEtag, `${testCase.caseId}: successful resource update needs exact ifMatch`);
  assert.equal(testCase.response?.status, 200, `${testCase.caseId}: modeled success must be explicit 200`);
  assert.equal(testCase.expected.readbackMatches, true, `${testCase.caseId}: successful resource update needs effective readback`);
  assert.deepEqual(testCase.readback?.logConfig, testCase.current?.logConfig, `${testCase.caseId}: readback must preserve logging configuration`);
  assert.deepEqual(testCase.readback?.scale, testCase.current?.scale, `${testCase.caseId}: readback must preserve scale`);
  assert.deepEqual(testCase.readback?.tags, testCase.current?.tags, `${testCase.caseId}: readback must preserve tags`);
}

const propertyCases = casesById(properties);
assert.ok(Array.isArray(properties.cases) && properties.cases.length >= 12, "property fixture needs preserve, mutation, ETag, and readback-mismatch cases");
assert.equal(properties.rules.ordinaryOmission, "preserve-by-partial-update-contract");
assert.equal(properties.rules.networkConfigPresence, "replace-complete-network-configuration");
assert.equal(properties.rules.nullNetworkConfig, "remove-network-configuration");
assert.equal(properties.rules.mutationGuard, "current-resource-etag-and-if-match");
assert.equal(properties.rules.afterMutation, "re-read-effective-resource");
assert.equal(properties.rules.conditionalUpdate, "mutate-only-when-ifMatch-exactly-equals-currentEtag");
assert.equal(properties.rules.stalePrecondition, "abort-without-retry");
const propertyDecision = (testCase) => {
  const candidate = testCase.change ?? testCase.candidate ?? {};
  const hasMutation = Object.keys(candidate).length > 0;
  if (!hasMutation) return { decision: "preserve", mutation: false, effectiveReadback: false };
  if (typeof testCase.currentEtag !== "string" || testCase.currentEtag.length === 0) return { decision: "abort", reason: "missing-current-etag", requestSent: false };
  if (typeof testCase.ifMatch !== "string" || testCase.ifMatch.length === 0) return { decision: "abort", reason: "missing-if-match", requestSent: false };
  // Never infer success from a simulated response when the conditional token
  // does not equal the ETag retrieved with the current resource.
  if (testCase.ifMatch !== testCase.currentEtag) return { decision: "abort", reason: "etag-mismatch", retry: false, requestSent: false, preserveCurrentState: true };
  if (testCase.response?.status === 412) return { decision: "abort", reason: "stale-precondition", retry: false, requestSent: true, preserveCurrentState: true };
  const expectedReadback = { ...testCase.current, ...candidate };
  if (Object.hasOwn(candidate, "networkConfig")) expectedReadback.networkConfig = candidate.networkConfig;
  if (testCase.response?.status === 200) {
    const readbackMatches = isDeepStrictEqual(testCase.readback, expectedReadback);
    return readbackMatches
      ? { decision: "update-and-confirm", mutation: true, effectiveReadback: true, readbackMatches: true }
      : { decision: "escalate", reason: "effective-state-mismatch", retry: false };
  }
  return { decision: "update", mutation: true, effectiveReadback: true };
};
const preservedProperties = propertyCases.get("preserve-description");
for (const key of ["description", "scale", "tags", "logConfig"]) assert.deepEqual(preservedProperties.expected[key], preservedProperties.current[key], `ordinary omission must preserve ${key}`);
assert.equal(propertyCases.get("change-scale").expected.capacityClaim, "not-proven", "scale is not a capacity guarantee");
assert.equal(propertyCases.get("change-logs").expected.deliveryCheck, "live-only", "log delivery is live-only evidence");
assert.equal(propertyCases.get("preserve-network-by-omission").expected.networkConfig, "preserved");
assert.equal(propertyCases.get("network-object-is-not-a-patch").expected.networkConfig, "complete-replacement");
assert.equal(propertyCases.get("network-object-is-not-a-patch").expected.mounts, "removed-if-not-included");
for (const testCase of properties.cases) {
  assert.ok(testCase.expected && typeof testCase.expected === "object", `property case missing expected result: ${testCase.caseId}`);
  const actual = propertyDecision(testCase);
  for (const key of ["decision", "reason", "mutation", "effectiveReadback", "readbackMatches", "retry", "requestSent", "preserveCurrentState"])
    if (Object.hasOwn(testCase.expected, key)) assert.deepEqual(actual[key], testCase.expected[key], `property case failed: ${testCase.caseId} (${key})`);
}
for (const id of ["matching-resource-etag-update", "readback-mismatch-escalates", "mismatched-resource-etag-aborts", "missing-resource-etag-aborts", "missing-property-if-match-aborts", "stale-property-etag-412-aborts"]) assert.ok(propertyCases.has(id), `property fixture missing required case: ${id}`);
assert.equal(propertyCases.get("mismatched-resource-etag-aborts").expected.requestSent, false, "mismatched property ETag must stop before request");
assert.equal(propertyCases.get("missing-property-if-match-aborts").expected.requestSent, false, "missing property ifMatch must stop before request");
assert.equal(propertyCases.get("stale-property-etag-412-aborts").expected.retry, false, "stale property ETag must not retry");
const propertyReadbackMismatch = propertyCases.get("readback-mismatch-escalates");
assert.equal(propertyReadbackMismatch.response?.status, 200, "property readback mismatch must model an acknowledged response");
assert.notEqual(propertyReadbackMismatch.readback?.description, propertyReadbackMismatch.candidate?.description, "property mismatch fixture must differ from intended description");
assert.deepEqual(propertyReadbackMismatch.expected, { decision: "escalate", reason: "effective-state-mismatch", retry: false }, "property readback mismatch must escalate without retry");
assert.deepEqual(
  [propertyCases.get("matching-resource-etag-update").currentEtag, propertyCases.get("matching-resource-etag-update").ifMatch, propertyCases.get("matching-resource-etag-update").expected.decision, propertyCases.get("matching-resource-etag-update").expected.readbackMatches],
  ["etag-a", "etag-a", "update-and-confirm", true],
  "matching property update must use exact ETag and read back"
);
assert.deepEqual(
  [propertyCases.get("mismatched-resource-etag-aborts").ifMatch, propertyCases.get("mismatched-resource-etag-aborts").currentEtag, propertyCases.get("mismatched-resource-etag-aborts").expected.decision, propertyCases.get("mismatched-resource-etag-aborts").expected.requestSent],
  ["etag-old", "etag-new", "abort", false],
  "mismatched property ETag must abort before request"
);
assert.deepEqual(
  [propertyCases.get("missing-resource-etag-aborts").ifMatch, propertyCases.get("missing-resource-etag-aborts").expected.decision, propertyCases.get("missing-resource-etag-aborts").expected.requestSent],
  [null, "abort", false],
  "missing property ETag must abort before request"
);
assert.deepEqual(
  [propertyCases.get("missing-property-if-match-aborts").currentEtag, propertyCases.get("missing-property-if-match-aborts").ifMatch, propertyCases.get("missing-property-if-match-aborts").expected.reason, propertyCases.get("missing-property-if-match-aborts").expected.requestSent],
  ["etag-a", undefined, "missing-if-match", false],
  "missing property ifMatch must abort before request"
);
assert.deepEqual(
  [propertyCases.get("stale-property-etag-412-aborts").response?.status, propertyCases.get("stale-property-etag-412-aborts").expected.decision, propertyCases.get("stale-property-etag-412-aborts").expected.retry],
  [412, "abort", false],
  "HTTP 412 property precondition must abort without retry"
);
assert.deepEqual(
  propertyDecision({ ...propertyCases.get("matching-resource-etag-update"), currentEtag: "etag-new", ifMatch: "etag-a", response: { status: 200 } }),
  { decision: "abort", reason: "etag-mismatch", retry: false, requestSent: false, preserveCurrentState: true },
  "property ETag mismatch must not be masked by a simulated success"
);
for (const testCase of properties.cases.filter(({ expected }) => expected.mutation === true)) {
  assert.equal(typeof testCase.currentEtag, "string", `${testCase.caseId}: successful property update needs current ETag`);
  assert.equal(testCase.ifMatch, testCase.currentEtag, `${testCase.caseId}: successful property update needs exact ifMatch`);
  assert.equal(testCase.response?.status, 200, `${testCase.caseId}: modeled success must be explicit 200`);
  assert.equal(testCase.expected.readbackMatches, true, `${testCase.caseId}: successful property update needs effective readback`);
  assert.ok(testCase.readback && typeof testCase.readback === "object", `${testCase.caseId}: successful property update needs readback object`);
  const candidate = testCase.change ?? testCase.candidate ?? {};
  const intendedNetwork = Object.hasOwn(candidate, "networkConfig") ? candidate.networkConfig : testCase.current.networkConfig;
  assert.deepEqual(testCase.readback.networkConfig, intendedNetwork, `${testCase.caseId}: readback must show intended subnet, NSGs, and mounts`);
  assert.deepEqual(testCase.readback.tags, candidate.tags ?? testCase.current.tags, `${testCase.caseId}: readback must show intended tags`);
  assert.deepEqual(testCase.readback.logConfig, candidate.logConfig ?? testCase.current.logConfig, `${testCase.caseId}: readback must show intended logging configuration`);
}

// Lifecycle operations are classified before any live request is considered.
const readOnlyOperations = new Set(["list", "get"]);
const mutationOperations = new Set(["create", "update", "move", "activate", "deactivate", "delete"]);
assert.ok(Array.isArray(operations.cases) && operations.cases.length >= 9, "operation fixture needs lifecycle coverage");
for (const testCase of operations.cases) {
  const isFlowReplacement = testCase.operation === "update-flows";
  const isReadOnly = readOnlyOperations.has(testCase.operation);
  assert.equal(testCase.mutates, !isReadOnly, `${testCase.caseId}: mutation classification mismatch`);
  if (isReadOnly) {
    assert.equal(testCase.workRequest, false, `${testCase.caseId}: read-only operation cannot need work request`);
    assert.equal(testCase.effectiveReadback, false, `${testCase.caseId}: read-only operation cannot require mutation readback`);
    assert.equal(testCase.expected, "inspect", `${testCase.caseId}: unexpected read-only action`);
  } else if (isFlowReplacement) {
    assert.equal(testCase.workRequest, false, `${testCase.caseId}: flow replacement is synchronous`);
    assert.equal(testCase.requiresCurrentEtag, true, `${testCase.caseId}: flow replacement needs ETag`);
    assert.equal(testCase.effectiveReadback, true, `${testCase.caseId}: flow replacement needs readback`);
    assert.equal(testCase.expected, "backup-conditional-replace", `${testCase.caseId}: wrong flow replacement classification`);
  } else {
    assert.equal(mutationOperations.has(testCase.operation), true, `${testCase.caseId}: unknown lifecycle mutation`);
    assert.equal(testCase.workRequest, true, `${testCase.caseId}: lifecycle mutation needs work request`);
    assert.equal(testCase.effectiveReadback, true, `${testCase.caseId}: lifecycle mutation needs effective readback`);
    assert.equal(testCase.expected, "approve-and-track", `${testCase.caseId}: wrong lifecycle classification`);
  }
}
assert.ok(operations.cannotProve.includes("work-request completion"), "operation fixture must distinguish modeled and live work requests");
assert.ok(operations.cannotProve.includes("lifecycle health"), "operation fixture must not claim lifecycle health offline");

// File Storage paths are relative names prefixed by the runtime; no filesystem
// is touched and traversal is rejected by segment, not by string shape alone.
assert.equal(mounts.rules.prefix, "/mnt/");
assert.equal(mounts.rules.maximumMountsToRecheck, 5);
const validateMount = (mountPath) => {
  if (typeof mountPath !== "string" || mountPath.length === 0) return { valid: false, reason: "empty-relative-path" };
  if (mountPath.startsWith("/")) return { valid: false, reason: "leading-slash" };
  if (mountPath.endsWith("/")) return { valid: false, reason: "trailing-slash" };
  if (mountPath.split("/").some((segment) => segment === "." || segment === "..")) return { valid: false, reason: "path-traversal" };
  return { valid: true, effectivePath: `${mounts.rules.prefix}${mountPath}` };
};
assert.ok(Array.isArray(mounts.cases) && mounts.cases.length >= 7, "mount fixture needs accept/reject coverage");
for (const testCase of mounts.cases) assert.deepEqual(validateMount(testCase.mountPath), testCase.expected, `mount case failed: ${testCase.caseId}`);
assert.ok(mounts.cases.some(({ expected }) => expected.valid), "mount fixture needs valid paths");
assert.ok(mounts.cases.some(({ expected }) => !expected.valid), "mount fixture needs rejected paths");
for (const statement of ["export existence", "NFS permissions", "runtime read/write access"]) assert.ok(mounts.cannotProve.includes(statement), `mount fixture cannotProve missing ${statement}`);

// Managed software updates are interruption boundaries: preflight must move
// required local state, and post-checks require both lifecycle/work-request and
// effective editor/flow/node/log evidence.
const updateCases = casesById(updates);
const preflightReady = updateCases.get("preflight-ready");
assert.equal(preflightReady.preflight.flowsBackup, true);
assert.equal(preflightReady.preflight.localFilesPersisted, true);
assert.equal(preflightReady.preflight.ownerNotified, true);
assert.equal(preflightReady.expected.decision, "bounded-maintenance-window");
const blockedUpdate = updateCases.get("preflight-blocks-local-only-state");
assert.equal(blockedUpdate.preflight.localFilesPersisted, false);
assert.deepEqual(blockedUpdate.expected, { decision: "stop", reason: "local-files-ephemeral" });
const postSuccess = updateCases.get("post-check-success");
assert.equal(postSuccess.lifecycle, "Active");
assert.equal(postSuccess.workRequest, "SUCCEEDED");
for (const check of ["editor", "flows", "permittedNodes", "logs"]) assert.equal(postSuccess.checks[check], true, `post-success check missing: ${check}`);
assert.deepEqual(postSuccess.expected, { decision: "record-effective-checks" });
const postFailure = updateCases.get("post-check-failure");
assert.equal(postFailure.workRequest, "FAILED");
assert.deepEqual(postFailure.expected, { decision: "stop-and-diagnose", retry: false });
for (const statement of ["update success", "interruption duration", "runtime health"]) assert.ok(updates.cannotProve.includes(statement), `software update cannotProve missing ${statement}`);
assert.equal(updates.cases.length, 4, "software update fixture must retain preflight and post-check pairs");

// Delivery/recovery state transitions preserve correlation, fence uncertain
// acceptance, and never loop terminal outcomes back into retry.
const deliveryResult = (testCase) => {
  const input = testCase.input;
  const correlationId = input.correlationId;
  if (input.result === "accepted") return { next: "accepted_unconfirmed", retry: "reconcile-first" };
  if (input.result === "temporary-failure") {
    const attemptLimitReached = Number.isInteger(input.attempt) && Number.isInteger(input.maxAttempts) && input.attempt >= input.maxAttempts;
    const pollLimitReached = Number.isInteger(input.pollCount) && Number.isInteger(input.maxPolls) && input.pollCount >= input.maxPolls;
    if (input.deadlineReached === true || attemptLimitReached || pollLimitReached) return { next: "not_responded", retry: false };
    if (Number.isInteger(input.attempt) && Number.isInteger(input.maxAttempts) && input.attempt > 0 && input.attempt < input.maxAttempts) return { next: "prepared", retry: true };
    return { next: "bad_response", retry: false };
  }
  if (input.result === "refused") return { next: "refused", retry: false };
  if (input.result === "malformed") return { next: "quarantined", retry: false };
  if (input.deadlineReached || input.pollCount >= input.maxPolls) return { next: "not_responded", retry: false };
  if (input.publication === "accepted") return { publicationEvidence: true, subscriberDeliveryEvidence: input.subscriberConfirmation === "confirmed" };
  return { next: "bad_response", retry: false };
};
assert.ok(Array.isArray(delivery.states) && delivery.states.includes("accepted_unconfirmed"), "delivery states need uncertain acceptance");
assert.ok(delivery.states.includes("quarantined"), "delivery states need quarantine");
assert.ok(delivery.states.includes("not_responded"), "delivery states need bounded timeout");
assert.deepEqual(delivery.invariants, ["correlationId is preserved", "poll count is bounded", "terminal states cannot re-enter retry"]);
assert.ok(Array.isArray(delivery.cases) && delivery.cases.length >= 9, "delivery fixture needs bounded recovery cases");
for (const testCase of delivery.cases) {
  assert.deepEqual(deliveryResult(testCase), testCase.expected, `delivery case failed: ${testCase.caseId}`);
  assert.equal(typeof testCase.input.correlationId, "string", `${testCase.caseId}: correlation must be present`);
  if (Object.hasOwn(testCase.input, "pollCount")) assert.ok(testCase.input.pollCount <= testCase.input.maxPolls, `${testCase.caseId}: poll bound exceeded`);
}
const deliveryCases = casesById(delivery);
assert.equal(deliveryCases.get("accepted-requires-reconciliation").expected.retry, "reconcile-first");
assert.equal(deliveryCases.get("notification-publication-is-not-delivery").expected.subscriberDeliveryEvidence, false);
for (const testCase of delivery.cases.filter(({ expected }) => expected.retry === false)) assert.equal(testCase.expected.retry, false, `${testCase.caseId}: terminal state re-entered retry`);

// Managed inventory records are explicit palette classifications and message /
// auth / transaction boundaries, while compatibility-gated roles stay offline
// until the target runtime and palette are inspected.
const requiredManagedLabels = new Set(["db-connection", "begin transaction", "end transaction", "enqueue", "dequeue", "sql", "iot-config", "telemetry", "subscribe", "send command"]);
assert.equal(nodes.sourceClaimId, "FR-NODES-001");
assert.ok(Array.isArray(nodes.nodes) && nodes.nodes.length === requiredManagedLabels.size, "managed inventory count changed unexpectedly");
const nodeIds = new Set();
for (const node of nodes.nodes) {
  assert.equal(nodeIds.has(node.nodeId), false, `duplicate managed node ID: ${node.nodeId}`);
  nodeIds.add(node.nodeId);
  assert.equal(requiredManagedLabels.has(node.canonicalLabel), true, `unknown managed node label: ${node.canonicalLabel}`);
  assert.equal(node.classification, "managed-documented", `${node.nodeId}: managed classification changed`);
  for (const field of ["input", "output", "authentication", "transaction", "acknowledgement", "retry", "error"]) assert.ok(typeof node[field] === "string" && node[field].trim(), `${node.nodeId}: missing ${field} contract`);
  assert.ok(Array.isArray(node.source?.sourceIds) && node.source.sourceIds.length > 0, `${node.nodeId}: missing source IDs`);
  assert.ok(Array.isArray(node.offlineEvidence) && node.offlineEvidence.length > 0, `${node.nodeId}: missing offline evidence`);
  assert.ok(Array.isArray(node.cannotProve) && node.cannotProve.length > 0, `${node.nodeId}: missing cannotProve boundary`);
}
assert.deepEqual(new Set(nodes.nodes.map(({ canonicalLabel }) => canonicalLabel)), requiredManagedLabels, "managed node inventory must cover every documented role exactly once");
const byLabel = new Map(nodes.nodes.map((node) => [node.canonicalLabel, node]));
assert.match(byLabel.get("begin transaction").transaction, /begins transaction/i);
assert.match(byLabel.get("end transaction").transaction, /commit|rollback/i);
assert.match(byLabel.get("dequeue").output, /empty/i);
assert.match(byLabel.get("send command").acknowledgement, /not device completion/i);
assert.match(byLabel.get("telemetry").acknowledgement, /not normalization/i);
assert.match(byLabel.get("iot-config").authentication, /resource principal/i);

const requiredGateFields = new Set(gates.requiredGateFields);
assert.deepEqual([...requiredGateFields].sort(), ["authContext", "liveApproval", "moduleVersion", "networkRoute", "paletteLabel", "region", "targetRuntimeVersion"].sort());
assert.equal(gates.classificationRules["official-scenario"], "role documented by an Oracle scenario; installed availability is unknown");
assert.equal(gates.classificationRules["sample-package"], "behavior supplied by oracle-samples/node-red-nodes; not a managed guarantee");
assert.equal(gates.classificationRules["managed-documented"], "current managed editor documents the role; target palette/version still requires inspection");
assert.ok(Array.isArray(gates.cases) && gates.cases.length >= 3, "compatibility gates need scenario and package cases");
for (const gate of gates.cases) {
  assert.ok(["official-scenario", "sample-package", "managed-documented"].includes(gate.classification), `${gate.caseId}: invalid compatibility class`);
  assert.ok(typeof gate.nodeOrRole === "string" && gate.nodeOrRole.trim(), `${gate.caseId}: missing node/role`);
  assert.ok(typeof gate.sourceClaimId === "string" && gate.sourceClaimId.trim(), `${gate.caseId}: missing source claim`);
  assert.ok(Array.isArray(gate.sourceIds) && gate.sourceIds.length > 0, `${gate.caseId}: missing source IDs`);
  assert.ok(typeof gate.role === "string" && gate.role.trim(), `${gate.caseId}: missing role`);
  assert.ok(typeof gate.targetAvailability === "string" && gate.targetAvailability.trim(), `${gate.caseId}: missing target availability`);
  assert.equal(gate.offlineAllowed, true, `${gate.caseId}: compatibility decision must remain offline`);
  assert.ok(Array.isArray(gate.liveRequired) && gate.liveRequired.length > 0, `${gate.caseId}: missing live gates`);
  if (gate.classification === "official-scenario") assert.equal(gate.targetAvailability, "unknown-until-palette-inspection", `${gate.caseId}: scenario availability must be gated`);
  if (gate.classification === "sample-package") assert.equal(gate.targetAvailability, "not-proven", `${gate.caseId}: sample package availability must not be claimed`);
}
assert.ok(gates.cannotProve.includes("installed node availability"), "compatibility gate must not claim installation");
assert.ok(gates.cannotProve.includes("version compatibility"), "compatibility gate must not claim version compatibility");

console.log(`verified runtime fixtures: flows ${flow.cases.length}, network ${network.cases.length}, properties ${properties.cases.length}, operations ${operations.cases.length}, mounts ${mounts.cases.length}, updates ${updates.cases.length}, delivery ${delivery.cases.length}; managed nodes ${nodes.nodes.length}, compatibility gates ${gates.cases.length}; invariants: complete-flow backup/ETag/412/readback, complete network preservation, work-request/readback classes, bounded delivery, and target-gated node availability`);
