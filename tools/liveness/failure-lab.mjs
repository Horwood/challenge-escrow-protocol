import assert from "node:assert/strict";

import { ChallengeModel, Outcome, State } from "../model/challenge-model.mjs";

function apply(model, action, expected = true) {
  const result = model.apply(action);
  assert.equal(result.ok, expected, `unexpected ${action.type}: ${result.error ?? "success"}`);
  return result;
}

function create(model, id, now, side = "A") {
  return apply(model, {
    type: "create",
    id,
    nonce: `lab-${id}`,
    caller: "challenger",
    challenger: "challenger",
    challengerSide: side,
    stake: 100,
    now,
    acceptanceDeadline: now + 10,
    observationTime: now + 20,
    sourceCorrectionCutoff: now + 25,
    proposalDeadline: now + 50,
    disputeWindow: 10,
    arbitrationWindow: 20,
    timeoutVoidAt: now + 80,
  });
}

function accept(model, id, now, wallet = "acceptor-a") {
  return apply(model, {
    type: "accept",
    id,
    caller: wallet,
    acceptor: wallet,
    permitNonce: 0,
    permitValid: true,
    expiresAt: now + 1,
    now,
  });
}

function finish(model, id, start, state, exitAt) {
  const snapshot = model.snapshot();
  const challenge = snapshot.challenges.find((item) => item.id === id);
  assert.equal(challenge?.state, state);
  assert.equal(snapshot.totalOutstandingLiability, 0);
  return { state, elapsed: exitAt - start, final: snapshot };
}

function pauserFailure() {
  const model = new ChallengeModel();
  const id = "pauser-silence";
  const start = 100;
  create(model, id, start);
  apply(model, { type: "pause", caller: "pauser", paused: true });
  apply(model, { type: "accept", id, caller: "acceptor-a", acceptor: "acceptor-a", permitNonce: 0, permitValid: true, expiresAt: 109, now: 101 }, false);
  apply(model, { type: "expire", id, now: 110 });
  apply(model, { type: "refund", id, caller: "challenger" });
  return { name: "pauser-permanent-pause", failure: "pauser unavailable after pausing", ...finish(model, id, start, State.EXPIRED, 110) };
}

function resolverFailure() {
  const model = new ChallengeModel();
  const id = "resolver-silence";
  const start = 200;
  create(model, id, start);
  accept(model, id, 201);
  apply(model, { type: "voidUnproposed", id, now: 250 });
  apply(model, { type: "refund", id, caller: "challenger" });
  apply(model, { type: "refund", id, caller: "acceptor-a" });
  return { name: "resolver-silence", failure: "resolver never proposes", ...finish(model, id, start, State.VOID, 250) };
}

function arbiterFailure() {
  const model = new ChallengeModel();
  const id = "arbiter-silence";
  const start = 300;
  create(model, id, start);
  accept(model, id, 301);
  apply(model, { type: "propose", id, caller: "resolver", outcome: Outcome.A, evidenceHash: "proposal-lab", now: 320 });
  apply(model, { type: "dispute", id, caller: "acceptor-a", outcome: Outcome.B, evidenceHash: "dispute-lab", parentEvidenceHash: "proposal-lab", now: 321 });
  apply(model, { type: "voidUnarbitrated", id, now: 345 });
  apply(model, { type: "refund", id, caller: "challenger" });
  apply(model, { type: "refund", id, caller: "acceptor-a" });
  return { name: "arbiter-silence", failure: "arbiter never decides", ...finish(model, id, start, State.VOID, 345) };
}

function dishonestAuthorityFailure() {
  const model = new ChallengeModel();
  const id = "dishonest-resolver";
  const start = 400;
  create(model, id, start);
  accept(model, id, 401);
  apply(model, { type: "propose", id, caller: "resolver", outcome: Outcome.A, evidenceHash: "proposal-dishonest", now: 420 });
  apply(model, { type: "dispute", id, caller: "acceptor-a", outcome: Outcome.B, evidenceHash: "dispute-dishonest", parentEvidenceHash: "proposal-dishonest", now: 421 });
  apply(model, { type: "pause", caller: "pauser", paused: true });
  apply(model, { type: "voidUnarbitrated", id, now: 445 });
  apply(model, { type: "refund", id, caller: "challenger" });
  apply(model, { type: "refund", id, caller: "acceptor-a" });
  return { name: "dishonest-resolver-paused", failure: "resolver is disputed while pauser also pauses", ...finish(model, id, start, State.VOID, 445) };
}

const results = [pauserFailure(), resolverFailure(), arbiterFailure(), dishonestAuthorityFailure()];
for (const result of results) {
  assert.equal(result.final.totalOutstandingLiability, 0);
}
console.log(JSON.stringify({
  status: "ok",
  cases: results.map(({ name, failure, state, elapsed }) => ({ name, failure, state, elapsed })),
  allFundsExited: true,
}, null, 2));
