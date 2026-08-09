import type { Address, Hex } from "./index.ts";
import type { ProtocolLog } from "./observer.ts";

export type EventKind =
  | "ReleaseDeclared"
  | "PauseStatusChanged"
  | "ChallengeCreated"
  | "AcceptanceNonceAdvanced"
  | "ChallengeAccepted"
  | "ChallengeCancelled"
  | "ChallengeExpired"
  | "OutcomeProposed"
  | "OutcomeDisputed"
  | "ChallengeResolved"
  | "ChallengeVoided"
  | "WinningsClaimed"
  | "PrincipalRefunded";

export type Side = "A" | "B";
export type Outcome = "A" | "B" | "VOID";

export interface ReleaseDeclaredEvent {
  readonly kind: "ReleaseDeclared";
  readonly releaseId: Hex;
  readonly eventProtocolId: string;
  readonly protocolVersion: string;
  readonly challengeSchemaId: string;
  readonly evidenceSchemaId: string;
  readonly chainId: bigint;
  readonly escrowContract: Address;
  readonly canonicalToken: Address;
  readonly tokenDecimals: number;
  readonly valueMode: number;
  readonly resolver: Address;
  readonly arbiter: Address;
  readonly initialPaused: boolean;
}

export interface PauseStatusChangedEvent {
  readonly kind: "PauseStatusChanged";
  readonly changedBy: Address;
  readonly previousPaused: boolean;
  readonly newPaused: boolean;
}

export interface ChallengeCreatedEvent {
  readonly kind: "ChallengeCreated";
  readonly challengeId: Hex;
  readonly specHash: Hex;
  readonly instanceNonce: Hex;
  readonly challengerWallet: Address;
  readonly challengerSide: Side;
  readonly stakeAmount: bigint;
  readonly acceptanceNonce: bigint;
  readonly acceptanceDeadline: bigint;
  readonly observationTime: bigint;
  readonly sourceCorrectionCutoff: bigint;
  readonly proposalDeadline: bigint;
  readonly disputeWindowSeconds: bigint;
  readonly arbitrationWindowSeconds: bigint;
  readonly timeoutVoidAt: bigint;
  readonly executionHash: Hex;
  readonly termsHash: Hex;
  readonly createdAt: bigint;
}

export interface AcceptanceNonceAdvancedEvent {
  readonly kind: "AcceptanceNonceAdvanced";
  readonly challengeId: Hex;
  readonly challengerWallet: Address;
  readonly previousNonce: bigint;
  readonly newNonce: bigint;
}

export interface ChallengeAcceptedEvent {
  readonly kind: "ChallengeAccepted";
  readonly challengeId: Hex;
  readonly acceptingWallet: Address;
  readonly acceptingSide: Side;
  readonly consumedNonce: bigint;
  readonly permitExpiresAt: bigint;
  readonly stakeAmount: bigint;
}

export interface ChallengeCancelledEvent {
  readonly kind: "ChallengeCancelled";
  readonly challengeId: Hex;
  readonly challengerWallet: Address;
  readonly refundAmount: bigint;
}

export interface ChallengeExpiredEvent {
  readonly kind: "ChallengeExpired";
  readonly challengeId: Hex;
  readonly materializedBy: Address;
  readonly challengerWallet: Address;
  readonly refundAmount: bigint;
}

export interface OutcomeProposedEvent {
  readonly kind: "OutcomeProposed";
  readonly challengeId: Hex;
  readonly resolver: Address;
  readonly assertedOutcome: Outcome;
  readonly reasonCode: number;
  readonly evidenceHash: Hex;
  readonly disputeDeadline: bigint;
}

export interface OutcomeDisputedEvent {
  readonly kind: "OutcomeDisputed";
  readonly challengeId: Hex;
  readonly disputingWallet: Address;
  readonly assertedOutcome: Outcome;
  readonly reasonCode: number;
  readonly evidenceHash: Hex;
  readonly parentEvidenceHash: Hex;
  readonly arbitrationStart: bigint;
  readonly arbitrationDeadline: bigint;
}

export interface ChallengeResolvedEvent {
  readonly kind: "ChallengeResolved";
  readonly challengeId: Hex;
  readonly finalizedBy: Address;
  readonly finalOutcome: Outcome;
  readonly reasonCode: number;
  readonly finalEvidenceHash: Hex;
  readonly parentEvidenceHash: Hex;
  readonly resolutionPath: number;
  readonly winnerWallet: Address;
  readonly claimAmount: bigint;
}

