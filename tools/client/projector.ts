import type { BlockHeader, ProtocolLog } from "./observer.ts";
import { decodeProtocolLog, type DecodedProtocolEvent, type DecodedProtocolLog } from "./events.ts";
import { computeEntitlementId } from "./keccak.ts";

export type FinalityLabel = "latest" | "safe" | "finalized" | "unknown";

export interface ProjectionHead {
  readonly number: string;
  readonly hash: string;
  readonly finality: FinalityLabel;
  readonly safe: { readonly number: string; readonly hash: string } | null;
  readonly finalized: { readonly number: string; readonly hash: string } | null;
}

export interface ProjectionAnomaly {
  readonly code: "orphan_event" | "invalid_transition" | "duplicate_terminal" | "release_conflict" | "duplicate_payout";
  readonly challengeId?: string;
  readonly kind: string;
  readonly message: string;
}

export interface ProjectedChallenge {
  readonly challengeId: string;
  readonly state: "OPEN" | "ACTIVE" | "PROPOSED" | "DISPUTED" | "CANCELLED" | "EXPIRED" | "RESOLVED_A" | "RESOLVED_B" | "VOID";
  readonly eventCount: number;
  readonly firstEventBlock: string;
  readonly lastEventBlock: string;
  readonly lastEvent: string;
  readonly created?: Record<string, unknown>;
  readonly evidenceHashes: readonly string[];
  readonly payoutCount: number;
}

export interface ObserverEvidenceRecord {
  readonly schema: "challenge-escrow.observer/v1";
  readonly head: ProjectionHead;
  readonly status: "consistent" | "incomplete" | "conflicted";
  readonly release: Record<string, unknown> | null;
  readonly paused: boolean | null;
  readonly eventCount: number;
  readonly logs: readonly Record<string, unknown>[];
  readonly challenges: readonly ProjectedChallenge[];
  readonly anomalies: readonly ProjectionAnomaly[];
}

interface MutableChallenge {
  challengeId: string;
  state: ProjectedChallenge["state"];
  eventCount: number;
  firstEventBlock: string;
  lastEventBlock: string;
  lastEvent: string;
  created?: Record<string, unknown>;
  createdEvent: Extract<DecodedProtocolEvent, { kind: "ChallengeCreated" }>;
  acceptanceNonce: bigint;
  acceptingWallet: string | null;
  proposalEvidenceHash: string | null;
  proposalOutcome: "A" | "B" | "VOID" | null;
  proposalReasonCode: number | null;
  proposalDisputeDeadline: bigint | null;
  disputeEvidenceHash: string | null;
  disputeOutcome: "A" | "B" | "VOID" | null;
  evidenceHashes: string[];
  payoutIds: Set<string>;
  payoutWallets: Set<string>;
}

function fail(message: string): never {
  throw new Error(`event-projector: ${message}`);
}

const MAX_UINT64 = (1n << 64n) - 1n;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const DATA_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;

function validateHeader(header: BlockHeader, label: string): void {
  if (
    typeof header.number !== "bigint"
    || header.number < 0n
    || header.number > MAX_UINT64
    || !HASH_PATTERN.test(header.hash)
    || !HASH_PATTERN.test(header.parentHash)
  ) fail(`${label} is malformed`);
}

function sameBlock(left: BlockHeader, right: BlockHeader): boolean {
  return left.number === right.number
    && left.hash.toLowerCase() === right.hash.toLowerCase()
    && left.parentHash.toLowerCase() === right.parentHash.toLowerCase();
}

function coherentPair(newer: BlockHeader, older: BlockHeader): boolean {
  if (newer.number < older.number) return false;
  if (newer.number === older.number) return sameBlock(newer, older);
  if (newer.number === older.number + 1n) {
    return newer.parentHash.toLowerCase() === older.hash.toLowerCase();
  }
  return true;
}

function validateFinality(
  head: BlockHeader,
  safe: BlockHeader | null,
  finalized: BlockHeader | null,
): void {
  validateHeader(head, "head");
  if (safe) validateHeader(safe, "safe head");
  if (finalized) validateHeader(finalized, "finalized head");
  if (finalized && !safe) fail("a finalized head requires a safe head");
  if (safe && !coherentPair(head, safe)) fail("safe head is inconsistent with the observed head");
  if (safe && finalized && !coherentPair(safe, finalized)) {
    fail("finalized head is inconsistent with the safe head");
  }
}

