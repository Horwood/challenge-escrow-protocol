import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(`supply-chain: ${message}`);
}

const workflow = read(".github/workflows/verify.yml");
const expectedActions = new Map([
  ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
  ["pnpm/action-setup", "0ebf47130e4866e96fce0953f49152a61190b271"],
  ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
  ["denoland/setup-deno", "667a34cdef165d8d2b2e98dde39547c9daac7282"],
  ["foundry-rs/foundry-toolchain", "908c540300062bd5a7e473851cdb4282204cee09"],
  ["astral-sh/setup-uv", "08807647e7069bb48b6ef5acd8ec9567f424441b"],
]);
const actionLines = [...workflow.matchAll(/^\s*uses:\s*([^@\s]+)@([^\s#]+)/gm)]
  .map((match) => ({ action: match[1], revision: match[2] }));
assert(actionLines.length === expectedActions.size, "workflow action inventory drifted");
for (const { action, revision } of actionLines) {
  assert(expectedActions.has(action), `unreviewed workflow action ${action}`);
  assert(/^[0-9a-f]{40}$/.test(revision), `${action} is not pinned to a full commit SHA`);
  assert(revision === expectedActions.get(action), `${action} revision drifted`);
}
assert(/^permissions:\n  contents: read$/m.test(workflow), "workflow permissions are not read-only");
assert(workflow.includes("persist-credentials: false"), "checkout credentials remain persisted");
assert(workflow.includes("pnpm install --frozen-lockfile --ignore-scripts"), "CI dependency install is not locked and script-free");
assert(!/pull_request_target|workflow_run|\$\{\{\s*secrets\./.test(workflow), "workflow exposes a high-risk trigger or secret context");
assert(!/curl\s+[^\n|]*\|\s*(?:ba)?sh|wget\s+[^\n|]*\|\s*(?:ba)?sh/.test(workflow), "workflow pipes network content into a shell");
for (const marker of [
  "node-version: 22.15.1",
  "deno-version: 2.7.3",
  "version: v1.7.1",
  "version: 0.9.29",
  "rustup toolchain install 1.97.1",
]) assert(workflow.includes(marker), `workflow toolchain marker drifted: ${marker}`);

const rootPackage = JSON.parse(read("package.json"));
const contractPackage = JSON.parse(read("contracts/package.json"));
assert(rootPackage.packageManager === "pnpm@10.29.1", "pnpm version is not exact");
assert(rootPackage.engines?.node === ">=22.15.1", "Node.js engine boundary drifted");
assert(contractPackage.dependencies?.["@openzeppelin/contracts"] === "5.6.1", "OpenZeppelin dependency is not exact");
assert(Object.keys(contractPackage.dependencies ?? {}).length === 1, "contract dependency inventory drifted");
assert(Object.keys(rootPackage.dependencies ?? {}).length === 0, "root runtime dependency inventory drifted");
assert(Object.keys(rootPackage.devDependencies ?? {}).length === 0, "root development dependency inventory drifted");
const scriptText = Object.values(rootPackage.scripts ?? {}).join("\n");
assert(!/\b(?:npx|curl|wget|eval)\b|(?:ba)?sh\s+-c/.test(scriptText), "package scripts contain an unreviewed execution or download primitive");
assert(!/(?:^|\s)(?:-A|--allow-all|--allow-net|--allow-write|--allow-env)(?:[=\s]|$)/m.test(scriptText), "package scripts grant a broad Deno permission");
assert(rootPackage.scripts?.["client:check"]?.includes("--allow-run=cast"), "Keccak differential test is not restricted to cast execution");
assert(rootPackage.scripts?.["check:depth3"]?.includes("authority-surface:check"), "authority surface gate is not wired into the depth check");
const auditSource = read("tools/security/audit.mjs");
assert(auditSource.includes('"tools/security/semgrep-local.yml"'), "local Semgrep policy is not wired into the audit");
assert(auditSource.includes('".github"'), "Semgrep audit does not scan the workflow boundary");
assert(auditSource.includes('"authority-surface"'), "authority surface gate is not wired into the audit");
const halmosRunner = read("tools/formal/halmos-check.mjs");
assert(halmosRunner.includes('"halmos==0.3.3"'), "Halmos top-level version is not exact");
for (const marker of ['"z3"', '"30s"', '"10ms"', "220_000"]) {
  assert(halmosRunner.includes(marker), `Halmos solver marker drifted: ${marker}`);
}
const chcRunner = read("tools/formal/check.mjs");
assert(chcRunner.includes('const expectedSolcVersion = "0.8.36+commit.8a079791";'), "CHC compiler version gate drifted");
const slitherGate = read("tools/security/slither-gate.mjs");
assert(slitherGate.includes('const expectedVersion = "0.11.6";'), "Slither gate version drifted");
assert(
  slitherGate.includes('const expectedFindingInventorySha256 = "sha256:ce15eeda80dcb84981d2a6994f2c0d89b6f9f773ed180b7337770d765096a666";'),
  "Slither finding-inventory digest drifted",
);
const medusaRunner = read("tools/medusa/run.mjs");
assert(
  medusaRunner.includes('const expectedMedusaVersion = "medusa version 1.5.1";'),
  "Medusa runner version drifted",
);
assert(
  medusaRunner.includes('const expectedSolcVersion = "0.8.36+commit.8a079791";'),
  "Medusa compiler version drifted",
);
for (const marker of [
  '["z3", "Z3 version 4.16.0"]',
  '["medusa", "medusa version 1.5.1"]',
  '["gitleaks", "8.30.1"]',
  '["semgrep", "1.172.0"]',
  '["slither", "0.11.6"]',
]) assert(auditSource.includes(marker), `audit analyzer marker drifted: ${marker}`);
assert(
  auditSource.includes('value.replace(/ - (?:32|64) bit$/, "")'),
  "Z3 platform-suffix normalization drifted",
);
for (const releaseVerifier of [
  read("tools/release/manifest.mjs"),
  read("tools/release/verify_manifest.py"),
]) {
  assert(releaseVerifier.includes('"tools/formal/cache"'), "release boundary does not exclude the local formal cache");
  assert(releaseVerifier.includes("MAX_BOUNDARY_FILES"), "release boundary has no file-count resource limit");
  assert(releaseVerifier.includes("MAX_BOUNDARY_BYTES"), "release boundary has no aggregate byte limit");
}

const npmrc = read(".npmrc");
assert(/^ignore-scripts=true$/m.test(npmrc), "package install scripts are not disabled by default");
assert(/^save-exact=true$/m.test(npmrc), "new package versions are not saved exactly");

const lock = read("pnpm-lock.yaml");
const integrityValues = [...lock.matchAll(/integrity:\s*(sha512-[A-Za-z0-9+/=]+)/g)].map((match) => match[1]);
assert(integrityValues.length === 1, "lockfile integrity inventory drifted");
assert(integrityValues[0] === "sha512-Ly6SlsVJ3mj+b18W3R8gNufB7dTICT105fJhodGAGgyC2oqnBAhqSiNDJ8V8DLY05cCz81GLI0CU5vNYA1EC/w==", "OpenZeppelin lockfile integrity drifted");
assert(!/\btarball:|git\+|https?:\/\//.test(lock), "lockfile contains a non-registry source override");

const rust = read("rust-toolchain.toml");
assert(/^channel = "1\.97\.1"$/m.test(rust), "Rust toolchain is not exact");
assert(/^components = \["rustfmt", "clippy"\]$/m.test(rust), "Rust verification components drifted");
const cargoManifest = read("rust/portable-verifier/Cargo.toml");
for (const marker of [
  'serde = { version = "1.0.228", features = ["derive"] }',
  'serde_json = "1.0.145"',
  'tiny-keccak = { version = "2.0.2", features = ["keccak"] }',
  'unicode-normalization = "0.1.24"',
]) assert(cargoManifest.includes(marker), `Rust direct dependency marker drifted: ${marker}`);
const cargoLock = read("rust/portable-verifier/Cargo.lock");
const cargoPackages = [...cargoLock.matchAll(/^\[\[package\]\]$/gm)].length;
const cargoSources = [...cargoLock.matchAll(/^source = "registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index"$/gm)].length;
const cargoChecksums = [...cargoLock.matchAll(/^checksum = "[0-9a-f]{64}"$/gm)].length;
assert(cargoPackages === 17 && cargoSources === 16 && cargoChecksums === 16, "Rust lockfile package or checksum inventory drifted");
assert(!/^source = "(?!registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index")/m.test(cargoLock), "Rust lockfile contains a non-registry source");
const cargoExecutionCommands = rootPackage.scripts?.["portable:rust"]
  .split("&&")
  .map((command) => command.trim())
  .filter((command) => /^cargo\s+(?!fmt\b)/.test(command));
assert(cargoExecutionCommands.length === 4 && cargoExecutionCommands.every((command) => /\s--locked(?:\s|$)/.test(command)), "a Rust build or execution command is not locked");

const foundry = read("contracts/foundry.toml");
for (const marker of [
  'solc = "0.8.36"',
  "auto_detect_solc = false",
  'evm_version = "cancun"',
  "optimizer = true",
  "optimizer_runs = 1",
  'bytecode_hash = "none"',
]) assert(foundry.includes(marker), `Foundry release setting drifted: ${marker}`);

console.log(JSON.stringify({
  status: "ok",
  pinnedActions: actionLines.length,
  lockedContractDependencies: integrityValues.length,
  lockedRustDependencies: cargoChecksums,
  installScripts: "disabled",
  workflowPermissions: "contents-read",
  toolchains: { node: "22.15.1", deno: "2.7.3", foundry: "1.7.1", rust: "1.97.1", uv: "0.9.29", solc: "0.8.36" },
  analyzerMarkers: { halmos: "0.3.3", z3: "4.16.0", medusa: "1.5.1", gitleaks: "8.30.1", semgrep: "1.172.0", slither: "0.11.6" },
}, null, 2));
