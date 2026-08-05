import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourceContracts = join(root, "contracts");
const mutationTargets = [
  {
    id: "M-01",
    description: "Remove the pause guard from funding",
    file: "src/ChallengeEscrowKernel.sol",
    search: "if (paused) revert ContractPaused();",
    replace: "if (false) revert ContractPaused();",
    occurrence: 0,
  },
  {
    id: "M-02",
    description: "Ignore the acceptance challenge binding",
    file: "src/ChallengeEscrowKernel.sol",
    search: "if (permit.challengeId != challengeId) {",
    replace: "if (false) {",
  },
  {
    id: "M-03",
    description: "Ignore the acceptance nonce binding",
    file: "src/ChallengeEscrowKernel.sol",
    search: "if (permit.acceptanceNonce != challenge.acceptanceNonce) {",
    replace: "if (false) {",
  },
  {
    id: "M-04",
    description: "Allow an accepting wallet to equal the challenger",
    file: "src/ChallengeEscrowKernel.sol",
    search: "|| wallet == challengerWallet",
    replace: "|| false",
  },
  {
    id: "M-05",
    description: "Ignore the proposal parent evidence hash",
    file: "src/ChallengeEscrowKernel.sol",
    search: "if (parentEvidenceHash != challenge.proposal.evidenceHash) {",
    replace: "if (false) {",
  },
  {
    id: "M-06",
    description: "Close uncontested finalization one second early",
    file: "src/ChallengeEscrowKernel.sol",
    search: "if (currentTime < challenge.proposal.disputeDeadline) {",
    replace: "if (currentTime <= challenge.proposal.disputeDeadline) {",
  },
  {
    id: "M-07",
    description: "Reject the independent VOID refund branch",
    file: "src/ChallengeEscrowKernel.sol",
    search: "bool acceptedTerminal = originState == ChallengeTypes.LifecycleState.VOID;",
    replace: "bool acceptedTerminal = false;",
  },
  {
    id: "M-08",
    description: "Remove exact incoming balance-delta enforcement",
    file: "src/libraries/ExactTokenDelta.sol",
    search: "if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) {",
    replace: "if (false) {",
  },
  {
    id: "M-09",
    description: "Stop clearing the consumed entitlement",
    file: "src/ChallengeEscrowKernel.sol",
    search: "entitlement.claimableAmount = 0;",
    replace: "entitlement.claimableAmount = amount;",
  },
  {
    id: "M-10",
    description: "Flip the winner-side wallet mapping",
    file: "src/ChallengeEscrowKernel.sol",
    search: "return challengerWon ? challenge.challengerWallet : challenge.acceptingWallet;",
    replace: "return challengerWon ? challenge.acceptingWallet : challenge.challengerWallet;",
  },
  {
    id: "M-11",
    description: "Reject an execution whose timeout exactly covers the longest path",
    file: "src/ChallengeEscrowKernel.sol",
    search: "latestProposalPath > execution.timeoutVoidAt",
    replace: "latestProposalPath >= execution.timeoutVoidAt",
  },
  {
    id: "M-12",
    description: "Allow resolver and arbiter role overlap",
    file: "src/ChallengeEscrowKernel.sol",
    search: "if (resolver_ == arbiter_) revert ResolverEqualsArbiter();",
    replace: "if (false) revert ResolverEqualsArbiter();",
  },
];

function copyContracts(destination) {
  cpSync(sourceContracts, destination, {
    recursive: true,
    filter(source) {
      return ![
        `${sep}out${sep}`,
        `${sep}cache${sep}`,
        `${sep}broadcast${sep}`,
      ].some((fragment) => source.includes(fragment));
    },
  });
  cpSync(join(root, "node_modules"), join(destination, "..", "node_modules"), {
    recursive: true,
  });
}

function applyMutation(mutationRoot, mutation) {
  const filePath = join(mutationRoot, mutation.file);
  const original = readFileSync(filePath, "utf8");
  const matches = [...original.matchAll(new RegExp(escapeRegExp(mutation.search), "g"))];
  if (matches.length === 0) {
    throw new Error(`${mutation.id}: mutation anchor not found`);
  }
  const occurrence = mutation.occurrence ?? 0;
  if (occurrence >= matches.length) {
    throw new Error(`${mutation.id}: requested occurrence ${occurrence} is absent`);
  }
  const match = matches[occurrence];
  const mutated =
    original.slice(0, match.index)
    + mutation.replace
    + original.slice(match.index + mutation.search.length);
  writeFileSync(filePath, mutated);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runMutation(mutation) {
  const tempRoot = mkdtempSync(join(tmpdir(), `challenge-escrow-${mutation.id.toLowerCase()}-`));
  const mutationRoot = join(tempRoot, "contracts");
  try {
    copyContracts(mutationRoot);
    applyMutation(mutationRoot, mutation);
    const command = [
      "forge",
      "test",
      "--root",
      mutationRoot,
      "--match-path",
      "test/*.t.sol",
      "--fail-fast",
    ];
    const result = spawnSync(command[0], command.slice(1), {
      cwd: root,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, FOUNDRY_PROFILE: "default" },
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const killed = result.status !== 0 || Boolean(result.error);
    const signalLines = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) =>
        line.startsWith("[FAIL]")
        || line.startsWith("Error:")
        || line.startsWith("Suite result:")
        || line.startsWith("Ran ")
      );
    return {
      id: mutation.id,
      description: mutation.description,
      killed,
      exitCode: result.status,
      signal: result.signal,
      error: result.error?.message,
      summary: signalLines.slice(-4).join("\n") || output.split("\n").slice(-4).join("\n"),
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const startedAt = Date.now();
const results = mutationTargets.map(runMutation);
const survivors = results.filter((result) => !result.killed);
const report = {
  status: survivors.length === 0 ? "ok" : "failed",
  mutations: results.length,
  killed: results.filter((result) => result.killed).length,
  survived: survivors.length,
  durationMs: Date.now() - startedAt,
  results,
};
console.log(JSON.stringify(report, null, 2));
if (survivors.length > 0) process.exitCode = 1;