export interface ChallengeVoidedEvent {
  readonly kind: "ChallengeVoided";
  readonly challengeId: Hex;
  readonly materializedBy: Address;
  readonly voidReason: number;
  readonly finalEvidenceHash: Hex;
  readonly parentEvidenceHash: Hex;
  readonly voidPath: number;
  readonly refundAmountEach: bigint;
}

export interface WinningsClaimedEvent {
  readonly kind: "WinningsClaimed";
  readonly challengeId: Hex;
  readonly entitlementId: Hex;
  readonly wallet: Address;
  readonly amount: bigint;
}

export interface PrincipalRefundedEvent {
  readonly kind: "PrincipalRefunded";
  readonly challengeId: Hex;
  readonly entitlementId: Hex;
  readonly wallet: Address;
  readonly originState: number;
  readonly amount: bigint;
}

export type DecodedProtocolEvent =
  | ReleaseDeclaredEvent
  | PauseStatusChangedEvent
  | ChallengeCreatedEvent
  | AcceptanceNonceAdvancedEvent
  | ChallengeAcceptedEvent
  | ChallengeCancelledEvent
  | ChallengeExpiredEvent
  | OutcomeProposedEvent
  | OutcomeDisputedEvent
  | ChallengeResolvedEvent
  | ChallengeVoidedEvent
  | WinningsClaimedEvent
  | PrincipalRefundedEvent;

export interface DecodedProtocolLog {
  readonly log: ProtocolLog;
  readonly event: DecodedProtocolEvent;
}

const signatures: Readonly<Record<string, EventKind>> = {
  "0x58ff9cf3a216732baaf694943f7d64940d5bf1455c9c40a510236b3e1568c2d2": "ReleaseDeclared",
  "0xb8001de07eb4cbba5b9e5f560980990844b6b389db760eab47c8a574fec01d28": "PauseStatusChanged",
  "0x71a9e34d73d92a3126e9f52e7cd3da34eb1cc37d7fd9708d85bb03816bb36836": "ChallengeCreated",
  "0x2fdb0c9000fcf6f0667d7955ee88a49c6684edf296615f4711278761756df33a": "AcceptanceNonceAdvanced",
  "0x75c3f3c74e516cfc210ea6de7f35096bd4f58111091af31db63f1e0ee7d8af1d": "ChallengeAccepted",
  "0x2cb7d696d5bdceff9373644531010b415b2c02e5d1dbf0526b8d877cfcfe4d4e": "ChallengeCancelled",
  "0xbd8c75dd6475654e5e8813516e9fb0e3c7d5e0715ccbb497a534e684300dcb9e": "ChallengeExpired",
  "0x02e3e014f3bd4c526b1c639a4009564b4a58dd7dd1caa072961bd067956b973b": "OutcomeProposed",
  "0x5dad5250aec28d0638dc7bee16d10dbec45733958a6468410fd9d7de0c010699": "OutcomeDisputed",
  "0xe28a0594fee27ebef83e9d8f57c0b688ace28ac6f6829a2e8c22ba1dc7037894": "ChallengeResolved",
  "0xf9632f0f41714fbb81d5d9452bc5025d7e452bb45f742618446dccd3fa1ce67f": "ChallengeVoided",
  "0x4eb2d19e6c39001f1a1c8687743849b1cb3f03696602c47188e2470a3a3c62f5": "WinningsClaimed",
  "0x41a4d4cbbcdc2ac4f0849cd696792f27d785275ffb541a6526d1c438dd7c74e6": "PrincipalRefunded",
};
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;

function fail(message: string): never {
  throw new Error(`event-decoder: ${message}`);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) fail(message);
}

