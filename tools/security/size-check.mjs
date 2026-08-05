import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EIP170_LIMIT = 24_576;
const root = fileURLToPath(new URL("../..", import.meta.url));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

run("forge", ["build", "--root", "contracts"]);
const bytecode = run(
  "forge",
  ["inspect", "--root", "contracts", "ChallengeEscrow", "deployedBytecode"],
).trim();
if (!/^0x[0-9a-fA-F]+$/.test(bytecode) || (bytecode.length - 2) % 2 !== 0) {
  throw new Error("forge returned an invalid deployed bytecode value");
}

const bytecodeBytes = (bytecode.length - 2) / 2;
const report = {
  status: bytecodeBytes <= EIP170_LIMIT ? "ok" : "failed",
  contract: "ChallengeEscrow",
  deployedBytecodeBytes: bytecodeBytes,
  eip170LimitBytes: EIP170_LIMIT,
  remainingBytes: EIP170_LIMIT - bytecodeBytes,
};
console.log(JSON.stringify(report, null, 2));
if (report.status !== "ok") process.exitCode = 1;
