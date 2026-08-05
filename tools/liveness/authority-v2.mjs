import assert from "node:assert/strict";

const POLICY = Object.freeze({
  epoch: 7,
  members: ["authority-a", "authority-b", "authority-c"],
  quorum: 2,
  decisionWindow: 30,
});

class AuthorityRejection extends Error {}

function reject(code) {
  throw new AuthorityRejection(code);
}

function certificate({ challengeId, epoch, outcome, evidenceHash, parentEvidenceHash, approvals, expiresAt, now }) {
  if (epoch !== POLICY.epoch) reject("AuthorityEpochMismatch");
  if (!["A", "B", "VOID"].includes(outcome)) reject("UnknownOutcome");
  if (!evidenceHash || !parentEvidenceHash) reject("EvidenceLineageMissing");
  if (expiresAt <= now) reject("CertificateExpired");
  const unique = [...new Set(approvals)];
  if (unique.length !== approvals.length) reject("DuplicateAuthorityApproval");
  if (!unique.every((member) => POLICY.members.includes(member))) reject("UnknownAuthority");
  if (unique.length < POLICY.quorum) reject("AuthorityQuorumMissing");
  return { challengeId, epoch, outcome, evidenceHash, parentEvidenceHash, approvals: unique, expiresAt };
}

function runCase(name, available, latency, outcome) {
  const now = 1_000;
  const availableMembers = POLICY.members.filter((member) => available.includes(member));
  if (availableMembers.length < POLICY.quorum) {
    return {
      name,
      mode: "permissionless-timeout",
      outcome: "VOID",
      at: now + POLICY.decisionWindow,
      latency: POLICY.decisionWindow,
      observedAuthorityLatency: latency,
      approvals: availableMembers.length,
      rejection: null,
    };
  }
  const decision = certificate({
    challengeId: `v2-${name}`,
    epoch: POLICY.epoch,
    outcome,
    evidenceHash: `evidence-${name}`,
    parentEvidenceHash: `parent-${name}`,
    approvals: availableMembers.slice(0, POLICY.quorum),
    expiresAt: now + POLICY.decisionWindow,
    now: now + latency,
  });
  return {
    name,
    mode: "quorum-certificate",
    outcome: decision.outcome,
    at: now + latency,
    latency,
    approvals: decision.approvals.length,
    rejection: null,
  };
}

const cases = [
  runCase("full-quorum", ["authority-a", "authority-b", "authority-c"], 8, "A"),
  runCase("one-member-missing", ["authority-a", "authority-c"], 12, "B"),
  runCase("quorum-missing", ["authority-a"], 12, "A"),
];

let replayRejection = null;
try {
  certificate({
    challengeId: "v2-replay",
    epoch: POLICY.epoch - 1,
    outcome: "A",
    evidenceHash: "evidence-replay",
    parentEvidenceHash: "parent-replay",
    approvals: ["authority-a", "authority-b"],
    expiresAt: 1_030,
    now: 1_001,
  });
} catch (error) {
  replayRejection = error.message;
}
assert.equal(replayRejection, "AuthorityEpochMismatch");
const successful = cases.filter((item) => item.mode === "quorum-certificate");
const fallback = cases.filter((item) => item.mode === "permissionless-timeout");

console.log(JSON.stringify({
  status: "ok",
  policy: POLICY,
  cases,
  measurements: {
    quorumDecisions: successful.length,
    timeoutFallbacks: fallback.length,
    maximumDecisionLatency: Math.max(...successful.map((item) => item.latency)),
    fallbackLatency: fallback[0]?.latency ?? null,
    replayRejection,
  },
  productionBoundary: "This is an off-chain policy prototype; it does not alter ChallengeEscrow bytecode.",
}, null, 2));
