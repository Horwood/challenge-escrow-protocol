import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function executableFromPath(name) {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  if (result.status === 0) {
    const candidate = result.stdout.trim();
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function findSolc() {
  if (process.env.SOLC_BIN && existsSync(process.env.SOLC_BIN)) return process.env.SOLC_BIN;
  const fromPath = executableFromPath("solc");
  if (fromPath) return fromPath;
  const roots = ["/opt/homebrew/Cellar/slither-analyzer", "/usr/local/Cellar/slither-analyzer"];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const version of readdirSync(root)) {
      const candidate = join(root, version, "libexec", "bin", "solc");
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const solc = findSolc();
const z3 = executableFromPath("z3");
if (!solc) throw new Error("SOLC_BIN is not set and no solc executable was found");
if (!z3) throw new Error("z3 is required for the CHC proof; install it or set it on PATH");
const expectedSolcVersion = "0.8.36+commit.8a079791";
const solcVersionResult = spawnSync(solc, ["--version"], { encoding: "utf8" });
const solcVersionOutput = `${solcVersionResult.stdout ?? ""}${solcVersionResult.stderr ?? ""}`;
const actualSolcVersion = solcVersionOutput.match(/Version:\s*(0\.8\.36\+commit\.8a079791)(?:\.[^\s]+)?/)?.[1] ?? null;
if (solcVersionResult.error || solcVersionResult.status !== 0 || actualSolcVersion !== expectedSolcVersion) {
  throw new Error(`expected solc ${expectedSolcVersion}, received ${actualSolcVersion ?? "unavailable"}`);
}

const source = resolve("tools/formal/ChallengeEscrowArithmeticProperties.sol");
const sourceText = readFileSync(source, "utf8");
const expectedAssertions = [...sourceText.matchAll(/\bassert\s*\(/g)].length;
if (expectedAssertions !== 7) {
  throw new Error(`SMT lemma assertion set drifted: expected 7, found ${expectedAssertions}`);
}
const args = [
  "--model-checker-engine", "chc",
  "--model-checker-solvers", "z3",
  "--model-checker-timeout", "120000",
  "--model-checker-show-proved-safe",
  "--model-checker-show-unproved",
  "--model-checker-targets", "assert,underflow,overflow",
  source,
];
const result = spawnSync(solc, args, { encoding: "utf8" });
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);

if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`solc exited with status ${result.status}`);
if (/not available|analysis was not possible|not safe|not proven|unproved/i.test(output)) {
  throw new Error("SMTChecker did not prove every requested target");
}
if (!/CHC:/i.test(output)) throw new Error("SMTChecker produced no CHC result");
const provedAssertions = [...output.matchAll(/CHC:\s+Assertion violation check is safe!/g)].length;
if (provedAssertions !== expectedAssertions) {
  throw new Error(
    `SMTChecker assertion count mismatch: expected ${expectedAssertions}, proved ${provedAssertions}`,
  );
}

console.log(`formal-check: ${provedAssertions} arithmetic assertions and all requested safety targets are proved safe with solc ${actualSolcVersion}`);
