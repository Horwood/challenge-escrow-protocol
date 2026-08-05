import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const reportDir = mkdtempSync(join(tmpdir(), "challenge-escrow-coverage-"));
const reportPath = join(reportDir, "lcov.info");
const forge = spawnSync(
  "forge",
  ["coverage", "--root", "contracts", "--report", "lcov", "--report-file", reportPath],
  { stdio: "ignore" },
);
if (forge.status !== 0) {
  throw new Error(`forge coverage failed with status ${forge.status ?? "unknown"}`);
}

const productionFiles = new Set([
  "src/ChallengeEscrow.sol",
  "src/ChallengeEscrowKernel.sol",
  "src/libraries/ExactTokenDelta.sol",
]);
const gaps = [];
let file = null;
for (const line of readFileSync(reportPath, "utf8").split("\n")) {
  if (line.startsWith("SF:")) {
    file = line.slice(3);
    continue;
  }
  if (!file || !productionFiles.has(file) || !line.startsWith("BRDA:")) continue;
  const [lineNumber, block, branch, taken] = line.slice(5).split(",");
  if (taken === "0" || taken === "-") {
    gaps.push({ file, line: Number(lineNumber), block: Number(block), branch: Number(branch), taken });
  }
}

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
  { id: "M-06", target: "Allow finalization before its deadline or dispute after its deadline", oracle: "boundary-time fixtures" },
  { id: "M-07", target: "Replace independent VOID refunds with a shared payout path", oracle: "blocked-recipient isolation" },
  { id: "M-08", target: "Remove exact incoming or outgoing balance-delta checks", oracle: "adversarial token corpus" },
  { id: "M-09", target: "Permit a second claim or refund", oracle: "entitlement one-time consumption" },
  { id: "M-10", target: "Change the winner-side mapping", oracle: "A/B resolution matrix" },
  { id: "M-11", target: "Relax the timeoutVoidAt path bounds", oracle: "deadline arithmetic and timeout validation" },
  { id: "M-12", target: "Add an owner, proxy, rescue, fee, or role-rotation escape hatch", oracle: "authority surface and bytecode inspection" },
];

const byCategory = Object.create(null);
for (const gap of gaps) {
  const key = category(gap);
  byCategory[key] = (byCategory[key] ?? 0) + 1;
  gap.category = key;
}

console.log(JSON.stringify({
  status: "ok",
  source: "forge coverage --report lcov",
  uncoveredProductionBranches: gaps.length,
  byCategory,
  gaps,
  mutationTargets,
}, null, 2));
