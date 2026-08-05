import assert from "node:assert/strict";

import { ChallengeModel, Outcome } from "./challenge-model.mjs";

const SEQUENCES = 10_000;
const DEPTH = 128;
const START = 1_900_000_000;
const CHALLENGER = "challenger";
const ACCEPTOR_A = "acceptor-a";
const ACCEPTOR_B = "acceptor-b";

const REQUIRED_TRANSITIONS = [
  "pause",
  "create",
  "advanceNonce",
  "accept",
  "cancel",
  "expire",
  "propose",
  "dispute",
  "finalize",
  "arbitrate",
  "voidUnproposed",
  "voidUnarbitrated",
  "claim",
  "refund",
];

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}

function pick(random, values) {
  return values[random() % values.length];
}

function challengeAt(model, random) {
  if (model.challenges.size === 0) return null;
  return [...model.challenges.values()][random() % model.challenges.size];
}

function execution(id, openedAt, challengerSide = "A") {
  const acceptanceDeadline = openedAt + 10;
  const observationTime = openedAt + 20;
  const sourceCorrectionCutoff = openedAt + 25;
  const proposalDeadline = openedAt + 50;
  const disputeWindow = 10;
  const arbitrationWindow = 20;
  return {
    type: "create",
    id,
    nonce: `nonce-${id}`,
    caller: CHALLENGER,
    challenger: CHALLENGER,
    challengerSide,
    stake: 100,
    now: openedAt,
    acceptanceDeadline,
    observationTime,
    sourceCorrectionCutoff,
    proposalDeadline,
    disputeWindow,
    arbitrationWindow,
    timeoutVoidAt: openedAt + 100,
  };
}

function acceptAction(model, id, now, acceptor) {
  const challenge = model.challenges.get(id);
  return {
    type: "accept",
    id,
    caller: acceptor,
    acceptor,
    permitNonce: challenge.acceptanceNonce,
    permitValid: true,
    expiresAt: challenge.acceptanceDeadline - 1,
    now,
  };
}

function proposeAction(id, now, outcome, evidenceHash, voidReason = "SOURCE_UNAVAILABLE") {
  return {
    type: "propose",
    id,
    caller: "resolver",
    outcome,
    voidReason,
    evidenceHash,
    now,
  };
}

function disputeAction(model, id, now, outcome, evidenceHash) {
  const challenge = model.challenges.get(id);
  return {
    type: "dispute",
    id,
    caller: challenge.acceptor,
    outcome,
    evidenceHash,
    parentEvidenceHash: challenge.proposal.evidenceHash,
    now,
  };
}

function expectOk(model, action, counts) {
  const result = model.apply(action);
  assert.equal(result.ok, true, `expected ${action.type} to succeed: ${result.error ?? "unknown"}`);
  counts[action.type] = (counts[action.type] ?? 0) + 1;
  return result.state;
}

function expectReject(model, action, errorCode) {
  const result = model.apply(action);
  assert.equal(result.ok, false, `expected ${action.type} to reject`);
  assert.equal(result.error, errorCode, `unexpected rejection for ${action.type}`);
}