function hexBytes(value: Hex, label: string): Uint8Array {
  assert(/^0x[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0, `${label} is not even-length hex`);
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  return bytes;
}

function word(data: Hex, index: number, label: string): Hex {
  const start = 2 + index * 64;
  assert(data.length >= start + 64, `${label} is truncated at word ${index}`);
  return `0x${data.slice(start, start + 64).toLowerCase()}` as Hex;
}

function words(data: Hex, expected: number, label: string): void {
  assert(data.length === 2 + expected * 64, `${label} expected ${expected} ABI words, got ${(data.length - 2) / 64}`);
}

function headWords(data: Hex, expected: number, label: string): void {
  assert(data.length >= 2 + expected * 64 && (data.length - 2) % 64 === 0, `${label} has a truncated or unaligned ABI payload`);
}

function bytes32(value: Hex, label: string): Hex {
  assert(/^0x[0-9a-fA-F]{64}$/.test(value), `${label} is not bytes32`);
  return value.toLowerCase() as Hex;
}

function uint(value: Hex): bigint {
  return BigInt(value);
}

function uint64(value: Hex, label: string): bigint {
  const parsed = uint(value);
  assert(parsed <= MAX_UINT64, `${label} exceeds uint64`);
  return parsed;
}

function boundedUint(value: Hex, maximum: bigint, label: string): number {
  const parsed = uint(value);
  assert(parsed <= maximum, `${label} is outside its enum range`);
  return Number(parsed);
}

function bool(value: Hex, label: string): boolean {
  const parsed = uint(value);
  assert(parsed === 0n || parsed === 1n, `${label} is not canonical ABI bool`);
  return parsed === 1n;
}

function addressWord(value: Hex, label: string): Address {
  assert(value.slice(2, 26) === "0".repeat(24), `${label} has non-zero address padding`);
  return `0x${value.slice(-40)}`.toLowerCase() as Address;
}

function topic(log: ProtocolLog, index: number, label: string): Hex {
  assert(index < log.topics.length, `${label} topic ${index} is missing`);
  return bytes32(log.topics[index], `${label}.topics[${index}]`);
}

function challengeTopic(log: ProtocolLog, label: string): Hex {
  return nonZeroBytes32(topic(log, 1, label), `${label}.challengeId`);
}

function side(value: Hex, label: string): Side {
  return boundedUint(value, 1n, label) === 0 ? "A" : "B";
}

function outcome(value: Hex, label: string): Outcome {
  const parsed = boundedUint(value, 2n, label);
  return parsed === 0 ? "A" : parsed === 1 ? "B" : "VOID";
}

function reasonCode(value: Hex, assertedOutcome: Outcome, label: string): number {
  return boundedUint(value, assertedOutcome === "VOID" ? 5n : 3n, label);
}

function nonZeroBytes32(value: Hex, label: string): Hex {
  const parsed = bytes32(value, label);
  assert(parsed !== `0x${"0".repeat(64)}`, `${label} must not be zero`);
  return parsed;
}

function nonZeroAddress(value: Hex, label: string): Address {
  const parsed = addressWord(value, label);
  assert(parsed !== `0x${"0".repeat(40)}`, `${label} must not be zero`);
  return parsed;
}

function decodeUtf8(data: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
}

function dynamicString(
  data: Hex,
  offsetWord: Hex,
  headBytes: number,
  expectedStart: number,
  label: string,
): { readonly value: string; readonly end: number } {
  const bytes = hexBytes(data, label);
  const offset = uint(offsetWord);
  assert(offset <= BigInt(Number.MAX_SAFE_INTEGER), `${label} offset exceeds safe local bounds`);
  const start = Number(offset);
  assert(start === expectedStart && start >= headBytes && start % 32 === 0 && start + 32 <= bytes.length, `${label} has a non-canonical ABI offset`);
  const length = uint(word(data, start / 32, label));
  assert(length <= BigInt(Number.MAX_SAFE_INTEGER), `${label} length exceeds safe local bounds`);
  const payloadLength = Number(length);
  const payloadStart = start + 32;
  const paddedLength = Math.ceil(payloadLength / 32) * 32;
  assert(payloadStart + paddedLength <= bytes.length, `${label} payload is truncated`);
  const payload = bytes.slice(payloadStart, payloadStart + payloadLength);
  for (const padding of bytes.slice(payloadStart + payloadLength, payloadStart + paddedLength)) assert(padding === 0, `${label} has non-zero ABI padding`);
  return { value: decodeUtf8(payload, label), end: payloadStart + paddedLength };
}

function decodeReleaseDeclared(log: ProtocolLog): ReleaseDeclaredEvent {
  const label = "ReleaseDeclared";
  assert(log.topics.length === 2, `${label} has an unexpected topic count`);
  headWords(log.data, 12, label);
  const headBytes = 12 * 32;
  const strings: string[] = [];
  let tailEnd = headBytes;
  for (const [index, field] of ["eventProtocolId", "protocolVersion", "challengeSchemaId", "evidenceSchemaId"].entries()) {
    const decoded = dynamicString(log.data, word(log.data, index, label), headBytes, tailEnd, `${label}.${field}`);
    strings.push(decoded.value);
    tailEnd = decoded.end;
  }
  assert(tailEnd === hexBytes(log.data, label).length, `${label} has trailing ABI data`);
  const event: ReleaseDeclaredEvent = {
    kind: "ReleaseDeclared",
    releaseId: topic(log, 1, label),
    eventProtocolId: strings[0],
    protocolVersion: strings[1],
    challengeSchemaId: strings[2],
    evidenceSchemaId: strings[3],
    chainId: uint(word(log.data, 4, label)),
    escrowContract: nonZeroAddress(word(log.data, 5, label), `${label}.escrowContract`),
    canonicalToken: nonZeroAddress(word(log.data, 6, label), `${label}.canonicalToken`),
    tokenDecimals: boundedUint(word(log.data, 7, label), 18n, `${label}.tokenDecimals`),
    valueMode: boundedUint(word(log.data, 8, label), 0n, `${label}.valueMode`),
    resolver: nonZeroAddress(word(log.data, 9, label), `${label}.resolver`),
    arbiter: nonZeroAddress(word(log.data, 10, label), `${label}.arbiter`),
    initialPaused: bool(word(log.data, 11, label), `${label}.initialPaused`),
  };
  assert(event.chainId > 0n, `${label}.chainId must be positive`);
  assert(event.eventProtocolId === "challenge-escrow-event/v1", `${label}.eventProtocolId is unsupported`);
  assert(event.protocolVersion === "challenge-escrow-protocol/v1", `${label}.protocolVersion is unsupported`);
  assert(event.challengeSchemaId === "challenge-escrow.spec/v1", `${label}.challengeSchemaId is unsupported`);
  assert(event.evidenceSchemaId === "challenge-escrow.evidence/v1", `${label}.evidenceSchemaId is unsupported`);
  assert(event.escrowContract === log.address.toLowerCase(), `${label}.escrowContract differs from the log address`);
  assert(new Set([event.escrowContract, event.canonicalToken, event.resolver, event.arbiter]).size === 4, `${label} contains overlapping roles`);
  return event;
}

function decodePauseStatusChanged(log: ProtocolLog): PauseStatusChangedEvent {
  const label = "PauseStatusChanged";
  assert(log.topics.length === 1, `${label} has an unexpected topic count`);
  words(log.data, 3, label);
  const event: PauseStatusChangedEvent = { kind: "PauseStatusChanged", changedBy: nonZeroAddress(word(log.data, 0, label), `${label}.changedBy`), previousPaused: bool(word(log.data, 1, label), `${label}.previousPaused`), newPaused: bool(word(log.data, 2, label), `${label}.newPaused`) };
  assert(event.previousPaused !== event.newPaused, `${label} did not change pause status`);
  return event;
}

function decodeChallengeCreated(log: ProtocolLog): ChallengeCreatedEvent {
  const label = "ChallengeCreated";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 15, label);
  const event: ChallengeCreatedEvent = { kind: "ChallengeCreated", challengeId: challengeTopic(log, label), specHash: nonZeroBytes32(word(log.data, 0, label), `${label}.specHash`), instanceNonce: nonZeroBytes32(word(log.data, 1, label), `${label}.instanceNonce`), challengerWallet: nonZeroAddress(topic(log, 2, label), `${label}.challengerWallet`), challengerSide: side(word(log.data, 2, label), `${label}.challengerSide`), stakeAmount: uint(word(log.data, 3, label)), acceptanceNonce: uint(word(log.data, 4, label)), acceptanceDeadline: uint64(word(log.data, 5, label), `${label}.acceptanceDeadline`), observationTime: uint64(word(log.data, 6, label), `${label}.observationTime`), sourceCorrectionCutoff: uint64(word(log.data, 7, label), `${label}.sourceCorrectionCutoff`), proposalDeadline: uint64(word(log.data, 8, label), `${label}.proposalDeadline`), disputeWindowSeconds: uint64(word(log.data, 9, label), `${label}.disputeWindowSeconds`), arbitrationWindowSeconds: uint64(word(log.data, 10, label), `${label}.arbitrationWindowSeconds`), timeoutVoidAt: uint64(word(log.data, 11, label), `${label}.timeoutVoidAt`), executionHash: nonZeroBytes32(word(log.data, 12, label), `${label}.executionHash`), termsHash: nonZeroBytes32(word(log.data, 13, label), `${label}.termsHash`), createdAt: uint64(word(log.data, 14, label), `${label}.createdAt`) };
  assert(event.stakeAmount > 0n && event.stakeAmount <= MAX_UINT256 / 2n, `${label}.stakeAmount is outside the production range`);
  assert(event.acceptanceNonce === 0n, `${label}.acceptanceNonce must start at zero`);
  assert(event.createdAt < event.acceptanceDeadline && event.acceptanceDeadline < event.observationTime && event.observationTime < event.sourceCorrectionCutoff && event.sourceCorrectionCutoff < event.proposalDeadline, `${label} deadline ordering is invalid`);
  assert(event.disputeWindowSeconds > 0n && event.arbitrationWindowSeconds > 0n, `${label} windows must be positive`);
  assert(event.sourceCorrectionCutoff < event.observationTime + event.disputeWindowSeconds, `${label} correction cutoff exceeds the dispute boundary`);
  assert(event.proposalDeadline + event.disputeWindowSeconds + event.arbitrationWindowSeconds <= event.timeoutVoidAt && event.sourceCorrectionCutoff + event.arbitrationWindowSeconds <= event.timeoutVoidAt, `${label} timeout does not cover every authority path`);
  return event;
}

