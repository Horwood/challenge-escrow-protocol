import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

function executable(name) {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function findSolc() {
  const fromPath = executable("solc");
  if (fromPath && existsSync(fromPath)) return fromPath;
  for (const root of ["/opt/homebrew/Cellar/slither-analyzer", "/usr/local/Cellar/slither-analyzer"]) {
    if (!existsSync(root)) continue;
    for (const version of readdirSync(root)) {
      const candidate = join(root, version, "libexec", "bin", "solc");
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const medusa = process.env.MEDUSA_BIN || executable("medusa");
const solc = process.env.SOLC_BIN || findSolc();
if (!medusa) throw new Error("medusa is required for the independent EVM fuzz run");
if (!solc) throw new Error("solc is required by crytic-compile; set SOLC_BIN or install solc");

const expectedMedusaVersion = "medusa version 1.5.1";
const versionResult = spawnSync(medusa, ["--version"], { encoding: "utf8" });
const actualMedusaVersion = `${versionResult.stdout ?? ""}${versionResult.stderr ?? ""}`.trim();
if (versionResult.error || versionResult.status !== 0) {
  throw new Error("medusa version could not be determined");
}
if (actualMedusaVersion !== expectedMedusaVersion) {
  throw new Error(`expected ${expectedMedusaVersion}, received ${actualMedusaVersion}`);
}

const expectedSolcVersion = "0.8.36+commit.8a079791";
const solcVersionResult = spawnSync(solc, ["--version"], { encoding: "utf8" });
const solcVersionOutput = `${solcVersionResult.stdout ?? ""}${solcVersionResult.stderr ?? ""}`;
const actualSolcVersion = solcVersionOutput.match(/Version:\s*(0\.8\.36\+commit\.8a079791)(?:\.[^\s]+)?/)?.[1] ?? null;
if (solcVersionResult.error || solcVersionResult.status !== 0 || actualSolcVersion !== expectedSolcVersion) {
  throw new Error(`expected solc ${expectedSolcVersion}, received ${actualSolcVersion ?? "unavailable"}`);
}

const requiredProperties = [
  "MedusaChallengeHarness.property_accounting()",
  "MedusaChallengeHarness.property_deadlineOrdering()",
  "MedusaChallengeHarness.property_entitlements()",
  "MedusaChallengeHarness.property_terminalFinality()",
];

const pathPrefix = dirname(solc);
const result = spawnSync(
  medusa,
  ["fuzz", "--config", "tools/medusa/config.json", "--no-color"],
  {
    encoding: "utf8",
    env: { ...process.env, PATH: `${pathPrefix}:${process.env.PATH ?? ""}` },
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  },
);
if (result.error) throw result.error;
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);
if (result.status !== 0) throw new Error(`medusa exited with status ${result.status}`);

const summary = output.match(/Test summary:\s+(\d+) test\(s\) passed,\s+(\d+) test\(s\) failed/);
if (!summary) throw new Error("medusa did not emit a machine-checkable test summary");
const passed = Number(summary[1]);
const failed = Number(summary[2]);
if (failed !== 0) throw new Error(`medusa reported ${failed} failed test(s)`);

for (const property of requiredProperties) {
  const marker = `[PASSED] Property Test: ${property}`;
  if (!output.includes(marker)) throw new Error(`required Medusa property did not pass: ${property}`);
}

const passedPropertyCount = [...output.matchAll(/\[PASSED\] Property Test:/g)].length;
const passedAssertionCount = [...output.matchAll(/\[PASSED\] Assertion Test:/g)].length;
if (passed !== passedPropertyCount + passedAssertionCount) {
  throw new Error(
    `medusa summary mismatch: summary=${passed}, properties=${passedPropertyCount}, assertions=${passedAssertionCount}`,
  );
}
if (passedPropertyCount !== requiredProperties.length) {
  throw new Error(
    `unexpected Medusa property count: expected ${requiredProperties.length}, received ${passedPropertyCount}`,
  );
}

console.log(JSON.stringify({
  medusaVersion: actualMedusaVersion,
  solcVersion: actualSolcVersion,
  requiredProperties: passedPropertyCount,
  auxiliaryAssertionTargets: passedAssertionCount,
  failed,
}));
