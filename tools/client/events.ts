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

function side(value: Hex, label: string): Side {
  return boundedUint(value, 1n, label) === 0 ? "A" : "B";
}

function outcome(value: Hex, label: string): Outcome {
  const parsed = boundedUint(value, 2n, label);
  return parsed === 0 ? "A" : parsed === 1 ? "B" : "VOID";
}

function decodeUtf8(data: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
}

function dynamicString(data: Hex, offsetWord: Hex, headBytes: number, label: string): string {
  const bytes = hexBytes(data, label);
  const offset = uint(offsetWord);
  assert(offset <= BigInt(Number.MAX_SAFE_INTEGER), `${label} offset exceeds safe local bounds`);
  const start = Number(offset);
  assert(start >= headBytes && start % 32 === 0 && start + 32 <= bytes.length, `${label} offset is outside the ABI head`);
  const length = uint(word(data, start / 32, label));
  assert(length <= BigInt(Number.MAX_SAFE_INTEGER), `${label} length exceeds safe local bounds`);
  const payloadLength = Number(length);
  const payloadStart = start + 32;
  const paddedLength = Math.ceil(payloadLength / 32) * 32;
  assert(payloadStart + paddedLength <= bytes.length, `${label} payload is truncated`);
  const payload = bytes.slice(payloadStart, payloadStart + payloadLength);
  for (const padding of bytes.slice(payloadStart + payloadLength, payloadStart + paddedLength)) assert(padding === 0, `${label} has non-zero ABI padding`);
  return decodeUtf8(payload, label);
}

function decodeReleaseDeclared(log: ProtocolLog): ReleaseDeclaredEvent {
  const label = "ReleaseDeclared";
  assert(log.topics.length === 2, `${label} has an unexpected topic count`);
  headWords(log.data, 12, label);
  return {
    kind: "ReleaseDeclared",
    releaseId: topic(log, 1, label),
    eventProtocolId: dynamicString(log.data, word(log.data, 0, label), 12 * 32, `${label}.eventProtocolId`),
    protocolVersion: dynamicString(log.data, word(log.data, 1, label), 12 * 32, `${label}.protocolVersion`),
    challengeSchemaId: dynamicString(log.data, word(log.data, 2, label), 12 * 32, `${label}.challengeSchemaId`),
    evidenceSchemaId: dynamicString(log.data, word(log.data, 3, label), 12 * 32, `${label}.evidenceSchemaId`),
    chainId: uint(word(log.data, 4, label)),
    escrowContract: addressWord(word(log.data, 5, label), `${label}.escrowContract`),
    canonicalToken: addressWord(word(log.data, 6, label), `${label}.canonicalToken`),
    tokenDecimals: boundedUint(word(log.data, 7, label), 255n, `${label}.tokenDecimals`),
    valueMode: boundedUint(word(log.data, 8, label), 0n, `${label}.valueMode`),
    resolver: addressWord(word(log.data, 9, label), `${label}.resolver`),
    arbiter: addressWord(word(log.data, 10, label), `${label}.arbiter`),
    initialPaused: bool(word(log.data, 11, label), `${label}.initialPaused`),
  };
}

function decodePauseStatusChanged(log: ProtocolLog): PauseStatusChangedEvent {
  const label = "PauseStatusChanged";
  assert(log.topics.length === 1, `${label} has an unexpected topic count`);
  words(log.data, 3, label);
  return { kind: "PauseStatusChanged", changedBy: addressWord(word(log.data, 0, label), `${label}.changedBy`), previousPaused: bool(word(log.data, 1, label), `${label}.previousPaused`), newPaused: bool(word(log.data, 2, label), `${label}.newPaused`) };
}

function decodeChallengeCreated(log: ProtocolLog): ChallengeCreatedEvent {
  const label = "ChallengeCreated";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 15, label);
  return { kind: "ChallengeCreated", challengeId: topic(log, 1, label), specHash: bytes32(word(log.data, 0, label), `${label}.specHash`), instanceNonce: bytes32(word(log.data, 1, label), `${label}.instanceNonce`), challengerWallet: addressWord(topic(log, 2, label), `${label}.challengerWallet`), challengerSide: side(word(log.data, 2, label), `${label}.challengerSide`), stakeAmount: uint(word(log.data, 3, label)), acceptanceNonce: uint(word(log.data, 4, label)), acceptanceDeadline: uint(word(log.data, 5, label)), observationTime: uint(word(log.data, 6, label)), sourceCorrectionCutoff: uint(word(log.data, 7, label)), proposalDeadline: uint(word(log.data, 8, label)), disputeWindowSeconds: uint(word(log.data, 9, label)), arbitrationWindowSeconds: uint(word(log.data, 10, label)), timeoutVoidAt: uint(word(log.data, 11, label)), executionHash: bytes32(word(log.data, 12, label), `${label}.executionHash`), termsHash: bytes32(word(log.data, 13, label), `${label}.termsHash`), createdAt: uint(word(log.data, 14, label)) };
}

function decodeAcceptanceNonceAdvanced(log: ProtocolLog): AcceptanceNonceAdvancedEvent {
  const label = "AcceptanceNonceAdvanced";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 2, label);
  return { kind: "AcceptanceNonceAdvanced", challengeId: topic(log, 1, label), challengerWallet: addressWord(topic(log, 2, label), `${label}.challengerWallet`), previousNonce: uint(word(log.data, 0, label)), newNonce: uint(word(log.data, 1, label)) };
}

