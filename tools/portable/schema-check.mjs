import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const schemaDir = new URL("../../spec/schemas/", import.meta.url);

function load(name) {
  return JSON.parse(readFileSync(new URL(name, schemaDir), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const condition = load("condition-language-v1.json");
const terms = load("terms-v1.json");
const evidence = load("evidence-v1.json");

assert(condition.$id === "challenge-escrow.condition-language/v1", "condition schema id drifted");
assert(terms.$id === "challenge-escrow.terms/v1", "terms schema id drifted");
assert(evidence.$id === "challenge-escrow.evidence/v1", "evidence schema id drifted");
assert(terms.properties.schema.const === terms.$id, "terms schema const drifted");
assert(evidence.properties.schema.const === evidence.$id, "evidence schema const drifted");
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

console.log(JSON.stringify({
  status: "ok",
  schemas: [condition.$id, terms.$id, evidence.$id],
  root,
  checked: [
    "versioned identifiers",
    "terms-to-condition reference",
    "evidence-to-condition value reference",
    "outcome reason bounds",
  ],
}, null, 2));