function decodeAcceptanceNonceAdvanced(log: ProtocolLog): AcceptanceNonceAdvancedEvent {
  const label = "AcceptanceNonceAdvanced";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 2, label);
  const event: AcceptanceNonceAdvancedEvent = { kind: "AcceptanceNonceAdvanced", challengeId: challengeTopic(log, label), challengerWallet: nonZeroAddress(topic(log, 2, label), `${label}.challengerWallet`), previousNonce: uint(word(log.data, 0, label)), newNonce: uint(word(log.data, 1, label)) };
  assert(event.newNonce === event.previousNonce + 1n, `${label} nonce did not advance by one`);
  return event;
}

function decodeChallengeAccepted(log: ProtocolLog): ChallengeAcceptedEvent {
  const label = "ChallengeAccepted";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 4, label);
  const event: ChallengeAcceptedEvent = { kind: "ChallengeAccepted", challengeId: challengeTopic(log, label), acceptingWallet: nonZeroAddress(topic(log, 2, label), `${label}.acceptingWallet`), acceptingSide: side(word(log.data, 0, label), `${label}.acceptingSide`), consumedNonce: uint(word(log.data, 1, label)), permitExpiresAt: uint64(word(log.data, 2, label), `${label}.permitExpiresAt`), stakeAmount: uint(word(log.data, 3, label)) };
  assert(event.permitExpiresAt > 0n && event.stakeAmount > 0n, `${label} permit expiry and stake must be positive`);
  return event;
}

