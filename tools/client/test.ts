import {
  decodeChallenge,
  decodeEntitlement,
  inspectChallenge,
  readReleaseSnapshot,
  summarizeAccounting,
  type Address,
  type Hex,
  type ReadContractRequest,
  type ReadProvider,
} from "./index.ts";

const address = "0x1111111111111111111111111111111111111111" as Address;
const challengeId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
const hash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;
const challenger = "0x2222222222222222222222222222222222222222" as Address;
const acceptor = "0x3333333333333333333333333333333333333333" as Address;
const emptyHash = `0x${"0".repeat(64)}` as Hex;
const emptyAddress = `0x${"0".repeat(40)}` as Address;

const rawChallenge = {
  exists: true,
  state: 1n,
  specHash: hash,
  executionHash: hash,
  termsHash: hash,
  instanceNonce: hash,
  challengerWallet: challenger,
  acceptingWallet: acceptor,
  challengerSide: 0n,
  stakeAmount: 10n,
  acceptanceNonce: 0n,
  depositedAmount: 20n,
  outstandingLiability: 20n,
  openedAt: 100n,
  createdAt: 99n,
  acceptedAt: 110n,
  acceptanceDeadline: 200n,
  observationTime: 300n,
  sourceCorrectionCutoff: 305n,
  proposalDeadline: 340n,
  disputeWindowSeconds: 10n,
  arbitrationWindowSeconds: 10n,
  timeoutVoidAt: 370n,
  proposal: {
    exists: false, outcome: 0n, abReason: 0n, evidenceVoidReason: 0n, evidenceHash: emptyHash, proposedAt: 0n, disputeDeadline: 0n,
  },
  dispute: {
    exists: false, disputingWallet: emptyAddress, outcome: 0n, abReason: 0n, evidenceVoidReason: 0n, evidenceHash: emptyHash, parentEvidenceHash: emptyHash, disputedAt: 0n, arbitrationStart: 0n, arbitrationDeadline: 0n,
  },
  finalResolution: {
    exists: false, outcome: 0n, abReason: 0n, evidenceVoidReason: 0n, timeoutVoidReason: 0n, resolutionPath: 0n, voidPath: 0n, finalEvidenceHash: emptyHash, parentEvidenceHash: emptyHash, finalizedBy: emptyAddress,
  },
};

const entitlement = { exists: false, claimableAmount: 0n, paidAmount: 0n };
const calls: ReadContractRequest[] = [];
const values: Record<string, unknown> = {
  getChallenge: rawChallenge,
  getEntitlement: entitlement,
  releaseId: hash,
  PROTOCOL_VERSION: "challenge-escrow-protocol/v1",
  EVENT_PROTOCOL_ID: "challenge-escrow-event/v1",
  CHALLENGE_SCHEMA_ID: "challenge-escrow.spec/v1",
  EVIDENCE_SCHEMA_ID: "challenge-escrow.evidence/v1",
  CONDITION_LANGUAGE_ID: "challenge-escrow.condition-language/v1",
  TERMS_DOMAIN: "challenge-escrow.terms/v1",
  SPEC_DOMAIN: "challenge-escrow.spec/v1",
  EVIDENCE_DOMAIN: "challenge-escrow.evidence/v1",
  canonicalToken: "0x7777777777777777777777777777777777777777",
  tokenDecimals: 6n,
  resolver: "0x4444444444444444444444444444444444444444",
  arbiter: "0x5555555555555555555555555555555555555555",
  pauser: "0x6666666666666666666666666666666666666666",
  paused: false,
  totalOutstandingLiability: 20n,
};

const provider: ReadProvider = {
  async readContract<T>(request: ReadContractRequest): Promise<T> {
    calls.push(request);
    return values[request.functionName] as T;
  },
};

const decoded = decodeChallenge(rawChallenge);
if (decoded.state !== "ACTIVE" || decoded.stakeAmount !== 10n) throw new Error("tuple decoding failed");

function expectChallengeReject(candidate: unknown, marker: string): void {
  let rejected = false;
  try {
    decodeChallenge(candidate);
  } catch (error) {
    rejected = String(error).includes(marker);
  }
  if (!rejected) throw new Error(`invalid challenge was accepted: ${marker}`);
}

expectChallengeReject({ ...rawChallenge, stakeAmount: -1n }, "unsigned ABI integer");
expectChallengeReject({ ...rawChallenge, stakeAmount: (1n << 256n).toString() }, "exceeds uint256");
expectChallengeReject({ ...rawChallenge, openedAt: 1n << 64n }, "exceeds uint64");
expectChallengeReject({ ...rawChallenge, createdAt: 101n }, "deadline ordering is invalid");
expectChallengeReject({ ...rawChallenge, depositedAmount: 19n }, "accepted challenge deposit is invalid");
expectChallengeReject({ ...rawChallenge, outstandingLiability: 19n }, "reachable payout step");
expectChallengeReject({ ...rawChallenge, specHash: emptyHash }, "specHash cannot be zero");
expectChallengeReject({
  ...rawChallenge,
  proposal: { ...rawChallenge.proposal, exists: true, evidenceHash: hash, proposedAt: 300n, disputeDeadline: 310n },
}, "premature evidence state");
expectChallengeReject({
  ...rawChallenge,
  proposal: { ...rawChallenge.proposal, evidenceHash: hash },
}, "absent proposal");
expectChallengeReject({
  ...rawChallenge,
  dispute: { ...rawChallenge.dispute, disputedAt: 1n },
}, "absent dispute");
expectChallengeReject({
  ...rawChallenge,
  finalResolution: { ...rawChallenge.finalResolution, finalizedBy: challenger },
}, "absent final resolution");