function runDeterministicPaths() {
  const model = new ChallengeModel();
  const counts = Object.create(null);

  expectOk(model, { type: "pause", caller: "pauser", paused: true }, counts);
  expectReject(model, execution("paused", START), "ContractPaused");
  expectReject(model, { type: "accept", id: "missing", now: START }, "ContractPaused");
  expectReject(model, { type: "propose", id: "missing", now: START }, "ContractPaused");
  expectOk(model, { type: "pause", caller: "pauser", paused: false }, counts);

  const resolvedByArbiter = "resolved-by-arbiter";
  expectOk(model, execution(resolvedByArbiter, START, "A"), counts);
  expectOk(model, { type: "advanceNonce", id: resolvedByArbiter, caller: CHALLENGER, now: START + 1 }, counts);
  expectOk(model, acceptAction(model, resolvedByArbiter, START + 2, ACCEPTOR_A), counts);
  expectOk(model, proposeAction(resolvedByArbiter, START + 20, Outcome.A, "proposal-arbiter"), counts);
  expectOk(model, disputeAction(model, resolvedByArbiter, START + 21, Outcome.B, "dispute-arbiter"), counts);
  expectOk(model, {
    type: "arbitrate",
    id: resolvedByArbiter,
    caller: "arbiter",
    outcome: Outcome.B,
    evidenceHash: "arbitration-final",
    parentEvidenceHash: "dispute-arbiter",
    now: START + 25,
  }, counts);
  expectOk(model, { type: "claim", id: resolvedByArbiter, caller: ACCEPTOR_A }, counts);
  expectReject(model, { type: "claim", id: resolvedByArbiter, caller: ACCEPTOR_A }, "InvalidEntitlement");

  const resolvedUncontested = "resolved-uncontested";
  const uncontestedStart = START + 120;
  expectOk(model, execution(resolvedUncontested, uncontestedStart, "B"), counts);
  expectOk(model, acceptAction(model, resolvedUncontested, uncontestedStart + 2, ACCEPTOR_B), counts);
  expectOk(model, proposeAction(resolvedUncontested, uncontestedStart + 20, Outcome.A, "proposal-uncontested"), counts);
  expectOk(model, {
    type: "finalize",
    id: resolvedUncontested,
    now: uncontestedStart + 30,
  }, counts);
  expectOk(model, { type: "claim", id: resolvedUncontested, caller: ACCEPTOR_B }, counts);

  const cancelled = "cancelled";
  const cancelledStart = START + 240;
  expectOk(model, execution(cancelled, cancelledStart), counts);
  expectOk(model, { type: "cancel", id: cancelled, caller: CHALLENGER, now: cancelledStart + 1 }, counts);
  expectOk(model, { type: "refund", id: cancelled, caller: CHALLENGER }, counts);

  const expired = "expired";
  const expiredStart = START + 260;
  expectOk(model, execution(expired, expiredStart), counts);
  expectOk(model, { type: "expire", id: expired, now: expiredStart + 10 }, counts);
  expectOk(model, { type: "refund", id: expired, caller: CHALLENGER }, counts);

  const proposalTimeout = "proposal-timeout";
  const proposalTimeoutStart = START + 280;
  expectOk(model, execution(proposalTimeout, proposalTimeoutStart), counts);
  expectOk(model, acceptAction(model, proposalTimeout, proposalTimeoutStart + 2, ACCEPTOR_A), counts);
  expectOk(model, {
    type: "voidUnproposed",
    id: proposalTimeout,
    now: proposalTimeoutStart + 50,
  }, counts);
  expectOk(model, { type: "refund", id: proposalTimeout, caller: CHALLENGER }, counts);
  expectOk(model, { type: "refund", id: proposalTimeout, caller: ACCEPTOR_A }, counts);

  const evidenceVoid = "evidence-void";
  const evidenceVoidStart = START + 350;
  expectOk(model, execution(evidenceVoid, evidenceVoidStart), counts);
  expectOk(model, acceptAction(model, evidenceVoid, evidenceVoidStart + 2, ACCEPTOR_A), counts);
  expectOk(model, proposeAction(
    evidenceVoid,
    evidenceVoidStart + 20,
    Outcome.VOID,
    "proposal-evidence-void",
    "TERMS_UNRESOLVABLE",
  ), counts);
  expectOk(model, { type: "finalize", id: evidenceVoid, now: evidenceVoidStart + 30 }, counts);
  expectOk(model, { type: "refund", id: evidenceVoid, caller: CHALLENGER }, counts);
  expectOk(model, { type: "refund", id: evidenceVoid, caller: ACCEPTOR_A }, counts);

  const arbitrationTimeout = "arbitration-timeout";
  const arbitrationTimeoutStart = START + 430;
  expectOk(model, execution(arbitrationTimeout, arbitrationTimeoutStart), counts);
  expectOk(model, acceptAction(model, arbitrationTimeout, arbitrationTimeoutStart + 2, ACCEPTOR_A), counts);
  expectOk(model, proposeAction(arbitrationTimeout, arbitrationTimeoutStart + 20, Outcome.A, "proposal-timeout-arb"), counts);
  expectOk(model, disputeAction(model, arbitrationTimeout, arbitrationTimeoutStart + 21, Outcome.B, "dispute-timeout-arb"), counts);
  expectOk(model, {
    type: "voidUnarbitrated",
    id: arbitrationTimeout,
    now: arbitrationTimeoutStart + 45,
  }, counts);
  expectOk(model, { type: "refund", id: arbitrationTimeout, caller: CHALLENGER }, counts);
  expectOk(model, { type: "refund", id: arbitrationTimeout, caller: ACCEPTOR_A }, counts);

  for (const transition of REQUIRED_TRANSITIONS) {
    assert.ok(counts[transition] > 0, `deterministic path did not cover ${transition}`);
  }
  assert.equal(model.totalOutstandingLiability, 0);
  return { counts, finalState: model.snapshot() };
}

function makeCreate(index, now, random) {
  const acceptanceDeadline = now + 1 + (random() % 20);
  const observationTime = acceptanceDeadline + 1 + (random() % 20);
  const sourceCorrectionCutoff = observationTime + 1 + (random() % 20);
  const proposalDeadline = sourceCorrectionCutoff + 1 + (random() % 20);
  const disputeWindow = 1 + (random() % 20);
  const arbitrationWindow = 1 + (random() % 20);
  const timeoutVoidAt = Math.max(
    proposalDeadline + disputeWindow + arbitrationWindow,
    sourceCorrectionCutoff + arbitrationWindow,
  );
  return {
    type: "create",
    id: `challenge-${index}`,
    nonce: `nonce-${index}`,
    caller: CHALLENGER,
    challenger: CHALLENGER,
    challengerSide: random() % 2 === 0 ? "A" : "B",
    stake: 1 + (random() % 1_000_000),
    now,
    acceptanceDeadline,
    observationTime,
    sourceCorrectionCutoff,
    proposalDeadline,
    disputeWindow,
    arbitrationWindow,
    timeoutVoidAt,
  };
}

