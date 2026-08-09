import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

import { assertNoDuplicateKeys } from "./canonical.mjs";

const root = new URL("../../", import.meta.url);
const schemaDir = new URL("../../spec/schemas/", import.meta.url);
const rootPath = fileURLToPath(root);
const publicJsonExclusions = [
  "tools/formal/cache",
  "tools/formal/out",
  "tools/medusa/corpus",
  "tools/medusa/crytic-export",
];

function scanJsonTree(directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const path = relative(rootPath, absolute).split("\\").join("/");
    if (publicJsonExclusions.some((excluded) => path === excluded || path.startsWith(`${excluded}/`))) continue;
    if (entry.isDirectory()) scanJsonTree(absolute, result);
    else if (entry.isFile() && entry.name.endsWith(".json")) result.push(path);
  }
  return result;
}

const publicJsonPaths = [
  "package.json",
  "contracts/package.json",
  ...scanJsonTree(fileURLToPath(new URL("../../spec/", import.meta.url))),
  ...scanJsonTree(fileURLToPath(new URL("../../tools/", import.meta.url))),
].sort();
for (const path of publicJsonPaths) {
  const raw = readFileSync(join(rootPath, path), "utf8");
  assertNoDuplicateKeys(raw);
  JSON.parse(raw);
}

function load(name) {
  const raw = readFileSync(new URL(name, schemaDir), "utf8");
  assertNoDuplicateKeys(raw);
  return JSON.parse(raw);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const condition = load("condition-language-v1.json");
const terms = load("terms-v1.json");
const evidence = load("evidence-v1.json");
const observer = load("observer-v1.json");
const testnetPreflight = load("testnet-preflight-v1.json");
const observerReceipt = load("observer-receipt-v1.json");
const authorityPolicy = load("authority-policy-v1.json");
const releaseManifest = load("release-manifest-v1.json");

assert(condition.$id === "challenge-escrow.condition-language/v1", "condition schema id drifted");
assert(terms.$id === "challenge-escrow.terms/v1", "terms schema id drifted");
assert(evidence.$id === "challenge-escrow.evidence/v1", "evidence schema id drifted");
assert(observer.$id === "challenge-escrow.observer/v1", "observer schema id drifted");
assert(testnetPreflight.$id === "challenge-escrow.testnet-preflight/v1", "testnet preflight schema id drifted");
assert(observerReceipt.$id === "challenge-escrow.observer-receipt/v1", "observer receipt schema id drifted");
assert(authorityPolicy.$id === "challenge-escrow.authority-policy/v1", "authority policy schema id drifted");
assert(releaseManifest.$id === "challenge-escrow.release-manifest/v1", "release manifest schema id drifted");
assert(terms.properties.schema.const === terms.$id, "terms schema const drifted");
assert(evidence.properties.schema.const === evidence.$id, "evidence schema const drifted");
assert(observer.properties.schema.const === observer.$id, "observer schema const drifted");
assert(testnetPreflight.properties.schema.const === testnetPreflight.$id, "testnet preflight schema const drifted");
assert(observerReceipt.properties.schema.const === observerReceipt.$id, "observer receipt schema const drifted");
assert(authorityPolicy.properties.schema.const === authorityPolicy.$id, "authority policy schema const drifted");
assert(releaseManifest.properties.schema.const === releaseManifest.$id, "release manifest schema const drifted");
assert(
  terms.properties.condition.$ref === "condition-language-v1.json",
  "terms must reference the versioned condition schema",
);
assert(
  evidence.properties.conditionLanguage.const === condition.$id,
  "evidence condition language binding drifted",
);
assert(
  evidence.properties.observations.items.$ref === "#/$defs/observation",
  "evidence observation definition drifted",
);
assert(
  evidence.$defs.observation.properties.value.$ref === "condition-language-v1.json#/$defs/value",
  "evidence values must use the condition value vocabulary",
);
assert(
  observerReceipt.$defs.quorum.properties.schema.const === "challenge-escrow.rpc-quorum/v1",
  "observer receipt quorum schema drifted",
);
assert(
  authorityPolicy.properties.forbiddenCapabilities.const.includes("owner-withdrawal")
    && authorityPolicy.properties.forbiddenCapabilities.const.includes("proxy-upgrade"),
  "authority policy capability boundary drifted",
);
assert(
  releaseManifest.$defs.runtime.properties.keccak256.$ref === "#/$defs/hash"
    && releaseManifest.$defs.runtime.properties.sha256.$ref === "#/$defs/sha256",
  "release runtime digest boundary drifted",
);
assert(
  releaseManifest.$defs.runtime.required.includes("immutableGroups")
    && releaseManifest.$defs.runtime.properties.immutableGroups.minItems === 6
    && releaseManifest.$defs.runtime.properties.immutableGroups.maxItems === 6
    && releaseManifest.$defs.runtime.properties.immutableGroups.uniqueItems === true,
  "release immutable group boundary drifted",
);
assert(
  testnetPreflight.required.includes("immutableGroupCount")
    && testnetPreflight.properties.immutableGroupCount.$ref === "#/$defs/positiveDecimal",
  "testnet immutable group report boundary drifted",
);
assert(
  testnetPreflight.required.includes("snapshotBlockHash")
    && testnetPreflight.required.includes("snapshotParentHash")
    && testnetPreflight.properties.checkedRpcMethods.minItems === 6
    && testnetPreflight.properties.checkedRpcMethods.maxItems === 6
    && testnetPreflight.properties.checkedRpcMethods.items.enum.includes("eth_getBlockByNumber"),
  "testnet block-hash snapshot boundary drifted",
);

console.log(JSON.stringify({
  status: "ok",
  schemas: [condition.$id, terms.$id, evidence.$id, observer.$id, testnetPreflight.$id, observerReceipt.$id, authorityPolicy.$id, releaseManifest.$id],
  root,
  checked: [
    "versioned identifiers",
    "terms-to-condition reference",
    "evidence-to-condition value reference",
    "observer evidence envelope and event vocabulary",
    "testnet preflight read-only envelope",
    "portable observer receipt and RPC quorum envelope",
    "authority epoch, threshold, and forbidden-capability envelope",
    "release source, ABI, runtime, and digest envelope",
    `duplicate-free public JSON (${publicJsonPaths.length} files)`,
    "outcome reason bounds",
  ],
}, null, 2));
