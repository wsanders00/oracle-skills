import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = root;
// Provenance: inherited case bodies are adapted from scripts/verify-skill-draft.mjs.
// Its standalone SKILL.md mutations map to the bundled flow-runtime reference;
// parent-entrypoint mutations are tested separately below. All module paths map
// beneath the installed flow-runtime/ directory.
const validatorRel = "flow-runtime/scripts/verify-portable.mjs";
const scratch = await mkdtemp(join(tmpdir(), "oci-iot-integrated-portability-"));
let negativeRegressionCount = 0;
let integratedCaseCount = 0;
let managedTargetRegressionCount = 0;

const runValidator = async (target) => run(process.execPath, [resolve(target, validatorRel)], {
  cwd: scratch,
  encoding: "utf8"
});

const makeCopy = async (name) => {
  const target = resolve(scratch, name);
  await cp(packageRoot, target, { recursive: true });
  return target;
};
const packagePath = (target, path) => path === "SKILL.md"
  ? resolve(target, "flow-runtime/references/flow-runtime.md")
  : path.startsWith("flow-runtime/") ? resolve(target, path) : resolve(target, "flow-runtime", path);

const expectFailure = async (name, mutate, expectedPattern) => {
  negativeRegressionCount += 1;
  const target = await makeCopy(name);
  await mutate(target);
  let failure;
  try {
    await runValidator(target);
  } catch (error) {
    failure = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
  }
  assert.ok(failure, `${name}: portable validator unexpectedly passed`);
  const expectedOrIntegrity = new RegExp(`(?:${expectedPattern.source})|(?:executable integrity mismatch)`, expectedPattern.flags.replace(/[gy]/g, ""));
  assert.match(failure, expectedOrIntegrity, `${name}: validator failed for the wrong reason`);
};

const expectManagedTargetFailure = async (name, mutate) => {
  managedTargetRegressionCount += 1;
  const target = await makeCopy(name);
  await mutate(target);
  let failure;
  try {
    await runValidator(target);
  } catch (error) {
    failure = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
  }
  assert.match(failure ?? "", /managed target-selection decision mismatch/, `${name}: unsafe target promotion was accepted`);
};

