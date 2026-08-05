import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ChallengeModel } from "../model/challenge-model.mjs";

const scenarioDir = resolve(dirname(fileURLToPath(import.meta.url)), "scenarios");

function summarize(snapshot) {
  return {
    paused: snapshot.paused,
    totalOutstandingLiability: snapshot.totalOutstandingLiability,
    challenges: snapshot.challenges.map((challenge) => ({
      id: challenge.id,
      state: challenge.state,
      outstanding: challenge.outstanding,
      paid: challenge.paid,
      entitlements: challenge.entitlements,
    })),
  };
}

function loadScenario(path) {
  const scenario = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(typeof scenario.name, "string", `${path}: name is required`);
  assert.ok(Array.isArray(scenario.steps) && scenario.steps.length > 0, `${path}: steps are required`);
  return scenario;
}

export function runScenario(path, { includeTrace = false } = {}) {
  const scenario = loadScenario(path);
  const model = new ChallengeModel();
  const trace = [];
  scenario.steps.forEach((step, index) => {
    const { expect = {}, ...action } = step;
    let result;
    try {
      result = model.apply(action);
    } catch (error) {
      throw new Error(`${scenario.name} step ${index} crashed: ${error.message}; action=${JSON.stringify(action)}`);
    }
    assert.equal(result.ok, expect.ok ?? true, `${scenario.name} step ${index}: unexpected ok=${result.ok}`);
    if (expect.error !== undefined) assert.equal(result.error, expect.error, `${scenario.name} step ${index}: wrong rejection`);
    if (expect.state !== undefined) {
      const actualState = result.state.challenges.find((challenge) => challenge.id === action.id)?.state;
      assert.equal(actualState, expect.state, `${scenario.name} step ${index}: wrong state`);
    }
    trace.push({ index, action, ok: result.ok, error: result.error ?? null, state: summarize(result.state) });
  });
  model.assertInvariants();
  const final = model.snapshot();
  if (scenario.finalOutstanding !== undefined) assert.equal(final.totalOutstandingLiability, scenario.finalOutstanding, `${scenario.name}: final liability`);
  if (scenario.finalStates) {
    for (const [id, expectedState] of Object.entries(scenario.finalStates)) {
      assert.equal(final.challenges.find((challenge) => challenge.id === id)?.state, expectedState, `${scenario.name}: final state ${id}`);
    }
  }
  return {
    name: scenario.name,
    description: scenario.description ?? "",
    steps: trace.length,
    rejected: trace.filter((entry) => !entry.ok).length,
    final: summarize(final),
    ...(includeTrace ? { trace } : {}),
  };
}

function scenarioPaths() {
  return readdirSync(scenarioDir).filter((file) => file.endsWith(".json")).sort().map((file) => join(scenarioDir, file));
}

const argument = process.argv[2];
const includeTrace = process.argv.includes("--trace");
const paths = argument && argument !== "--all" && argument !== "--trace" ? [resolve(argument)] : scenarioPaths();
const results = paths.map((path) => runScenario(path, { includeTrace }));
console.log(JSON.stringify({ status: "ok", scenarios: results }, null, 2));