const absentChallenge = {
  ...rawChallenge,
  exists: false,
  state: 0n,
  specHash: emptyHash,
  executionHash: emptyHash,
  termsHash: emptyHash,
  instanceNonce: emptyHash,
  challengerWallet: emptyAddress,
  acceptingWallet: emptyAddress,
  challengerSide: 0n,
  stakeAmount: 0n,
  acceptanceNonce: 0n,
  depositedAmount: 0n,
  outstandingLiability: 0n,
  openedAt: 0n,
  createdAt: 0n,
  acceptedAt: 0n,
  acceptanceDeadline: 0n,
  observationTime: 0n,
  sourceCorrectionCutoff: 0n,
  proposalDeadline: 0n,
  disputeWindowSeconds: 0n,
  arbitrationWindowSeconds: 0n,
  timeoutVoidAt: 0n,
};
if (decodeChallenge(absentChallenge).exists) throw new Error("canonical absent challenge was rejected");
expectChallengeReject({ ...absentChallenge, stakeAmount: 1n }, "canonical zero tuple");

const proposed = {
  ...rawChallenge,
  state: 2n,
  proposal: { ...rawChallenge.proposal, exists: true, outcome: 1n, evidenceHash: hash, proposedAt: 300n, disputeDeadline: 310n },
};
if (decodeChallenge(proposed).state !== "PROPOSED") throw new Error("valid proposed state was rejected");
expectChallengeReject({
  ...proposed,
  proposal: { ...proposed.proposal, outcome: 2n, evidenceVoidReason: 0n },
}, "proposal is internally inconsistent");
const earlyUnresolvableProposal = {
  ...proposed,
  proposal: { ...proposed.proposal, outcome: 2n, evidenceVoidReason: 5n },
};
if (decodeChallenge(earlyUnresolvableProposal).proposal.outcome !== "VOID") {
  throw new Error("TERMS_UNRESOLVABLE proposal exception was rejected before the correction cutoff");
}

const disputed = {
  ...proposed,
  state: 3n,
  dispute: {
    ...rawChallenge.dispute,
    exists: true,
    disputingWallet: challenger,
    outcome: 0n,
    evidenceHash: challengeId,
    parentEvidenceHash: hash,
    disputedAt: 302n,
    arbitrationStart: 305n,
    arbitrationDeadline: 315n,
  },
};
if (decodeChallenge(disputed).state !== "DISPUTED") throw new Error("valid disputed state was rejected");
expectChallengeReject({
  ...disputed,
  dispute: { ...disputed.dispute, disputingWallet: values.resolver },
}, "challenge dispute is internally inconsistent");
expectChallengeReject({
  ...disputed,
  dispute: { ...disputed.dispute, disputedAt: 299n, arbitrationStart: 305n },
}, "challenge dispute is internally inconsistent");

const resolved = {
  ...disputed,
  state: 7n,
  finalResolution: {
    ...rawChallenge.finalResolution,
    exists: true,
    outcome: 1n,
    resolutionPath: 1n,
    finalEvidenceHash: challengeId,
    parentEvidenceHash: challengeId,
    finalizedBy: acceptor,
  },
};
if (decodeChallenge(resolved).state !== "RESOLVED_B") throw new Error("valid arbitrated resolution was rejected");
expectChallengeReject({
  ...resolved,
  finalResolution: { ...resolved.finalResolution, parentEvidenceHash: hash },
}, "arbitrated resolution has invalid evidence lineage");

const uncontestedMismatch = {
  ...proposed,
  state: 6n,
  finalResolution: {
    ...rawChallenge.finalResolution,
    exists: true,
    outcome: 0n,
    resolutionPath: 0n,
    finalEvidenceHash: hash,
    parentEvidenceHash: emptyHash,
    finalizedBy: challenger,
  },
};
expectChallengeReject(uncontestedMismatch, "uncontested resolution has invalid evidence lineage");

const proposalTimeoutVoid = {
  ...rawChallenge,
  state: 8n,
  finalResolution: {
    ...rawChallenge.finalResolution,
    exists: true,
    outcome: 2n,
    voidPath: 2n,
    finalizedBy: acceptor,
  },
};
if (decodeChallenge(proposalTimeoutVoid).state !== "VOID") throw new Error("valid proposal-timeout void was rejected");
expectChallengeReject({
  ...proposalTimeoutVoid,
  finalResolution: { ...proposalTimeoutVoid.finalResolution, evidenceVoidReason: 1n },
}, "timeout void");