function actionFor(model, random, index, now) {
  if (random() % 31 === 0) {
    return { type: "pause", caller: "pauser", paused: !model.paused };
  }
  if (model.challenges.size < 4 && (model.challenges.size === 0 || random() % 7 === 0)) {
    return makeCreate(index, now, random);
  }
  const challenge = challengeAt(model, random);
  if (!challenge) return makeCreate(index, now, random);
  const validCaller = random() % 5 !== 0;
  const caller = validCaller ? CHALLENGER : "random-wallet";
  const acceptingWallet = random() % 2 === 0 ? ACCEPTOR_A : ACCEPTOR_B;
  switch (random() % 12) {
    case 0:
      return { type: "advanceNonce", id: challenge.id, caller, now };
    case 1:
      return {
        type: "accept",
        id: challenge.id,
        caller: validCaller ? acceptingWallet : caller,
        acceptor: acceptingWallet,
        permitNonce: random() % 5 === 0 ? challenge.acceptanceNonce + 1 : challenge.acceptanceNonce,
        permitValid: random() % 6 !== 0,
        expiresAt: challenge.acceptanceDeadline,
        now,
      };
    case 2:
      return { type: "cancel", id: challenge.id, caller, now };
    case 3:
      return { type: "expire", id: challenge.id, now: random() % 2 ? challenge.acceptanceDeadline : now };
    case 4:
      return {
        type: "propose",
        id: challenge.id,
        caller: validCaller ? "resolver" : caller,
        outcome: pick(random, [Outcome.A, Outcome.B, Outcome.VOID]),
        voidReason: "SOURCE_UNAVAILABLE",
        evidenceHash: `proposal-${challenge.id}`,
        now,
      };
    case 5:
      return {
        type: "dispute",
        id: challenge.id,
        caller: validCaller ? (challenge.acceptor ?? ACCEPTOR_A) : caller,
        outcome: pick(random, [Outcome.A, Outcome.B, Outcome.VOID]),
        evidenceHash: `dispute-${challenge.id}`,
        parentEvidenceHash: challenge.proposal?.evidenceHash ?? "wrong-parent",
        now,
      };
    case 6:
      return { type: "finalize", id: challenge.id, now: challenge.proposal?.disputeDeadline ?? now };
    case 7: {
      const deadline = challenge.dispute?.arbitrationDeadline ?? now;
      const arbitrationNow = challenge.dispute ? Math.max(challenge.sourceCorrectionCutoff, deadline - 1) : now;
      return {
        type: "arbitrate",
        id: challenge.id,
        caller: validCaller ? "arbiter" : caller,
        outcome: pick(random, [Outcome.A, Outcome.B, Outcome.VOID]),
        evidenceHash: `arbiter-${challenge.id}`,
        parentEvidenceHash: challenge.dispute?.evidenceHash ?? "wrong-parent",
        now: arbitrationNow,
      };
    }
    case 8:
      return { type: "voidUnproposed", id: challenge.id, now: challenge.proposalDeadline };
    case 9:
      return { type: "voidUnarbitrated", id: challenge.id, now: challenge.dispute?.arbitrationDeadline ?? now };
    case 10:
      return { type: "claim", id: challenge.id, caller: random() % 2 ? CHALLENGER : ACCEPTOR_A };
    default:
      return { type: "refund", id: challenge.id, caller: random() % 2 ? CHALLENGER : ACCEPTOR_A };
  }
}

function runSequence(seed) {
  const random = rng(seed);
  const model = new ChallengeModel();
  const counts = Object.create(null);
  let now = START;
  let nextIndex = 0;
  let rejected = 0;
  for (let step = 0; step < DEPTH; step += 1) {
    if (random() % 9 === 0) now += random() % 101;
    const action = actionFor(model, random, nextIndex, now);
    if (action.type === "create") nextIndex += 1;
    let result;
    try {
      result = model.apply(action);
    } catch (error) {
      error.message = `${error.message} sequence=${seed} step=${step} action=${JSON.stringify(action)}`;
      throw error;
    }
    if (result.ok) counts[action.type] = (counts[action.type] ?? 0) + 1;
    else rejected += 1;
    if (action.now !== undefined) now = Math.max(now, action.now);
  }
  return { seed, counts, rejected, state: model.snapshot() };
}

function mergeCounts(total, counts) {
  for (const [key, value] of Object.entries(counts)) total[key] = (total[key] ?? 0) + value;
}

const deterministic = runDeterministicPaths();
const randomCounts = Object.create(null);
let rejected = 0;
for (let sequence = 0; sequence < SEQUENCES; sequence += 1) {
  const result = runSequence(0xC0DE0000 + sequence);
  mergeCounts(randomCounts, result.counts);
  rejected += result.rejected;
}

console.log(JSON.stringify({
  status: "ok",
  deterministic: { successfulTransitions: deterministic.counts },
  random: { sequences: SEQUENCES, depth: DEPTH, successfulTransitions: randomCounts, rejected },
}));