function eventChallengeId(event: DecodedProtocolEvent): string | null {
  if ("challengeId" in event) return event.challengeId;
  return null;
}

function eventValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(eventValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, eventValue(nested)]));
  return value;
}

function logRecord(decoded: DecodedProtocolLog): Record<string, unknown> {
  return {
    blockNumber: decoded.log.blockNumber.toString(),
    blockHash: decoded.log.blockHash.toLowerCase(),
    transactionIndex: decoded.log.transactionIndex.toString(),
    logIndex: decoded.log.logIndex.toString(),
    kind: decoded.event.kind,
    event: eventValue(decoded.event) as Record<string, unknown>,
  };
}

function compareLogs(left: ProtocolLog, right: ProtocolLog): number {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
  if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex < right.transactionIndex ? -1 : 1;
  if (left.logIndex !== right.logIndex) return left.logIndex < right.logIndex ? -1 : 1;
  return 0;
}

function transition(state: MutableChallenge["state"], kind: string): MutableChallenge["state"] | null {
  if (kind === "ChallengeAccepted" && state === "OPEN") return "ACTIVE";
  if (kind === "OutcomeProposed" && state === "ACTIVE") return "PROPOSED";
  if (kind === "OutcomeDisputed" && state === "PROPOSED") return "DISPUTED";
  if (kind === "ChallengeCancelled" && state === "OPEN") return "CANCELLED";
  if (kind === "ChallengeExpired" && state === "OPEN") return "EXPIRED";
  if (kind === "ChallengeResolved" && (state === "PROPOSED" || state === "DISPUTED")) return "RESOLVED_A";
  if (kind === "ChallengeVoided" && ["OPEN", "ACTIVE", "PROPOSED", "DISPUTED"].includes(state)) return "VOID";
  return null;
}

function terminal(state: MutableChallenge["state"]): boolean {
  return ["CANCELLED", "EXPIRED", "RESOLVED_A", "RESOLVED_B", "VOID"].includes(state);
}

function addAnomaly(anomalies: ProjectionAnomaly[], anomaly: ProjectionAnomaly): void {
  anomalies.push(anomaly);
}

function overlapsReleaseBoundary(
  wallet: string,
  release: Extract<DecodedProtocolEvent, { kind: "ReleaseDeclared" }> | null,
): boolean {
  const reserved: readonly string[] = release === null ? [] : [
    release.escrowContract,
    release.canonicalToken,
    release.resolver,
    release.arbiter,
  ];
  return reserved.includes(wallet);
}

