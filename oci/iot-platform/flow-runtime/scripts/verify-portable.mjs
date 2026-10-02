import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = resolve(packageRoot, "..");
const textExtensions = new Set([".md", ".mjs", ".json", ".yaml", ".yml", ".txt"]);
// Only this explicitly allowlisted text extension may contain executable
// source. Any other executable-looking extension is rejected above.
const executableTextExtensions = new Set([".mjs"]);
// JavaScript identifiers may contain Unicode escapes. Canonicalize those
// escapes before capability scanning so raw spelling cannot hide a callable
// network primitive from the preflight.
const canonicalizeJavaScriptIdentifiers = (value) => {
  let canonical = value.replace(
    /\\u(?:\{([0-9a-fA-F]{1,6})\}|([0-9a-fA-F]{4}))/g,
    (escape, braced, fixed) => {
      const codePoint = Number.parseInt(braced ?? fixed, 16);
      assert.ok(codePoint <= 0x10ffff, `invalid JavaScript Unicode escape: ${escape}`);
      return String.fromCodePoint(codePoint);
    }
  );
  // Fold adjacent identifier-like string fragments so computed property access
  // cannot hide a dynamic-code primitive.
  const joinedIdentifierStrings = /(["'])([A-Za-z_$][A-Za-z0-9_$]*)\1(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*(?:\r\n|[\r\n\u2028\u2029]|$))*\+(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*(?:\r\n|[\r\n\u2028\u2029]|$))*(["'])([A-Za-z_$][A-Za-z0-9_$]*)\3/g;
  let previous;
  do {
    previous = canonical;
    canonical = canonical.replace(joinedIdentifierStrings, (_match, quote, left, _rightQuote, right) => `${quote}${left}${right}${quote}`);
  } while (canonical !== previous);
  return canonical;
};
// Binary assets are intentionally not part of this package yet. Keep this as
// an explicit allowlist so a future binary asset must opt in to byte scanning.
const binaryExtensions = new Set();
const projectResidue = new RegExp(["iot-node", "-flows|pub skill ", "cs|Lu", "na agents?|Her", "dr"].join(""), "i");

const forbiddenMaterialPatterns = [
  /ocid1\.[a-z0-9.-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /["']?(?:client[_-]?secret|access[_-]?key|private[_-]?key|password)["']?\s*[:=]\s*["']?[^\s'"},\]]+/i,
  /(?:mqtts?|wss?):\/\//i,
  /https?:\/\/[^\s/]+\.(?:oraclecloud\.com|customer-oci\.com)(?:[/\s)]|$)/i
];

const machinePath = /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+|~\/)/;
const scanBytes = (bytes, name) => {
  assert.equal(bytes.includes(Buffer.from([0xef, 0xbf, 0xbd])), false, `${name} contains a Unicode replacement character`);
  const latin1 = bytes.toString("latin1");
  assert.doesNotMatch(latin1, machinePath, `${name} contains a machine-specific path`);
  assert.doesNotMatch(latin1, projectResidue, `${name} contains project-only history or names`);
  for (const pattern of forbiddenMaterialPatterns) {
    assert.doesNotMatch(latin1, pattern, `${name} contains forbidden live or secret material: ${pattern}`);
  }
};

const requiredFiles = [
  "references/flow-runtime.md",
  "references/node-reference.md",
  "references/topic-contracts.md",
  "references/experience-derived-guidance.md",
  "references/safety-and-live-gates.md",
  "references/sources.md",
  "references/node-capability-matrix.md",
  "references/database-and-aq-node-contracts.md",
  "references/iot-and-oci-node-contracts.md",
  "references/optional-oci-node-contracts.md",
  "examples/external-broker-ingress.md",
  "assets/node-red/oci-iot-ingress-core.json",
  "assets/oci-iot/telemetry-ingress-cases.json",
  "assets/nodes/node-identity-cases.json",
  "assets/nodes/database-aq-contract-cases.json",
  "assets/nodes/iot-node-contract-cases.json",
  "assets/nodes/optional-oci-node-contract-cases.json",
  "tests/coverage-contract.json",
  "scripts/verify-runtime.mjs",
  "scripts/verify-workflows.mjs",
  "scripts/verify-node-capabilities.mjs",
  "scripts/verify-portable.mjs"
];

const insidePackage = (path) => path === packageRoot || path.startsWith(`${packageRoot}${sep}`);
const isFile = async (path) => {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
};

for (const file of requiredFiles) {
  assert.equal(await isFile(resolve(packageRoot, file)), true, `missing package file: ${file}`);
}

const files = [];
const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    assert.equal(entry.name.startsWith("."), false, `${relative(packageRoot, path)} is a hidden artifact; portable packages must contain explicit package files`);
    assert.equal(entry.isSymbolicLink(), false, `${relative(packageRoot, path)} is a symlink; portable packages must contain regular files and directories`);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) files.push(path);
    else assert.fail(`${relative(packageRoot, path)} is not a regular package file or directory`);
  }
};
await walk(packageRoot);

const texts = new Map();
for (const path of files) {
  const name = relative(packageRoot, path);
  const extension = extname(basename(path)).toLowerCase();
  const bytes = await readFile(path);
  // Scan bytes before classifying the extension, so an unreferenced artifact
  // cannot hide a secret, endpoint, path, or replacement character.
  scanBytes(bytes, name);
  if (!textExtensions.has(extension) && !binaryExtensions.has(extension)) {
    assert.fail(`${name} has an unsupported file extension: ${extension || "<none>"}`);
  }
  if (binaryExtensions.has(extension)) continue;
  let value;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    assert.fail(`${name} is not valid UTF-8 text`);
  }
  assert.equal(value.includes("\uFFFD"), false, `${name} contains a Unicode replacement character`);
  assert.doesNotMatch(value, machinePath, `${name} contains a machine-specific path`);
  texts.set(path, value);
}

// These are the only package artifacts executed by this validator. Pinning
// their exact reviewed bytes makes the portable verifier fail closed before
// an altered focused module or flow function can run, including dynamically
// reconstructed capabilities that cannot be exhaustively recognized by text
// patterns alone. This verifier is the trust root and is intentionally not
// self-hashed.
const executableIntegrity = new Map([
  ["scripts/verify-runtime.mjs", "76af7c4b07a0679b17dcf6b33d7fdabb07cd312975ea7ed33aced839f0156848"],
  ["scripts/verify-workflows.mjs", "6169e24aaae9aa702bb58b41c235243ee4e8e1aa839e654f5f73530626422273"],
  ["scripts/verify-node-capabilities.mjs", "946a2eba7e66ac96cb217cc9260226589084eb5a4331e58e64c4d7b97b14275e"],
  ["assets/node-red/oci-iot-ingress-core.json", "fe51bd106564a35829bd4691c31f79c432189122f2c688b875ce080e82e773b4"]
]);
for (const [name, expectedSha256] of executableIntegrity) {
  const value = texts.get(resolve(packageRoot, name));
  assert.equal(typeof value, "string", true, `executable integrity target is missing: ${name}`);
  const actualSha256 = createHash("sha256").update(value, "utf8").digest("hex");
  assert.equal(actualSha256, expectedSha256, `executable integrity mismatch: ${name}`);
}

