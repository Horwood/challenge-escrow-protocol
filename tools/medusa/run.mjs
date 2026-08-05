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

const pathPrefix = dirname(solc);
const result = spawnSync(
  medusa,
  ["fuzz", "--config", "tools/medusa/config.json", "--no-color"],
  { stdio: "inherit", env: { ...process.env, PATH: `${pathPrefix}:${process.env.PATH ?? ""}` } },
);
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`medusa exited with status ${result.status}`);
