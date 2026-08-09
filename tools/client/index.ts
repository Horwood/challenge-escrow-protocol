export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export interface ReadContractRequest {
  readonly address: Address;
  readonly functionName: string;
  readonly args?: readonly unknown[];
  readonly blockTag?: bigint;
}

export interface ReadProvider {
  readContract<T = unknown>(request: ReadContractRequest): Promise<T>;
}

export type LifecycleState =
  | "OPEN"
  | "ACTIVE"
  | "PROPOSED"
  | "DISPUTED"
  | "CANCELLED"
  | "EXPIRED"
  | "RESOLVED_A"
  | "RESOLVED_B"
  | "VOID";
export type Side = "A" | "B";
export type Outcome = "A" | "B" | "VOID";

export interface ProposalState {
  readonly exists: boolean;
  readonly outcome: Outcome;
  readonly abReason: number;
  readonly evidenceVoidReason: number;
  readonly evidenceHash: Hex;
  readonly proposedAt: bigint;
  readonly disputeDeadline: bigint;
}

export interface DisputeState {
  readonly exists: boolean;
  readonly disputingWallet: Address;
  readonly outcome: Outcome;
  readonly abReason: number;
  readonly evidenceVoidReason: number;
  readonly evidenceHash: Hex;
  readonly parentEvidenceHash: Hex;
  readonly disputedAt: bigint;
  readonly arbitrationStart: bigint;
  readonly arbitrationDeadline: bigint;
}

export interface FinalResolutionState {
  readonly exists: boolean;
  readonly outcome: Outcome;
  readonly abReason: number;
  readonly evidenceVoidReason: number;
  readonly timeoutVoidReason: number;
  readonly resolutionPath: number;
  readonly voidPath: number;
  readonly finalEvidenceHash: Hex;
  readonly parentEvidenceHash: Hex;
  readonly finalizedBy: Address;
}

export interface ChallengeState {
  readonly exists: boolean;
  readonly state: LifecycleState;
  readonly specHash: Hex;
  readonly executionHash: Hex;
  readonly termsHash: Hex;
  readonly instanceNonce: Hex;
  readonly challengerWallet: Address;
  readonly acceptingWallet: Address;
  readonly challengerSide: Side;
  readonly stakeAmount: bigint;
  readonly acceptanceNonce: bigint;
  readonly depositedAmount: bigint;
  readonly outstandingLiability: bigint;
  readonly openedAt: bigint;
  readonly createdAt: bigint;
  readonly acceptedAt: bigint;
  readonly acceptanceDeadline: bigint;
  readonly observationTime: bigint;
  readonly sourceCorrectionCutoff: bigint;
  readonly proposalDeadline: bigint;
  readonly disputeWindowSeconds: bigint;
  readonly arbitrationWindowSeconds: bigint;
  readonly timeoutVoidAt: bigint;
  readonly proposal: ProposalState;
  readonly dispute: DisputeState;
  readonly finalResolution: FinalResolutionState;
}

export interface EntitlementState {
  readonly exists: boolean;
  readonly claimableAmount: bigint;
  readonly paidAmount: bigint;
}

export interface ReleaseSnapshot {
  readonly releaseId: Hex;
  readonly protocolVersion: string;
  readonly eventProtocolId: string;
  readonly challengeSchemaId: string;
  readonly evidenceSchemaId: string;
  readonly conditionLanguageId: string;
  readonly termsDomain: string;
  readonly specDomain: string;
  readonly evidenceDomain: string;
  readonly canonicalToken: Address;
  readonly tokenDecimals: number;
  readonly resolver: Address;
  readonly arbiter: Address;
  readonly pauser: Address;
  readonly paused: boolean;
  readonly totalOutstandingLiability: bigint;
}

export interface AccountingSummary {
  readonly deposited: bigint;
  readonly outstanding: bigint;
  readonly paid: bigint;
  readonly claimable: bigint;
  readonly expectedOutstanding: bigint;
  readonly localConservation: boolean;
  readonly entitlementConservation: boolean;
  readonly nonNegative: boolean;
}

