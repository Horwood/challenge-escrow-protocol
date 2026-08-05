import assert from "node:assert/strict";

import { ChallengeModel } from "../model/challenge-model.mjs";

const START = 1_000_000;
const SAMPLES = 10_000;

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}

function schedule(index, random, forceBoundary = false) {
  const acceptanceDeadline = START + 1 + (random() % 600);
  const observationTime = acceptanceDeadline + 1 + (random() % 600);
  const disputeWindow = 1 + (random() % 600);
  const sourceCorrectionCutoff = forceBoundary
    ? observationTime + disputeWindow - 1
    : observationTime + (random() % (disputeWindow + 2));
  const proposalDeadline = sourceCorrectionCutoff + 1 + (random() % 600);
  const arbitrationWindow = 1 + (random() % 600);
  const latestPath = proposalDeadline + disputeWindow + arbitrationWindow;
  const latestCorrectionPath = sourceCorrectionCutoff + arbitrationWindow;
  const timeoutVoidAt = forceBoundary
    ? Math.max(latestPath, latestCorrectionPath)
    : Math.max(latestPath, latestCorrectionPath) + (random() % 9) - 4;
  return {
    id: `sweep-${index}`,
    nonce: `nonce-${index}`,
    now: START,
    acceptanceDeadline,
    observationTime,
    sourceCorrectionCutoff,
    proposalDeadline,
    disputeWindow,
    arbitrationWindow,
    timeoutVoidAt,
  };
}

function validate(schedule_) {
  const failures = [];
  if (!(schedule_.acceptanceDeadline > schedule_.now)) failures.push("acceptance-after-open");
  if (!(schedule_.acceptanceDeadline < schedule_.observationTime)) failures.push("acceptance-before-observation");
  if (!(schedule_.observationTime < schedule_.sourceCorrectionCutoff && schedule_.sourceCorrectionCutoff < schedule_.proposalDeadline)) failures.push("correction-order");
  if (!(schedule_.disputeWindow > 0 && schedule_.arbitrationWindow > 0)) failures.push("positive-windows");
  if (!(schedule_.sourceCorrectionCutoff < schedule_.observationTime + schedule_.disputeWindow)) failures.push("correction-before-dispute-end");
  const latestProposalPath = schedule_.proposalDeadline + schedule_.disputeWindow + schedule_.arbitrationWindow;
  const latestCorrectionPath = schedule_.sourceCorrectionCutoff + schedule_.arbitrationWindow;
  if (Math.max(latestProposalPath, latestCorrectionPath) > schedule_.timeoutVoidAt) failures.push("timeout-covers-all-paths");
  return { valid: failures.length === 0, failures, latestProposalPath, latestCorrectionPath };
}

function authorityWindows(schedule_) {
  const proposalSilence = schedule_.proposalDeadline - schedule_.now;
  const arbiterSilence = schedule_.proposalDeadline + schedule_.disputeWindow + schedule_.arbitrationWindow - schedule_.now;
  const timeoutBound = schedule_.timeoutVoidAt - schedule_.now;
  return {
    challengerOpenExit: schedule_.acceptanceDeadline - schedule_.now,
    resolverSilence: proposalSilence,
    arbiterSilence: arbiterSilence,
    protocolBound: timeoutBound,
    timeoutSlack: schedule_.timeoutVoidAt - Math.max(schedule_.latestProposalPath, schedule_.latestCorrectionPath),
  };
}

function assertModelAgreement(candidate, validation, index) {
  const model = new ChallengeModel();
  const result = model.apply({
    type: "create",
    id: candidate.id,
    nonce: candidate.nonce,
    caller: "challenger",
    challenger: "challenger",
    challengerSide: index % 2 === 0 ? "A" : "B",
    stake: 1,
    ...candidate,
  });
  assert.equal(result.ok, validation.valid, `model disagreement at ${candidate.id}: ${JSON.stringify({ validation, result })}`);
}

const random = rng(0xC0FFEE);
const samples = [];
for (let index = 0; index < SAMPLES; index += 1) {
  const candidate = schedule(index, random, index < 32);
  const validation = validate(candidate);
  candidate.latestProposalPath = validation.latestProposalPath;
  candidate.latestCorrectionPath = validation.latestCorrectionPath;
  assertModelAgreement(candidate, validation, index);
  samples.push({ ...candidate, validation, windows: authorityWindows(candidate) });
}

const valid = samples.filter((sample) => sample.validation.valid);
const invalid = samples.filter((sample) => !sample.validation.valid);
const minSlack = Math.min(...valid.map((sample) => sample.windows.timeoutSlack));
const maxResolverSilence = Math.max(...valid.map((sample) => sample.windows.resolverSilence));
const maxArbiterSilence = Math.max(...valid.map((sample) => sample.windows.arbiterSilence));
const maxProtocolBound = Math.max(...valid.map((sample) => sample.windows.protocolBound));
const boundary = valid.find((sample) => sample.windows.timeoutSlack === minSlack);

console.log(JSON.stringify({
  status: "ok",
  samples: SAMPLES,
  valid: valid.length,
  invalid: invalid.length,
  invalidReasons: invalid.reduce((result, sample) => {
    for (const reason of sample.validation.failures) result[reason] = (result[reason] ?? 0) + 1;
    return result;
  }, {}),
  measurements: {
    minimumTimeoutSlack: minSlack,
    maximumResolverSilence: maxResolverSilence,
    maximumArbiterSilence: maxArbiterSilence,
    maximumProtocolBound: maxProtocolBound,
  },
  boundaryFixture: boundary,
}, null, 2));