function decodeChallengeAccepted(log: ProtocolLog): ChallengeAcceptedEvent {
  const label = "ChallengeAccepted";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 4, label);
  return { kind: "ChallengeAccepted", challengeId: topic(log, 1, label), acceptingWallet: addressWord(topic(log, 2, label), `${label}.acceptingWallet`), acceptingSide: side(word(log.data, 0, label), `${label}.acceptingSide`), consumedNonce: uint(word(log.data, 1, label)), permitExpiresAt: uint(word(log.data, 2, label)), stakeAmount: uint(word(log.data, 3, label)) };
}

function decodeChallengeCancelled(log: ProtocolLog): ChallengeCancelledEvent {
  const label = "ChallengeCancelled";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 1, label);
  return { kind: "ChallengeCancelled", challengeId: topic(log, 1, label), challengerWallet: addressWord(topic(log, 2, label), `${label}.challengerWallet`), refundAmount: uint(word(log.data, 0, label)) };
}

function decodeChallengeExpired(log: ProtocolLog): ChallengeExpiredEvent {
  const label = "ChallengeExpired";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 2, label);
  return { kind: "ChallengeExpired", challengeId: topic(log, 1, label), materializedBy: addressWord(word(log.data, 0, label), `${label}.materializedBy`), challengerWallet: addressWord(topic(log, 2, label), `${label}.challengerWallet`), refundAmount: uint(word(log.data, 1, label)) };
}

function decodeOutcomeProposed(log: ProtocolLog): OutcomeProposedEvent {
  const label = "OutcomeProposed";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 4, label);
  return { kind: "OutcomeProposed", challengeId: topic(log, 1, label), resolver: addressWord(topic(log, 2, label), `${label}.resolver`), assertedOutcome: outcome(word(log.data, 0, label), `${label}.assertedOutcome`), reasonCode: boundedUint(word(log.data, 1, label), 5n, `${label}.reasonCode`), evidenceHash: bytes32(word(log.data, 2, label), `${label}.evidenceHash`), disputeDeadline: uint(word(log.data, 3, label)) };
}

function decodeOutcomeDisputed(log: ProtocolLog): OutcomeDisputedEvent {
  const label = "OutcomeDisputed";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 6, label);
  return { kind: "OutcomeDisputed", challengeId: topic(log, 1, label), disputingWallet: addressWord(topic(log, 2, label), `${label}.disputingWallet`), assertedOutcome: outcome(word(log.data, 0, label), `${label}.assertedOutcome`), reasonCode: boundedUint(word(log.data, 1, label), 5n, `${label}.reasonCode`), evidenceHash: bytes32(word(log.data, 2, label), `${label}.evidenceHash`), parentEvidenceHash: bytes32(word(log.data, 3, label), `${label}.parentEvidenceHash`), arbitrationStart: uint(word(log.data, 4, label)), arbitrationDeadline: uint(word(log.data, 5, label)) };
}

function decodeChallengeResolved(log: ProtocolLog): ChallengeResolvedEvent {
  const label = "ChallengeResolved";
  assert(log.topics.length === 4, `${label} has an unexpected topic count`);
  words(log.data, 6, label);
  return { kind: "ChallengeResolved", challengeId: topic(log, 1, label), finalizedBy: addressWord(topic(log, 2, label), `${label}.finalizedBy`), winnerWallet: addressWord(topic(log, 3, label), `${label}.winnerWallet`), finalOutcome: outcome(word(log.data, 0, label), `${label}.finalOutcome`), reasonCode: boundedUint(word(log.data, 1, label), 5n, `${label}.reasonCode`), finalEvidenceHash: bytes32(word(log.data, 2, label), `${label}.finalEvidenceHash`), parentEvidenceHash: bytes32(word(log.data, 3, label), `${label}.parentEvidenceHash`), resolutionPath: boundedUint(word(log.data, 4, label), 1n, `${label}.resolutionPath`), claimAmount: uint(word(log.data, 5, label)) };
}

function decodeChallengeVoided(log: ProtocolLog): ChallengeVoidedEvent {
  const label = "ChallengeVoided";
  assert(log.topics.length === 3, `${label} has an unexpected topic count`);
  words(log.data, 5, label);
  return { kind: "ChallengeVoided", challengeId: topic(log, 1, label), materializedBy: addressWord(topic(log, 2, label), `${label}.materializedBy`), voidReason: boundedUint(word(log.data, 0, label), 5n, `${label}.voidReason`), finalEvidenceHash: bytes32(word(log.data, 1, label), `${label}.finalEvidenceHash`), parentEvidenceHash: bytes32(word(log.data, 2, label), `${label}.parentEvidenceHash`), voidPath: boundedUint(word(log.data, 3, label), 3n, `${label}.voidPath`), refundAmountEach: uint(word(log.data, 4, label)) };
}

function decodeWinningsClaimed(log: ProtocolLog): WinningsClaimedEvent {
  const label = "WinningsClaimed";
  assert(log.topics.length === 4, `${label} has an unexpected topic count`);
  words(log.data, 1, label);
  return { kind: "WinningsClaimed", challengeId: topic(log, 1, label), entitlementId: topic(log, 2, label), wallet: addressWord(topic(log, 3, label), `${label}.wallet`), amount: uint(word(log.data, 0, label)) };
}

function decodePrincipalRefunded(log: ProtocolLog): PrincipalRefundedEvent {
  const label = "PrincipalRefunded";
  assert(log.topics.length === 4, `${label} has an unexpected topic count`);
  words(log.data, 2, label);
  return { kind: "PrincipalRefunded", challengeId: topic(log, 1, label), entitlementId: topic(log, 2, label), wallet: addressWord(topic(log, 3, label), `${label}.wallet`), originState: boundedUint(word(log.data, 0, label), 8n, `${label}.originState`), amount: uint(word(log.data, 1, label)) };
}

export function decodeProtocolEvent(log: ProtocolLog): DecodedProtocolEvent {
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