export interface ChallengeInspection {
  readonly snapshot: ReleaseSnapshot;
  readonly challenge: ChallengeState;
  readonly entitlements: ReadonlyMap<Address, EntitlementState>;
  readonly accounting: AccountingSummary;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"0".repeat(64)}`;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const RELEASE_CONSTANTS = {
  protocolVersion: "challenge-escrow-protocol/v1",
  eventProtocolId: "challenge-escrow-event/v1",
  challengeSchemaId: "challenge-escrow.spec/v1",
  evidenceSchemaId: "challenge-escrow.evidence/v1",
  conditionLanguageId: "challenge-escrow.condition-language/v1",
  termsDomain: "challenge-escrow.terms/v1",
  specDomain: "challenge-escrow.spec/v1",
  evidenceDomain: "challenge-escrow.evidence/v1",
} as const;

function fail(message: string): never {
  throw new Error(`challenge-client: ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function field(value: unknown, name: string, index: number, label: string): unknown {
  if (Array.isArray(value)) {
    if (index >= value.length) fail(`${label}.${name} is missing at tuple index ${index}`);
    return value[index];
  }
  const object = record(value, label);
  if (!Object.hasOwn(object, name)) fail(`${label}.${name} is missing`);
  return object[name];
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label} must be boolean`);
  return value;
}

function integer(value: unknown, label: string): bigint {
  let parsed: bigint;
  if (typeof value === "bigint" && value >= 0n) parsed = value;
  else if (typeof value === "string" && value.length <= 78 && /^(0|[1-9][0-9]*)$/.test(value)) parsed = BigInt(value);
  else fail(`${label} must be an unsigned ABI integer without a precision-losing number`);
  if (parsed > MAX_UINT256) fail(`${label} exceeds uint256`);
  return parsed;
}

function uint64(value: unknown, label: string): bigint {
  const parsed = integer(value, label);
  if (parsed > MAX_UINT64) fail(`${label} exceeds uint64`);
  return parsed;
}

function smallInteger(value: unknown, label: string, maximum: number): number {
  const parsed = integer(value, label);
  if (parsed > BigInt(maximum)) fail(`${label} is outside the enum range`);
  return Number(parsed);
}

function hash(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail(`${label} must be bytes32`);
  return value.toLowerCase() as Hex;
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) fail(`${label} must be an address`);
  return value.toLowerCase() as Address;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 256) fail(`${label} must be a bounded string`);
  return value;
}

function enumValue<T extends string>(value: unknown, label: string, values: readonly T[]): T {
  const index = smallInteger(value, label, values.length - 1);
  return values[index];
}

function nested(value: unknown, label: string): unknown {
  if (!Array.isArray(value) && (!value || typeof value !== "object")) fail(`${label} must be a tuple or object`);
  return value;
}

function reasonPair(outcome: Outcome, abReason: number, evidenceVoidReason: number, label: string): void {
  if (outcome === "VOID" ? abReason !== 0 : evidenceVoidReason !== 0) {
    fail(`${label} carries a non-canonical unused reason`);
  }
}

function readTarget(address_: unknown, blockTag: unknown): { address: Address; blockTag?: bigint } {
  const contractAddress = address(address_, "contract address");
  if (contractAddress === ZERO_ADDRESS) fail("contract address cannot be zero");
  return blockTag === undefined
    ? { address: contractAddress }
    : { address: contractAddress, blockTag: uint64(blockTag, "blockTag") };
}

function decodeProposal(raw: unknown): ProposalState {
  const value = nested(raw, "proposal");
  return {
    exists: boolean(field(value, "exists", 0, "proposal"), "proposal.exists"),
    outcome: enumValue(field(value, "outcome", 1, "proposal"), "proposal.outcome", ["A", "B", "VOID"]),
    abReason: smallInteger(field(value, "abReason", 2, "proposal"), "proposal.abReason", 3),
    evidenceVoidReason: smallInteger(field(value, "evidenceVoidReason", 3, "proposal"), "proposal.evidenceVoidReason", 5),
    evidenceHash: hash(field(value, "evidenceHash", 4, "proposal"), "proposal.evidenceHash"),
    proposedAt: uint64(field(value, "proposedAt", 5, "proposal"), "proposal.proposedAt"),
    disputeDeadline: uint64(field(value, "disputeDeadline", 6, "proposal"), "proposal.disputeDeadline"),
  };
}

function decodeDispute(raw: unknown): DisputeState {
  const value = nested(raw, "dispute");
  return {
    exists: boolean(field(value, "exists", 0, "dispute"), "dispute.exists"),
    disputingWallet: address(field(value, "disputingWallet", 1, "dispute"), "dispute.disputingWallet"),
    outcome: enumValue(field(value, "outcome", 2, "dispute"), "dispute.outcome", ["A", "B", "VOID"]),
    abReason: smallInteger(field(value, "abReason", 3, "dispute"), "dispute.abReason", 3),
    evidenceVoidReason: smallInteger(field(value, "evidenceVoidReason", 4, "dispute"), "dispute.evidenceVoidReason", 5),
    evidenceHash: hash(field(value, "evidenceHash", 5, "dispute"), "dispute.evidenceHash"),
    parentEvidenceHash: hash(field(value, "parentEvidenceHash", 6, "dispute"), "dispute.parentEvidenceHash"),
    disputedAt: uint64(field(value, "disputedAt", 7, "dispute"), "dispute.disputedAt"),
    arbitrationStart: uint64(field(value, "arbitrationStart", 8, "dispute"), "dispute.arbitrationStart"),
    arbitrationDeadline: uint64(field(value, "arbitrationDeadline", 9, "dispute"), "dispute.arbitrationDeadline"),
  };
}

function decodeFinalResolution(raw: unknown): FinalResolutionState {
  const value = nested(raw, "finalResolution");
  return {
    exists: boolean(field(value, "exists", 0, "finalResolution"), "finalResolution.exists"),
    outcome: enumValue(field(value, "outcome", 1, "finalResolution"), "finalResolution.outcome", ["A", "B", "VOID"]),
    abReason: smallInteger(field(value, "abReason", 2, "finalResolution"), "finalResolution.abReason", 3),
    evidenceVoidReason: smallInteger(field(value, "evidenceVoidReason", 3, "finalResolution"), "finalResolution.evidenceVoidReason", 5),
    timeoutVoidReason: smallInteger(field(value, "timeoutVoidReason", 4, "finalResolution"), "finalResolution.timeoutVoidReason", 1),
    resolutionPath: smallInteger(field(value, "resolutionPath", 5, "finalResolution"), "finalResolution.resolutionPath", 1),
    voidPath: smallInteger(field(value, "voidPath", 6, "finalResolution"), "finalResolution.voidPath", 3),
    finalEvidenceHash: hash(field(value, "finalEvidenceHash", 7, "finalResolution"), "finalResolution.finalEvidenceHash"),
    parentEvidenceHash: hash(field(value, "parentEvidenceHash", 8, "finalResolution"), "finalResolution.parentEvidenceHash"),
    finalizedBy: address(field(value, "finalizedBy", 9, "finalResolution"), "finalResolution.finalizedBy"),
  };
}

function validateAbsentNestedState(challenge: ChallengeState): void {
  const proposal = challenge.proposal;
  if (
    !proposal.exists
    && (
      proposal.outcome !== "A"
      || proposal.abReason !== 0
      || proposal.evidenceVoidReason !== 0
      || proposal.evidenceHash !== ZERO_HASH
      || proposal.proposedAt !== 0n
      || proposal.disputeDeadline !== 0n
    )
  ) fail("absent proposal is not a canonical zero tuple");

  const dispute = challenge.dispute;
  if (
    !dispute.exists
    && (
      dispute.disputingWallet !== ZERO_ADDRESS
      || dispute.outcome !== "A"
      || dispute.abReason !== 0
      || dispute.evidenceVoidReason !== 0
      || dispute.evidenceHash !== ZERO_HASH
      || dispute.parentEvidenceHash !== ZERO_HASH
      || dispute.disputedAt !== 0n
      || dispute.arbitrationStart !== 0n
      || dispute.arbitrationDeadline !== 0n
    )
  ) fail("absent dispute is not a canonical zero tuple");

  const final = challenge.finalResolution;
  if (
    !final.exists
    && (
      final.outcome !== "A"
      || final.abReason !== 0
      || final.evidenceVoidReason !== 0
      || final.timeoutVoidReason !== 0
      || final.resolutionPath !== 0
      || final.voidPath !== 0
      || final.finalEvidenceHash !== ZERO_HASH
      || final.parentEvidenceHash !== ZERO_HASH
      || final.finalizedBy !== ZERO_ADDRESS
    )
  ) fail("absent final resolution is not a canonical zero tuple");
}

function validateChallenge(challenge: ChallengeState): void {
  validateAbsentNestedState(challenge);
  if (!challenge.exists) {
    const zeroIntegers = [
      challenge.stakeAmount,
      challenge.acceptanceNonce,
      challenge.depositedAmount,
      challenge.outstandingLiability,
      challenge.openedAt,
      challenge.createdAt,
      challenge.acceptedAt,
      challenge.acceptanceDeadline,
      challenge.observationTime,
      challenge.sourceCorrectionCutoff,
      challenge.proposalDeadline,
      challenge.disputeWindowSeconds,
      challenge.arbitrationWindowSeconds,
      challenge.timeoutVoidAt,
      challenge.proposal.proposedAt,
      challenge.proposal.disputeDeadline,
      challenge.dispute.disputedAt,
      challenge.dispute.arbitrationStart,
      challenge.dispute.arbitrationDeadline,
    ];
    if (
      challenge.state !== "OPEN"
      || challenge.challengerSide !== "A"
      || [challenge.specHash, challenge.executionHash, challenge.termsHash, challenge.instanceNonce].some((value) => value !== ZERO_HASH)
      || [challenge.challengerWallet, challenge.acceptingWallet, challenge.dispute.disputingWallet, challenge.finalResolution.finalizedBy].some((value) => value !== ZERO_ADDRESS)
      || zeroIntegers.some((value) => value !== 0n)
      || challenge.proposal.exists
      || challenge.proposal.outcome !== "A"
      || challenge.proposal.abReason !== 0
      || challenge.proposal.evidenceVoidReason !== 0
      || challenge.proposal.evidenceHash !== ZERO_HASH
      || challenge.dispute.exists
      || challenge.dispute.outcome !== "A"
      || challenge.dispute.abReason !== 0
      || challenge.dispute.evidenceVoidReason !== 0
      || challenge.dispute.evidenceHash !== ZERO_HASH
      || challenge.dispute.parentEvidenceHash !== ZERO_HASH
      || challenge.finalResolution.exists
      || challenge.finalResolution.outcome !== "A"
      || challenge.finalResolution.abReason !== 0
      || challenge.finalResolution.evidenceVoidReason !== 0
      || challenge.finalResolution.timeoutVoidReason !== 0
      || challenge.finalResolution.resolutionPath !== 0
      || challenge.finalResolution.voidPath !== 0
      || challenge.finalResolution.finalEvidenceHash !== ZERO_HASH
      || challenge.finalResolution.parentEvidenceHash !== ZERO_HASH
    ) fail("absent challenge is not a canonical zero tuple");
    return;
  }
  for (const [label, value] of [
    ["specHash", challenge.specHash],
    ["executionHash", challenge.executionHash],
    ["termsHash", challenge.termsHash],
    ["instanceNonce", challenge.instanceNonce],
  ] as const) {
    if (value === ZERO_HASH) fail(`challenge.${label} cannot be zero`);
  }
  if (challenge.challengerWallet === ZERO_ADDRESS) fail("challenge.challengerWallet cannot be zero");
  if (challenge.stakeAmount === 0n || challenge.stakeAmount > MAX_UINT256 / 2n) fail("challenge.stakeAmount is outside the production range");
  if (
    challenge.createdAt > challenge.openedAt
    || challenge.openedAt >= challenge.acceptanceDeadline
    || challenge.acceptanceDeadline >= challenge.observationTime
    || challenge.observationTime >= challenge.sourceCorrectionCutoff
    || challenge.sourceCorrectionCutoff >= challenge.proposalDeadline
  ) fail("challenge deadline ordering is invalid");
  if (challenge.disputeWindowSeconds === 0n || challenge.arbitrationWindowSeconds === 0n) {
    fail("challenge windows must be positive");
  }
  if (challenge.sourceCorrectionCutoff >= challenge.observationTime + challenge.disputeWindowSeconds) {
    fail("challenge correction cutoff exceeds the dispute boundary");
  }
  const latestProposalPath = challenge.proposalDeadline
    + challenge.disputeWindowSeconds
    + challenge.arbitrationWindowSeconds;
  const latestCorrectionPath = challenge.sourceCorrectionCutoff + challenge.arbitrationWindowSeconds;
  if (latestProposalPath > challenge.timeoutVoidAt || latestCorrectionPath > challenge.timeoutVoidAt) {
    fail("challenge timeout does not cover every authority path");
  }
  const openOnly = ["OPEN", "CANCELLED", "EXPIRED"].includes(challenge.state);
  if (openOnly) {
    if (challenge.acceptingWallet !== ZERO_ADDRESS || challenge.acceptedAt !== 0n) {
      fail("unaccepted challenge contains an accepting wallet or timestamp");
    }
    if (challenge.depositedAmount !== challenge.stakeAmount) fail("unaccepted challenge deposit is invalid");
  } else {
    if (
      challenge.acceptingWallet === ZERO_ADDRESS
      || challenge.acceptingWallet === challenge.challengerWallet
      || challenge.acceptedAt < challenge.openedAt
      || challenge.acceptedAt >= challenge.acceptanceDeadline
    ) fail("accepted challenge identity or timestamp is invalid");
    if (challenge.depositedAmount !== challenge.stakeAmount * 2n) fail("accepted challenge deposit is invalid");
  }
  if (challenge.outstandingLiability > challenge.depositedAmount) fail("challenge liability exceeds deposits");

  const live = ["OPEN", "ACTIVE", "PROPOSED", "DISPUTED"].includes(challenge.state);
  const validOutstanding = live
    ? challenge.outstandingLiability === challenge.depositedAmount
    : challenge.state === "VOID"
      ? [0n, challenge.stakeAmount, challenge.stakeAmount * 2n].includes(challenge.outstandingLiability)
      : [0n, challenge.depositedAmount].includes(challenge.outstandingLiability);
  if (!validOutstanding) fail("challenge liability is not a reachable payout step");

  const proposalRequired = ["PROPOSED", "DISPUTED", "RESOLVED_A", "RESOLVED_B"].includes(challenge.state);
  const disputeRequired = challenge.state === "DISPUTED";
  const finalRequired = ["RESOLVED_A", "RESOLVED_B", "VOID"].includes(challenge.state);
  if (proposalRequired && !challenge.proposal.exists) fail("challenge state requires a proposal");
  if (disputeRequired && !challenge.dispute.exists) fail("challenge state requires a dispute");
  if (finalRequired !== challenge.finalResolution.exists) fail("challenge final-resolution flag does not match state");
  if (["OPEN", "ACTIVE", "CANCELLED", "EXPIRED"].includes(challenge.state) && (challenge.proposal.exists || challenge.dispute.exists)) {
    fail("challenge state contains premature evidence state");
  }
  if (challenge.state === "PROPOSED" && challenge.dispute.exists) fail("proposed challenge contains a premature dispute");

  if (challenge.proposal.exists) {
    reasonPair(challenge.proposal.outcome, challenge.proposal.abReason, challenge.proposal.evidenceVoidReason, "challenge proposal");
    if (
      challenge.proposal.evidenceHash === ZERO_HASH
      || challenge.proposal.proposedAt < challenge.observationTime
      || challenge.proposal.proposedAt >= challenge.proposalDeadline
      || challenge.proposal.disputeDeadline !== challenge.proposal.proposedAt + challenge.disputeWindowSeconds
      || (challenge.proposal.outcome === "VOID"
        && challenge.proposal.evidenceVoidReason !== 5
        && challenge.proposal.proposedAt < challenge.sourceCorrectionCutoff)
    ) fail("challenge proposal is internally inconsistent");
  }
  if (challenge.dispute.exists) {
    reasonPair(challenge.dispute.outcome, challenge.dispute.abReason, challenge.dispute.evidenceVoidReason, "challenge dispute");
    const expectedStart = challenge.dispute.disputedAt < challenge.sourceCorrectionCutoff
      ? challenge.sourceCorrectionCutoff
      : challenge.dispute.disputedAt;
    if (
      !challenge.proposal.exists
      || challenge.dispute.disputingWallet === ZERO_ADDRESS
      || ![challenge.challengerWallet, challenge.acceptingWallet].includes(challenge.dispute.disputingWallet)
      || challenge.dispute.evidenceHash === ZERO_HASH
      || challenge.dispute.parentEvidenceHash !== challenge.proposal.evidenceHash
      || challenge.dispute.outcome === challenge.proposal.outcome
      || challenge.dispute.disputedAt < challenge.proposal.proposedAt
      || challenge.dispute.disputedAt >= challenge.proposal.disputeDeadline
      || challenge.dispute.arbitrationStart !== expectedStart
      || challenge.dispute.arbitrationDeadline !== expectedStart + challenge.arbitrationWindowSeconds
    ) fail("challenge dispute is internally inconsistent");
  }
  if (challenge.finalResolution.exists) {
    const final = challenge.finalResolution;
    if (final.finalizedBy === ZERO_ADDRESS) fail("challenge finalizer cannot be zero");
    reasonPair(final.outcome, final.abReason, final.evidenceVoidReason, "challenge final resolution");
    if (challenge.state === "RESOLVED_A" && final.outcome !== "A") fail("resolved-A state carries another outcome");
    if (challenge.state === "RESOLVED_B" && final.outcome !== "B") fail("resolved-B state carries another outcome");
    if (challenge.state === "VOID" && final.outcome !== "VOID") fail("void state carries another outcome");

    if (final.outcome !== "VOID") {
      if (!challenge.proposal.exists || final.finalEvidenceHash === ZERO_HASH || final.timeoutVoidReason !== 0 || final.voidPath !== 0) {
        fail("resolved challenge carries invalid final-resolution fields");
      }
      if (final.resolutionPath === 0) {
        if (
          challenge.dispute.exists
          || final.outcome !== challenge.proposal.outcome
          || final.abReason !== challenge.proposal.abReason
          || final.finalEvidenceHash !== challenge.proposal.evidenceHash
          || final.parentEvidenceHash !== ZERO_HASH
        ) {
          fail("uncontested resolution has invalid evidence lineage");
        }
      } else if (
        !challenge.dispute.exists
        || final.parentEvidenceHash !== challenge.dispute.evidenceHash
      ) fail("arbitrated resolution has invalid evidence lineage");
    } else {
      if (final.resolutionPath !== 0) fail("void resolution carries a non-default resolution path");
      if (final.voidPath <= 1) {
        if (final.finalEvidenceHash === ZERO_HASH || final.timeoutVoidReason !== 0) {
          fail("evidence void carries invalid final evidence");
        }
        if (final.voidPath === 0) {
          if (
            !challenge.proposal.exists
            || challenge.dispute.exists
            || challenge.proposal.outcome !== "VOID"
            || final.evidenceVoidReason !== challenge.proposal.evidenceVoidReason
            || final.finalEvidenceHash !== challenge.proposal.evidenceHash
            || final.parentEvidenceHash !== ZERO_HASH
          ) {
            fail("uncontested evidence void has invalid lineage");
          }
        } else if (!challenge.dispute.exists || final.parentEvidenceHash !== challenge.dispute.evidenceHash) {
          fail("arbitrated evidence void has invalid lineage");
        }
      } else {
        if (
          final.evidenceVoidReason !== 0
          || final.finalEvidenceHash !== ZERO_HASH
          || final.parentEvidenceHash !== ZERO_HASH
        ) {
          fail("timeout void carries non-canonical evidence fields");
        }
        if (final.voidPath === 2) {
          if (challenge.proposal.exists || challenge.dispute.exists || final.timeoutVoidReason !== 0) {
            fail("proposal-timeout void has invalid history");
          }
        } else if (!challenge.proposal.exists || !challenge.dispute.exists || final.timeoutVoidReason !== 1) {
          fail("arbitration-timeout void has invalid history");
        }
      }
    }
  }
}

export function decodeChallenge(raw: unknown): ChallengeState {
  const challenge: ChallengeState = {
    exists: boolean(field(raw, "exists", 0, "challenge"), "challenge.exists"),
    state: enumValue(field(raw, "state", 1, "challenge"), "challenge.state", ["OPEN", "ACTIVE", "PROPOSED", "DISPUTED", "CANCELLED", "EXPIRED", "RESOLVED_A", "RESOLVED_B", "VOID"]),
    specHash: hash(field(raw, "specHash", 2, "challenge"), "challenge.specHash"),
    executionHash: hash(field(raw, "executionHash", 3, "challenge"), "challenge.executionHash"),
    termsHash: hash(field(raw, "termsHash", 4, "challenge"), "challenge.termsHash"),
    instanceNonce: hash(field(raw, "instanceNonce", 5, "challenge"), "challenge.instanceNonce"),
    challengerWallet: address(field(raw, "challengerWallet", 6, "challenge"), "challenge.challengerWallet"),
    acceptingWallet: address(field(raw, "acceptingWallet", 7, "challenge"), "challenge.acceptingWallet"),
    challengerSide: enumValue(field(raw, "challengerSide", 8, "challenge"), "challenge.challengerSide", ["A", "B"]),
    stakeAmount: integer(field(raw, "stakeAmount", 9, "challenge"), "challenge.stakeAmount"),
    acceptanceNonce: integer(field(raw, "acceptanceNonce", 10, "challenge"), "challenge.acceptanceNonce"),
    depositedAmount: integer(field(raw, "depositedAmount", 11, "challenge"), "challenge.depositedAmount"),
    outstandingLiability: integer(field(raw, "outstandingLiability", 12, "challenge"), "challenge.outstandingLiability"),
    openedAt: uint64(field(raw, "openedAt", 13, "challenge"), "challenge.openedAt"),
    createdAt: uint64(field(raw, "createdAt", 14, "challenge"), "challenge.createdAt"),
    acceptedAt: uint64(field(raw, "acceptedAt", 15, "challenge"), "challenge.acceptedAt"),
    acceptanceDeadline: uint64(field(raw, "acceptanceDeadline", 16, "challenge"), "challenge.acceptanceDeadline"),
    observationTime: uint64(field(raw, "observationTime", 17, "challenge"), "challenge.observationTime"),
    sourceCorrectionCutoff: uint64(field(raw, "sourceCorrectionCutoff", 18, "challenge"), "challenge.sourceCorrectionCutoff"),
    proposalDeadline: uint64(field(raw, "proposalDeadline", 19, "challenge"), "challenge.proposalDeadline"),
    disputeWindowSeconds: uint64(field(raw, "disputeWindowSeconds", 20, "challenge"), "challenge.disputeWindowSeconds"),
    arbitrationWindowSeconds: uint64(field(raw, "arbitrationWindowSeconds", 21, "challenge"), "challenge.arbitrationWindowSeconds"),
    timeoutVoidAt: uint64(field(raw, "timeoutVoidAt", 22, "challenge"), "challenge.timeoutVoidAt"),
    proposal: decodeProposal(field(raw, "proposal", 23, "challenge")),
    dispute: decodeDispute(field(raw, "dispute", 24, "challenge")),
    finalResolution: decodeFinalResolution(field(raw, "finalResolution", 25, "challenge")),
  };
  validateChallenge(challenge);
  return challenge;
}

export function decodeEntitlement(raw: unknown): EntitlementState {
  const entitlement: EntitlementState = {
    exists: boolean(field(raw, "exists", 0, "entitlement"), "entitlement.exists"),
    claimableAmount: integer(field(raw, "claimableAmount", 1, "entitlement"), "entitlement.claimableAmount"),
    paidAmount: integer(field(raw, "paidAmount", 2, "entitlement"), "entitlement.paidAmount"),
  };
  validateEntitlementState(entitlement, "entitlement");
  return entitlement;
}

function validateEntitlementState(entitlement: EntitlementState, label: string): void {
  if (
    !entitlement
    || typeof entitlement !== "object"
    || typeof entitlement.exists !== "boolean"
    || typeof entitlement.claimableAmount !== "bigint"
    || entitlement.claimableAmount < 0n
    || entitlement.claimableAmount > MAX_UINT256
    || typeof entitlement.paidAmount !== "bigint"
    || entitlement.paidAmount < 0n
    || entitlement.paidAmount > MAX_UINT256
  ) fail(`${label} is malformed`);
  if (!entitlement.exists && (entitlement.claimableAmount !== 0n || entitlement.paidAmount !== 0n)) {
    fail(`absent ${label} carries a balance`);
  }
  if (entitlement.exists && entitlement.claimableAmount === 0n && entitlement.paidAmount === 0n) {
    fail(`present ${label} has no claimable or paid balance`);
  }
  if (entitlement.claimableAmount !== 0n && entitlement.paidAmount !== 0n) {
    fail(`${label} is simultaneously claimable and paid`);
  }
}

export function summarizeAccounting(
  challenge: ChallengeState,
  entitlements: Iterable<EntitlementState>,
): AccountingSummary {
  validateChallenge(challenge);
  let paid = 0n;
  let claimable = 0n;
  let index = 0;
  for (const entitlement of entitlements) {
    if (index >= 2) fail("entitlement set exceeds the two-participant protocol boundary");
    validateEntitlementState(entitlement, `entitlements[${index}]`);
    paid += entitlement.paidAmount;
    claimable += entitlement.claimableAmount;
    if (paid > MAX_UINT256 || claimable > MAX_UINT256) fail("entitlement totals exceed uint256");
    index += 1;
  }
  const expectedOutstanding = challenge.depositedAmount - paid;
  const terminal = ["CANCELLED", "EXPIRED", "RESOLVED_A", "RESOLVED_B", "VOID"].includes(challenge.state);
  return {
    deposited: challenge.depositedAmount,
    outstanding: challenge.outstandingLiability,
    paid,
    claimable,
    expectedOutstanding,
    localConservation: expectedOutstanding === challenge.outstandingLiability,
    entitlementConservation: terminal
      ? paid + claimable === challenge.depositedAmount
      : paid === 0n && claimable === 0n,
    nonNegative: challenge.outstandingLiability >= 0n && expectedOutstanding >= 0n,
  };
}

export async function readChallenge(
  provider: ReadProvider,
  address_: Address,
  challengeId: Hex,
  blockTag?: bigint,
): Promise<ChallengeState> {
  const target = readTarget(address_, blockTag);
  const normalizedChallengeId = hash(challengeId, "challengeId");
  const raw = await provider.readContract({ ...target, functionName: "getChallenge", args: [normalizedChallengeId] });
  return decodeChallenge(raw);
}

export async function readEntitlement(
  provider: ReadProvider,
  address_: Address,
  challengeId: Hex,
  wallet: Address,
  blockTag?: bigint,
): Promise<EntitlementState> {
  const target = readTarget(address_, blockTag);
  const normalizedChallengeId = hash(challengeId, "challengeId");
  const normalizedWallet = address(wallet, "wallet");
  if (normalizedWallet === ZERO_ADDRESS) fail("wallet cannot be zero");
  const raw = await provider.readContract({ ...target, functionName: "getEntitlement", args: [normalizedChallengeId, normalizedWallet] });
  return decodeEntitlement(raw);
}

export async function readReleaseSnapshot(provider: ReadProvider, address_: Address, blockTag?: bigint): Promise<ReleaseSnapshot> {
  const target = readTarget(address_, blockTag);
  const read = <T>(functionName: string): Promise<T> => provider.readContract<T>({ ...target, functionName });
  const [releaseId, protocolVersion, eventProtocolId, challengeSchemaId, evidenceSchemaId, conditionLanguageId, termsDomain, specDomain, evidenceDomain, canonicalToken, tokenDecimals, resolver, arbiter, pauser, paused, totalOutstandingLiability] = await Promise.all([
    read<unknown>("releaseId"), read<unknown>("PROTOCOL_VERSION"), read<unknown>("EVENT_PROTOCOL_ID"), read<unknown>("CHALLENGE_SCHEMA_ID"), read<unknown>("EVIDENCE_SCHEMA_ID"), read<unknown>("CONDITION_LANGUAGE_ID"), read<unknown>("TERMS_DOMAIN"), read<unknown>("SPEC_DOMAIN"), read<unknown>("EVIDENCE_DOMAIN"), read<unknown>("canonicalToken"), read<unknown>("tokenDecimals"), read<unknown>("resolver"), read<unknown>("arbiter"), read<unknown>("pauser"), read<unknown>("paused"), read<unknown>("totalOutstandingLiability"),
  ]);
  const snapshot = {
    releaseId: hash(releaseId, "releaseId"),
    protocolVersion: text(protocolVersion, "PROTOCOL_VERSION"),
    eventProtocolId: text(eventProtocolId, "EVENT_PROTOCOL_ID"),
    challengeSchemaId: text(challengeSchemaId, "CHALLENGE_SCHEMA_ID"),
    evidenceSchemaId: text(evidenceSchemaId, "EVIDENCE_SCHEMA_ID"),
    conditionLanguageId: text(conditionLanguageId, "CONDITION_LANGUAGE_ID"),
    termsDomain: text(termsDomain, "TERMS_DOMAIN"),
    specDomain: text(specDomain, "SPEC_DOMAIN"),
    evidenceDomain: text(evidenceDomain, "EVIDENCE_DOMAIN"),
    canonicalToken: address(canonicalToken, "canonicalToken"),
    tokenDecimals: smallInteger(tokenDecimals, "tokenDecimals", 18),
    resolver: address(resolver, "resolver"),
    arbiter: address(arbiter, "arbiter"),
    pauser: address(pauser, "pauser"),
    paused: boolean(paused, "paused"),
    totalOutstandingLiability: integer(totalOutstandingLiability, "totalOutstandingLiability"),
  };
  if (snapshot.releaseId === ZERO_HASH) fail("releaseId cannot be zero");
  for (const [key, expected] of Object.entries(RELEASE_CONSTANTS)) {
    if (snapshot[key as keyof typeof RELEASE_CONSTANTS] !== expected) fail(`${key} does not identify the supported release`);
  }
  const roles = [target.address, snapshot.canonicalToken, snapshot.resolver, snapshot.arbiter, snapshot.pauser];
  if (roles.includes(ZERO_ADDRESS as Address)) fail("release roles cannot be zero");
  if (new Set(roles).size !== roles.length) fail("release roles must be pairwise distinct");
  return snapshot;
}

export async function inspectChallenge(
  provider: ReadProvider,
  address_: Address,
  challengeId: Hex,
  blockTag?: bigint,
): Promise<ChallengeInspection> {
  if (blockTag === undefined) fail("inspectChallenge requires an explicit blockTag");
  const [snapshot, challenge] = await Promise.all([
    readReleaseSnapshot(provider, address_, blockTag),
    readChallenge(provider, address_, challengeId, blockTag),
  ]);
  if (!challenge.exists) fail(`challenge ${challengeId} does not exist`);
  const targetAddress = address(address_, "contract address");
  const forbiddenParticipants = new Set([
    targetAddress,
    snapshot.canonicalToken,
    snapshot.resolver,
    snapshot.arbiter,
    snapshot.pauser,
  ]);
  if (
    forbiddenParticipants.has(challenge.challengerWallet)
    || (challenge.acceptingWallet !== ZERO_ADDRESS && forbiddenParticipants.has(challenge.acceptingWallet))
  ) fail("challenge participant overlaps the release boundary");
  if (snapshot.totalOutstandingLiability < challenge.outstandingLiability) {
    fail("challenge liability exceeds the release aggregate liability");
  }
  const final = challenge.finalResolution;
  const arbiterPath = final.exists
    && (final.outcome === "VOID" ? final.voidPath === 1 : final.resolutionPath === 1);
  if (arbiterPath && final.finalizedBy !== snapshot.arbiter) {
    fail("arbitrated final resolution was not finalized by the release arbiter");
  }
  const wallets = [...new Set([challenge.challengerWallet, challenge.acceptingWallet])]
    .filter((wallet) => wallet !== ZERO_ADDRESS) as Address[];
  const entries = await Promise.all(wallets.map(async (wallet) => [wallet, await readEntitlement(provider, address_, challengeId, wallet, blockTag)] as const));
  const entitlements = new Map<Address, EntitlementState>(entries);
  const accounting = summarizeAccounting(challenge, entitlements.values());
  if (!accounting.localConservation || !accounting.entitlementConservation || !accounting.nonNegative) {
    fail("challenge accounting does not conserve the decoded deposits");
  }
  return { snapshot, challenge, entitlements, accounting };
}

export const ZERO_VALUES = { ZERO_ADDRESS, ZERO_HASH } as const;