function projectEvent(
  decoded: DecodedProtocolLog,
  challenges: Map<string, MutableChallenge>,
  anomalies: ProjectionAnomaly[],
  release: { value: Record<string, unknown> | null; event: Extract<DecodedProtocolEvent, { kind: "ReleaseDeclared" }> | null },
  paused: { value: boolean | null },
): void {
  const event = decoded.event;
  if (event.kind === "ReleaseDeclared") {
    const next = eventValue(event) as Record<string, unknown>;
    if (release.value) addAnomaly(anomalies, { code: "release_conflict", kind: event.kind, message: JSON.stringify(release.value) === JSON.stringify(next) ? "ReleaseDeclared was emitted more than once" : "ReleaseDeclared payload changed after the first declaration" });
    else {
      release.value = next;
      release.event = event;
    }
    paused.value = event.initialPaused;
    return;
  }
  if (event.kind === "PauseStatusChanged") {
    if (paused.value !== null && paused.value !== event.previousPaused) addAnomaly(anomalies, { code: "invalid_transition", kind: event.kind, message: "pause event previous value does not match the projected value" });
    paused.value = event.newPaused;
    return;
  }
  const challengeId = eventChallengeId(event);
  if (!challengeId) return;
  const challenge = challenges.get(challengeId);
  if (!challenge) {
    if (event.kind !== "ChallengeCreated") addAnomaly(anomalies, { code: "orphan_event", challengeId, kind: event.kind, message: "challenge event arrived before ChallengeCreated" });
    if (event.kind !== "ChallengeCreated") return;
    const created = event as Extract<DecodedProtocolEvent, { kind: "ChallengeCreated" }>;
    if (overlapsReleaseBoundary(created.challengerWallet, release.event)) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "challenge participant overlaps the declared release boundary" });
      return;
    }
    challenges.set(challengeId, {
      challengeId,
      state: "OPEN",
      eventCount: 1,
      firstEventBlock: decoded.log.blockNumber.toString(),
      lastEventBlock: decoded.log.blockNumber.toString(),
      lastEvent: event.kind,
      created: eventValue(created) as Record<string, unknown>,
      createdEvent: created,
      acceptanceNonce: created.acceptanceNonce,
      acceptingWallet: null,
      proposalEvidenceHash: null,
      proposalOutcome: null,
      proposalReasonCode: null,
      proposalDisputeDeadline: null,
      disputeEvidenceHash: null,
      disputeOutcome: null,
      evidenceHashes: [],
      payoutIds: new Set(),
      payoutWallets: new Set(),
    });
    return;
  }
  if (event.kind === "ChallengeCreated") {
    addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "ChallengeCreated was emitted twice for one challenge id" });
    return;
  }
  challenge.eventCount += 1;
  challenge.lastEventBlock = decoded.log.blockNumber.toString();
  challenge.lastEvent = event.kind;
  if (event.kind === "AcceptanceNonceAdvanced") {
    if (
      challenge.state !== "OPEN"
      || event.challengerWallet !== challenge.createdEvent.challengerWallet
      || event.previousNonce !== challenge.acceptanceNonce
    ) addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "acceptance nonce event does not match the open challenge" });
    else challenge.acceptanceNonce = event.newNonce;
    return;
  }
  if (event.kind === "ChallengeAccepted" && challenge.state === "OPEN") {
    const expectedSide = challenge.createdEvent.challengerSide === "A" ? "B" : "A";
    if (
      event.acceptingWallet === challenge.createdEvent.challengerWallet
      || overlapsReleaseBoundary(event.acceptingWallet, release.event)
      || event.acceptingSide !== expectedSide
      || event.consumedNonce !== challenge.acceptanceNonce
      || event.stakeAmount !== challenge.createdEvent.stakeAmount
      || event.permitExpiresAt <= challenge.createdEvent.createdAt
      || event.permitExpiresAt > challenge.createdEvent.acceptanceDeadline
    ) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "acceptance event does not match the created challenge" });
      return;
    }
    challenge.acceptingWallet = event.acceptingWallet;
  }
  if ((event.kind === "ChallengeCancelled" || event.kind === "ChallengeExpired") && challenge.state === "OPEN") {
    if (
      event.challengerWallet !== challenge.createdEvent.challengerWallet
      || event.refundAmount !== challenge.createdEvent.stakeAmount
    ) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "open refund event does not match the created challenge" });
      return;
    }
  }
  if (event.kind === "OutcomeProposed" && challenge.state === "ACTIVE") {
    const proposedAt = event.disputeDeadline - challenge.createdEvent.disputeWindowSeconds;
    if (
      (release.event && event.resolver !== release.event.resolver)
      || event.disputeDeadline
        < challenge.createdEvent.observationTime + challenge.createdEvent.disputeWindowSeconds
      || event.disputeDeadline
        >= challenge.createdEvent.proposalDeadline + challenge.createdEvent.disputeWindowSeconds
      || (event.assertedOutcome === "VOID"
        && event.reasonCode !== 5
        && proposedAt < challenge.createdEvent.sourceCorrectionCutoff)
    ) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "proposal authority, dispute deadline, or source correction cutoff does not match the declared resolver and challenge schedule" });
      return;
    }
    challenge.proposalEvidenceHash = event.evidenceHash;
    challenge.proposalOutcome = event.assertedOutcome;
    challenge.proposalReasonCode = event.reasonCode;
    challenge.proposalDisputeDeadline = event.disputeDeadline;
    challenge.evidenceHashes.push(event.evidenceHash);
  }
  if (event.kind === "OutcomeDisputed" && challenge.state === "PROPOSED") {
    if (
      !challenge.acceptingWallet
      || ![challenge.createdEvent.challengerWallet, challenge.acceptingWallet].includes(event.disputingWallet)
      || event.parentEvidenceHash !== challenge.proposalEvidenceHash
      || event.assertedOutcome === challenge.proposalOutcome
      || event.arbitrationStart < challenge.createdEvent.sourceCorrectionCutoff
      || challenge.proposalDisputeDeadline === null
      || event.arbitrationStart >= challenge.proposalDisputeDeadline
      || event.arbitrationDeadline - event.arbitrationStart !== challenge.createdEvent.arbitrationWindowSeconds
    ) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "dispute event does not match its proposal or participants" });
      return;
    }
    challenge.disputeEvidenceHash = event.evidenceHash;
    challenge.disputeOutcome = event.assertedOutcome;
    if (!challenge.evidenceHashes.includes(event.evidenceHash)) challenge.evidenceHashes.push(event.evidenceHash);
  }
  if (event.kind === "WinningsClaimed" || event.kind === "PrincipalRefunded") {
    if (event.entitlementId.toLowerCase() !== computeEntitlementId(event.challengeId, event.wallet)) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "payout entitlement ID does not match the challenge and wallet" });
      return;
    }
    const validPayoutState = event.kind === "WinningsClaimed"
      ? challenge.state === "RESOLVED_A" || challenge.state === "RESOLVED_B"
      : ["CANCELLED", "EXPIRED", "VOID"].includes(challenge.state)
        && event.originState === ["OPEN", "ACTIVE", "PROPOSED", "DISPUTED", "CANCELLED", "EXPIRED", "RESOLVED_A", "RESOLVED_B", "VOID"].indexOf(challenge.state);
    if (!validPayoutState) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "payout kind or origin does not match the terminal state" });
      return;
    }
    const expectedAmount = event.kind === "WinningsClaimed"
      ? challenge.createdEvent.stakeAmount * 2n
      : challenge.createdEvent.stakeAmount;
    const resolvedOutcome = challenge.state === "RESOLVED_A" ? "A" : challenge.state === "RESOLVED_B" ? "B" : null;
    const challengerWon = resolvedOutcome !== null && challenge.createdEvent.challengerSide === resolvedOutcome;
    const expectedWinner = challengerWon ? challenge.createdEvent.challengerWallet : challenge.acceptingWallet;
    const validRecipient = event.kind === "WinningsClaimed"
      ? event.wallet === expectedWinner
      : challenge.state === "VOID"
        ? event.wallet === challenge.createdEvent.challengerWallet || event.wallet === challenge.acceptingWallet
        : event.wallet === challenge.createdEvent.challengerWallet;
    if (event.amount !== expectedAmount || !validRecipient) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "payout amount or recipient does not match the challenge" });
      return;
    }
    const payoutId = event.entitlementId.toLowerCase();
    const payoutWallet = event.wallet.toLowerCase();
    if (challenge.payoutIds.has(payoutId) || challenge.payoutWallets.has(payoutWallet)) {
      addAnomaly(anomalies, { code: "duplicate_payout", challengeId, kind: event.kind, message: "entitlement or wallet appeared in more than one payout" });
      return;
    }
    challenge.payoutIds.add(payoutId);
    challenge.payoutWallets.add(payoutWallet);
    return;
  }
  if (event.kind === "ChallengeResolved") {
    if (terminal(challenge.state)) {
      addAnomaly(anomalies, { code: "duplicate_terminal", challengeId, kind: event.kind, message: "a terminal challenge emitted another terminal resolution" });
      return;
    }
    const expectedState = event.resolutionPath === 0 ? "PROPOSED" : "DISPUTED";
    if (challenge.state !== expectedState) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: `${event.kind} cannot follow projected ${challenge.state}` });
      return;
    }
    const expectedParent = event.resolutionPath === 0 ? `0x${"0".repeat(64)}` : challenge.disputeEvidenceHash;
    const expectedEvidence = event.resolutionPath === 0 ? challenge.proposalEvidenceHash : event.finalEvidenceHash;
    const uncontestedMismatch = event.resolutionPath === 0
      && (event.finalOutcome !== challenge.proposalOutcome || event.reasonCode !== challenge.proposalReasonCode);
    const challengerWon = (challenge.createdEvent.challengerSide === "A" && event.finalOutcome === "A")
      || (challenge.createdEvent.challengerSide === "B" && event.finalOutcome === "B");
    const expectedWinner = challengerWon ? challenge.createdEvent.challengerWallet : challenge.acceptingWallet;
    if (
      event.parentEvidenceHash !== expectedParent
      || event.finalEvidenceHash !== expectedEvidence
      || uncontestedMismatch
      || event.winnerWallet !== expectedWinner
      || event.claimAmount !== challenge.createdEvent.stakeAmount * 2n
      || (event.resolutionPath === 1 && release.event !== null && event.finalizedBy !== release.event.arbiter)
    ) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "resolution event does not match evidence lineage, winner, or authority" });
      return;
    }
    challenge.state = event.finalOutcome === "A" ? "RESOLVED_A" : event.finalOutcome === "B" ? "RESOLVED_B" : "VOID";
    if (!challenge.evidenceHashes.includes(event.finalEvidenceHash)) challenge.evidenceHashes.push(event.finalEvidenceHash);
    return;
  }
  if (event.kind === "ChallengeVoided") {
    if (terminal(challenge.state)) {
      addAnomaly(anomalies, { code: "duplicate_terminal", challengeId, kind: event.kind, message: "a terminal challenge emitted another terminal void" });
      return;
    }
    const expectedState = event.voidPath === 0
      ? "PROPOSED"
      : event.voidPath === 1 || event.voidPath === 3
        ? "DISPUTED"
        : "ACTIVE";
    if (challenge.state !== expectedState) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: `${event.kind} path ${event.voidPath} cannot follow projected ${challenge.state}` });
      return;
    }
    const expectedEvidence = event.voidPath === 0 ? challenge.proposalEvidenceHash : event.finalEvidenceHash;
    const expectedParent = event.voidPath === 1 ? challenge.disputeEvidenceHash : `0x${"0".repeat(64)}`;
    const uncontestedMismatch = event.voidPath === 0
      && (challenge.proposalOutcome !== "VOID" || event.voidReason !== challenge.proposalReasonCode);
    if (
      event.refundAmountEach !== challenge.createdEvent.stakeAmount
      || event.finalEvidenceHash !== expectedEvidence
      || event.parentEvidenceHash !== expectedParent
      || uncontestedMismatch
      || (event.voidPath === 1 && release.event !== null && event.materializedBy !== release.event.arbiter)
    ) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "void event does not match evidence lineage, refund, or authority" });
      return;
    }
    challenge.state = "VOID";
    if (event.finalEvidenceHash !== `0x${"0".repeat(64)}` && !challenge.evidenceHashes.includes(event.finalEvidenceHash)) {
      challenge.evidenceHashes.push(event.finalEvidenceHash);
    }
    return;
  }
  if (terminal(challenge.state)) {
    addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "a non-payout event arrived after terminal state" });
    return;
  }
  const next = transition(challenge.state, event.kind);
  if (next) {
    challenge.state = next;
  } else if (["ChallengeAccepted", "OutcomeProposed", "OutcomeDisputed", "ChallengeCancelled", "ChallengeExpired"].includes(event.kind)) {
    addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: `${event.kind} cannot follow projected ${challenge.state}` });
  }
}

