import { readFileSync, writeFileSync } from "node:fs";

import { assertNoDuplicateKeys } from "../portable/canonical.mjs";
import { authorityPolicyHash, evaluateIncidentMatrix, validateAuthorityPolicy } from "./authority-policy.mjs";

const vectorUrl = new URL("../../spec/vectors/authority-policy-v1.json", import.meta.url);
const raw = readFileSync(vectorUrl, "utf8");
assertNoDuplicateKeys(raw);
const vector = JSON.parse(raw);
vector.policy.policyHash = authorityPolicyHash(vector.policy);
validateAuthorityPolicy(vector.policy, vector.verificationContext);
vector.expected = {
  policyHash: vector.policy.policyHash,
  incidents: evaluateIncidentMatrix(vector.policy, vector.verificationContext),
};
const serialized = `${JSON.stringify(vector, null, 2)}\n`;

if (process.argv.includes("--write")) writeFileSync(vectorUrl, serialized);
else process.stdout.write(serialized);
