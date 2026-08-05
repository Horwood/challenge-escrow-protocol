import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const logDir = mkdtempSync(join(tmpdir(), "challenge-escrow-audit-"));
const env = { ...process.env, CI: "1" };

function executable(name) {
  const result = spawnSync("which", [name], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function findSolc() {
  const fromPath = executable("solc");
  if (fromPath && existsSync(fromPath)) return fromPath;
  for (const cellar of ["/opt/homebrew/Cellar/slither-analyzer", "/usr/local/Cellar/slither-analyzer"]) {
    if (!existsSync(cellar)) continue;
    const versions = spawnSync("find", [cellar, "-type", "f", "-name", "solc"], {
      cwd: root,
      encoding: "utf8",
    });
    const candidate = versions.status === 0 ? versions.stdout.trim().split("\n")[0] : "";
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

function version(name, args, explicitPath = null) {
  const path = explicitPath || executable(name);
  if (!path) return { available: false };
  const result = spawnSync(path, args, { cwd: root, env, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return { available: result.status === 0, value: output.split("\n")[0] ?? output };
}

function run(label, command, args, timeout) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const logPath = join(logDir, `${String(results.length + 1).padStart(2, "0")}-${label}.log`);
  writeFileSync(logPath, output);
  return {
    label,
    command: [command, ...args].join(" "),
    ok: result.status === 0 && !result.error,
    exitCode: result.status,
    signal: result.signal,
    logPath,
    tail: output.trim().split("\n").slice(-4).join("\n"),
  };
}

const results = [];
results.push(run("diff-check", "git", ["diff", "--check"], 30_000));
results.push(run("protocol-check", "pnpm", ["run", "check"], 180_000));
results.push(run("size-check", "pnpm", ["run", "size:check"], 180_000));
results.push(run("model", "pnpm", ["run", "model:test"], 180_000));
results.push(run("formal", "pnpm", ["run", "formal:check"], 180_000));
results.push(run("schemas", "pnpm", ["run", "schemas:check"], 120_000));
results.push(run("portable", "pnpm", ["run", "portable:check"], 120_000));
results.push(run("client", "pnpm", ["run", "client:check"], 120_000));
results.push(run("simulator", "pnpm", ["run", "simulator:test"], 120_000));
results.push(run("liveness", "pnpm", ["run", "liveness:sweep"], 120_000));
results.push(run("failure-lab", "pnpm", ["run", "failure:lab"], 120_000));
results.push(run("authority-v2", "pnpm", ["run", "authority:v2"], 120_000));
results.push(run("attack-baseline", "pnpm", ["run", "security:baseline"], 180_000));
results.push(run("mutation", "pnpm", ["run", "security:mutation"], 300_000));
results.push(run("medusa", "pnpm", ["run", "medusa:test"], 180_000));
results.push(run("gitleaks", "gitleaks", ["detect", "--source", ".", "--no-git", "--redact"], 120_000));
results.push(run(
  "semgrep",
  "semgrep",
  [
    "scan",
    "--no-git-ignore",
    "--config",
    "p/security-audit",
    "--config",
    "p/secrets",
    "--error",
    "--exclude",
    "node_modules",
    "--exclude",
    "tools/medusa/corpus",
    "--exclude",
    "contracts/cache",
    "--exclude",
    "contracts/out",
    "--exclude",
    "contracts/broadcast",
    "contracts/src",
    "contracts/test",
    "tools",
    "docs",
    "README.md",
    "SECURITY.md",
    "package.json",
  ],
  180_000,
));
results.push(run(
  "slither-summary",
  "slither",
  ["contracts", "--exclude-dependencies", "--print", "human-summary"],
  180_000,
));
results.push(run("dependency-audit", "pnpm", ["audit", "--audit-level", "high"], 120_000));

const tools = Object.fromEntries([
  ["node", version("node", ["--version"])],
  ["pnpm", version("pnpm", ["--version"])],
  ["forge", version("forge", ["--version"])],
  ["solc", version("solc", ["--version"], findSolc())],
  ["z3", version("z3", ["--version"])],
  ["medusa", version("medusa", ["--version"])],
  ["gitleaks", version("gitleaks", ["version"])],
  ["semgrep", version("semgrep", ["--version"])],
  ["slither", version("slither", ["--version"])],
]);

const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({
  status: failed.length === 0 ? "ok" : "failed",
  root,
  logDir,
  tools,
  results,
}, null, 2));

if (failed.length > 0) process.exitCode = 1;
