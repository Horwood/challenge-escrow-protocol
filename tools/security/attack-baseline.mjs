import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const reportDir = mkdtempSync(join(tmpdir(), "challenge-escrow-coverage-"));
const reportPath = join(reportDir, "lcov.info");
process.on("exit", () => rmSync(reportDir, { recursive: true, force: true }));
const forge = spawnSync(
  "forge",
  ["coverage", "--root", "contracts", "--report", "lcov", "--report-file", reportPath],
  { stdio: "ignore", timeout: 180_000 },
);
if (forge.error || forge.signal || forge.status !== 0) {
  throw new Error(
    `forge coverage failed: ${forge.error?.message ?? forge.signal ?? forge.status ?? "unknown"}`,
  );
}

const productionFiles = new Set([
  "src/ChallengeEscrow.sol",
  "src/ChallengeEscrowKernel.sol",
  "src/libraries/ExactTokenDelta.sol",
]);
const gaps = [];
const seenProductionFiles = new Set();
let productionBranches = 0;
let file = null;
for (const line of readFileSync(reportPath, "utf8").split("\n")) {
  if (line.startsWith("SF:")) {
    file = line.slice(3);
    if (productionFiles.has(file)) seenProductionFiles.add(file);
    continue;
  }
  if (!file || !productionFiles.has(file) || !line.startsWith("BRDA:")) continue;
  productionBranches += 1;
  const [lineNumber, block, branch, taken] = line.slice(5).split(",");
  if (taken === "0" || taken === "-") {
    gaps.push({ file, line: Number(lineNumber), block: Number(block), branch: Number(branch), taken });
  }
}

const acceptedDominatedBranch = "if (afterEscrowBalance < totalOutstandingLiability) {";
const sourceLines = new Map(
  [...productionFiles].map((path) => [
    path,
    readFileSync(join("contracts", path), "utf8").split("\n"),
  ]),
);
const acceptedGaps = gaps.filter((gap) =>
  gap.file === "src/ChallengeEscrowKernel.sol"
  && sourceLines.get(gap.file)?.[gap.line - 1]?.trim() === acceptedDominatedBranch
);
const unexpectedGaps = gaps.filter((gap) => !acceptedGaps.includes(gap));

function category(gap) {
  if (gap.file.endsWith("ChallengeEscrow.sol")) {
    if (gap.line <= 39) return "constructor role and token boundaries";
    return "pause and participant boundaries";
  }
  if (gap.file.endsWith("ExactTokenDelta.sol")) return "token return and balance-delta boundaries";
  if (gap.line <= 337) return "creation identity, commitment, and funding";
  if (gap.line <= 404) return "acceptance permit and signature authorization";
  if (gap.line <= 441) return "open-state timeout and cancellation";
  if (gap.line <= 484) return "proposal reason and correction cutoff";
  if (gap.line <= 536) return "dispute lineage and arbitration start";
  if (gap.line <= 567) return "uncontested finalization";
  if (gap.line <= 614) return "arbiter authorization and finalization";
  if (gap.line <= 644) return "permissionless timeout void";
  if (gap.line <= 689) return "claims and independent refunds";
  if (gap.line <= 812) return "execution and deadline validation";
  return "state access and accounting";
}

const mutationTargets = [
  { id: "M-01", target: "Remove the paused guard from createAndFund, accept, or propose", oracle: "pause-safe-exit and exposure tests" },
  { id: "M-02", target: "Ignore permit challengeId or specHash", oracle: "permit binding permutations" },
  { id: "M-03", target: "Ignore acceptance nonce or expiry", oracle: "replay and stale-permit tests" },
  { id: "M-04", target: "Allow an accepting wallet to overlap a role or participant", oracle: "constructor and participant overlap matrix" },
  { id: "M-05", target: "Remove proposal or arbitration parent-evidence equality", oracle: "lineage fixtures" },
  { id: "M-06", target: "Allow uncontested finalization one second before its deadline", oracle: "boundary-time fixtures" },
  { id: "M-07", target: "Disable accepted-challenge VOID refund eligibility", oracle: "VOID refund and blocked-recipient isolation tests" },
  { id: "M-08", target: "Remove exact incoming or outgoing balance-delta checks", oracle: "adversarial token corpus" },
  { id: "M-09", target: "Permit a second claim or refund", oracle: "entitlement one-time consumption" },
  { id: "M-10", target: "Change the winner-side mapping", oracle: "A/B resolution matrix" },
  { id: "M-11", target: "Allow timeoutVoidAt to undershoot the longest proposal path by one second", oracle: "deadline arithmetic and timeout validation" },
  { id: "M-12", target: "Allow resolver and arbiter authority overlap", oracle: "constructor role-separation tests" },
];

const byCategory = Object.create(null);
for (const gap of gaps) {
  const key = category(gap);
  byCategory[key] = (byCategory[key] ?? 0) + 1;
  gap.category = key;
}

const status = seenProductionFiles.size === productionFiles.size
  && productionBranches > 0
  && unexpectedGaps.length === 0
  ? "ok"
  : "failed";
console.log(JSON.stringify({
  status,
  source: "forge coverage --report lcov",
  productionFiles: seenProductionFiles.size,
  productionBranches,
  uncoveredProductionBranches: gaps.length,
  acceptedDominatedBranches: acceptedGaps.length,
  unexpectedUncoveredBranches: unexpectedGaps.length,
  byCategory,
  gaps,
  mutationTargets,
}, null, 2));
if (status !== "ok") process.exitCode = 1;
