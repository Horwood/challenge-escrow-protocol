import type { BlockHeader, ProtocolLog } from "./observer.ts";
import { decodeProtocolLog, type DecodedProtocolEvent, type DecodedProtocolLog } from "./events.ts";

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
  evidenceHashes: string[];
  payoutIds: Set<string>;
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
  if (kind === "OutcomeProposed" && (state === "ACTIVE" || state === "PROPOSED")) return "PROPOSED";
  if (kind === "OutcomeDisputed" && state === "PROPOSED") return "DISPUTED";
  if (kind === "ChallengeCancelled" && state === "OPEN") return "CANCELLED";
  if (kind === "ChallengeExpired" && (state === "OPEN" || state === "ACTIVE")) return "EXPIRED";
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

function projectEvent(
  decoded: DecodedProtocolLog,
  challenges: Map<string, MutableChallenge>,
  anomalies: ProjectionAnomaly[],
  release: { value: Record<string, unknown> | null },
  paused: { value: boolean | null },
): void {
  const event = decoded.event;
  if (event.kind === "ReleaseDeclared") {
    const next = eventValue(event) as Record<string, unknown>;
    if (release.value && JSON.stringify(release.value) !== JSON.stringify(next)) {
      addAnomaly(anomalies, { code: "release_conflict", kind: event.kind, message: "ReleaseDeclared payload changed after the first declaration" });
    } else {
      release.value = next;
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
    challenges.set(challengeId, {
      challengeId,
      state: "OPEN",
      eventCount: 1,
      firstEventBlock: decoded.log.blockNumber.toString(),
      lastEventBlock: decoded.log.blockNumber.toString(),
      lastEvent: event.kind,
      created: eventValue(created) as Record<string, unknown>,
      evidenceHashes: [],
      payoutIds: new Set(),
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
    if (terminal(challenge.state)) addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "acceptance nonce advanced after terminal state" });
    return;
  }
  if (event.kind === "OutcomeProposed" || event.kind === "OutcomeDisputed" || event.kind === "ChallengeResolved" || event.kind === "ChallengeVoided") {
    const evidenceHash = "evidenceHash" in event ? event.evidenceHash : "finalEvidenceHash" in event ? event.finalEvidenceHash : undefined;
    if (evidenceHash && !challenge.evidenceHashes.includes(evidenceHash)) challenge.evidenceHashes.push(evidenceHash);
  }
  if (event.kind === "WinningsClaimed" || event.kind === "PrincipalRefunded") {
    if (!terminal(challenge.state)) {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: "payout event arrived before a terminal state" });
      return;
    }
    const payoutId = `${event.kind}:${event.entitlementId}:${event.wallet}`.toLowerCase();
    if (challenge.payoutIds.has(payoutId)) addAnomaly(anomalies, { code: "duplicate_payout", challengeId, kind: event.kind, message: `payout ${payoutId} appeared twice` });
    challenge.payoutIds.add(payoutId);
    return;
  }
  if (event.kind === "ChallengeResolved") {
    if (terminal(challenge.state)) {
      addAnomaly(anomalies, { code: "duplicate_terminal", challengeId, kind: event.kind, message: "a terminal challenge emitted another terminal resolution" });
      return;
    }
    if (challenge.state !== "PROPOSED" && challenge.state !== "DISPUTED") {
      addAnomaly(anomalies, { code: "invalid_transition", challengeId, kind: event.kind, message: `${event.kind} cannot follow projected ${challenge.state}` });
      return;
    }
    challenge.state = event.finalOutcome === "A" ? "RESOLVED_A" : event.finalOutcome === "B" ? "RESOLVED_B" : "VOID";
    return;
  }
  if (event.kind === "ChallengeVoided") {
    if (terminal(challenge.state)) {
      addAnomaly(anomalies, { code: "duplicate_terminal", challengeId, kind: event.kind, message: "a terminal challenge emitted another terminal void" });
      return;
    }
    challenge.state = "VOID";
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
  const decoded = [...logs].sort((left, right) => compareLogs(left, right)).map((log) => decodeProtocolLog(log));
  const challenges = new Map<string, MutableChallenge>();
  const anomalies: ProjectionAnomaly[] = [];
  const release: { value: Record<string, unknown> | null } = { value: null };
  const paused: { value: boolean | null } = { value: null };
  for (const item of decoded) projectEvent(item, challenges, anomalies, release, paused);
  const challengeRecords = [...challenges.values()].map((challenge): ProjectedChallenge => ({ challengeId: challenge.challengeId, state: challenge.state, eventCount: challenge.eventCount, firstEventBlock: challenge.firstEventBlock, lastEventBlock: challenge.lastEventBlock, lastEvent: challenge.lastEvent, created: challenge.created, evidenceHashes: [...challenge.evidenceHashes], payoutCount: challenge.payoutIds.size }));
  const status = anomalies.length > 0 ? "conflicted" : challengeRecords.some((challenge) => challenge.state === "OPEN" || challenge.state === "ACTIVE" || challenge.state === "PROPOSED" || challenge.state === "DISPUTED") ? "incomplete" : "consistent";
  return {
    schema: "challenge-escrow.observer/v1",
    head: {
      number: head.number.toString(),
      hash: head.hash.toLowerCase(),
      finality: finalityOf(head, options.safe ?? null, options.finalized ?? null),
      safe: options.safe ? { number: options.safe.number.toString(), hash: options.safe.hash.toLowerCase() } : null,
      finalized: options.finalized ? { number: options.finalized.number.toString(), hash: options.finalized.hash.toLowerCase() } : null,
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
