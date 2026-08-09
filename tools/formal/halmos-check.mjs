import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const formalRoot = "tools/formal";
const resultsPath = "tools/formal/out/halmos-results.json";
const ledgerPath = "tools/formal/proof-ledger.json";

function run(command, args, timeout) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} terminated by ${result.signal}`);
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

if (!existsSync("tools/formal/foundry.toml")) {
  throw new Error("formal Foundry configuration is missing");
}

run("forge", ["build", "--root", formalRoot, "--config-path", `${formalRoot}/foundry.toml`, "--ast"], 60_000);
run("uv", [
  "tool",
  "run",
  "--from",
  "halmos==0.3.3",
  "halmos",
  "--root",
  formalRoot,
  "--contract",
  "ChallengeEscrowHalmosProperties",
  "--solver",
  "z3",
  "--solver-timeout-assertion",
  "30s",
  "--solver-timeout-branching",
  "10ms",
  "--no-status",
  "--json-output",
  resultsPath,
], 220_000);

const report = JSON.parse(readFileSync(resultsPath, "utf8"));
const tests = Object.values(report.test_results ?? {}).flat();
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
if (ledger.schema !== "challenge-escrow.formal-proof-ledger/v1" || !Array.isArray(ledger.properties)) {
  throw new Error("formal proof ledger is malformed");
}
const ledgerIds = ledger.properties.map((property) => property.id);
const expectedNames = ledger.properties.map((property) => property.test).sort();
const actualNames = tests.map((test) => String(test.name).split("(")[0]).sort();
if (
  new Set(ledgerIds).size !== ledgerIds.length
  || new Set(expectedNames).size !== expectedNames.length
  || ledger.properties.some((property) => property.status !== "PROVED")
  || JSON.stringify(actualNames) !== JSON.stringify(expectedNames)
) throw new Error("formal proof ledger does not match the executed Halmos properties");
if (
  report.exitcode !== 0
  || tests.length !== 10
  || tests.some((test) => test.exitcode !== 0 || test.num_models !== 0 || test.num_bounded_loops !== 0)
) {
  throw new Error("formal contract boundary did not prove all ten properties");
}

console.log(`formal-contract: ${tests.length} Halmos properties proved with zero counterexamples`);