function decodeChallengeCancelled(log: ProtocolLog): ChallengeCancelledEvent {
  const label = "ChallengeCancelled";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 1, label);
  const event: ChallengeCancelledEvent = { kind: "ChallengeCancelled", challengeId: challengeTopic(log, label), challengerWallet: nonZeroAddress(topic(log, 2, label), `${label}.challengerWallet`), refundAmount: uint(word(log.data, 0, label)) };
  assert(event.refundAmount > 0n, `${label}.refundAmount must be positive`);
  return event;
}

function decodeChallengeExpired(log: ProtocolLog): ChallengeExpiredEvent {
  const label = "ChallengeExpired";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 2, label);
  const event: ChallengeExpiredEvent = { kind: "ChallengeExpired", challengeId: challengeTopic(log, label), materializedBy: nonZeroAddress(word(log.data, 0, label), `${label}.materializedBy`), challengerWallet: nonZeroAddress(topic(log, 2, label), `${label}.challengerWallet`), refundAmount: uint(word(log.data, 1, label)) };
  assert(event.refundAmount > 0n, `${label}.refundAmount must be positive`);
  return event;
}

function decodeOutcomeProposed(log: ProtocolLog): OutcomeProposedEvent {
  const label = "OutcomeProposed";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 4, label);
  const assertedOutcome = outcome(word(log.data, 0, label), `${label}.assertedOutcome`);
  return { kind: "OutcomeProposed", challengeId: challengeTopic(log, label), resolver: nonZeroAddress(topic(log, 2, label), `${label}.resolver`), assertedOutcome, reasonCode: reasonCode(word(log.data, 1, label), assertedOutcome, `${label}.reasonCode`), evidenceHash: nonZeroBytes32(word(log.data, 2, label), `${label}.evidenceHash`), disputeDeadline: uint64(word(log.data, 3, label), `${label}.disputeDeadline`) };
}