decodeEntitlement({ exists: true, claimableAmount: 10n, paidAmount: 0n });
let invalidEntitlementRejected = false;
try {
  decodeEntitlement({ exists: false, claimableAmount: 1n, paidAmount: 0n });
} catch (error) {
  invalidEntitlementRejected = String(error).includes("absent entitlement");
}
if (!invalidEntitlementRejected) throw new Error("absent entitlement with value was accepted");
let emptyPresentEntitlementRejected = false;
try {
  decodeEntitlement({ exists: true, claimableAmount: 0n, paidAmount: 0n });
} catch (error) {
  emptyPresentEntitlementRejected = String(error).includes("present entitlement");
}
if (!emptyPresentEntitlementRejected) throw new Error("empty present entitlement was accepted");
const summary = summarizeAccounting(decoded, [
  { exists: false, claimableAmount: 0n, paidAmount: 0n },
  { exists: false, claimableAmount: 0n, paidAmount: 0n },
]);
if (!summary.localConservation || !summary.entitlementConservation) throw new Error("accounting summary failed");
let oversizedEntitlementSetRejected = false;
try {
  summarizeAccounting(decoded, [entitlement, entitlement, entitlement]);
} catch (error) {
  oversizedEntitlementSetRejected = String(error).includes("two-participant protocol boundary");
}
if (!oversizedEntitlementSetRejected) throw new Error("unbounded entitlement set was accepted");

const inspection = await inspectChallenge(provider, address, challengeId, 77n);
if (inspection.accounting.outstanding !== 20n || inspection.snapshot.paused) throw new Error("read-only inspection failed");
if (calls.some((call) => call.blockTag !== 77n)) throw new Error("inspection did not pin a common block tag");
if (calls.some((call) => call.functionName.toLowerCase().includes("send") || call.functionName.toLowerCase().includes("write"))) {
  throw new Error("read-only kit attempted a write-like call");
}

async function expectInspectionReject(
  challenge: unknown,
  overrides: Record<string, unknown>,
  marker: string,
): Promise<void> {
  const candidateValues: Record<string, unknown> = { ...values, ...overrides, getChallenge: challenge };
  const candidateProvider: ReadProvider = {
    async readContract<T>(request: ReadContractRequest): Promise<T> {
      return candidateValues[request.functionName] as T;
    },
  };
  let rejected = false;
  try {
    await inspectChallenge(candidateProvider, address, challengeId, 77n);
  } catch (error) {
    rejected = String(error).includes(marker);
  }
  if (!rejected) throw new Error(`inspection accepted invalid release relation: ${marker}`);
}

await expectInspectionReject(
  { ...rawChallenge, challengerWallet: values.pauser },
  {},
  "participant overlaps",
);
await expectInspectionReject(rawChallenge, { totalOutstandingLiability: 19n }, "aggregate liability");
await expectInspectionReject(resolved, {}, "not finalized by the release arbiter");
await expectInspectionReject(
  rawChallenge,
  { getEntitlement: { exists: true, claimableAmount: 1n, paidAmount: 0n } },
  "does not conserve",
);

let unpinnedInspectionRejected = false;
try {
  await inspectChallenge(provider, address, challengeId);
} catch (error) {
  unpinnedInspectionRejected = String(error).includes("explicit blockTag");
}
if (!unpinnedInspectionRejected) throw new Error("multi-read inspection accepted an unpinned latest state");

let oversizedBlockTagRejected = false;
try {
  await readReleaseSnapshot(provider, address, 1n << 64n);
} catch (error) {
  oversizedBlockTagRejected = String(error).includes("blockTag exceeds uint64");
}
if (!oversizedBlockTagRejected) throw new Error("out-of-range block tag was accepted");

const invalidReleaseValues: Record<string, unknown> = { ...values, PROTOCOL_VERSION: "challenge-escrow-protocol/v2" };
const invalidReleaseProvider: ReadProvider = {
  async readContract<T>(request: ReadContractRequest): Promise<T> {
    return invalidReleaseValues[request.functionName] as T;
  },
};
let releaseAliasRejected = false;
try {
  await readReleaseSnapshot(invalidReleaseProvider, address, 77n);
} catch (error) {
  releaseAliasRejected = String(error).includes("supported release");
}
if (!releaseAliasRejected) throw new Error("release constant alias was accepted");

const oversizedReleaseStringProvider: ReadProvider = {
  async readContract<T>(request: ReadContractRequest): Promise<T> {
    return (request.functionName === "PROTOCOL_VERSION" ? "x".repeat(257) : values[request.functionName]) as T;
  },
};
let oversizedReleaseStringRejected = false;
try {
  await readReleaseSnapshot(oversizedReleaseStringProvider, address, 77n);
} catch (error) {
  oversizedReleaseStringRejected = String(error).includes("bounded string");
}
if (!oversizedReleaseStringRejected) throw new Error("oversized release string was accepted");

console.log(JSON.stringify({
  status: "ok",
  readCalls: calls.length,
  state: inspection.challenge.state,
  outstanding: inspection.accounting.outstanding.toString(),
  challengeNegatives: 18,
  entitlementAndAccountingNegatives: 3,
  inspectionRelationNegatives: 4,
  releaseAndPinningNegatives: 4,
}));
