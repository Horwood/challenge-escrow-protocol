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
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  fail(`${label} must be an ABI integer without a precision-losing number`);
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
  if (typeof value !== "string") fail(`${label} must be a string`);
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

function decodeProposal(raw: unknown): ProposalState {
  const value = nested(raw, "proposal");
  return {
    exists: boolean(field(value, "exists", 0, "proposal"), "proposal.exists"),
    outcome: enumValue(field(value, "outcome", 1, "proposal"), "proposal.outcome", ["A", "B", "VOID"]),
    abReason: smallInteger(field(value, "abReason", 2, "proposal"), "proposal.abReason", 3),
    evidenceVoidReason: smallInteger(field(value, "evidenceVoidReason", 3, "proposal"), "proposal.evidenceVoidReason", 5),
    evidenceHash: hash(field(value, "evidenceHash", 4, "proposal"), "proposal.evidenceHash"),
    proposedAt: integer(field(value, "proposedAt", 5, "proposal"), "proposal.proposedAt"),
    disputeDeadline: integer(field(value, "disputeDeadline", 6, "proposal"), "proposal.disputeDeadline"),
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
    disputedAt: integer(field(value, "disputedAt", 7, "dispute"), "dispute.disputedAt"),
    arbitrationStart: integer(field(value, "arbitrationStart", 8, "dispute"), "dispute.arbitrationStart"),
    arbitrationDeadline: integer(field(value, "arbitrationDeadline", 9, "dispute"), "dispute.arbitrationDeadline"),
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

export function decodeChallenge(raw: unknown): ChallengeState {
  return {
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
    openedAt: integer(field(raw, "openedAt", 13, "challenge"), "challenge.openedAt"),
    createdAt: integer(field(raw, "createdAt", 14, "challenge"), "challenge.createdAt"),
    acceptedAt: integer(field(raw, "acceptedAt", 15, "challenge"), "challenge.acceptedAt"),
    acceptanceDeadline: integer(field(raw, "acceptanceDeadline", 16, "challenge"), "challenge.acceptanceDeadline"),
    observationTime: integer(field(raw, "observationTime", 17, "challenge"), "challenge.observationTime"),
    sourceCorrectionCutoff: integer(field(raw, "sourceCorrectionCutoff", 18, "challenge"), "challenge.sourceCorrectionCutoff"),
    proposalDeadline: integer(field(raw, "proposalDeadline", 19, "challenge"), "challenge.proposalDeadline"),
    disputeWindowSeconds: integer(field(raw, "disputeWindowSeconds", 20, "challenge"), "challenge.disputeWindowSeconds"),
    arbitrationWindowSeconds: integer(field(raw, "arbitrationWindowSeconds", 21, "challenge"), "challenge.arbitrationWindowSeconds"),
    timeoutVoidAt: integer(field(raw, "timeoutVoidAt", 22, "challenge"), "challenge.timeoutVoidAt"),
    proposal: decodeProposal(field(raw, "proposal", 23, "challenge")),
    dispute: decodeDispute(field(raw, "dispute", 24, "challenge")),
    finalResolution: decodeFinalResolution(field(raw, "finalResolution", 25, "challenge")),
  };
}

export function decodeEntitlement(raw: unknown): EntitlementState {
  return {
    exists: boolean(field(raw, "exists", 0, "entitlement"), "entitlement.exists"),
    claimableAmount: integer(field(raw, "claimableAmount", 1, "entitlement"), "entitlement.claimableAmount"),
    paidAmount: integer(field(raw, "paidAmount", 2, "entitlement"), "entitlement.paidAmount"),
  };
}

export function summarizeAccounting(
  challenge: ChallengeState,
  entitlements: Iterable<EntitlementState>,
): AccountingSummary {
  let paid = 0n;
  let claimable = 0n;
  for (const entitlement of entitlements) {
    paid += entitlement.paidAmount;
    claimable += entitlement.claimableAmount;
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
  const raw = await provider.readContract({ address: address_, functionName: "getChallenge", args: [challengeId], blockTag });
  return decodeChallenge(raw);
}

export async function readEntitlement(
  provider: ReadProvider,
  address_: Address,
  challengeId: Hex,
  wallet: Address,
  blockTag?: bigint,
): Promise<EntitlementState> {
  const raw = await provider.readContract({ address: address_, functionName: "getEntitlement", args: [challengeId, wallet], blockTag });
  return decodeEntitlement(raw);
}

export async function readReleaseSnapshot(provider: ReadProvider, address_: Address, blockTag?: bigint): Promise<ReleaseSnapshot> {
  const read = <T>(functionName: string): Promise<T> => provider.readContract<T>({ address: address_, functionName, blockTag });
  const [releaseId, protocolVersion, eventProtocolId, challengeSchemaId, evidenceSchemaId, conditionLanguageId, termsDomain, specDomain, evidenceDomain, canonicalToken, tokenDecimals, resolver, arbiter, pauser, paused, totalOutstandingLiability] = await Promise.all([
    read<unknown>("releaseId"), read<unknown>("PROTOCOL_VERSION"), read<unknown>("EVENT_PROTOCOL_ID"), read<unknown>("CHALLENGE_SCHEMA_ID"), read<unknown>("EVIDENCE_SCHEMA_ID"), read<unknown>("CONDITION_LANGUAGE_ID"), read<unknown>("TERMS_DOMAIN"), read<unknown>("SPEC_DOMAIN"), read<unknown>("EVIDENCE_DOMAIN"), read<unknown>("canonicalToken"), read<unknown>("tokenDecimals"), read<unknown>("resolver"), read<unknown>("arbiter"), read<unknown>("pauser"), read<unknown>("paused"), read<unknown>("totalOutstandingLiability"),
  ]);
  const decimals = smallInteger(tokenDecimals, "tokenDecimals", 18);
  return {
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
    tokenDecimals: decimals,
    resolver: address(resolver, "resolver"),
    arbiter: address(arbiter, "arbiter"),
    pauser: address(pauser, "pauser"),
    paused: boolean(paused, "paused"),
    totalOutstandingLiability: integer(totalOutstandingLiability, "totalOutstandingLiability"),
  };
}

export async function inspectChallenge(
  provider: ReadProvider,
  address_: Address,
  challengeId: Hex,
  blockTag?: bigint,
): Promise<ChallengeInspection> {
  const [snapshot, challenge] = await Promise.all([
    readReleaseSnapshot(provider, address_, blockTag),
    readChallenge(provider, address_, challengeId, blockTag),
  ]);
  if (!challenge.exists) fail(`challenge ${challengeId} does not exist`);
  const wallets = [...new Set([challenge.challengerWallet, challenge.acceptingWallet])]
    .filter((wallet) => wallet !== ZERO_ADDRESS) as Address[];
  const entries = await Promise.all(wallets.map(async (wallet) => [wallet, await readEntitlement(provider, address_, challengeId, wallet, blockTag)] as const));
  const entitlements = new Map<Address, EntitlementState>(entries);
  return { snapshot, challenge, entitlements, accounting: summarizeAccounting(challenge, entitlements.values()) };
}

export const ZERO_VALUES = { ZERO_ADDRESS, ZERO_HASH } as const;