function decodeOutcomeDisputed(log: ProtocolLog): OutcomeDisputedEvent {
  const label = "OutcomeDisputed";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 6, label);
  const assertedOutcome = outcome(word(log.data, 0, label), `${label}.assertedOutcome`);
  const event: OutcomeDisputedEvent = { kind: "OutcomeDisputed", challengeId: challengeTopic(log, label), disputingWallet: nonZeroAddress(topic(log, 2, label), `${label}.disputingWallet`), assertedOutcome, reasonCode: reasonCode(word(log.data, 1, label), assertedOutcome, `${label}.reasonCode`), evidenceHash: nonZeroBytes32(word(log.data, 2, label), `${label}.evidenceHash`), parentEvidenceHash: nonZeroBytes32(word(log.data, 3, label), `${label}.parentEvidenceHash`), arbitrationStart: uint64(word(log.data, 4, label), `${label}.arbitrationStart`), arbitrationDeadline: uint64(word(log.data, 5, label), `${label}.arbitrationDeadline`) };
  assert(event.arbitrationStart < event.arbitrationDeadline, `${label} has an invalid arbitration interval`);
  return event;
}

function decodeChallengeResolved(log: ProtocolLog): ChallengeResolvedEvent {
  const label = "ChallengeResolved";
  assert(log.topics.length === 4, `${label} has an unexpected topic count`);
  words(log.data, 6, label);
  const finalOutcome = outcome(word(log.data, 0, label), `${label}.finalOutcome`);
  assert(finalOutcome !== "VOID", `${label} cannot carry a VOID outcome`);
  const resolutionPath = boundedUint(word(log.data, 4, label), 1n, `${label}.resolutionPath`);
  const parentEvidenceHash = bytes32(word(log.data, 3, label), `${label}.parentEvidenceHash`);
  const zeroHash = `0x${"0".repeat(64)}`;
  assert(
    resolutionPath === 0 ? parentEvidenceHash === zeroHash : parentEvidenceHash !== zeroHash,
    `${label}.parentEvidenceHash does not match its resolution path`,
  );
  const claimAmount = uint(word(log.data, 5, label));
  assert(claimAmount > 0n, `${label}.claimAmount must be positive`);
  return { kind: "ChallengeResolved", challengeId: challengeTopic(log, label), finalizedBy: nonZeroAddress(topic(log, 2, label), `${label}.finalizedBy`), winnerWallet: nonZeroAddress(topic(log, 3, label), `${label}.winnerWallet`), finalOutcome, reasonCode: reasonCode(word(log.data, 1, label), finalOutcome, `${label}.reasonCode`), finalEvidenceHash: nonZeroBytes32(word(log.data, 2, label), `${label}.finalEvidenceHash`), parentEvidenceHash, resolutionPath, claimAmount };
}

