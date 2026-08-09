import { readFileSync } from "node:fs";

import { assertNoDuplicateKeys, canonicalizeValue } from "../portable/canonical.mjs";
import {
  AuthorityPolicyError,
  authorityPolicyHash,
  evaluateIncidentMatrix,
  validateAuthorityPolicy,
} from "./authority-policy.mjs";

const vectorUrl = new URL("../../spec/vectors/authority-policy-v1.json", import.meta.url);
const negativeUrl = new URL("../../spec/vectors/authority-policy-negative-v1.json", import.meta.url);

function readJson(url) {
  const raw = readFileSync(url, "utf8");
  assertNoDuplicateKeys(raw);
  return JSON.parse(raw);
}

function mutate(vector, mutation) {
  const policy = structuredClone(vector.policy);
  const context = structuredClone(vector.verificationContext);
  if (mutation === "zero-member") policy.roles[0].members[0].fingerprint = `sha256:${"0".repeat(64)}`;
  else if (mutation === "duplicate-member") policy.roles[0].members[1] = structuredClone(policy.roles[0].members[0]);
  else if (mutation === "cross-role-overlap") policy.roles[1].members[0].fingerprint = policy.roles[0].members[0].fingerprint;
  else if (mutation === "single-signer-threshold") policy.roles[2].threshold = "1";
  else if (mutation === "minority-threshold") {
    policy.roles[2].members.push({
      fingerprint: `sha256:${"9".repeat(64)}`,
      custody: "hardware",
    });
  }
  else if (mutation === "threshold-exceeds-members") policy.roles[1].threshold = "3";
  else if (mutation === "uint256-overflow") policy.lineage.epoch = (1n << 256n).toString();
  else if (mutation === "uint64-time-overflow") policy.lineage.validUntil = (1n << 64n).toString();
  else if (mutation === "epoch-too-long") policy.rotation.maximumEpochSeconds = String(365 * 24 * 60 * 60 + 1);
  else if (mutation === "insufficient-review-delay") policy.lineage.announcedAt = String(BigInt(policy.lineage.validFrom) - BigInt(policy.rotation.minimumDelaySeconds) + 1n);
  else if (mutation === "role-order") policy.roles.reverse();
  else if (mutation === "member-order") policy.roles[2].members.reverse();
  else if (mutation === "missing-capability-denial") policy.forbiddenCapabilities.pop();
  else if (mutation === "missing-predecessor") policy.lineage.predecessorPolicyHash = null;
  else if (mutation === "zero-predecessor") policy.lineage.predecessorPolicyHash = `0x${"0".repeat(64)}`;
  else if (mutation === "stale-epoch-context") context.expectedEpoch = "2";
  else if (mutation === "wrong-predecessor-context") context.expectedPredecessorPolicyHash = `0x${"2".repeat(64)}`;
  else if (mutation === "expired-policy") context.observedAt = policy.lineage.validUntil;
  else if (mutation === "policy-hash-mismatch") policy.policyHash = `0x${"0".repeat(64)}`;
  else throw new Error(`unknown authority policy mutation: ${mutation}`);
  return { policy, context };
}

const vector = readJson(vectorUrl);
if (vector.schema !== "challenge-escrow.authority-policy-vector/v1") throw new Error("authority policy vector schema drifted");
if (!vector.expected.policyHash || !vector.expected.incidents) throw new Error("authority policy vector has not been generated");
const verified = validateAuthorityPolicy(vector.policy, vector.verificationContext);
if (verified.policyHash !== vector.expected.policyHash) throw new Error("authority policy expected hash drifted");
const incidents = evaluateIncidentMatrix(vector.policy, vector.verificationContext);
if (canonicalizeValue(incidents) !== canonicalizeValue(vector.expected.incidents)) throw new Error("authority incident matrix drifted");

const widerPolicy = structuredClone(vector.policy);
widerPolicy.roles[2].members.push({
  fingerprint: `sha256:${"9".repeat(64)}`,
  custody: "hardware",
});
widerPolicy.roles[2].threshold = "3";
widerPolicy.policyHash = authorityPolicyHash(widerPolicy);
const widerIncidents = evaluateIncidentMatrix(widerPolicy, vector.verificationContext);
const widerQuorumLoss = widerIncidents.scenarios.find((scenario) => scenario.id === "quorum-loss");
if (widerQuorumLoss?.quorumAvailable !== false || widerQuorumLoss.remaining !== "2") {
  throw new Error("authority incident matrix did not derive an actual quorum loss");
}

const negative = readJson(negativeUrl);
if (negative.schema !== "challenge-escrow.authority-policy-negative/v1") throw new Error("authority policy negative schema drifted");
for (const testCase of negative.cases) {
  const candidate = mutate(vector, testCase.mutation);
  let observed = null;
  try {
    validateAuthorityPolicy(candidate.policy, candidate.context);
  } catch (error) {
    if (error instanceof AuthorityPolicyError) observed = error.code;
    else throw error;
  }
  if (observed !== testCase.expectedCode) {
    throw new Error(`${testCase.id}: expected ${testCase.expectedCode}, observed ${observed ?? "accept"}`);
  }
}

console.log(JSON.stringify({
  status: "ok",
  policyHash: verified.policyHash,
  epoch: verified.epoch,
  roles: verified.roles,
  members: verified.members,
  incidents: incidents.scenarios.length,
  generalizedQuorumLoss: true,
  negativeCases: negative.cases.length,
}, null, 2));
