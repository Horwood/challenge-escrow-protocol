import {
  decodeChallenge,
  inspectChallenge,
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
  sourceCorrectionCutoff: 320n,
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
  canonicalToken: address,
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
const summary = summarizeAccounting(decoded, [
  { exists: true, claimableAmount: 0n, paidAmount: 0n },
  { exists: true, claimableAmount: 0n, paidAmount: 0n },
]);
if (!summary.localConservation || !summary.entitlementConservation) throw new Error("accounting summary failed");

const inspection = await inspectChallenge(provider, address, challengeId, 77n);
if (inspection.accounting.outstanding !== 20n || inspection.snapshot.paused) throw new Error("read-only inspection failed");
if (calls.some((call) => call.blockTag !== 77n)) throw new Error("inspection did not pin a common block tag");
if (calls.some((call) => call.functionName.toLowerCase().includes("send") || call.functionName.toLowerCase().includes("write"))) {
  throw new Error("read-only kit attempted a write-like call");
}

console.log(JSON.stringify({ status: "ok", readCalls: calls.length, state: inspection.challenge.state, outstanding: inspection.accounting.outstanding.toString() }));