try {
  const direct = await runValidator(packageRoot);
  assert.match(direct.stdout, /verified bundled Flow Runtime module/);

  await expectManagedTargetFailure("managed-target-version-only-promotion", async (target) => {
    const path = packagePath(target, "assets/nodes/node-identity-cases.json");
    const fixture = JSON.parse(await readFile(path, "utf8"));
    fixture.targetSelectionCases.find((item) => item.caseId === "matching-name-and-version-without-contract-stays-gated").expected = {
      decision: "plan-bounded-managed-test", selectedNodeType: "iot-send-command", contract: "version-match",
      liveCompatibility: "confirmed", liveAcceptance: "passed", authorization: "granted"
    };
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  });

  await expectManagedTargetFailure("sample-contract-promoted-to-wrong-managed-module", async (target) => {
    const path = packagePath(target, "assets/nodes/node-identity-cases.json");
    const fixture = JSON.parse(await readFile(path, "utf8"));
    fixture.targetSelectionCases.find((item) => item.caseId === "sample-0-6-contract-cannot-transfer-to-observed-0-5-module").expected = {
      decision: "plan-bounded-managed-test", selectedNodeType: "iot-send-command", contract: "verified-matching-immutable-implementation",
      liveCompatibility: "confirmed", liveAcceptance: "passed", authorization: "granted"
    };
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  });

  const standalone = await makeCopy("standalone");
  const copied = await runValidator(standalone);
  assert.match(copied.stdout, /verified bundled Flow Runtime module/);

  await expectFailure("bad-encoding", async (target) => {
    const path = packagePath(target, "SKILL.md");
    await writeFile(path, `${await readFile(path, "utf8")}\n\uFFFD\n`, "utf8");
  }, /Unicode replacement character/);

  await expectFailure("escaping-link", async (target) => {
    const path = packagePath(target, "SKILL.md");
    await writeFile(path, `${await readFile(path, "utf8")}\n[escape](..\/..\/outside.md)\n`, "utf8");
  }, /link escaping the package/);

  await expectFailure("reference-link", async (target) => {
    const path = packagePath(target, "SKILL.md");
    await writeFile(path, `${await readFile(path, "utf8")}\n[outside]: ../../outside.md\n`, "utf8");
  }, /link escaping the package/);

  await expectFailure("absolute-link", async (target) => {
    const path = packagePath(target, "SKILL.md");
    await writeFile(path, `${await readFile(path, "utf8")}\n[local](\/Users\/example\/file.md)\n`, "utf8");
  }, /machine-specific path|absolute local link/);

  await expectFailure("missing-asset", async (target) => {
    await rm(packagePath(target, "assets/oci-iot/telemetry-ingress-cases.json"));
  }, /missing package file/);

  await expectFailure("external-symlink", async (target) => {
    const outside = resolve(scratch, "outside.md");
    await writeFile(outside, "outside\n", "utf8");
    await symlink(outside, packagePath(target, "linked.md"));
    const path = packagePath(target, "SKILL.md");
    await writeFile(path, `${await readFile(path, "utf8")}\n[linked](linked.md)\n`, "utf8");
  }, /is a symlink/);

  await expectFailure("unreferenced-symlink", async (target) => {
    const outside = resolve(scratch, "unreferenced.txt");
    await writeFile(outside, "outside\n", "utf8");
    await symlink(outside, packagePath(target, "unreferenced.txt"));
  }, /is a symlink/);

  await expectFailure("missing-shell-target", async (target) => {
    const path = packagePath(target, "SKILL.md");
    await writeFile(path, `${await readFile(path, "utf8")}\n\`\`\`zsh\nnode "./scripts/missing.mjs"\n\`\`\`\n`, "utf8");
  }, /shell command references a missing package file/);

  await expectFailure("escaping-shell-target", async (target) => {
    const path = packagePath(target, "SKILL.md");
    await writeFile(path, `${await readFile(path, "utf8")}\n\`\`\`bash\nnode ../../outside.mjs\n\`\`\`\n`, "utf8");
  }, /shell path that escapes the package/);

  await expectFailure("empty-cases", async (target) => {
    const path = packagePath(target, "assets/oci-iot/telemetry-ingress-cases.json");
    const fixture = JSON.parse(await readFile(path, "utf8"));
    fixture.cases = [];
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /offline cases are missing/);

  await expectFailure("broken-topology", async (target) => {
    const path = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(path, "utf8"));
    flow.find((node) => node.type === "inject").wires = [];
    await writeFile(path, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
  }, /Inject must wire directly to function/);

  await expectFailure("wrong-tab", async (target) => {
    const path = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(path, "utf8"));
    flow.find((node) => node.type === "debug").z = "missing-tab";
    await writeFile(path, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
  }, /node must belong to the sole flow tab/);

  await expectFailure("network-capability", async (target) => {
    const path = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(path, "utf8"));
    flow.find((node) => node.type === "function").func += `\n${["fet", "ch ("].join("")}\"https://example.com\");`;
    await writeFile(path, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("commented-network-capability", async (target) => {
    const path = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(path, "utf8"));
    flow.find((node) => node.type === "function").func += `\nvoid ${["fet", "ch/* valid JavaScript comment */("].join("")}\"https://example.com\");`;
    await writeFile(path, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("function-dynamic-import", async (target) => {
    const path = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(path, "utf8"));
    flow.find((node) => node.type === "function").func += `\nvoid ${["imp", "ort("].join("")}\"node:https\");`;
    await writeFile(path, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
  }, /flow function contains a forbidden dynamic import/);

  await expectFailure("function-commented-dynamic-import", async (target) => {
    const path = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(path, "utf8"));
    flow.find((node) => node.type === "function").func += `\nvoid ${["imp", "ort/* valid JavaScript comment */("].join("")}\"node:https\");`;
    await writeFile(path, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
  }, /flow function contains a forbidden dynamic import/);

  await expectFailure("function-unicode-line-comment-import", async (target) => {
    const path = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(path, "utf8"));
    flow.find((node) => node.type === "function").func += `\nvoid ${["imp", "ort// valid JavaScript comment\u2028("].join("")}\"node:https\");`;
    await writeFile(path, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
  }, /flow function contains a forbidden dynamic import/);

  await expectFailure("network-import", async (target) => {
    const path = packagePath(target, "scripts/extra.mjs");
    await writeFile(path, `import http from "http";\nvoid http;\n`, "utf8");
  }, /imports a non-allowlisted module/);

  await expectFailure("commented-network-import", async (target) => {
    const path = packagePath(target, "scripts/extra.mjs");
    await writeFile(path, `import/* valid JavaScript comment */ https from "node:https";\nvoid https;\n`, "utf8");
  }, /imports a non-allowlisted module/);

  await expectFailure("network-export-from", async (target) => {
    const path = packagePath(target, "scripts/extra.mjs");
    await writeFile(path, `export { request } from "node:https";\n`, "utf8");
  }, /imports a non-allowlisted module/);

  await expectFailure("commented-dynamic-import", async (target) => {
    const path = packagePath(target, "scripts/extra.mjs");
    await writeFile(path, `void import/* valid JavaScript comment */("node:https");\n`, "utf8");
  }, /imports a non-allowlisted module/);

  await expectFailure("commented-fetch-capability", async (target) => {
    const path = packagePath(target, "scripts/extra.mjs");
    await writeFile(path, `void fetch/* valid JavaScript comment */;\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("commented-process-capability", async (target) => {
    const path = packagePath(target, "scripts/extra.mjs");
    await writeFile(path, `void process/* valid JavaScript comment */.getBuiltinModule;\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("escaped-identifier-network-capability", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    const escapedCapability = ["f", "\\u0065", "tch"].join("");
    await writeFile(path, `${verifier}\nvoid typeof ${escapedCapability};\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("dynamic-eval-network-capability", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    await writeFile(path, `${verifier}\n${["ev", "al"].join("")}('fet' + 'ch')('https://example.invalid');\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("function-constructor-network-capability", async (target) => {
    const path = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(path, "utf8"));
    flow.find((node) => node.type === "function").func += `\n${["Fun", "ction"].join("")}('return fet' + 'ch')()('https://example.invalid');`;
    await writeFile(path, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("function-alias-dynamic-code", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    const dynamicFactory = ["Fun", "ction"].join("");
    await writeFile(path, `${verifier}\nconst compileSentinel = ${dynamicFactory};\ncompileSentinel("throw new Error('ALIAS_EXECUTED')")();\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("function-tagged-template-dynamic-code", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    const dynamicFactory = ["Fun", "ction"].join("");
    await writeFile(path, `${verifier}\n${dynamicFactory}\`throw new Error('TAGGED_EXECUTED')\`();\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("computed-global-network-capability", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    await writeFile(path, `${verifier}\nglobal['fet' + 'ch']('https://example.invalid');\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("global-alias-dynamic-code", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    await writeFile(path, `${verifier}\nconst g = global;\ng["Fun" + "ction"]("throw new Error('ALIAS_GLOBAL_EXECUTED')")();\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("optional-chain-global-dynamic-code", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    await writeFile(path, `${verifier}\nglobal?.["Fun" + "ction"]("throw new Error('OPTIONAL_GLOBAL_EXECUTED')")();\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("reflect-global-dynamic-code", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    await writeFile(path, `${verifier}\nReflect.get(global, "Fun" + "ction")("throw new Error('REFLECT_GLOBAL_EXECUTED')")();\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("computed-constructor-dynamic-code", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    await writeFile(path, `${verifier}\n(() => {})["con" + "structor"]("throw new Error('COMPUTED_CONSTRUCTOR_EXECUTED')")();\n`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("flow-computed-constructor-dynamic-code", async (target) => {
    const path = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(path, "utf8"));
    flow.find((node) => node.type === "function").func += `\n(() => {})["con" + "structor"]("throw new Error('FLOW_COMPUTED_CONSTRUCTOR_EXECUTED')")();`;
    await writeFile(path, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
  }, /forbidden network-capable API/);

  for (const [name, expression] of [
    ["parenthesized-computed-constructor", `(() => {})['con' + ('structor')]("throw new Error('PARENTHESIZED_EXECUTED')")();`],
    ["three-fragment-computed-constructor", `(() => {})['con' + 'str' + 'uctor']("throw new Error('THREE_FRAGMENT_EXECUTED')")();`],
    ["concat-computed-constructor", `(() => {})['con'.concat('structor')]("throw new Error('CONCAT_EXECUTED')")();`],
    ["template-computed-constructor", `(() => {})[\`con${'${'}'structor'}\`]("throw new Error('TEMPLATE_EXECUTED')")();`],
    ["hex-computed-constructor", `(() => {})['\\x63onstructor']("throw new Error('HEX_EXECUTED')")();`]
  ]) {
    await expectFailure(name, async (target) => {
      const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
      const verifier = await readFile(path, "utf8");
      await writeFile(path, `${verifier}\n${expression}\n`, "utf8");
    }, /executable integrity mismatch|forbidden network-capable API/);
  }

  await expectFailure("flow-parenthesized-computed-constructor", async (target) => {
    const path = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(path, "utf8"));
    flow.find((node) => node.type === "function").func += `\n(() => {})['con' + ('structor')]("throw new Error('FLOW_PARENTHESIZED_EXECUTED')")();`;
    await writeFile(path, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
  }, /executable integrity mismatch|forbidden network-capable API/);

  await expectFailure("bare-cr-line-comment-import", async (target) => {
    const path = packagePath(target, "scripts/extra.mjs");
    await writeFile(path, `void import// valid JavaScript comment\r("node:https");\n`, "utf8");
  }, /imports a non-allowlisted module/);

  await expectFailure("unicode-line-comment-import", async (target) => {
    const path = packagePath(target, "scripts/extra.mjs");
    await writeFile(path, `void import// valid JavaScript comment\u2028("node:https");\n`, "utf8");
  }, /imports a non-allowlisted module/);

  await expectFailure("unreferenced-cjs-network", async (target) => {
    const path = packagePath(target, "scripts/unreferenced.cjs");
    await writeFile(path, `fetch("https://example.com");\n`, "utf8");
  }, /unsupported file extension|forbidden network-capable API/i);

  await expectFailure("unreferenced-private-key", async (target) => {
    const path = packagePath(target, "assets/unreferenced.pem");
    await writeFile(path, "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n", "utf8");
  }, /forbidden live or secret material|unsupported file extension/i);

  await expectFailure("quoted-json-credential", async (target) => {
    const path = packagePath(target, "assets/quoted-credential.json");
    await writeFile(path, '{"password":"SYNTHETIC_REVIEW_VALUE_NOT_A_SECRET"}\n', "utf8");
  }, /forbidden live or secret material/i);

  await expectFailure("unreferenced-unknown-binary", async (target) => {
    const path = packagePath(target, "assets/unreferenced.bin");
    await writeFile(path, Buffer.from([0, 1, 2, 3, 255]));
  }, /unsupported file extension/i);

  await expectFailure("preflight-before-focused-execution", async (target) => {
    const path = packagePath(target, "scripts/verify-workflows.mjs");
    const verifier = await readFile(path, "utf8");
    await writeFile(path, `throw new Error("EXECUTED_BEFORE_PREFLIGHT");\nfetch("https://example.com");\n${verifier}`, "utf8");
  }, /forbidden network-capable API/);

  await expectFailure("self-masked-mapping", async (target) => {
    const flowPath = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(flowPath, "utf8"));
    const functionNode = flow.find((node) => node.type === "function");
    functionNode.func = functionNode.func.replace('? "data" : "hvacs/"', '? "wrong" : "hvacs/"');
    await writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
    const fixturePath = packagePath(target, "assets/oci-iot/telemetry-ingress-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const gateway = fixture.cases.find((item) => item.name === "gateway example");
    gateway.expected.topic = "wrong";
    gateway.expected._example.targetTopic = "wrong";
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded routing contract failed/);

  await expectFailure("self-masked-shared-routing", async (target) => {
    const flowPath = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(flowPath, "utf8"));
    const functionNode = flow.find((node) => node.type === "function");
    functionNode.func = functionNode.func.replace("parts = parts.slice(2);", 'node.warn("Shared subscriptions disabled");\n    return null;');
    await writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
    const fixturePath = packagePath(target, "assets/oci-iot/telemetry-ingress-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    fixture.cases.find((item) => item.name === "shared subscription example").expected = { output: null };
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded routing contract failed/);

  await expectFailure("self-masked-serialization", async (target) => {
    const flowPath = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(flowPath, "utf8"));
    const functionNode = flow.find((node) => node.type === "function");
    functionNode.func = functionNode.func.replace("msg.payload = JSON.stringify(payload);", 'msg.payload = "{}";');
    await writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
    const fixturePath = packagePath(target, "assets/oci-iot/telemetry-ingress-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    for (const item of fixture.cases) if (item.expected.output !== null) item.expected.payload = "{}";
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded payload serialization failed/);

  await expectFailure("self-masked-timestamp", async (target) => {
    const flowPath = packagePath(target, "assets/node-red/oci-iot-ingress-core.json");
    const flow = JSON.parse(await readFile(flowPath, "utf8"));
    const functionNode = flow.find((node) => node.type === "function");
    functionNode.func = functionNode.func.replace("if (!Number.isFinite(parsedTime) || canonicalTime.slice(0, 19) !== payload.time.slice(0, 19)) {", "if (false) {");
    await writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`, "utf8");
    const fixturePath = packagePath(target, "assets/oci-iot/telemetry-ingress-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    for (const item of fixture.cases) {
      if (!["missing observation time", "numeric observation time", "invalid observation time"].includes(item.name)) continue;
      item.expected = {
        topic: "hvacs/example-hvac-01",
        payload: JSON.stringify(item.input.payload),
        _example: { sourceTopic: item.input.topic, targetTopic: "hvacs/example-hvac-01" }
      };
    }
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded rejection contract accepted/);

  await expectFailure("phase-status-masking", async (target) => {
    const path = packagePath(target, "tests/coverage-contract.json");
    const contract = JSON.parse(await readFile(path, "utf8"));
    contract.phase_status = "reviewed";
    contract.required_modules.find((item) => item.id === "example-batch-ingestion").status = "planned";
    await writeFile(path, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  }, /is not implemented by completed phase/);

  await expectFailure("unresolved-claim-source", async (target) => {
    const path = packagePath(target, "tests/coverage-contract.json");
    const contract = JSON.parse(await readFile(path, "utf8"));
    contract.claims.find((item) => item.id === "FR-BATCH-001").source_ids = ["missing-source"];
    await writeFile(path, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  }, /unresolved source ID/);

  await expectFailure("stale-target-specific-source", async (target) => {
    const path = packagePath(target, "tests/coverage-contract.json");
    const contract = JSON.parse(await readFile(path, "utf8"));
    for (const sourceId of ["C11", "C12"]) contract.sources.find((item) => item.id === sourceId).observed_date = "2000-01-01";
    for (const claimId of ["FR-BATCH-001", "FR-MONITOR-001", "FR-SCENARIO-NODES-001"]) contract.claims.find((item) => item.id === claimId).observed_date = "2000-01-01";
    await writeFile(path, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  }, /freshness metadata is stale/);

  await expectFailure("self-masked-batch-routing", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-workflows.mjs");
    const verifier = await readFile(verifierPath, "utf8");
    await writeFile(verifierPath, verifier.replace('topic: deviceType === "gateway" ? "data" :', 'topic: deviceType === "gateway" ? "wrong" :'), "utf8");
    const fixturePath = packagePath(target, "assets/batch/batch-ingestion-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    for (const item of fixture.cases) {
      for (const row of item.expected.rows ?? []) if (row.deviceType === "gateway") row.topic = "wrong";
    }
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded batch gateway routing contract failed/);

  await expectFailure("self-masked-monitoring-identity-route", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-workflows.mjs");
    const verifier = await readFile(verifierPath, "utf8");
    await writeFile(
      verifierPath,
      verifier.replace(
        'return { route: "final", reason: "invalid-identity", commands: [], recordId: record?.recordId ?? null };',
        'return { route: "command", reason: "invalid-identity", commands: [{ unsafe: true }], recordId: record?.recordId ?? null };'
      ),
      "utf8"
    );
    const fixturePath = packagePath(target, "assets/monitoring/normalized-monitoring-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    for (const testCase of fixture.cases) {
      if (testCase.expected.reason !== "invalid-identity") continue;
      testCase.expected.route = "command";
      testCase.expected.commands = [{ unsafe: true }];
    }
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded monitoring identity rejection contract failed/);

  await expectFailure("self-masked-delivery-retry-bounds", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-runtime.mjs");
    const verifier = await readFile(verifierPath, "utf8");
    await writeFile(
      verifierPath,
      verifier.replace(
        'if (input.deadlineReached === true || attemptLimitReached || pollLimitReached) return { next: "not_responded", retry: false };',
        'if (attemptLimitReached) return { next: "not_responded", retry: false };'
      ),
      "utf8"
    );
    const fixturePath = packagePath(target, "assets/runtime/delivery-recovery-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    for (const caseId of ["transient-failure-deadline", "transient-failure-poll-limit"]) {
      fixture.cases.find((item) => item.caseId === caseId).expected = { next: "prepared", retry: true };
    }
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded bounded delivery terminal contract failed/);

  await expectFailure("self-masked-batch-microseconds", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-workflows.mjs");
    let verifier = await readFile(verifierPath, "utf8");
    verifier = verifier.replace("const milliseconds = micros / 1000n;", "const milliseconds = micros;");
    verifier = verifier.replace(
      'assert.equal(parseTimestamp("1768485600000000"), "2026-01-15T14:00:00.000Z");',
      'assert.equal(parseTimestamp("1768485600000000"), "+058011-01-29T08:00:00.000Z");'
    );
    await writeFile(verifierPath, verifier, "utf8");
    const fixturePath = packagePath(target, "assets/batch/batch-ingestion-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    for (const testCase of fixture.cases) {
      for (const row of testCase.expected.rows ?? []) {
        if (row.sourceTime !== "2026-01-15T14:00:00.000Z" || !testCase.objectBytesBase64) continue;
        const decoded = Buffer.from(testCase.objectBytesBase64, "base64").toString("utf8");
        if (!decoded.includes("1768485600000000")) continue;
        row.sourceTime = "+058011-01-29T08:00:00.000Z";
        const payload = JSON.parse(row.payload);
        payload.time = row.sourceTime;
        row.payload = JSON.stringify(payload);
      }
    }
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded microsecond timestamp contract failed/);

  await expectFailure("self-masked-batch-object-name", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-workflows.mjs");
    let verifier = await readFile(verifierPath, "utf8");
    verifier = verifier.replace(
      "if (!expectedObjectName || testCase.objectName !== expectedObjectName)",
      "if (!expectedObjectName)"
    );
    verifier = verifier.replace(
      'assert.equal(transformBatchCase(batch.cases.find(({ name }) => name === "requested object does not match counter")).download, "invalid-object-name");',
      'assert.equal(transformBatchCase(batch.cases.find(({ name }) => name === "requested object does not match counter")).download, "success");'
    );
    await writeFile(verifierPath, verifier, "utf8");
    const fixturePath = packagePath(target, "assets/batch/batch-ingestion-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const testCase = fixture.cases.find((item) => item.name === "requested object does not match counter");
    testCase.expected = { download: "success", index: 15, rows: [], errors: ["empty object"] };
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded batch object-name mismatch outcome failed/);

  await expectFailure("self-masked-command-correlation", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-workflows.mjs");
    const verifier = await readFile(verifierPath, "utf8");
    await writeFile(verifierPath, verifier.replace("if (!statusRow || statusRow.ID !== commandId)", "if (!statusRow)"), "utf8");
    const fixturePath = packagePath(target, "assets/commands/command-notification-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const testCase = fixture.cases.find((item) => item.name === "mismatched SQL command record ID");
    testCase.expected.state = "completed";
    testCase.expected.transitions = ["completed"];
    testCase.expected.notification.body = "sourceRecordId=r-mismatch rawCommandDataRecordId=cmd-mismatch status=completed deviceType=hvacs externalKey=child-05";
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded command-record mismatch contract failed/);

  await expectFailure("self-masked-command-bind-separation", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-workflows.mjs");
    let verifier = await readFile(verifierPath, "utf8");
    verifier = verifier
      .replace('commands.contract.sql.bindName, "recordId"', 'commands.contract.sql.bindName, "rawCommandDataRecordId"')
      .replace('commands.contract.sql.bindValueSource, "rawCommandDataRecordId"', 'commands.contract.sql.bindValueSource, "recordId"')
      .replace('commands.contract.sql.predicate, "ID = :recordId"', 'commands.contract.sql.predicate, "ID = :rawCommandDataRecordId"');
    await writeFile(verifierPath, verifier, "utf8");
    const fixturePath = packagePath(target, "assets/commands/command-notification-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    fixture.contract.sql.bindName = "rawCommandDataRecordId";
    fixture.contract.sql.bindValueSource = "recordId";
    fixture.contract.sql.predicate = "ID = :rawCommandDataRecordId";
    for (const testCase of fixture.cases) {
      if (testCase.commandResponse?.rawCommandDataRecordId) testCase.commandResponse.recordId = testCase.commandResponse.rawCommandDataRecordId;
    }
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded command SQL bind name\/value-source contract failed/);

  await expectFailure("self-masked-command-status-provenance", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-workflows.mjs");
    let verifier = await readFile(verifierPath, "utf8");
    verifier = verifier.replace(
      "  const sqlBinds = { [commands.contract.sql.bindName]: response[commands.contract.sql.bindValueSource] };\n",
      "  if (response.status) return commandOutput(testCase, String(response.status).toLowerCase(), \"final\", 0, response.rawCommandDataRecordId ?? null, [String(response.status).toLowerCase()]);\n  const sqlBinds = { [commands.contract.sql.bindName]: response[commands.contract.sql.bindValueSource] };\n"
    );
    verifier = verifier.replace(/  if \(testCase\.commandResponse\) assert\.equal\(Object\.hasOwn\(testCase\.commandResponse, "status"\), false, [^\n]+\);\n/, "");
    await writeFile(verifierPath, verifier, "utf8");
    const fixturePath = packagePath(target, "assets/commands/command-notification-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    const testCase = fixture.cases.find((item) => item.name === "send returns ID and SQL reports completed");
    testCase.commandResponse.status = "COMPLETED";
    testCase.statusResults = [];
    testCase.expected.polls = 0;
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /Send Command response must contain only its returned ID/);

  await expectFailure("self-masked-resource-etag", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-runtime.mjs");
    let verifier = await readFile(verifierPath, "utf8");
    verifier = verifier.replace(
      "if (testCase.ifMatch !== testCase.currentEtag) {",
      'if (testCase.ifMatch !== testCase.currentEtag && testCase.caseId !== "replace-network-preserving-mount") {'
    );
    verifier = verifier.replace(
      /assert\.deepEqual\(\n  networkDecision\(\{ \.\.\.preserving, currentEtag: "etag-new", ifMatch: "etag-a", response: \{ status: 200 \} \}\),[\s\S]*?"network ETag mismatch must not be masked by a simulated success"\n\);\n/,
      ""
    );
    verifier = verifier.replace(
      '  assert.equal(testCase.ifMatch, testCase.currentEtag, `${testCase.caseId}: successful resource update needs exact ifMatch`);\n',
      ""
    );
    await writeFile(verifierPath, verifier, "utf8");
    const fixturePath = packagePath(target, "assets/runtime/network-config-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    fixture.cases.find((item) => item.caseId === "replace-network-preserving-mount").ifMatch = "etag-wrong";
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded successful network replacement must match current ETag/);

  await expectFailure("self-masked-network-readback", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-runtime.mjs");
    let verifier = await readFile(verifierPath, "utf8");
    verifier = verifier.replace(
      "const readbackMatches = isDeepStrictEqual(testCase.readback, expectedReadback);",
      'const readbackMatches = isDeepStrictEqual(testCase.readback, expectedReadback) || testCase.caseId === "readback-mismatch-escalates";'
    );
    verifier = verifier.replace(
      'assert.deepEqual(networkReadbackMismatch.expected, { decision: "escalate", reason: "effective-state-mismatch", retry: false }, "network readback mismatch must escalate without retry");\n',
      ""
    );
    await writeFile(verifierPath, verifier, "utf8");
    const fixturePath = packagePath(target, "assets/runtime/network-config-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    fixture.cases.find((item) => item.caseId === "readback-mismatch-escalates").expected = {
      decision: "replace-complete-and-confirm", mutation: true, effectiveReadback: true, readbackMatches: true
    };
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded network readback mismatch must escalate/);

  await expectFailure("self-masked-property-readback", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-runtime.mjs");
    let verifier = await readFile(verifierPath, "utf8");
    const marker = "const readbackMatches = isDeepStrictEqual(testCase.readback, expectedReadback);";
    const markerIndex = verifier.lastIndexOf(marker);
    if (markerIndex >= 0) {
      verifier = `${verifier.slice(0, markerIndex)}const readbackMatches = isDeepStrictEqual(testCase.readback, expectedReadback) || testCase.caseId === "readback-mismatch-escalates";${verifier.slice(markerIndex + marker.length)}`;
    }
    verifier = verifier.replace(
      'assert.deepEqual(propertyReadbackMismatch.expected, { decision: "escalate", reason: "effective-state-mismatch", retry: false }, "property readback mismatch must escalate without retry");\n',
      ""
    );
    await writeFile(verifierPath, verifier, "utf8");
    const fixturePath = packagePath(target, "assets/runtime/resource-property-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    fixture.cases.find((item) => item.caseId === "readback-mismatch-escalates").expected = {
      decision: "update-and-confirm", mutation: true, effectiveReadback: true, readbackMatches: true
    };
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded property readback mismatch must escalate/);

  await expectFailure("sample-source-pin-corruption", async (target) => {
    const path = packagePath(target, "tests/coverage-contract.json");
    const contract = JSON.parse(await readFile(path, "utf8"));
    for (const sourceId of ["O7", "S4"]) contract.sources.find((item) => item.id === sourceId).immutable_ref = "0000000000000000000000000000000000000000";
    await writeFile(path, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  }, /hardcoded O7 immutable revision contract failed/);

  await expectFailure("source-owned-identity-matrix-corruption", async (target) => {
    const path = packagePath(target, "references/node-capability-matrix.md");
    await writeFile(path, "# Node capability and identity matrix\n\nFR-NODE-IDENTITY-001: All iot-config names mean the same managed OCI configuration.\n", "utf8");
  }, /hardcoded managed iot-config source-owned matrix record failed/);

  await expectFailure("forward-unlimited-retry-corruption", async (target) => {
    const path = packagePath(target, "tests/coverage-contract.json");
    const contract = JSON.parse(await readFile(path, "utf8"));
    const test = contract.forward_tests.find((item) => item.id === "FT10");
    test.offline_live_classification = "offline";
    test.expected_outcome = { decision: "accept", reason: "unlimited-retries-allowed" };
    test.forbidden_claims = ["missing subscriber is retryable forever"];
    await writeFile(path, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  }, /forward test FT10 must reject unlimited dequeue retries/);

  await expectFailure("forward-node-identity-guess-corruption", async (target) => {
    const path = packagePath(target, "tests/coverage-contract.json");
    const contract = JSON.parse(await readFile(path, "utf8"));
    contract.forward_tests.find((item) => item.id === "FT08").expected_outcome = {
      decision: "select", reason: "guessed-managed-identity", target_availability: "confirmed"
    };
    await writeFile(path, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  }, /forward test FT08 must not guess/);

  await expectFailure("forward-ords-unbounded-corruption", async (target) => {
    const path = packagePath(target, "tests/coverage-contract.json");
    const contract = JSON.parse(await readFile(path, "utf8"));
    contract.forward_tests.find((item) => item.id === "FT12").expected_outcome = {
      decision: "accept", polling: "unlimited", managed_availability: "confirmed"
    };
    await writeFile(path, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  }, /forward test FT12 must keep ORDS polling finite/);

  await expectFailure("optional-node-parent-auth-corruption", async (target) => {
    const path = packagePath(target, "assets/nodes/optional-oci-node-contract-cases.json");
    const fixture = JSON.parse(await readFile(path, "utf8"));
    fixture.contracts["oci-ords-poll"].configurationParent = "oci-config";
    fixture.contracts["oci-ords-poll"].authFamily = "oci-api";
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded optional-node parent\/authentication contracts failed/);

  await expectFailure("optional-node-finite-bound-corruption", async (target) => {
    const path = packagePath(target, "assets/nodes/optional-oci-node-contract-cases.json");
    const fixture = JSON.parse(await readFile(path, "utf8"));
    delete fixture.finiteBounds.pollTimeoutMs.maximum;
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded optional-node finite bounds failed/);

  await expectFailure("ords-deadline-outcome-corruption", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(verifierPath, "utf8");
    await writeFile(verifierPath, verifier.replace("const eligibleResponses = (input.responses ?? []).slice(0, maxAttempts);", "const eligibleResponses = input.responses ?? [];"), "utf8");
    const path = packagePath(target, "assets/nodes/optional-oci-node-contract-cases.json");
    const fixture = JSON.parse(await readFile(path, "utf8"));
    fixture.cases.find((item) => item.caseId === "ords-poll-deadline-excludes-next-command-at-boundary").expected = {
      decision: "accepted-shape",
      path: "/20250531/rawCommandData/fixture-record-deadline-command",
      pollComplete: true,
      pollTimedOut: false,
      pollAttempts: 2,
      deliveryStatus: "COMPLETED",
      finite: true
    };
    fixture.cases.find((item) => item.caseId === "ords-poll-deadline-excludes-next-custom-at-boundary").expected = {
      decision: "bounded-result", pollComplete: true, pollTimedOut: false, pollAttempts: 2, genericRetry: false
    };
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded ORDS command deadline contract failed/);

  await expectFailure("sql-preflight-order-corruption", async (target) => {
    const path = packagePath(target, "assets/nodes/database-aq-contract-cases.json");
    const fixture = JSON.parse(await readFile(path, "utf8"));
    fixture.cases.find((item) => item.caseId === "sql-editor-multiple-statements-active-transaction-row-limit").expected = {
      decision: "accepted-shape", sameTransaction: true, durable: false
    };
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /database\/AQ decision mismatch|hardcoded SQL structural preflight ordering failed/);

  await expectFailure("telemetry-null-outcome-corruption", async (target) => {
    const path = packagePath(target, "assets/nodes/iot-node-contract-cases.json");
    const fixture = JSON.parse(await readFile(path, "utf8"));
    fixture.cases.find((item) => item.caseId === "telemetry-null-payload-auto-timestamp-errors-before-publish").expected = {
      valid: true, payload: { value: null, time: 1 }, acceptance: "transport-only"
    };
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /IoT\/OCI decision mismatch|hardcoded telemetry null timestamp failure contract failed/);

  await expectFailure("aq-multi-consumer-composition-corruption", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    await writeFile(path, verifier.replace('if (input.queue === "multi-consumer" && !hasDequeueBehavior)', 'if (input.queue === "multi-consumer")'), "utf8");
  }, /database\/AQ decision mismatch|multi-consumer validation must not bypass finite retry policy/);

  await expectFailure("sql-bind-state-composition-corruption", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    await writeFile(path, verifier.replace('    if (["committed", "rolled-back", "closed"].includes(input.transactionState))', '    if (successfulBindDecision) return successfulBindDecision;\n    if (["committed", "rolled-back", "closed"].includes(input.transactionState))'), "utf8");
  }, /database\/AQ decision mismatch|successful SQL bind validation must not bypass ended transaction state/);

  await expectFailure("ords-command-envelope-corruption", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    await writeFile(path, verifier.replace("const ordsCommandData = (data) => {", "const ordsCommandData = (data) => data;\nconst unusedOrdsCommandData = (data) => {"), "utf8");
  }, /optional OCI decision mismatch|ORDS command envelope must be resolved before terminal evaluation/);

  await expectFailure("object-storage-effective-operation-corruption", async (target) => {
    const path = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(path, "utf8");
    await writeFile(path, verifier.replace('if (effective.operation === "download")', 'if (input.operation === "download")'), "utf8");
  }, /optional OCI decision mismatch|Object Storage must dispatch from the resolved configured operation/);

  await expectFailure("ords-response-null-status-corruption", async (target) => {
    const path = packagePath(target, "assets/nodes/optional-oci-node-contract-cases.json");
    const fixture = JSON.parse(await readFile(path, "utf8"));
    fixture.cases.find((item) => item.caseId === "ords-poll-response-data-without-delivery-status-completes-without-undefined").expected.deliveryStatus = "UNDEFINED";
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /optional OCI decision mismatch|hardcoded ORDS response-only null-status contract failed/);

  await expectFailure("self-masked-unbounded-ords-polling", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(verifierPath, "utf8");
    const original = 'if (!positiveInteger(input.timeoutMs)) return { valid: false, route: "reject", reason: "poll timeout must be finite" };';
    const replacement = 'if (false) return { valid: false, route: "reject", reason: "poll timeout must be finite" };';
    const mutated = verifier.replace(original, replacement);
    assert.notEqual(mutated, verifier, "ORDS bound corruption probe did not alter the focused verifier");
    await writeFile(verifierPath, mutated, "utf8");
    const fixturePath = packagePath(target, "assets/nodes/iot-node-contract-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    fixture.cases.find((item) => item.caseId === "ords-unbounded-poll-is-rejected").expected = {
      classification: "sample-package-compatibility-gated",
      validBounds: false,
      refreshOn401: "once",
      polls: 0,
      route: "compatibility-gate",
      reason: "target palette/version and module permission remain unverified"
    };
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded bounded ORDS polling rejection failed/);

  await expectFailure("self-masked-node-identity-collision", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(verifierPath, "utf8");
    const original = 'return { decision: "clarify", reason: "ambiguous-name", candidateIdentities: ["managed-iot-config", "sample-device-iot-config"], authenticationFamilies: ["oci-configuration", "device-mqtts"], sourceOwners: ["O1", "S4"] };';
    const replacement = 'return { decision: "select", reason: "guessed", candidateIdentities: ["managed-iot-config"], authenticationFamilies: ["oci-configuration"], sourceOwners: ["O1"] };';
    const mutated = verifier.replace(original, replacement);
    assert.notEqual(mutated, verifier, "identity corruption probe did not alter the focused verifier");
    await writeFile(verifierPath, mutated, "utf8");
    const fixturePath = packagePath(target, "assets/nodes/node-identity-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    fixture.cases.find((item) => item.caseId === "bare-iot-config-requires-clarification").expected = {
      decision: "select", reason: "guessed", candidateIdentities: ["managed-iot-config"], authenticationFamilies: ["oci-configuration"], sourceOwners: ["O1"]
    };
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded iot-config collision contract failed/);

  await expectFailure("self-masked-database-durability", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(verifierPath, "utf8");
    const original = 'if (input.operation === "commit" && input.state === "active") return { state: "committed", durable: true, closed: true };';
    const replacement = 'if (input.operation === "commit" && input.state === "active") return { state: "committed", durable: false, closed: true };';
    const mutated = verifier.replace(original, replacement);
    assert.notEqual(mutated, verifier, "database durability corruption probe did not alter the focused verifier");
    await writeFile(verifierPath, mutated, "utf8");
    const fixturePath = packagePath(target, "assets/nodes/database-aq-contract-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    fixture.cases.find((item) => item.caseId === "transaction-commit").expected.durable = false;
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded transaction commit durability contract failed/);

  await expectFailure("self-masked-notification-delivery", async (target) => {
    const verifierPath = packagePath(target, "scripts/verify-node-capabilities.mjs");
    const verifier = await readFile(verifierPath, "utf8");
    const original = 'subscriberDelivery: "unknown"';
    const replacement = 'subscriberDelivery: "delivered"';
    const mutated = verifier.replace(original, replacement);
    assert.notEqual(mutated, verifier, "notification delivery corruption probe did not alter the focused verifier");
    await writeFile(verifierPath, mutated, "utf8");
    const fixturePath = packagePath(target, "assets/nodes/iot-node-contract-cases.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
    fixture.cases.find((item) => item.caseId === "notifications-publish-accepted-not-delivered").expected.subscriberDelivery = "delivered";
    await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  }, /hardcoded Notifications publication\/delivery boundary failed/);

  const expectIntegratedFailure = async (name, mutate, expectedPattern) => {
    integratedCaseCount += 1;
    const target = await makeCopy(`integrated-${name}`);
    await mutate(target);
    let failure;
    try {
      await runValidator(target);
    } catch (error) {
      failure = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    }
    assert.ok(failure, `${name}: integrated package validator unexpectedly passed`);
    assert.match(failure, expectedPattern, `${name}: integrated package validator failed for the wrong reason`);
  };

  const relocated = await makeCopy("relocated-installable-skill");
  const parentSmoke = await run("bash", [resolve(relocated, "tests/smoke.sh")], { cwd: relocated, encoding: "utf8" });
  assert.match(parentSmoke.stdout, /smoke checks passed/);
  const redaction = await run("bash", [resolve(relocated, "tests/redaction_scan.sh")], { cwd: relocated, encoding: "utf8" });
  assert.match(redaction.stdout, /No obvious secret or internal-provenance patterns found/);

  await expectIntegratedFailure("missing-parent-entrypoint", async (target) => {
    await rm(resolve(target, "SKILL.md"));
  }, /ENOENT|SKILL\.md/);

  await expectIntegratedFailure("invalid-utf8-parent-entrypoint", async (target) => {
    const path = resolve(target, "SKILL.md");
    const bytes = await readFile(path);
    await writeFile(path, Buffer.concat([bytes, Buffer.from([0xc3, 0x28])]));
  }, /Unicode replacement character/);

  await expectIntegratedFailure("broken-parent-frontmatter", async (target) => {
    const path = resolve(target, "SKILL.md");
    await writeFile(path, (await readFile(path, "utf8")).replace("name: oci-iot-platform", "name: wrong-skill"));
  }, /wrong skill name/);

  await expectIntegratedFailure("symlinked-parent-entrypoint", async (target) => {
    const path = resolve(target, "SKILL.md");
    const outside = resolve(scratch, "external-parent-skill.md");
    await writeFile(outside, await readFile(path));
    await rm(path);
    await symlink(outside, path);
  }, /parent SKILL\.md must be a regular file/);

  await expectIntegratedFailure("broken-parent-live-gate-route", async (target) => {
    const path = resolve(target, "SKILL.md");
    const value = await readFile(path, "utf8");
    await writeFile(path, value.replace("flow-runtime/references/safety-and-live-gates.md", "flow-runtime/references/missing-live-gates.md"));
  }, /missing file|missing local|live-gates/);

  await expectIntegratedFailure("omitted-parent-live-gate-route", async (target) => {
    const path = resolve(target, "SKILL.md");
    const value = await readFile(path, "utf8");
    await writeFile(path, value.replace("[live-operation gates](flow-runtime/references/safety-and-live-gates.md)", "live-operation gates"));
  }, /must route to live-operation gates/);

  await expectIntegratedFailure("broken-parent-module-route", async (target) => {
    const path = resolve(target, "SKILL.md");
    const value = await readFile(path, "utf8");
    await writeFile(path, value.replace("flow-runtime/references/flow-runtime.md", "flow-runtime/references/missing-runtime.md"));
  }, /missing file|missing local|flow-runtime/);

  await expectIntegratedFailure("missing-child-asset", async (target) => {
    await rm(resolve(target, "flow-runtime/assets/oci-iot/telemetry-ingress-cases.json"));
  }, /missing package file/);

  await expectIntegratedFailure("hidden-child-artifact", async (target) => {
    await writeFile(resolve(target, "flow-runtime/.hidden-review-artifact"), "synthetic\n", "utf8");
  }, /hidden artifact/);

  await expectIntegratedFailure("parent-to-child-link-outside-root", async (target) => {
    const path = resolve(target, "SKILL.md");
    const value = await readFile(path, "utf8");
    await writeFile(path, `${value}\n[escape](../outside.md)\n`);
  }, /link escaping the installable skill/);

  await expectIntegratedFailure("parent-link-through-intermediate-symlink", async (target) => {
    const linkDirectory = resolve(scratch, "linked-directory");
    const externalDirectory = resolve(scratch, "synthetic-external-directory");
    await mkdir(externalDirectory);
    await writeFile(resolve(externalDirectory, "guide.md"), "synthetic linked guide\n", "utf8");
    await symlink(externalDirectory, linkDirectory);
    await symlink(linkDirectory, resolve(target, "linked-directory"));
    const path = resolve(target, "SKILL.md");
    const value = await readFile(path, "utf8");
    await writeFile(path, `${value}\n[synthetic](linked-directory/guide.md)\n`, "utf8");
  }, /link escaping the installable skill/);

  assert.equal(negativeRegressionCount, 84, "inherited negative regression inventory changed without an explicit count update");
  assert.equal(integratedCaseCount, 11, "integrated case inventory changed without an explicit count update");
  assert.equal(managedTargetRegressionCount, 2, "managed target-selection regression inventory changed without an explicit count update");
  console.log(`verified relocated installable skill, ${negativeRegressionCount} inherited regressions, ${integratedCaseCount} integrated boundary cases, and ${managedTargetRegressionCount} managed-target promotion regressions`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
