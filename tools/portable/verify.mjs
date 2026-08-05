import { readFileSync } from "node:fs";
import {
  assertNoDuplicateKeys,
  canonicalizeJson,
  canonicalizeValue,
  domainHash,
  evaluateCondition,
  validateEvidence,
  validateTerms,
} from "./canonical.mjs";

const vectorText = readFileSync(new URL("../../spec/vectors/portable-v1.json", import.meta.url), "utf8");
assertNoDuplicateKeys(vectorText);
const vector = JSON.parse(vectorText);
if (vector.version !== "portable-v1") throw new Error("portable vector version drifted");

validateTerms(vector.terms);
validateEvidence(vector.evidence);

const termsCanonical = canonicalizeValue(vector.terms);
const evidenceCanonical = canonicalizeValue(vector.evidence);
const termsHash = domainHash("challenge-escrow.terms/v1", vector.terms);
const evidenceHash = domainHash("challenge-escrow.evidence/v1", vector.evidence);
const expected = vector.expected;

for (const [label, actual] of Object.entries({
  termsCanonical,
  termsHash,
  evidenceCanonical,
  evidenceHash,
})) {
  if (actual !== expected[label]) throw new Error(`${label} drifted`);
}

const conditionResult = evaluateCondition(vector.terms.condition, vector.evidence.observations);
if (conditionResult !== vector.expected.conditionResult) throw new Error("condition result drifted");

const reordered = `{ "z": "last", "a": "first", "nested": { "b": "two", "a": "one" } }`;
if (canonicalizeJson(reordered) !== '{"a":"first","nested":{"a":"one","b":"two"},"z":"last"}') {
  throw new Error("object key ordering is not deterministic");
}
if (canonicalizeJson('{"text":"e\\u0301"}') !== '{"text":"é"}') {
  throw new Error("NFC normalization is not deterministic");
}
const decimalCondition = {
  schema: "challenge-escrow.condition-language/v1",
  root: {
    op: "eq",
    left: { kind: "decimal", value: "1.50" },
    right: { kind: "decimal", value: "1.5" },
  },
};
if (!evaluateCondition(decimalCondition, [])) throw new Error("exact decimal comparison drifted");
for (const [label, raw] of [
  ["duplicate key", '{"a":"one","a":"two"}'],
  ["JSON number", '{"a":1}'],
]) {
  try {
    canonicalizeJson(raw);
    throw new Error(`${label} was accepted`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(label === "duplicate key" ? "duplicate" : "numbers")) {
      throw error;
    }
  }
}

const invalidTerms = structuredClone(vector.terms);
invalidTerms.condition.root.op = "execute";
try {
  validateTerms(invalidTerms);
  throw new Error("unknown condition operator was accepted");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("unknown")) throw error;
}

const invalidEvidence = structuredClone(vector.evidence);
invalidEvidence.reasonCode = "4";
try {
  validateEvidence(invalidEvidence);
  throw new Error("A/B reason code outside the enum was accepted");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("reasonCode")) throw error;
}

console.log(JSON.stringify({
  status: "ok",
  termsHash,
  evidenceHash,
  conditionResult,
  termsBytes: Buffer.byteLength(termsCanonical),
  evidenceBytes: Buffer.byteLength(evidenceCanonical),
  negativeCases: 4,
}, null, 2));
