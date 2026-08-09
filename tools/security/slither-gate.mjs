import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const expectedVersion = "0.11.6";
const expectedFindingInventorySha256 = "sha256:ce15eeda80dcb84981d2a6994f2c0d89b6f9f773ed180b7337770d765096a666";
const allowedMediumFindings = new Map([
  [
    "368f3d9598b6b9e4039ae0f605fd48aeca5a9a54965fa51413645275d8bc7799",
    {
      check: "incorrect-equality",
      confidence: "High",
      functionName: "accept",
      source: "contracts/src/ChallengeEscrowKernel.sol",
    },
  ],
  [
    "2c0f30f1db2b57a0505836d0c5b62787cd941937c35b133f0675c4d67c61f2b5",
    {
      check: "reentrancy-no-eth",
      confidence: "Medium",
      functionName: "createAndFund",
      source: "contracts/src/ChallengeEscrowKernel.sol",
    },
  ],
]);
const expectedSeverityCounts = Object.freeze({
  High: 0,
  Medium: 2,
  Low: 14,
  Informational: 9,
  Optimization: 0,
});

function assert(condition, message) {
  if (!condition) throw new Error(`slither-gate: ${message}`);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedFindingInventory(detectors) {
  return detectors.map((detector) => ({
    id: detector.id,
    check: detector.check,
    impact: detector.impact,
    confidence: detector.confidence,
    elements: detector.elements.map((element) => ({
      type: element.type,
      name: element.name,
      source: element.source_mapping?.filename_relative ?? null,
    })).sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right))),
  })).sort((left, right) => compareText(left.id, right.id));
}

const versionResult = run("slither", ["--version"]);
assert(!versionResult.error && versionResult.status === 0, "Slither is unavailable");
const actualVersion = versionResult.stdout.trim();
assert(actualVersion === expectedVersion, `expected Slither ${expectedVersion}, got ${actualVersion}`);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "challenge-escrow-slither-"));
const reportPath = join(temporaryDirectory, "report.json");

try {
  const result = run("slither", ["contracts", "--exclude-dependencies", "--json", reportPath]);
  assert(!result.error && !result.signal, `execution failed: ${result.error?.message ?? result.signal}`);
  // Slither exits 255 when it successfully emits a report containing findings.
  assert(result.status === 0 || result.status === 255, `unexpected exit status ${result.status}`);

  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    throw new Error(`slither-gate: report is missing or malformed: ${error.message}`);
  }
  assert(report.success === true, `analysis failed: ${report.error ?? "unknown Slither error"}`);
  assert(Array.isArray(report.results?.detectors), "detector inventory is missing");

  const findingInventory = normalizedFindingInventory(report.results.detectors);
  assert(
    new Set(findingInventory.map((finding) => finding.id)).size === findingInventory.length,
    "duplicate detector IDs make the finding inventory ambiguous",
  );
  const findingInventorySha256 = `sha256:${createHash("sha256")
    .update(JSON.stringify(findingInventory))
    .digest("hex")}`;
  assert(
    findingInventorySha256 === expectedFindingInventorySha256,
    `finding inventory drifted: ${findingInventorySha256}`,
  );

  const severityCounts = { High: 0, Medium: 0, Low: 0, Informational: 0, Optimization: 0 };
  const observedAllowed = new Set();
  for (const detector of report.results.detectors) {
    assert(Object.hasOwn(severityCounts, detector.impact), `unknown severity ${detector.impact}`);
    severityCounts[detector.impact] += 1;
    assert(detector.impact !== "High", `${detector.check} produced a high-severity finding`);
    if (detector.impact !== "Medium") continue;

    const expected = allowedMediumFindings.get(detector.id);
    assert(expected, `unreviewed medium finding ${detector.check} (${detector.id})`);
    const functions = detector.elements
      .filter((element) => element.type === "function")
      .map((element) => element.name);
    const sources = [...new Set(detector.elements.map((element) => element.source_mapping?.filename_relative))];
    assert(detector.check === expected.check, `detector drift for ${detector.id}`);
    assert(detector.confidence === expected.confidence, `confidence drift for ${detector.id}`);
    assert(functions.length === 1 && functions[0] === expected.functionName, `function drift for ${detector.id}`);
    assert(sources.length === 1 && sources[0] === expected.source, `source drift for ${detector.id}`);
    observedAllowed.add(detector.id);
  }

  assert(
    observedAllowed.size === allowedMediumFindings.size
      && [...allowedMediumFindings.keys()].every((id) => observedAllowed.has(id)),
    "reviewed medium-finding inventory drifted",
  );
  assert(
    Object.entries(expectedSeverityCounts)
      .every(([severity, expected]) => severityCounts[severity] === expected),
    `finding severity inventory drifted: ${JSON.stringify(severityCounts)}`,
  );

  console.log(JSON.stringify({
    status: "ok",
    slitherVersion: actualVersion,
    severityCounts,
    findingInventorySha256,
    reviewedMediumFindings: [...observedAllowed],
  }, null, 2));
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
