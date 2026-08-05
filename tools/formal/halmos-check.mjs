import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const formalRoot = "tools/formal";
const resultsPath = "tools/formal/out/halmos-results.json";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

if (!existsSync("tools/formal/foundry.toml")) {
  throw new Error("formal Foundry configuration is missing");
}

run("forge", ["build", "--root", formalRoot, "--config-path", `${formalRoot}/foundry.toml`, "--ast"]);
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
]);

const report = JSON.parse(readFileSync(resultsPath, "utf8"));
const tests = Object.values(report.test_results ?? {}).flat();
if (report.exitcode !== 0 || tests.length !== 5 || tests.some((test) => test.exitcode !== 0)) {
  throw new Error("formal contract boundary did not prove all five properties");
}

console.log(`formal-contract: ${tests.length} Halmos properties proved with zero counterexamples`);