function finalityOf(head: BlockHeader, safe: BlockHeader | null, finalized: BlockHeader | null): FinalityLabel {
  if (finalized && finalized.number === head.number && finalized.hash.toLowerCase() === head.hash.toLowerCase()) return "finalized";
  if (safe && safe.number === head.number && safe.hash.toLowerCase() === head.hash.toLowerCase()) return "safe";
  return "latest";
}

export function projectProtocolLogs(
  logs: readonly ProtocolLog[],
  head: BlockHeader,
  options: { readonly safe?: BlockHeader | null; readonly finalized?: BlockHeader | null } = {},
): ObserverEvidenceRecord {
  const safe = options.safe ?? null;
  const finalized = options.finalized ?? null;
  validateFinality(head, safe, finalized);
  const contractAddresses = new Set<string>();
  const blockHashes = new Map<bigint, string>();
  const eventPositions = new Set<string>();
  for (const log of logs) {
    if (
      !log
      || typeof log !== "object"
      || typeof log.address !== "string"
      || !ADDRESS_PATTERN.test(log.address)
      || typeof log.blockNumber !== "bigint"
      || log.blockNumber < 0n
      || log.blockNumber > MAX_UINT64
      || log.blockNumber > head.number
      || !HASH_PATTERN.test(log.blockHash)
      || typeof log.transactionIndex !== "bigint"
      || log.transactionIndex < 0n
      || log.transactionIndex > MAX_UINT64
      || typeof log.logIndex !== "bigint"
      || log.logIndex < 0n
      || log.logIndex > MAX_UINT64
      || !Array.isArray(log.topics)
      || log.topics.length < 1
      || log.topics.length > 4
      || log.topics.some((topic) => typeof topic !== "string" || !HASH_PATTERN.test(topic))
      || typeof log.data !== "string"
      || !DATA_PATTERN.test(log.data)
      || (log.data.length - 2) / 2 > 1_048_576
      || (log.removed !== undefined && log.removed !== false)
    ) fail("a protocol log is malformed or outside the observed head");
    const address = log.address.toLowerCase();
    const blockHash = log.blockHash.toLowerCase();
    const knownBlockHash = blockHashes.get(log.blockNumber);
    if (knownBlockHash && knownBlockHash !== blockHash) fail("protocol logs contain two forks at one height");
    if (log.blockNumber === head.number && blockHash !== head.hash.toLowerCase()) {
      fail("a head-block log is not anchored to the observed head");
    }
    const position = `${blockHash}:${log.logIndex}`;
    if (eventPositions.has(position)) fail("protocol logs contain a duplicate event position");
    contractAddresses.add(address);
    blockHashes.set(log.blockNumber, blockHash);
    eventPositions.add(position);
  }
  if (contractAddresses.size > 1) fail("protocol logs mix more than one contract address");
  const sortedLogs = [...logs].sort((left, right) => compareLogs(left, right));
  for (let index = 1; index < sortedLogs.length; index += 1) {
    const previous = sortedLogs[index - 1];
    const current = sortedLogs[index];
    if (previous.blockNumber === current.blockNumber && previous.logIndex >= current.logIndex) {
      fail("protocol logs contain non-canonical event ordering");
    }
  }
  const decoded = sortedLogs.map((log) => decodeProtocolLog(log));
  const challenges = new Map<string, MutableChallenge>();
  const anomalies: ProjectionAnomaly[] = [];
  if (decoded.some((entry) => entry.event.kind === "ReleaseDeclared") && decoded[0]?.event.kind !== "ReleaseDeclared") {
    anomalies.push({ code: "release_conflict", kind: "ReleaseDeclared", message: "ReleaseDeclared appeared after another protocol event" });
  }
  const release: { value: Record<string, unknown> | null; event: Extract<DecodedProtocolEvent, { kind: "ReleaseDeclared" }> | null } = { value: null, event: null };
  const paused: { value: boolean | null } = { value: null };
  for (const item of decoded) projectEvent(item, challenges, anomalies, release, paused);
  const challengeRecords = [...challenges.values()].map((challenge): ProjectedChallenge => ({ challengeId: challenge.challengeId, state: challenge.state, eventCount: challenge.eventCount, firstEventBlock: challenge.firstEventBlock, lastEventBlock: challenge.lastEventBlock, lastEvent: challenge.lastEvent, created: challenge.created, evidenceHashes: [...challenge.evidenceHashes], payoutCount: challenge.payoutIds.size }));
  const status = anomalies.length > 0
    ? "conflicted"
    : release.value === null || challengeRecords.some((challenge) => challenge.state === "OPEN" || challenge.state === "ACTIVE" || challenge.state === "PROPOSED" || challenge.state === "DISPUTED")
      ? "incomplete"
      : "consistent";
  return {
    schema: "challenge-escrow.observer/v1",
    head: {
      number: head.number.toString(),
      hash: head.hash.toLowerCase(),
      finality: finalityOf(head, safe, finalized),
      safe: safe ? { number: safe.number.toString(), hash: safe.hash.toLowerCase() } : null,
      finalized: finalized ? { number: finalized.number.toString(), hash: finalized.hash.toLowerCase() } : null,
    },
    status,
    release: release.value,
    paused: paused.value,
    eventCount: decoded.length,
    logs: decoded.map(logRecord),
    challenges: challengeRecords,
    anomalies,
  };
}