const skillPath = resolve(skillRoot, "SKILL.md");
const skillStat = await lstat(skillPath);
assert.equal(skillStat.isFile(), true, "parent SKILL.md must be a regular file, not a symlink or special file");
const skillText = await readFile(skillPath, "utf8");
scanBytes(Buffer.from(skillText, "utf8"), "SKILL.md");
assert.match(skillText, /^---\r?\n[\s\S]*?\r?\n---\r?\n/, "SKILL.md must start with YAML frontmatter");
const frontmatter = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)[1];
assert.match(frontmatter, /^name:\s+oci-iot-platform\s*$/m, "SKILL.md has the wrong skill name");
assert.match(frontmatter, /^description:\s+\S.+$/m, "SKILL.md needs a description");
for (const pattern of [/OCI IoT/i, /managed Node-RED/i, /self-hosted Node-RED/i, /explicit approval/i, /(?:do|does)\s+not\s+publish/i]) {
  assert.match(skillText, pattern, `SKILL.md is missing a required boundary: ${pattern}`);
}
assert.match(skillText, /\]\(flow-runtime\/references\/flow-runtime\.md\)/, "parent SKILL.md must route to the managed Flow Runtime reference");
assert.match(skillText, /\]\(flow-runtime\/references\/safety-and-live-gates\.md\)/, "parent SKILL.md must route to live-operation gates");
const installableRoot = skillRoot;
const installableRealRoot = await realpath(installableRoot);
const parentLinks = [
  /!?(?:\[[^\]]*\])\(([^)]+)\)/g,
  /^\s*\[[^\]]+\]:\s*(\S+)/gm
];
for (const rawTarget of parentLinks.flatMap((pattern) => [...skillText.matchAll(pattern)].map((match) => match[1]))) {
  let target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
  target = target.split(/\s+["']/)[0];
  if (/^(?:https?:\/\/|mailto:|#)/i.test(target)) continue;
  assert.doesNotMatch(target, /^(?:\/|~|[A-Za-z]:[\\/])/, `SKILL.md has an absolute local link: ${target}`);
  const cleanTarget = target.split(/[?#]/, 1)[0];
  const targetPath = resolve(dirname(skillPath), cleanTarget);
  assert.equal(targetPath === installableRoot || targetPath.startsWith(`${installableRoot}${sep}`), true, `SKILL.md has a link escaping the installable skill: ${target}`);
  assert.equal(await isFile(targetPath), true, `SKILL.md has a link to a missing file: ${target}`);
  const resolvedTargetPath = await realpath(targetPath);
  assert.equal(resolvedTargetPath === installableRealRoot || resolvedTargetPath.startsWith(`${installableRealRoot}${sep}`), true, `SKILL.md has a link escaping the installable skill: ${target}`);
}
const editorReference = texts.get(resolve(packageRoot, "references/flows-editor-and-collaboration.md"));
assert.match(editorReference, /management-side Flows tab[\s\S]*update-flows API or CLI replace that complete document/i, "management complete-flow replacement boundary is missing");
assert.match(editorReference, /Interactive Node-RED editor Import is different/i, "editor import must be distinguished from management replacement");
assert.doesNotMatch(editorReference, /Importing or calling the flow replacement operation replaces that complete document/i, "editor import is incorrectly conflated with complete replacement");

const markdownLinks = [
  /!?\[[^\]]*\]\(([^)]+)\)/g,
  /^\s*\[[^\]]+\]:\s*(\S+)/gm
];
const externalUrls = new Set();
for (const [sourcePath, value] of texts) {
  if (!sourcePath.endsWith(".md")) continue;
  const targets = markdownLinks.flatMap((pattern) => [...value.matchAll(pattern)].map((match) => match[1]));
  for (const rawTarget of targets) {
    let target = rawTarget.trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = target.split(/\s+["']/)[0];
    if (/^https:\/\//i.test(target)) {
      externalUrls.add(target.replace(/[.,;]+$/, ""));
      continue;
    }
    if (/^(?:mailto:|#)/i.test(target)) continue;
    assert.doesNotMatch(target, /^(?:\/|~|[A-Za-z]:[\\/])/, `${relative(packageRoot, sourcePath)} has an absolute local link: ${target}`);
    const cleanTarget = target.split(/[?#]/, 1)[0];
    const targetPath = resolve(dirname(sourcePath), cleanTarget);
    assert.equal(insidePackage(targetPath), true, `${relative(packageRoot, sourcePath)} has a link escaping the package: ${target}`);
    assert.equal(await isFile(targetPath), true, `${relative(packageRoot, sourcePath)} links to a missing file: ${target}`);
  }
}

const sourceText = texts.get(resolve(packageRoot, "references/sources.md"));
const sourceUrls = new Set([...sourceText.matchAll(/https:\/\/[^\s)]+/g)].map((match) => match[0].replace(/[.,;]+$/, "")));
for (const url of externalUrls) {
  assert.equal(sourceUrls.has(url), true, `external URL is missing from references/sources.md: ${url}`);
}

// Phase-aware coverage contract. Planned future modules are named here so the
// package has a stable routing contract, but only implemented entries are
// required to exist in the current package.
const contractPath = resolve(packageRoot, "tests/coverage-contract.json");
const contract = JSON.parse(await readFile(contractPath, "utf8"));
const contractValue = (value, label) => {
  assert.equal(value !== null && value !== undefined, true, `${label} is missing`);
  return value;
};
const contractArray = (value, label) => {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);
  return value;
};
assert.equal(contract.schema_version, 1, "coverage contract has an unsupported schema_version");
assert.equal(Number.isInteger(contract.phase) && contract.phase >= 0, true, "coverage contract phase must be a non-negative integer");
assert.equal(["accepted", "implemented", "in-remediation", "reviewed"].includes(contract.phase_status), true, "coverage contract has an invalid phase_status");

const requiredModules = contractArray(contract.required_modules, "coverage contract required_modules");
const uniqueIds = (items, label) => {
  const ids = new Set();
  for (const item of items) {
    const id = contractValue(item?.id, `${label} item`);
    assert.equal(typeof id === "string" && id.length > 0, true, `${label} item has an invalid id`);
    assert.equal(ids.has(id), false, `${label} contains duplicate ID: ${id}`);
    ids.add(id);
  }
  return ids;
};
const moduleIds = uniqueIds(requiredModules, "required_modules");
const moduleById = new Map(requiredModules.map((item) => [item.id, item]));
const modulePaths = new Set();
const allowedKinds = new Set(["reference", "example", "fixture"]);
const allowedStatuses = new Set(["planned", "implemented"]);
const packageRelativePath = (value, label) => {
  assert.equal(typeof value === "string" && value.length > 0, true, `${label} must be a non-empty path`);
  assert.doesNotMatch(value, /^(?:\/|~|[A-Za-z]:[\\/])/, `${label} must be package-relative: ${value}`);
  const candidate = resolve(packageRoot, value);
  assert.equal(insidePackage(candidate), true, `${label} escapes the package: ${value}`);
  return candidate;
};
for (const module of requiredModules) {
  assert.equal(allowedKinds.has(module.kind), true, `module ${module.id} has an invalid kind`);
  assert.equal(allowedStatuses.has(module.status), true, `module ${module.id} has an invalid status`);
  assert.equal(Number.isInteger(module.introduced_in_phase) && module.introduced_in_phase >= 0, true, `module ${module.id} needs introduced_in_phase`);
  const moduleFile = packageRelativePath(contractValue(module.path, `module ${module.id} path`), `module ${module.id} path`);
  assert.equal(modulePaths.has(module.path), false, `required_modules contains duplicate path: ${module.path}`);
  modulePaths.add(module.path);
  if (["implemented", "reviewed"].includes(contract.phase_status) && module.introduced_in_phase <= contract.phase) {
    assert.equal(module.status, "implemented", `module ${module.id} is not implemented by completed phase ${contract.phase}`);
  }
  if (module.status === "implemented") assert.ok(module.introduced_in_phase <= contract.phase, `implemented module ${module.id} is assigned to future phase ${module.introduced_in_phase}`);
  if (module.status === "implemented") assert.equal(await isFile(moduleFile), true, `implemented module is missing: ${module.path}`);
  if (module.normative === true) {
    const evidence = contractValue(module.evidence, `normative module ${module.id} evidence`);
    const evidenceClaims = contractArray(evidence.claim_ids, `normative module ${module.id} evidence.claim_ids`);
    assert.ok(typeof evidence.offline_proof === "string" && evidence.offline_proof.trim(), `normative module ${module.id} needs offline_proof evidence`);
    assert.ok(typeof evidence.cannot_prove === "string" && evidence.cannot_prove.trim(), `normative module ${module.id} needs cannot_prove evidence`);
    assert.ok(typeof evidence.operation_class === "string" && evidence.operation_class.trim(), `normative module ${module.id} needs operation_class evidence`);
  }
}
const moduleIdsByKind = (kind, label) => {
  const ids = contractArray(contract[label], `coverage contract ${label}`);
  for (const id of ids) {
    assert.equal(typeof id === "string" && id.length > 0, true, `${label} contains an invalid module ID`);
    assert.equal(moduleIds.has(id), true, `${label} references an unknown module ID: ${id}`);
    assert.equal(moduleById.get(id).kind, kind, `${label} references ${id}, which is not a ${kind}`);
  }
  const implementedIds = requiredModules.filter((item) => item.kind === kind && item.status === "implemented").map((item) => item.id).sort();
  assert.deepEqual([...ids].sort(), implementedIds, `${label} must list every implemented ${kind} module exactly once`);
  return ids;
};
moduleIdsByKind("reference", "required_references");
moduleIdsByKind("example", "required_examples");
moduleIdsByKind("fixture", "required_fixtures");

const surfaces = contractArray(contract.surfaces, "coverage contract surfaces");
uniqueIds(surfaces, "surfaces");
const surfaceClasses = new Set(["managed", "sample-package", "generic", "self-hosted", "legacy"]);
const seenSurfaceClasses = new Set();
for (const surface of surfaces) {
  assert.equal(surfaceClasses.has(surface.classification), true, `surface ${surface.id} has an invalid classification`);
  seenSurfaceClasses.add(surface.classification);
  assert.equal(Boolean(typeof surface.description === "string" && surface.description.trim()), true, `surface ${surface.id} needs a description`);
  if (surface.classification === "managed") assert.equal(surface.normative, true, "managed surface must be normative");
  else assert.equal(surface.normative, false, `${surface.classification} surface must not be normative`);
}
for (const classification of surfaceClasses) assert.equal(seenSurfaceClasses.has(classification), true, `coverage contract is missing the ${classification} surface classification`);

const sourceRecords = contractArray(contract.sources, "coverage contract sources");
uniqueIds(sourceRecords, "sources");
const sourceById = new Map();
for (const source of sourceRecords) {
  assert.ok(/^https:\/\//i.test(source.uri), `source ${source.id} needs an HTTPS URI`);
  assert.equal(sourceUrls.has(source.uri), true, `coverage source ${source.id} is missing from references/sources.md`);
  assert.ok(typeof source.kind === "string" && source.kind.trim(), `source ${source.id} needs a kind`);
  assert.match(source.observed_date, /^\d{4}-\d{2}-\d{2}$/, `source ${source.id} has invalid observed_date`);
  assert.equal(Number.isFinite(new Date(`${source.observed_date}T00:00:00Z`).getTime()), true, `source ${source.id} has invalid observed_date`);
  sourceById.set(source.id, source);
}

const claims = contractArray(contract.claims, "coverage contract claims");
uniqueIds(claims, "claims");
const claimById = new Map();
const sensitivityClasses = new Set(["mutable_service", "stable_conceptual", "target_specific", "official_repository", "scenario"]);
const ninetyDaySourceClasses = new Set(["mutable_service", "target_specific", "scenario"]);
const now = Date.now();
for (const claim of claims) {
  assert.equal(typeof claim.owner === "string" && claim.owner.length > 0, true, `claim ${claim.id} must have exactly one owner`);
  assert.equal(moduleById.has(claim.owner), true, `claim ${claim.id} has an unknown owner: ${claim.owner}`);
  assert.equal(moduleById.get(claim.owner).kind, "reference", `claim ${claim.id} owner must be a reference module`);
  const claimSources = contractArray(claim.source_ids, `claim ${claim.id} source_ids`);
  assert.ok(claimSources.length > 0, `claim ${claim.id} needs at least one source ID`);
  for (const sourceId of claimSources) {
    assert.equal(sourceById.has(sourceId), true, `claim ${claim.id} has an unresolved source ID: ${sourceId}`);
    const sourceObserved = new Date(`${sourceById.get(sourceId).observed_date}T00:00:00Z`).getTime();
    assert.equal(sourceObserved <= now, true, `claim ${claim.id} source ${sourceId} observed_date is in the future`);
  }
  assert.ok(typeof claim.heading_or_fragment === "string" && claim.heading_or_fragment.trim(), `claim ${claim.id} needs heading_or_fragment`);
  assert.match(claim.observed_date, /^\d{4}-\d{2}-\d{2}$/, `claim ${claim.id} has invalid observed_date`);
  const observed = new Date(`${claim.observed_date}T00:00:00Z`).getTime();
  assert.equal(Number.isFinite(observed), true, `claim ${claim.id} has invalid observed_date`);
  assert.equal(observed <= now, true, `claim ${claim.id} observed_date is in the future`);
  assert.equal(sensitivityClasses.has(claim.sensitivity_class), true, `claim ${claim.id} has an invalid sensitivity_class`);
  assert.ok(typeof claim.recheck_rule === "string" && claim.recheck_rule.trim(), `claim ${claim.id} needs a recheck_rule`);
  if (claim.sensitivity_class === "mutable_service") assert.match(claim.recheck_rule, /implementation/i, `claim ${claim.id} mutable source must recheck at implementation`);
  if (claim.sensitivity_class === "mutable_service") assert.match(claim.recheck_rule, /promotion/i, `claim ${claim.id} mutable source must recheck at promotion`);
  if (claim.sensitivity_class === "mutable_service") assert.match(claim.recheck_rule, /90\s*(?:day|d)/i, `claim ${claim.id} mutable source must recheck at least every 90 days`);
  if (claim.sensitivity_class === "stable_conceptual") assert.match(claim.recheck_rule, /implementation/i, `claim ${claim.id} stable source must recheck at implementation`);
  if (claim.sensitivity_class === "stable_conceptual") assert.match(claim.recheck_rule, /promotion/i, `claim ${claim.id} stable source must recheck at promotion`);
  if (claim.sensitivity_class === "stable_conceptual") assert.match(claim.recheck_rule, /180\s*(?:day|d)/i, `claim ${claim.id} stable source must recheck at least every 180 days`);
  if (["target_specific", "scenario"].includes(claim.sensitivity_class)) assert.match(claim.recheck_rule, /implementation/i, `claim ${claim.id} must recheck public sources at implementation`);
  if (["target_specific", "scenario"].includes(claim.sensitivity_class)) assert.match(claim.recheck_rule, /promotion/i, `claim ${claim.id} must recheck public sources at promotion`);
  if (["target_specific", "scenario"].includes(claim.sensitivity_class)) assert.match(claim.recheck_rule, /90\s*(?:day|d)/i, `claim ${claim.id} must recheck public sources at least every 90 days`);
  if (claim.sensitivity_class === "target_specific") assert.match(claim.recheck_rule, /runtime|region|palette|target/i, `claim ${claim.id} target-specific source needs target recheck rule`);
  if (claim.sensitivity_class === "official_repository") {
    for (const sourceId of claimSources) assert.ok(sourceById.get(sourceId).immutable_ref, `claim ${claim.id} uses official repository behavior without an immutable reference`);
  }
  const ageDays = (now - observed) / 86400000;
  if (ninetyDaySourceClasses.has(claim.sensitivity_class)) assert.ok(ageDays <= 90, `claim ${claim.id} freshness metadata is stale`);
  if (claim.sensitivity_class === "stable_conceptual") assert.ok(ageDays <= 180, `claim ${claim.id} freshness metadata is stale`);
  for (const sourceId of claimSources) {
    const sourceAgeDays = (now - new Date(`${sourceById.get(sourceId).observed_date}T00:00:00Z`).getTime()) / 86400000;
    if (ninetyDaySourceClasses.has(claim.sensitivity_class)) assert.ok(sourceAgeDays <= 90, `claim ${claim.id} source ${sourceId} freshness metadata is stale`);
    if (claim.sensitivity_class === "stable_conceptual") assert.ok(sourceAgeDays <= 180, `claim ${claim.id} source ${sourceId} freshness metadata is stale`);
  }
  claimById.set(claim.id, claim);
}
for (const claimId of ["FR-NODE-IDENTITY-001", "FR-DB-AQ-DETAIL-001", "FR-IOT-TRANSPORT-001", "FR-SCENARIO-NODE-CONTRACTS-001", "FR-IOT-EXTENSIONS-001", "FR-FLOW-LOGGING-NODES-001"]) {
  const claim = claimById.get(claimId);
  assert.ok(claim, `node capability claim is missing: ${claimId}`);
  const ownerPath = resolve(packageRoot, moduleById.get(claim.owner).path);
  assert.match(texts.get(ownerPath) ?? "", new RegExp(`\\b${claimId}\\b`), `node capability claim ${claimId} is missing from its owner`);
}

const operationClasses = contractArray(contract.live_operation_classes, "coverage contract live_operation_classes");
uniqueIds(operationClasses, "live_operation_classes");
const operationClassIds = new Set(operationClasses.map((item) => item.id));
for (const item of operationClasses) assert.ok(typeof item.effect === "string" && item.effect.trim(), `operation class ${item.id} needs an effect`);
for (const module of requiredModules) {
  if (module.normative !== true) continue;
  for (const claimId of module.evidence.claim_ids) assert.equal(claimById.has(claimId), true, `normative module ${module.id} has an unresolved evidence claim: ${claimId}`);
  assert.equal(operationClassIds.has(module.evidence.operation_class), true, `normative module ${module.id} has an unknown evidence operation class`);
}
const routingCases = contractArray(contract.routing_cases, "coverage contract routing_cases");
uniqueIds(routingCases, "routing_cases");
const routedAudiences = new Set();
for (const route of routingCases) {
  assert.ok(["author", "operator", "troubleshooter"].includes(route.audience), `route ${route.id} has an invalid audience`);
  routedAudiences.add(route.audience);
  assert.ok(typeof route.request === "string" && route.request.trim(), `route ${route.id} needs a request`);
  for (const moduleId of contractArray(route.expected_modules, `route ${route.id} expected_modules`)) assert.equal(moduleIds.has(moduleId), true, `route ${route.id} references an unknown module: ${moduleId}`);
  for (const claimId of contractArray(route.claim_ids, `route ${route.id} claim_ids`)) assert.equal(claimById.has(claimId), true, `route ${route.id} references an unknown claim: ${claimId}`);
  assert.ok(typeof route.boundary === "string" && route.boundary.trim(), `route ${route.id} needs a boundary`);
  assert.equal(operationClassIds.has(route.operation_class), true, `route ${route.id} has an unknown operation class: ${route.operation_class}`);
}
assert.deepEqual(routedAudiences, new Set(["author", "operator", "troubleshooter"]), "coverage routes must include author, operator, and troubleshooter audiences");
const proofs = contractArray(contract.offline_proof, "coverage contract offline_proof");
const cannotProve = contractArray(contract.cannot_prove, "coverage contract cannot_prove");
uniqueIds(proofs, "offline_proof");
uniqueIds(cannotProve, "cannot_prove");
for (const proof of proofs) assert.ok(typeof proof.id === "string" && typeof proof.statement === "string" && proof.statement.trim(), "offline proof entries need IDs and statements");
for (const limit of cannotProve) assert.ok(typeof limit.id === "string" && typeof limit.statement === "string" && limit.statement.trim(), "cannot_prove entries need IDs and statements");

const forwardTests = contractArray(contract.forward_tests, "coverage contract forward_tests");
const forwardTestIds = uniqueIds(forwardTests, "forward_tests");
assert.deepEqual(forwardTestIds, new Set(["FT01", "FT02", "FT03", "FT04", "FT05", "FT06", "FT07", "FT08", "FT09", "FT10", "FT11", "FT12", "FT13", "FT14", "FT15", "FT16"]), "coverage contract must contain FT01 through FT16");
for (const test of forwardTests) {
  assert.ok(typeof test.request === "string" && test.request.trim(), `forward test ${test.id} needs a request`);
  assert.equal(routingCases.some((route) => route.id === test.route), true, `forward test ${test.id} has an unknown route`);
  for (const moduleId of contractArray(test.expected_modules, `forward test ${test.id} expected_modules`)) assert.equal(moduleIds.has(moduleId), true, `forward test ${test.id} references an unknown module: ${moduleId}`);
  for (const claimId of contractArray(test.required_claims, `forward test ${test.id} required_claims`)) assert.equal(claimById.has(claimId), true, `forward test ${test.id} references an unknown required claim: ${claimId}`);
  for (const claimId of contractArray(test.source_claim_ids, `forward test ${test.id} source_claim_ids`)) assert.equal(claimById.has(claimId), true, `forward test ${test.id} references an unknown source claim: ${claimId}`);
  const forbiddenClaims = contractArray(test.forbidden_claims, `forward test ${test.id} forbidden_claims`);
  assert.ok(forbiddenClaims.length > 0, `forward test ${test.id} needs at least one forbidden claim`);
  for (const claim of forbiddenClaims) assert.ok(typeof claim === "string" && claim.trim(), `forward test ${test.id} has an invalid forbidden claim`);
  assert.ok(typeof test.offline_live_classification === "string" && ["offline", "live", "refuse", "live-gated"].includes(test.offline_live_classification), `forward test ${test.id} has an invalid offline/live classification`);
  assert.equal(operationClassIds.has(test.operation_class), true, `forward test ${test.id} has an unknown operation class`);
  assert.ok(typeof test.stop_or_handoff === "string" && test.stop_or_handoff.trim(), `forward test ${test.id} needs stop_or_handoff`);
}
const forwardTestById = new Map(forwardTests.map((item) => [item.id, item]));
assert.deepEqual(
  forwardTestById.get("FT08")?.expected_outcome,
  { decision: "clarify", reason: "ambiguous-name", target_availability: "unproven" },
  "forward test FT08 must not guess a colliding node identity or target availability"
);
assert.deepEqual(
  forwardTestById.get("FT10")?.expected_outcome,
  { decision: "reject", reason: "finite-reconnect-bound-required" },
  "forward test FT10 must reject unlimited dequeue retries"
);
assert.deepEqual(
  forwardTestById.get("FT12")?.expected_outcome,
  { decision: "compatibility-gate", polling: "finite", managed_availability: "unproven" },
  "forward test FT12 must keep ORDS polling finite and managed availability unproven"
);
assert.deepEqual(
  forwardTestById.get("FT15")?.expected_outcome,
  { decision: "reject-durability-claim", durable: false, commit_required: true },
  "forward test FT15 must reject unsupported standalone-DML durability"
);
assert.deepEqual(
  forwardTestById.get("FT16")?.expected_outcome,
  { decision: "reject-delivery-claim", publication: "accepted", subscriber_delivery: "unknown" },
  "forward test FT16 must separate publication acceptance from subscriber delivery"
);

for (const [sourcePath, value] of texts) {
  if (!sourcePath.endsWith(".md")) continue;
  for (const block of value.matchAll(/```(?:bash|sh|shell|zsh)\s*\n([\s\S]*?)```/gi)) {
    assert.doesNotMatch(block[1], /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\|~\/|\$\{?(?:HOME|CODEX_HOME)\}?)/, `${relative(packageRoot, sourcePath)} has a machine-specific shell command`);
    assert.doesNotMatch(block[1], /(?:^|[;&|]\s*)cd\s+/m, `${relative(packageRoot, sourcePath)} has a working-directory-dependent cd command`);
    assert.doesNotMatch(block[1], /(?:^|[\s"'])(?:\.\.\/|\/)[^\s"']*/m, `${relative(packageRoot, sourcePath)} has a shell path that escapes the package`);
    for (const line of block[1].split(/\r?\n/)) {
      const tokens = [...line.matchAll(/"([^"]*)"|'([^']*)'|([^\s]+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);
      for (const token of tokens) {
        if (!/\.(?:mjs|js|py|sh|json|md)$/.test(token)) continue;
        const commandPath = resolve(packageRoot, token.replace(/^\.\//, ""));
        assert.equal(insidePackage(commandPath), true, `shell command escapes package: ${token}`);
        assert.equal(await isFile(commandPath), true, `shell command references a missing package file: ${token}`);
      }
    }
  }
}

const combinedText = [...texts.values()].join("\n");
for (const pattern of forbiddenMaterialPatterns) {
  assert.equal(pattern.test(combinedText), false, `package contains forbidden live or secret material: ${pattern}`);
}

const flow = JSON.parse(await readFile(resolve(packageRoot, "assets/node-red/oci-iot-ingress-core.json"), "utf8"));
const fixture = JSON.parse(await readFile(resolve(packageRoot, "assets/oci-iot/telemetry-ingress-cases.json"), "utf8"));
assert.equal(Array.isArray(flow), true, "flow export must be an array");
assert.equal(fixture.scope, "offline-example", "fixture must remain an offline example");
assert.equal(Array.isArray(fixture.cases), true, "fixture cases must be an array");
const requiredCaseNames = [
  "HVAC example",
  "gateway example",
  "shared subscription example",
  "unsupported device type",
  "missing observation time",
  "numeric observation time",
  "invalid observation time",
  "malformed source topic",
  "empty external key",
  "malformed shared subscription",
  "malformed JSON payload"
];
assert.deepEqual(fixture.cases.map((item) => item.name), requiredCaseNames, "offline cases are missing, reordered, or renamed");

const allowedTypes = new Set(["tab", "inject", "function", "debug"]);
const ids = new Set(flow.map((node) => node.id));
assert.equal(ids.size, flow.length, "flow node IDs must be unique");
for (const node of flow) {
  assert.equal(allowedTypes.has(node.type), true, `unexpected flow node type: ${node.type}`);
  for (const wire of (node.wires ?? []).flat()) assert.equal(ids.has(wire), true, `missing wire target: ${wire}`);
}

const tabs = flow.filter((node) => node.type === "tab");
const injects = flow.filter((node) => node.type === "inject");
const functions = flow.filter((node) => node.type === "function");
const debugs = flow.filter((node) => node.type === "debug");
assert.equal(tabs.length, 1, "flow must contain exactly one tab");
assert.equal(injects.length, 1, "flow must contain exactly one Inject node");
assert.equal(functions.length, 1, "flow must contain exactly one function node");
assert.equal(debugs.length, 1, "flow must contain exactly one Debug node");
const [functionNode] = functions;
for (const node of [...injects, ...functions, ...debugs]) assert.equal(node.z, tabs[0].id, `${node.type} node must belong to the sole flow tab`);
assert.deepEqual(injects[0].wires, [[functionNode.id]], "Inject must wire directly to function");
assert.deepEqual(functionNode.wires, [[debugs[0].id]], "function must wire directly to Debug");

const allowedImports = new Set(["node:assert/strict", "node:crypto", "node:fs/promises", "node:path", "node:url", "node:util", "./verify-runtime.mjs", "./verify-workflows.mjs", "./verify-node-capabilities.mjs"]);
const jsTrivia = String.raw`(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n\u2028\u2029]*(?:\r\n|[\r\n\u2028\u2029]|$))*`;
const staticImportFromPattern = new RegExp(`\\bimport${jsTrivia}[\\s\\S]*?\\bfrom${jsTrivia}["']([^"']+)["']`, "g");
const sideEffectImportPattern = new RegExp(`\\bimport${jsTrivia}["']([^"']+)["']`, "g");
const dynamicImportPattern = new RegExp(`\\bimport${jsTrivia}\\(${jsTrivia}["']([^"']+)["']${jsTrivia}\\)`, "g");
const dynamicImportStartPattern = new RegExp(`\\bimport${jsTrivia}\\(`, "g");
const exportFromPattern = new RegExp(`\\bexport${jsTrivia}[\\s\\S]*?\\bfrom${jsTrivia}["']([^"']+)["']`, "g");
for (const [path, value] of texts) {
  if (!executableTextExtensions.has(extname(basename(path)).toLowerCase())) continue;
  const canonicalValue = canonicalizeJavaScriptIdentifiers(value);
  const staticImports = [
    ...canonicalValue.matchAll(staticImportFromPattern),
    ...canonicalValue.matchAll(sideEffectImportPattern),
    ...canonicalValue.matchAll(exportFromPattern)
  ].map((match) => match[1]);
  const dynamicImportMatches = [...canonicalValue.matchAll(dynamicImportPattern)];
  const dynamicImportStarts = [...canonicalValue.matchAll(dynamicImportStartPattern)];
  assert.equal(dynamicImportMatches.length, dynamicImportStarts.length, `${relative(packageRoot, path)} contains a non-literal dynamic import`);
  const imports = [...staticImports, ...dynamicImportMatches.map((match) => match[1])];
  for (const specifier of imports) {
    const validatorVmImport = relative(packageRoot, path) === "scripts/verify-portable.mjs" && specifier === "node:vm";
    assert.equal(allowedImports.has(specifier) || validatorVmImport, true, `${relative(packageRoot, path)} imports a non-allowlisted module: ${specifier}`);
  }
}
const forbiddenCodePatterns = [
  new RegExp("\\bfet" + "ch\\b", "i"),
  new RegExp("\\brequ" + `ire${jsTrivia}\\(`, "i"),
  new RegExp("\\bWeb" + "Socket\\b", "i"),
  new RegExp("\\bXMLHttp" + "Request\\b", "i"),
  new RegExp("\\bglobal" + "This\\b", "i"),
  new RegExp("\\bpro" + "cess\\b", "i"),
  new RegExp("\\bDe" + "no\\b", "i"),
  new RegExp("\\bB" + "un\\b", "i"),
  new RegExp("\\bev" + "al\\b", "i"),
  new RegExp("\\bFun" + "ction\\b"),
  new RegExp("\\bconstr" + "uctor\\b", "i"),
  new RegExp("\\bglo" + "bal\\b", "i")
];
for (const [path, value] of texts) {
  if (!executableTextExtensions.has(extname(basename(path)).toLowerCase())) continue;
  const canonicalValue = canonicalizeJavaScriptIdentifiers(value);
  for (const pattern of forbiddenCodePatterns) assert.doesNotMatch(canonicalValue, pattern, `${relative(packageRoot, path)} contains a forbidden network-capable API: ${pattern}`);
}
const canonicalFunctionCode = canonicalizeJavaScriptIdentifiers(functionNode.func);
for (const pattern of forbiddenCodePatterns) assert.doesNotMatch(canonicalFunctionCode, pattern, `flow function contains a forbidden network-capable API: ${pattern}`);
const forbiddenFunctionPatterns = [new RegExp("\\bimp" + `ort${jsTrivia}\\(`, "i")];
for (const pattern of forbiddenFunctionPatterns) assert.doesNotMatch(canonicalFunctionCode, pattern, `flow function contains a forbidden dynamic import: ${pattern}`);

// Load executable focused checks only after every package file and flow
// function has passed the byte, import, and network-capability preflight.
await import("./verify-runtime.mjs");
await import("./verify-workflows.mjs");
await import("./verify-node-capabilities.mjs");

// Independent anchors prevent synchronized changes to the focused node
// verifier and fixtures from redefining the highest-risk contracts.
const pinnedSampleRevision = "d1f886fed04f456b28527d578be140fbc7a6c2f1";
for (const sourceId of ["O7", "S4"]) {
  const source = sourceById.get(sourceId);
  assert.equal(source?.immutable_ref, pinnedSampleRevision, `hardcoded ${sourceId} immutable revision contract failed`);
  assert.match(source?.uri ?? "", new RegExp(pinnedSampleRevision), `hardcoded ${sourceId} pinned URI contract failed`);
}

const identityCasesFixture = JSON.parse(await readFile(resolve(packageRoot, "assets/nodes/node-identity-cases.json"), "utf8"));
const identityCasesById = new Map(identityCasesFixture.cases.map((item) => [item.caseId, item]));
const nodeCapabilityMatrix = texts.get(resolve(packageRoot, "references/node-capability-matrix.md")) ?? "";
assert.match(
  nodeCapabilityMatrix,
  /\| Managed editor \| `iot-config` \| `OCI Config` \|[^\n]+OCI configuration[^\n]+`managed-documented`[^\n]+`O1`/,
  "hardcoded managed iot-config source-owned matrix record failed"
);
assert.match(
  nodeCapabilityMatrix,
  /\| Sample package \| `iot-config` \|[^\n]+device MQTT[^\n]+Device credentials\/certificate and MQTTS session[^\n]+`sample-package`[^\n]+`S4`/,
  "hardcoded sample device iot-config source-owned matrix record failed"
);
assert.match(
  nodeCapabilityMatrix,
  /\| Sample package \| `oci-config` \|[^\n]+OCI SDK\/API authentication[^\n]+`sample-package`[^\n]+`S4`/,
  "hardcoded sample oci-config source-owned matrix record failed"
);
for (const type of ["oci-object-storage", "oci-notification", "ords-config", "oci-ords-request", "oci-ords-poll", "oci-logging", "oci-log-analytics"]) {
  assert.match(nodeCapabilityMatrix, new RegExp("\\| Sample package \\| `" + type + "`"), `hardcoded optional node identity record failed: ${type}`);
}
assert.deepEqual(
  identityCasesById.get("bare-iot-config-requires-clarification")?.expected,
  { decision: "clarify", reason: "ambiguous-name", candidateIdentities: ["managed-iot-config", "sample-device-iot-config"], authenticationFamilies: ["oci-configuration", "device-mqtts"], sourceOwners: ["O1", "S4"] },
  "hardcoded iot-config collision contract failed"
);
assert.deepEqual(
  [identityCasesById.get("sample-device-iot-config-context")?.expected?.authenticationFamily, identityCasesById.get("sample-cloud-oci-config-context")?.expected?.authenticationFamily],
  ["device-mqtts", "oci-api"],
  "hardcoded device and OCI authentication-family separation failed"
);

const databaseCasesFixture = JSON.parse(await readFile(resolve(packageRoot, "assets/nodes/database-aq-contract-cases.json"), "utf8"));
const databaseCasesById = new Map(databaseCasesFixture.cases.map((item) => [item.caseId, item]));
assert.deepEqual(databaseCasesById.get("transaction-commit")?.expected, { state: "committed", durable: true, closed: true }, "hardcoded transaction commit durability contract failed");
assert.deepEqual(databaseCasesById.get("transaction-rollback")?.expected, { state: "rolled-back", durable: false, closed: true }, "hardcoded transaction rollback contract failed");
assert.deepEqual(databaseCasesById.get("continuous-dequeue-zero-retries-invalid")?.expected, { decision: "reject", reason: "finite-max-retries-required", sourceNormalization: "unlimited" }, "hardcoded finite dequeue retry contract failed");
assert.deepEqual(databaseCasesById.get("continuous-dequeue-missing-finite-bound-invalid")?.expected, { decision: "reject", reason: "finite-max-retries-required", sourceNormalization: "unlimited" }, "hardcoded missing dequeue retry bound contract failed");
assert.deepEqual(databaseCasesById.get("continuous-multi-consumer-zero-retries-rejected")?.expected, { decision: "reject", reason: "finite-max-retries-required", sourceNormalization: "unlimited" }, "hardcoded multi-consumer finite retry composition failed");
assert.deepEqual(databaseCasesById.get("continuous-multi-consumer-shutdown-stops")?.expected, { decision: "stopped", break: true, closed: true, retry: false }, "hardcoded multi-consumer shutdown composition failed");
assert.equal(databaseCasesById.get("continuous-dequeue-fractional-delay-valid")?.expected?.retryDelayMs, 1.5, "hardcoded fractional dequeue retry-delay normalization failed");
assert.equal(databaseCasesById.get("continuous-dequeue-numeric-text-delay-normalizes")?.expected?.retryDelayMs, 250, "hardcoded numeric-text dequeue retry-delay normalization failed");
assert.deepEqual(databaseCasesById.get("dequeue-standalone-empty-still-commits-and-closes")?.expected, { decision: "no-work", retry: false, queueFailure: false, commit: true, autoCommit: true, closed: true, outputs: 0 }, "hardcoded standalone empty-dequeue commit contract failed");
assert.deepEqual(databaseCasesById.get("dequeue-empty-no-work")?.expected, { decision: "no-work", retry: false, queueFailure: false, commit: true, autoCommit: true, closed: true, outputs: 0 }, "hardcoded absent-transaction empty-dequeue commit contract failed");
assert.deepEqual(databaseCasesById.get("dequeue-transaction-owned-empty-defers-commit")?.expected, { decision: "no-work", retry: false, queueFailure: false, commit: false, autoCommit: false, commitOwner: "end-transaction", outputs: 0 }, "hardcoded transaction-owned empty-dequeue contract failed");
assert.deepEqual(databaseCasesById.get("dequeue-standalone-browse-no-durable-removal")?.expected, { decision: "accepted", read: true, removed: false, durableRemoval: false, autoCommit: true, closed: true, outputs: 1 }, "hardcoded standalone browse removal contract failed");
assert.deepEqual(databaseCasesById.get("enqueue-missing-recipients-optional")?.expected, { decision: "accepted-shape", recipientsUsed: false, recipientsOptional: true, dequeueSubscriberUsed: false }, "hardcoded optional enqueue recipients contract failed");
assert.deepEqual(databaseCasesById.get("sql-standalone-dml-no-commit")?.expected, { decision: "accepted-non-durable", durable: false, commitRequired: true, closeOutcome: "rolls-back" }, "hardcoded standalone DML durability contract failed");
assert.deepEqual(databaseCasesById.get("sql-msg-sql-does-not-inherit-editor-rule")?.expected, { decision: "separate-source-contract", editorRuleApplied: false, anonymousPlsqlAllowed: true }, "hardcoded msg.sql source-mode contract failed");
for (const caseId of ["sql-editor-validation-order-before-binds", "sql-editor-multiple-statements-active-transaction-row-limit", "sql-editor-plsql-appended-sql-rejected"]) {
  assert.equal(databaseCasesById.get(caseId)?.expected?.reason, "single-statement-required", `hardcoded SQL structural preflight ordering failed: ${caseId}`);
  assert.equal(databaseCasesById.get(caseId)?.expected?.beforeDispatch, true, `hardcoded SQL structural preflight dispatch boundary failed: ${caseId}`);
}
assert.deepEqual(databaseCasesById.get("sql-bind-scan-ignores-literals-and-comments")?.expected, { decision: "accepted-shape", bindParity: true, source: "Editor" }, "hardcoded SQL literal/comment bind scan contract failed");
assert.equal(databaseCasesById.get("sql-named-bind-closed-transaction-rejected-after-bind-validation")?.expected?.reason, "transaction-context-already-ended", "hardcoded SQL bind/transaction composition failed");
assert.equal(databaseCasesById.get("sql-active-transaction-placeholders-without-bind-mode-rejected")?.expected?.reason, "bind-parity-mismatch", "hardcoded implicit SQL bind validation failed");
for (const caseId of ["sql-named-placeholder-positional-mode-rejected", "sql-positional-placeholder-named-mode-rejected", "sql-no-placeholder-extra-named-bind-rejected", "sql-positional-gap-rejected"]) {
  assert.equal(databaseCasesById.get(caseId)?.expected?.reason, "bind-parity-mismatch", `hardcoded exact SQL bind-family/parity contract failed: ${caseId}`);
}
assert.equal(databaseCasesById.get("sql-named-bind-row-limit-continues-to-row-outcome")?.expected?.rowOutcome, "within-limit", "hardcoded SQL bind/row-limit composition failed");
assert.equal(databaseCasesById.get("sql-editor-concatenated-plsql-regex-heuristic")?.expected?.sourceBehavior, "regex-heuristic-accepts-concatenated-blocks", "hardcoded anonymous PL/SQL heuristic boundary failed");

const iotCasesFixture = JSON.parse(await readFile(resolve(packageRoot, "assets/nodes/iot-node-contract-cases.json"), "utf8"));
const iotCasesById = new Map(iotCasesFixture.cases.map((item) => [item.caseId, item]));
assert.deepEqual(iotCasesById.get("subscription-does-not-auto-ack-command")?.expected, { valid: true, acknowledgement: "none", route: "explicit-response-node-required" }, "hardcoded subscription acknowledgement contract failed");
assert.deepEqual(iotCasesById.get("ords-unbounded-poll-is-rejected")?.expected, { valid: false, route: "reject", reason: "poll timeout must be finite" }, "hardcoded bounded ORDS polling rejection failed");
assert.equal(iotCasesById.get("notifications-publish-accepted-not-delivered")?.expected?.subscriberDelivery, "unknown", "hardcoded Notifications publication/delivery boundary failed");
assert.deepEqual(
  [iotCasesById.get("flow-logging-is-distinct-from-runtime-console")?.expected?.route, iotCasesById.get("runtime-console-logging-does-not-select-flow-node")?.expected?.route],
  ["flow-originated-logging", "runtime-system-console"],
  "hardcoded runtime and flow-originated logging separation failed"
);
assert.deepEqual(
  iotCasesById.get("relationship-update-requires-exact-string-key-and-content-precedence")?.expected,
  { valid: true, keyShape: "sourceTwinOcid->targetTwinOcid:contentPath", parsed: { source: "fixture-source", target: "fixture-target", contentPath: "fixture-related" }, contentUsed: "message", updateAcceptance: "unknown", route: "compatibility-gate" },
  "hardcoded relationship-key grammar contract failed"
);
assert.deepEqual(iotCasesById.get("telemetry-null-payload-auto-timestamp-errors-before-publish")?.expected, { valid: false, route: "node-error", reason: "null-payload-timestamp-TypeError", beforePublish: true }, "hardcoded telemetry null timestamp failure contract failed");
assert.equal(iotCasesById.get("telemetry-null-qos-does-not-override-configured")?.expected?.qos, 2, "hardcoded telemetry null QoS fallback contract failed");
for (const caseId of ["telemetry-empty-runtime-qos-normalizes-to-zero", "telemetry-null-configured-qos-normalizes-to-zero", "telemetry-empty-configured-qos-normalizes-to-zero"]) {
  assert.equal(iotCasesById.get(caseId)?.expected?.qos, 0, `hardcoded telemetry source QoS normalization failed: ${caseId}`);
}
for (const caseId of ["subscription-null-config-qos-normalizes-to-zero", "subscription-empty-config-qos-normalizes-to-zero"]) {
  assert.equal(iotCasesById.get(caseId)?.expected?.effectiveQos, 0, `hardcoded subscription source QoS normalization failed: ${caseId}`);
}
assert.deepEqual(iotCasesById.get("telemetry-array-payload-without-auto-timestamp-preserves-array")?.expected?.payload, [1, { value: 2 }], "hardcoded telemetry array pass-through contract failed");
assert.equal(iotCasesById.get("relationship-explicit-empty-top-level-bypasses-configured-default")?.expected?.selectedKey, "payload-source->payload-target:payload-path", "hardcoded relationship explicit-empty precedence contract failed");

const optionalCasesFixture = JSON.parse(await readFile(resolve(packageRoot, "assets/nodes/optional-oci-node-contract-cases.json"), "utf8"));
const optionalCasesById = new Map(optionalCasesFixture.cases.map((item) => [item.caseId, item]));
assert.deepEqual(optionalCasesById.get("ords-poll-custom-times-out-finitely")?.expected, { decision: "bounded-result", pollComplete: false, pollTimedOut: true, pollAttempts: 3, genericRetry: false }, "hardcoded bounded ORDS polling contract failed");
assert.deepEqual(optionalCasesById.get("ords-poll-custom-default-items-not-empty-completes")?.expected, { decision: "bounded-result", pollComplete: true, pollTimedOut: false, pollAttempts: 1, genericRetry: false }, "hardcoded ORDS custom-success defaults failed");
assert.deepEqual(optionalCasesById.get("ords-poll-incomplete-response-timeline-does-not-prove-timeout")?.expected, { decision: "insufficient-timeline", pollComplete: false, pollTimedOut: "unproven", pollAttempts: 2, genericRetry: false }, "hardcoded incomplete ORDS timeline evidence boundary failed");
assert.equal(optionalCasesById.get("notification-payload-fallback-json-stringifies")?.expected?.subscriberDelivery, "unknown", "hardcoded package Notifications publication/delivery boundary failed");
assert.deepEqual(optionalCasesFixture.contracts["oci-notification"]?.outputs, ["msg.payload", "msg.statusCode"], "hardcoded Notifications output-shape contract failed");
assert.equal(optionalCasesById.get("object-runtime-values-override-configured")?.expected?.effective?.objectName, "runtime-object", "hardcoded Object Storage runtime-first precedence contract failed");
assert.equal(optionalCasesById.get("object-configured-download-without-runtime-operation-takes-download-branch")?.expected?.branch, "download", "hardcoded Object Storage configured-operation dispatch failed");
assert.equal(optionalCasesById.get("object-runtime-download-overrides-config-upload-and-takes-download-branch")?.expected?.runtimeOperationOverridesConfigured, true, "hardcoded Object Storage runtime-operation dispatch failed");
assert.equal(optionalCasesById.get("object-missing-namespace-before-service-call")?.expected?.serviceCall, false, "hardcoded Object Storage namespace validation failed");
assert.equal(optionalCasesById.get("object-missing-bucket-before-service-call")?.expected?.serviceCall, false, "hardcoded Object Storage bucket validation failed");
assert.equal(optionalCasesById.get("object-unsupported-operation-errors")?.expected?.apiCall, false, "hardcoded Object Storage operation validation failed");
assert.equal(optionalCasesById.get("object-upload-without-payload-or-file-errors")?.expected?.apiCall, false, "hardcoded Object Storage upload-body validation failed");
assert.deepEqual(optionalCasesById.get("ords-config-omitted-limits-use-finite-input-defaults")?.expected, { decision: "accepted-shape", requestTimeoutMs: 30000, tokenExpiryFallbackMins: 60, maxConcurrentPolls: 5, maxQueuedPolls: 100, bounded: true }, "hardcoded ORDS config defaults contract failed");
assert.deepEqual(optionalCasesById.get("ords-config-missing-credentials-errors")?.expected?.reasons, ["missing Client ID", "missing Client Secret"], "hardcoded ORDS credential validation contract failed");
assert.deepEqual(optionalCasesById.get("ords-poll-refused-is-source-terminal")?.expected, { decision: "accepted-shape", path: "/20250531/rawCommandData/fixture-record-refused", pollComplete: true, pollTimedOut: false, pollAttempts: 2, deliveryStatus: "REFUSED", finite: true }, "hardcoded ORDS REFUSED terminal contract failed");
assert.deepEqual(optionalCasesById.get("ords-poll-not-responded-is-source-terminal")?.expected?.deliveryStatus, "NOT_RESPONDED", "hardcoded ORDS NOT_RESPONDED terminal contract failed");
assert.deepEqual(optionalCasesById.get("ords-poll-deadline-excludes-next-command-at-boundary")?.expected, { decision: "accepted-shape", path: "/20250531/rawCommandData/fixture-record-deadline-command", pollComplete: false, pollTimedOut: true, pollAttempts: 1, deliveryStatus: "PENDING", finite: true }, "hardcoded ORDS command deadline contract failed");
assert.deepEqual(optionalCasesById.get("ords-poll-deadline-excludes-next-custom-at-boundary")?.expected, { decision: "bounded-result", pollComplete: false, pollTimedOut: true, pollAttempts: 1, genericRetry: false }, "hardcoded ORDS custom deadline contract failed");
for (const caseId of ["ords-poll-response-envelope-items-first-item", "ords-poll-response-envelope-item-object", "ords-poll-response-envelope-value-object"]) {
  assert.deepEqual([optionalCasesById.get(caseId)?.expected?.pollComplete, optionalCasesById.get(caseId)?.expected?.deliveryStatus], [true, "COMPLETED"], `hardcoded ORDS response-envelope contract failed: ${caseId}`);
}
assert.deepEqual([optionalCasesById.get("ords-poll-response-data-without-delivery-status-completes-without-undefined")?.expected?.pollComplete, optionalCasesById.get("ords-poll-response-data-without-delivery-status-completes-without-undefined")?.expected?.deliveryStatus], [true, null], "hardcoded ORDS response-only null-status contract failed");
assert.equal(optionalCasesById.get("ords-request-config-fallback-without-query-params")?.expected?.bodySource, "none", "hardcoded ORDS request optional-query fallback failed");
assert.equal(optionalCasesById.get("ords-request-get-ignores-runtime-payload")?.expected?.bodySource, "none", "hardcoded ORDS GET body boundary failed");
assert.equal(optionalCasesById.get("ords-request-configured-body-precedes-runtime-payload")?.expected?.bodySource, "configured-body", "hardcoded ORDS configured-body precedence failed");
for (const caseId of ["ords-request-missing-custom-path-errors", "ords-poll-config-command-missing-record-errors", "ords-poll-runtime-absolute-custom-path-errors", "ords-poll-custom-missing-path-errors"]) {
  assert.equal(optionalCasesById.get(caseId)?.expected?.decision, "node-error", `hardcoded ORDS path/record validation failed: ${caseId}`);
}
for (const caseId of ["ords-request-explicit-null-custom-path-does-not-fall-back", "ords-request-scheme-relative-custom-path-errors", "ords-request-runtime-ftp-custom-path-errors", "ords-request-whitespace-absolute-custom-path-errors", "ords-request-unsupported-method-errors", "ords-poll-scheme-relative-custom-path-errors", "ords-poll-runtime-ftp-custom-path-errors", "ords-poll-whitespace-absolute-custom-path-errors"]) {
  assert.equal(optionalCasesById.get(caseId)?.expected?.decision, "node-error", `hardcoded ORDS relative-path/method validation failed: ${caseId}`);
}
assert.deepEqual(
  [optionalCasesById.get("ords-request-configured-query-fallback")?.expected?.queryQ, optionalCasesById.get("ords-request-runtime-json-string-is-not-double-encoded")?.expected?.queryQ, optionalCasesById.get("ords-request-runtime-query-params-q-overrides-query")?.expected?.queryQ],
  ['{"state":"configured"}', '{"state":"runtime"}', "override"],
  "hardcoded ORDS query resolution/precedence failed"
);
assert.equal(Object.hasOwn(optionalCasesById.get("ords-request-null-query-omits-q")?.expected ?? {}, "queryQ"), false, "hardcoded ORDS null-query omission failed");
for (const caseId of ["ords-request-query-params-null-q-omits-q", "ords-request-query-params-empty-q-omits-q"]) {
  assert.equal(Object.hasOwn(optionalCasesById.get(caseId)?.expected ?? {}, "queryQ"), false, `hardcoded ORDS empty query-parameter omission failed: ${caseId}`);
}
assert.equal(optionalCasesById.get("ords-request-query-params-object-q-serializes-and-null-limit-omits")?.expected?.queryQ, '{"state":"runtime"}', "hardcoded ORDS object query-parameter serialization failed");
assert.equal(Object.hasOwn(optionalCasesById.get("ords-request-query-params-object-q-serializes-and-null-limit-omits")?.expected ?? {}, "queryLimit"), false, "hardcoded ORDS null query-limit omission failed");
assert.equal(optionalCasesById.get("ords-request-whitespace-configured-body-falls-back-to-payload")?.expected?.bodySource, "msg.payload", "hardcoded ORDS whitespace body fallback failed");
assert.equal(optionalCasesById.get("ords-request-invalid-configured-body-errors")?.expected?.decision, "node-error", "hardcoded ORDS configured-body validation failed");
assert.equal(optionalCasesById.get("ords-request-whitespace-record-id-is-not-appended")?.expected?.path, "/fixture", "hardcoded ORDS whitespace record-ID handling failed");
assert.equal(optionalCasesById.get("ords-config-malformed-https-url-errors")?.expected?.decision, "config-error", "hardcoded ORDS URL parsing failed");
assert.equal(optionalCasesById.get("ords-config-uppercase-https-url-is-valid")?.expected?.decision, "accepted-shape", "hardcoded ORDS URL protocol normalization failed");
for (const caseId of ["ords-request-invalid-configured-method-precedes-runtime-method", "ords-request-object-configured-headers-error", "ords-request-reserved-query-key-errors"]) {
  assert.equal(optionalCasesById.get(caseId)?.expected?.decision, "node-error", `hardcoded ORDS request validation failed: ${caseId}`);
}
assert.equal(optionalCasesById.get("ords-request-configured-method-validates-before-missing-path")?.expected?.reason, "Unsupported ORDS method: TRACE", "hardcoded ORDS configured-method validation order failed");
assert.equal(optionalCasesById.get("ords-request-runtime-header-json-string-errors")?.expected?.reason, "msg.headers must be an object", "hardcoded ORDS runtime-header shape failed");
assert.equal(optionalCasesById.get("ords-request-configured-null-header-json-is-empty")?.expected?.decision, "accepted-shape", "hardcoded ORDS configured-null header normalization failed");
for (const caseId of ["ords-request-runtime-object-header-value-errors", "ords-request-runtime-null-header-value-errors"]) {
  assert.match(optionalCasesById.get(caseId)?.expected?.reason ?? "", /must be a string, number, boolean, or array/, `hardcoded ORDS header-value validation failed: ${caseId}`);
}
for (const caseId of ["ords-request-array-query-params-are-ignored", "ords-request-string-query-params-are-ignored"]) {
  assert.equal(optionalCasesById.get(caseId)?.expected?.queryQ, '{"state":"configured"}', `hardcoded ORDS non-object queryParams handling failed: ${caseId}`);
}
assert.deepEqual(
  [optionalCasesById.get("ords-poll-runtime-query-params-q-overrides-query")?.expected?.queryQ, optionalCasesById.get("ords-poll-runtime-query-params-q-overrides-query")?.expected?.queryLimit],
  ["override", "2"],
  "hardcoded ORDS poll query resolution/precedence failed"
);
assert.deepEqual(
  [optionalCasesById.get("ords-poll-omitted-bounds-use-finite-defaults")?.expected?.intervalMs, optionalCasesById.get("ords-poll-omitted-bounds-use-finite-defaults")?.expected?.timeoutMs],
  [2000, 60000],
  "hardcoded ORDS poll default bounds failed"
);
assert.deepEqual(
  [optionalCasesById.get("ords-poll-configured-bounds-clamp-to-maximum")?.expected?.intervalMs, optionalCasesById.get("ords-poll-configured-bounds-clamp-to-maximum")?.expected?.timeoutMs],
  [300000, 3600000],
  "hardcoded ORDS poll maximum bounds failed"
);
assert.deepEqual(
  [optionalCasesById.get("ords-poll-runtime-numeric-text-bounds-normalize")?.expected?.intervalMs, optionalCasesById.get("ords-poll-invalid-runtime-bounds-fall-back-to-configured")?.expected?.intervalMs],
  [1000, 1500],
  "hardcoded ORDS poll runtime normalization failed"
);
assert.equal(optionalCasesById.get("ords-poll-whitespace-command-record-follows-source-path")?.expected?.path, "/20250531/rawCommandData/", "hardcoded ORDS poll whitespace-record source fidelity failed");
assert.deepEqual(
  Object.fromEntries(Object.entries(optionalCasesFixture.contracts).map(([name, value]) => [name, [value.configurationParent, value.authFamily]])),
  {
    "oci-object-storage": ["oci-config", "oci-api"],
    "oci-notification": ["oci-config", "oci-api"],
    "ords-config": [null, "HTTPS OAuth client credentials"],
    "oci-ords-request": ["ords-config", "ORDS bearer token"],
    "oci-ords-poll": ["ords-config", "ORDS bearer token"],
    "oci-logging": ["oci-config", "OCI Logging Ingestion API"],
    "oci-log-analytics": ["oci-config", "OCI Log Analytics upload API"],
    "iot-get-content-distinction": ["oci-config", "OCI IoT SDK"]
  },
  "hardcoded optional-node parent/authentication contracts failed"
);
assert.deepEqual(
  optionalCasesFixture.finiteBounds,
  {
    ordsRequestTimeoutMs: { minimum: 1000, maximum: 300000, default: 30000 },
    ordsTokenExpiryFallbackMins: { minimum: 1, maximum: 1440, default: 60 },
    ordsMaxConcurrentPolls: { minimum: 1, maximum: 100, default: 5 },
    ordsMaxQueuedPolls: { minimum: 0, maximum: 10000, default: 100 },
    pollIntervalMs: { minimum: 1, maximum: 300000, default: 2000 },
    pollTimeoutMs: { minimum: 1, maximum: 3600000, default: 60000 },
    logEntryBytes: { maximumExclusive: 1048576 },
    implicitRetries: { ords401Refresh: 1, genericResend: 0 }
  },
  "hardcoded optional-node finite bounds failed"
);

const runFunction = (input) => {
  const diagnostics = [];
  const msg = structuredClone(input);
  const node = {
    warn: (message) => diagnostics.push(message),
    error: (message) => diagnostics.push(message)
  };
  const output = runInNewContext(`(function (msg, node) {\n${functionNode.func}\n})(msg, node)`, { msg, node }, { timeout: 1000 });
  return { output: output === null ? null : structuredClone(output), diagnostics };
};

for (const testCase of fixture.cases) {
  const result = runFunction(testCase.input);
  if (testCase.expected.output === null) {
    assert.equal(result.output, null, `${testCase.name}: expected no output`);
    assert.ok(result.diagnostics.length > 0, `${testCase.name}: expected a diagnostic`);
  } else {
    assert.deepEqual(result.output, testCase.expected, `${testCase.name}: output mismatch`);
  }
}

const hardcodedChecks = [
  {
    input: { topic: "source/hvacs/portable-check", payload: { time: "2026-01-15T00:00:00Z", value: 1 } },
    expectedTopic: "hvacs/portable-check"
  },
  {
    input: { topic: "source/gateway/portable-check", payload: { time: "2026-01-15T00:00:00Z", value: 1 } },
    expectedTopic: "data"
  },
  {
    input: { topic: "$share/portable-group/source/hvacs/portable-check", payload: { time: "2026-01-15T00:00:00Z", value: 1 } },
    expectedTopic: "hvacs/portable-check"
  }
];
for (const check of hardcodedChecks) {
  const result = runFunction(check.input);
  assert.equal(result.output?.topic, check.expectedTopic, `hardcoded routing contract failed for ${check.input.topic}`);
  assert.equal(result.output?.payload, JSON.stringify(check.input.payload), `hardcoded payload serialization failed for ${check.input.topic}`);
  assert.deepEqual(result.output?._example, { sourceTopic: check.input.topic, targetTopic: check.expectedTopic }, `hardcoded trace metadata failed for ${check.input.topic}`);
}

const hardcodedRejections = [
  { topic: "source/pumps/portable-check", payload: { time: "2026-01-15T00:00:00Z" } },
  { topic: "source/hvacs/portable-check", payload: {} },
  { topic: "source/hvacs/portable-check", payload: { time: 1768435200 } },
  { topic: "source/hvacs/portable-check", payload: { time: "not-a-time" } },
  { topic: "source/hvacs", payload: { time: "2026-01-15T00:00:00Z" } },
  { topic: "source/hvacs/", payload: { time: "2026-01-15T00:00:00Z" } },
  { topic: "$share//source/hvacs/portable-check", payload: { time: "2026-01-15T00:00:00Z" } },
  { topic: "source/hvacs/portable-check", payload: [] },
  { topic: "source/hvacs/portable-check", payload: "{\"time\":" }
];
for (const input of hardcodedRejections) {
  const result = runFunction(input);
  assert.equal(result.output, null, `hardcoded rejection contract accepted ${input.topic}`);
  assert.ok(result.diagnostics.length > 0, `hardcoded rejection contract omitted a diagnostic for ${input.topic}`);
}

// Independent anchors prevent a synchronized change to a focused verifier and
// its fixture from redefining the highest-risk package contracts unnoticed.
const batchFixture = JSON.parse(await readFile(resolve(packageRoot, "assets/batch/batch-ingestion-cases.json"), "utf8"));
const gatewayBatch = batchFixture.cases.find(({ name }) => name === "valid gateway row");
const missingBatch = batchFixture.cases.find(({ name }) => name === "missing object");
const failedBatch = batchFixture.cases.find(({ name }) => name === "download failure leaves index unchanged");
const numericBatchTime = batchFixture.cases.find(({ name }) => name === "numeric timestamp boundary");
const emptyBatchNumber = batchFixture.cases.find(({ name }) => name === "empty numeric cell is rejected");
const mismatchedBatch = batchFixture.cases.find(({ name }) => name === "requested object does not match counter");
const invalidCalendarBatch = batchFixture.cases.find(({ name }) => name === "invalid calendar timestamp is rejected");
assert.equal(gatewayBatch?.expected?.rows?.[0]?.topic, "data", "hardcoded batch gateway routing contract failed");
assert.equal(gatewayBatch?.objectName, "iot-data-1.csv", "hardcoded batch object-name/index contract failed");
assert.deepEqual(
  [mismatchedBatch?.objectName, mismatchedBatch?.initialIndex, mismatchedBatch?.expected],
  ["iot-data-999.csv", 14, { download: "invalid-object-name", index: 14, rows: [], errors: ["invalid object name"] }],
  "hardcoded batch object-name mismatch outcome failed"
);
assert.equal(missingBatch?.expected?.index, missingBatch?.initialIndex, "hardcoded missing-object index contract failed");
assert.equal(failedBatch?.expected?.index, failedBatch?.initialIndex, "hardcoded failed-download index contract failed");
assert.equal(numericBatchTime?.expected?.rows?.[0]?.sourceTime, "2026-01-15T14:00:00.000Z", "hardcoded microsecond timestamp contract failed");
assert.ok(emptyBatchNumber?.expected?.errors?.includes("invalid number: temperature"), "hardcoded empty numeric cell rejection failed");
assert.deepEqual(invalidCalendarBatch?.expected?.errors, ["invalid timestamp"], "hardcoded invalid calendar timestamp rejection failed");

const monitoringFixture = JSON.parse(await readFile(resolve(packageRoot, "assets/monitoring/normalized-monitoring-cases.json"), "utf8"));
const monitoringByName = new Map(monitoringFixture.cases.map((item) => [item.name, item]));
const identityRejections = new Map([
  ["missing target twin configuration is terminal", { route: "final", reason: "target-twin-required", commands: [], recordId: null }],
  ["missing record twin identity is terminal", { route: "final", reason: "invalid-identity", commands: [], recordId: "r-08" }],
  ["missing record device type is terminal", { route: "final", reason: "invalid-identity", commands: [], recordId: "r-09" }],
  ["missing record external key is terminal", { route: "final", reason: "invalid-identity", commands: [], recordId: "r-10" }]
]);
for (const [name, expected] of identityRejections) {
  assert.deepEqual(monitoringByName.get(name)?.expected, expected, `hardcoded monitoring identity rejection contract failed: ${name}`);
}
assert.deepEqual(monitoringByName.get("invalid calendar source time is terminal")?.expected, { route: "final", reason: "invalid-source-time", commands: [], recordId: "r-11" }, "hardcoded monitoring calendar rejection failed");

const commandFixture = JSON.parse(await readFile(resolve(packageRoot, "assets/commands/command-notification-cases.json"), "utf8"));
const refusedCommand = commandFixture.cases.find(({ name }) => name === "refused status from SQL");
const completedCommand = commandFixture.cases.find(({ name }) => name === "send returns ID and SQL reports completed");
const mismatchedCommand = commandFixture.cases.find(({ name }) => name === "mismatched SQL command record ID");
const deadlineCommand = commandFixture.cases.find(({ name }) => name === "poll deadline");
const emptyRetryCommand = commandFixture.cases.find(({ name }) => name === "empty SQL status result retries then completes");
const emptyDeadlineCommand = commandFixture.cases.find(({ name }) => name === "empty SQL status result reaches deadline");
const boundedMissingCommand = commandFixture.cases.find(({ name }) => name === "missing command response within reconciliation bounds");
const limitedMissingCommand = commandFixture.cases.find(({ name }) => name === "missing command response attempt limit");
const timedOutMissingCommand = commandFixture.cases.find(({ name }) => name === "missing command response deadline");
assert.deepEqual([refusedCommand?.expected?.state, refusedCommand?.expected?.route], ["refused", "final"], "hardcoded refused-command terminal contract failed");
assert.deepEqual([mismatchedCommand?.expected?.state, mismatchedCommand?.expected?.route], ["bad-response", "final"], "hardcoded command-record mismatch contract failed");
assert.notEqual(mismatchedCommand?.expected?.sourceRecordId, mismatchedCommand?.expected?.rawCommandDataRecordId, "hardcoded source and command correlation IDs must remain distinct");
assert.deepEqual(
  [commandFixture.contract.sql.bindName, commandFixture.contract.sql.bindValueSource, commandFixture.contract.sql.predicate],
  ["recordId", "rawCommandDataRecordId", "ID = :recordId"],
  "hardcoded command SQL bind name/value-source contract failed"
);
assert.deepEqual(completedCommand?.commandResponse, { rawCommandDataRecordId: "cmd-completed" }, "Send Command response must contain only its returned ID");
assert.deepEqual(completedCommand?.statusResults?.[0]?.[0], { ID: "cmd-completed", DELIVERY_STATUS: "COMPLETED" }, "completed command status must come from SQL readback");
assert.match(completedCommand?.expected?.notification?.body ?? "", /status=completed/, "completed notification needs SQL status provenance");
for (const status of ["prepared", "sent", "pending", "responded"]) {
  const testCase = commandFixture.cases.find(({ name }) => name === `SQL ${status} then completed`);
  assert.deepEqual([testCase?.statusResults?.[0]?.[0]?.DELIVERY_STATUS, testCase?.expected?.state, testCase?.expected?.transitions], [status.toUpperCase(), "completed", [status, "completed"]], `hardcoded ${status} non-final command contract failed`);
}
assert.deepEqual(
  [boundedMissingCommand?.reconciliationAttempt, boundedMissingCommand?.elapsedMs, boundedMissingCommand?.expected?.state, boundedMissingCommand?.expected?.route],
  [1, 0, "missing", "retry"],
  "hardcoded bounded missing-response retry failed"
);
assert.deepEqual([limitedMissingCommand?.reconciliationAttempt, limitedMissingCommand?.expected?.state, limitedMissingCommand?.expected?.route], [3, "deadline", "final"], "hardcoded missing-response attempt limit failed");
assert.deepEqual([timedOutMissingCommand?.elapsedMs, timedOutMissingCommand?.expected?.state, timedOutMissingCommand?.expected?.route], [2500, "deadline", "final"], "hardcoded missing-response deadline failed");
assert.deepEqual(
  [emptyRetryCommand?.statusResults?.[0], emptyRetryCommand?.expected?.state, emptyRetryCommand?.expected?.polls, emptyRetryCommand?.expected?.transitions],
  [[], "completed", 2, ["retry", "completed"]],
  "hardcoded empty SQL result retry contract failed"
);
assert.deepEqual(
  [emptyDeadlineCommand?.statusResults, emptyDeadlineCommand?.expected?.state, emptyDeadlineCommand?.expected?.polls, emptyDeadlineCommand?.expected?.transitions],
  [[[], [], []], "deadline", 2, ["retry", "retry", "deadline"]],
  "hardcoded empty SQL result deadline contract failed"
);
assert.deepEqual([deadlineCommand?.expected?.state, deadlineCommand?.expected?.route], ["deadline", "final"], "hardcoded command deadline contract failed");
assert.ok(deadlineCommand?.expected?.polls <= commandFixture.contract.pollLimit, "hardcoded command poll bound failed");
assert.ok((deadlineCommand?.expected?.polls + 1) * commandFixture.contract.pollIntervalMs > commandFixture.contract.deadlineMs, "hardcoded command time deadline is not independently exercised");

const flowCasesFixture = JSON.parse(await readFile(resolve(packageRoot, "assets/runtime/flow-document-cases.json"), "utf8"));
const staleFlow = flowCasesFixture.cases.find(({ caseId }) => caseId === "stale-etag-aborts");
const missingFlowEtag = flowCasesFixture.cases.find(({ caseId }) => caseId === "missing-etag-aborts");
assert.equal(staleFlow?.expected?.retry, false, "hardcoded stale flows ETag no-retry contract failed");
assert.equal(missingFlowEtag?.expected?.requestSent, false, "hardcoded missing flows ETag stop contract failed");

const networkCasesFixture = JSON.parse(await readFile(resolve(packageRoot, "assets/runtime/network-config-cases.json"), "utf8"));
const staleResource = networkCasesFixture.cases.find(({ caseId }) => caseId === "stale-resource-etag-aborts");
const missingResourceEtag = networkCasesFixture.cases.find(({ caseId }) => caseId === "missing-resource-etag-aborts");
const preserveNetwork = networkCasesFixture.cases.find(({ caseId }) => caseId === "replace-network-preserving-mount");
const networkReadbackMismatch = networkCasesFixture.cases.find(({ caseId }) => caseId === "readback-mismatch-escalates");
assert.equal(staleResource?.expected?.retry, false, "hardcoded stale resource ETag no-retry contract failed");
assert.equal(missingResourceEtag?.expected?.requestSent, false, "hardcoded missing resource ETag stop contract failed");
assert.equal(preserveNetwork?.ifMatch, preserveNetwork?.currentEtag, "hardcoded successful network replacement must match current ETag");
assert.deepEqual(preserveNetwork?.candidate?.networkConfig?.fileStorageMounts, preserveNetwork?.current?.fileStorageMounts, "hardcoded network mount-preservation contract failed");
assert.ok(preserveNetwork?.candidate?.networkConfig?.networkSecurityGroupIds?.includes("<nsg-a>"), "hardcoded network NSG-preservation contract failed");
assert.deepEqual(
  [networkReadbackMismatch?.response?.status, networkReadbackMismatch?.candidate?.networkConfig?.subnetId, networkReadbackMismatch?.readback?.subnetId, networkReadbackMismatch?.expected],
  [200, "<subnet-b>", "<subnet-wrong>", { decision: "escalate", reason: "effective-state-mismatch", retry: false }],
  "hardcoded network readback mismatch must escalate"
);

const propertyCasesFixture = JSON.parse(await readFile(resolve(packageRoot, "assets/runtime/resource-property-cases.json"), "utf8"));
const matchingProperty = propertyCasesFixture.cases.find(({ caseId }) => caseId === "matching-resource-etag-update");
const propertyReadbackMismatch = propertyCasesFixture.cases.find(({ caseId }) => caseId === "readback-mismatch-escalates");
const mismatchedProperty = propertyCasesFixture.cases.find(({ caseId }) => caseId === "mismatched-resource-etag-aborts");
const staleProperty = propertyCasesFixture.cases.find(({ caseId }) => caseId === "stale-property-etag-412-aborts");
assert.equal(matchingProperty?.ifMatch, matchingProperty?.currentEtag, "hardcoded successful property update must match current ETag");
assert.deepEqual(
  [propertyReadbackMismatch?.response?.status, propertyReadbackMismatch?.candidate?.description, propertyReadbackMismatch?.readback?.description, propertyReadbackMismatch?.expected],
  [200, "changed", "unexpected", { decision: "escalate", reason: "effective-state-mismatch", retry: false }],
  "hardcoded property readback mismatch must escalate"
);
assert.deepEqual([mismatchedProperty?.expected?.decision, mismatchedProperty?.expected?.retry], ["abort", false], "hardcoded mismatched property ETag contract failed");
assert.deepEqual([staleProperty?.expected?.decision, staleProperty?.expected?.retry], ["abort", false], "hardcoded stale property ETag 412 contract failed");

const deliveryCasesFixture = JSON.parse(await readFile(resolve(packageRoot, "assets/runtime/delivery-recovery-cases.json"), "utf8"));
const deliveryCasesById = new Map(deliveryCasesFixture.cases.map((item) => [item.caseId, item]));
for (const caseId of ["transient-failure-attempt-limit", "transient-failure-deadline", "transient-failure-poll-limit"]) {
  assert.deepEqual(deliveryCasesById.get(caseId)?.expected, { next: "not_responded", retry: false }, `hardcoded bounded delivery terminal contract failed: ${caseId}`);
}
assert.deepEqual(
  deliveryCasesById.get("transient-failure-bounded-retry")?.expected,
  { next: "prepared", retry: true },
  "hardcoded bounded delivery retry contract failed"
);

console.log(`verified bundled Flow Runtime module with ${requiredFiles.length} required files, ${fixture.cases.length} offline cases, contained links and commands, UTF-8 text, and safety constraints`);