function decodeChallengeVoided(log: ProtocolLog): ChallengeVoidedEvent {
  const label = "ChallengeVoided";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 5, label);
  const voidPath = boundedUint(word(log.data, 3, label), 3n, `${label}.voidPath`);
  const timeoutPath = voidPath >= 2;
  const voidReason = boundedUint(word(log.data, 0, label), timeoutPath ? 1n : 5n, `${label}.voidReason`);
  const finalEvidenceHash = bytes32(word(log.data, 1, label), `${label}.finalEvidenceHash`);
  const parentEvidenceHash = bytes32(word(log.data, 2, label), `${label}.parentEvidenceHash`);
  const zeroHash = `0x${"0".repeat(64)}`;
  if (timeoutPath) {
    assert(finalEvidenceHash === zeroHash && parentEvidenceHash === zeroHash, `${label} timeout path must not carry evidence hashes`);
    assert(voidReason === voidPath - 2, `${label} timeout reason does not match its path`);
  } else {
    assert(finalEvidenceHash !== zeroHash, `${label} evidence path requires a final evidence hash`);
    assert(
      voidPath === 0 ? parentEvidenceHash === zeroHash : parentEvidenceHash !== zeroHash,
      `${label}.parentEvidenceHash does not match its evidence path`,
    );
  }
  const refundAmountEach = uint(word(log.data, 4, label));
  assert(refundAmountEach > 0n, `${label}.refundAmountEach must be positive`);
  return { kind: "ChallengeVoided", challengeId: challengeTopic(log, label), materializedBy: nonZeroAddress(topic(log, 2, label), `${label}.materializedBy`), voidReason, finalEvidenceHash, parentEvidenceHash, voidPath, refundAmountEach };
}

function decodeWinningsClaimed(log: ProtocolLog): WinningsClaimedEvent {
  const label = "WinningsClaimed";
  assert(log.topics.length === 4, `${label} has an unexpected topic count`);
  words(log.data, 1, label);
  const event: WinningsClaimedEvent = { kind: "WinningsClaimed", challengeId: challengeTopic(log, label), entitlementId: nonZeroBytes32(topic(log, 2, label), `${label}.entitlementId`), wallet: nonZeroAddress(topic(log, 3, label), `${label}.wallet`), amount: uint(word(log.data, 0, label)) };
  assert(event.amount > 0n, `${label}.amount must be positive`);
  return event;
}

function decodePrincipalRefunded(log: ProtocolLog): PrincipalRefundedEvent {
  const label = "PrincipalRefunded";
  assert(log.topics.length === 4, `${label} has an unexpected topic count`);
  words(log.data, 2, label);
  const originState = boundedUint(word(log.data, 0, label), 8n, `${label}.originState`);
  assert(originState === 4 || originState === 5 || originState === 8, `${label}.originState is not refundable`);
  const amount = uint(word(log.data, 1, label));
  assert(amount > 0n, `${label}.amount must be positive`);
  return { kind: "PrincipalRefunded", challengeId: challengeTopic(log, label), entitlementId: nonZeroBytes32(topic(log, 2, label), `${label}.entitlementId`), wallet: nonZeroAddress(topic(log, 3, label), `${label}.wallet`), originState, amount };
}

export function decodeProtocolEvent(log: ProtocolLog): DecodedProtocolEvent {
  assert(log.topics.length > 0, "event signature topic is missing");
  const signature = bytes32(log.topics[0], "event signature");
  const kind = signatures[signature];
  if (!kind) fail(`unknown event signature ${signature}`);
  switch (kind) {
    case "ReleaseDeclared": return decodeReleaseDeclared(log);
    case "PauseStatusChanged": return decodePauseStatusChanged(log);
    case "ChallengeCreated": return decodeChallengeCreated(log);
    case "AcceptanceNonceAdvanced": return decodeAcceptanceNonceAdvanced(log);
    case "ChallengeAccepted": return decodeChallengeAccepted(log);
    case "ChallengeCancelled": return decodeChallengeCancelled(log);
    case "ChallengeExpired": return decodeChallengeExpired(log);
    case "OutcomeProposed": return decodeOutcomeProposed(log);
    case "OutcomeDisputed": return decodeOutcomeDisputed(log);
    case "ChallengeResolved": return decodeChallengeResolved(log);
    case "ChallengeVoided": return decodeChallengeVoided(log);
    case "WinningsClaimed": return decodeWinningsClaimed(log);
    case "PrincipalRefunded": return decodePrincipalRefunded(log);
  }
}

export function decodeProtocolLog(log: ProtocolLog): DecodedProtocolLog {
  return { log, event: decodeProtocolEvent(log) };
}

export function eventSignature(kind: EventKind): Hex {
  const entry = Object.entries(signatures).find(([, value]) => value === kind);
  if (!entry) fail(`event kind ${kind} has no signature`);
  return entry[0] as Hex;
}
