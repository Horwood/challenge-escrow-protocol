import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeValue, domainHash } from "../portable/canonical.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const MANIFEST_PATH = "spec/release/release-manifest-v1.json";
const ARTIFACT_PATH = "contracts/out/ChallengeEscrow.sol/ChallengeEscrow.json";
const IMMUTABLE_AST_ARTIFACTS = Object.freeze([
  ARTIFACT_PATH,
  "contracts/out/ChallengeEscrowKernel.sol/ChallengeEscrowKernel.json",
]);
const EXPECTED_IMMUTABLES = Object.freeze([
  "arbiter",
  "canonicalToken",
  "pauser",
  "releaseId",
  "resolver",
  "tokenDecimals",
]);
const MAX_BOUNDARY_FILES = 4_096;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_BOUNDARY_BYTES = 128 * 1024 * 1024;
const PUBLIC_EXACT = Object.freeze([
  ".gitignore",
  ".npmrc",
  "CITATION.cff",
  "CONTRIBUTING.md",
  "LICENSE",
  "NOTICE.md",
  "README.md",
  "SECURITY.md",
  "contracts/foundry.toml",
  "contracts/package.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "requirements-ci.in",
  "requirements-ci.lock",
  "rust-toolchain.toml",
  "spec/README.md",
]);
const PUBLIC_TREES = Object.freeze([
  ".github",
  "contracts/test",
  "docs",
  "rust/portable-verifier",
  "spec/schemas",
  "spec/vectors",
  "tools",
]);
const PUBLIC_EXCLUSIONS = Object.freeze([
  "rust/portable-verifier/target",
  "tools/formal/cache",
  "tools/formal/out",
  "tools/medusa/corpus",
  "tools/medusa/crytic-export",
  "tools/medusa/slither_results.json",
]);

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Domain(domain, value) {
  return sha256Bytes(Buffer.from(`${domain}\0${canonicalizeValue(value)}`, "utf8"));
}

function safePath(path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\\") || path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error(`unsafe release path: ${path}`);
  }
  const absolute = resolve(ROOT, path);
  const rootReal = realpathSync(ROOT);
  const parentReal = realpathSync(dirname(absolute));
  if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${sep}`)) throw new Error(`release path escapes root: ${path}`);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`release path is not a regular file: ${path}`);
  const resolved = realpathSync(absolute);
  if (resolved !== rootReal && !resolved.startsWith(`${rootReal}${sep}`)) throw new Error(`release file escapes root: ${path}`);
  return { absolute, stat };
}

function fileEntry(path) {
  const { absolute, stat } = safePath(path);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`release file exceeds the per-file byte limit: ${path}`);
  const bytes = readFileSync(absolute);
  return { path, bytes: String(bytes.length), sha256: sha256Bytes(bytes) };
}

function validateBoundarySize(paths, label) {
  if (paths.length > MAX_BOUNDARY_FILES) throw new Error(`${label} contains too many files`);
  let total = 0;
  for (const path of paths) {
    const { stat } = safePath(path);
    if (stat.size > MAX_FILE_BYTES) throw new Error(`${label} file exceeds the per-file byte limit: ${path}`);
    total += stat.size;
    if (total > MAX_BOUNDARY_BYTES) throw new Error(`${label} exceeds the aggregate byte limit`);
  }
}

function excludedPublicPath(path) {
  const name = path.split("/").at(-1);
  return name === ".DS_Store"
    || name === "__pycache__"
    || name?.endsWith(".pyc")
    || PUBLIC_EXCLUSIONS.some((excluded) => path === excluded || path.startsWith(`${excluded}/`));
}

function filesUnder(directory, { suffix = null, publicBoundary = false } = {}) {
  const absolute = resolve(ROOT, directory);
  const result = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const nested = `${directory}/${entry.name}`;
    if (publicBoundary && excludedPublicPath(nested)) continue;
    if (entry.isSymbolicLink()) throw new Error(`symlink is forbidden in release boundary: ${nested}`);
    if (entry.isDirectory()) result.push(...filesUnder(nested, { suffix, publicBoundary }));
    else if (entry.isFile() && (!suffix || entry.name.endsWith(suffix))) result.push(nested);
  }
  return result.sort();
}

function exactString(source, name) {
  const match = source.match(new RegExp(`string\\s+public\\s+constant\\s+${name}\\s*=\\s*"([^"]+)"\\s*;`));
  if (!match) throw new Error(`missing release constant ${name}`);
  return match[1];
}

function immutableDeclarations() {
  const declarations = new Map();
  function visit(value) {
    if (Array.isArray(value)) {
      for (const nested of value) visit(nested);
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.nodeType === "VariableDeclaration" && value.mutability === "immutable") {
      if (!Number.isSafeInteger(value.id) || typeof value.name !== "string" || value.visibility !== "public") {
        throw new Error("compiled immutable declaration is malformed or non-public");
      }
      if (declarations.has(String(value.id))) throw new Error(`duplicate immutable compiler ID ${value.id}`);
      declarations.set(String(value.id), value.name);
    }
    for (const nested of Object.values(value)) visit(nested);
  }
  for (const path of IMMUTABLE_AST_ARTIFACTS) {
    const artifact = JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
    visit(artifact.ast);
  }
  const names = [...declarations.values()].sort();
  if (canonicalizeValue(names) !== canonicalizeValue(EXPECTED_IMMUTABLES)) {
    throw new Error("compiled public immutable inventory drifted");
  }
  return declarations;
}

function releaseIdentity() {
  const kernel = readFileSync(resolve(ROOT, "contracts/src/ChallengeEscrowKernel.sol"), "utf8");
  if (!kernel.includes("ChallengeTypes.ValueMode.TESTNET_NO_VALUE")) throw new Error("release value mode drifted");
  const release = {
    contract: "ChallengeEscrow",
    protocolVersion: exactString(kernel, "PROTOCOL_VERSION"),
    eventProtocolId: exactString(kernel, "EVENT_PROTOCOL_ID"),
    challengeSchemaId: exactString(kernel, "CHALLENGE_SCHEMA_ID"),
    evidenceSchemaId: exactString(kernel, "EVIDENCE_SCHEMA_ID"),
    conditionLanguageId: exactString(kernel, "CONDITION_LANGUAGE_ID"),
    valueMode: "TESTNET_NO_VALUE",
  };
  const expected = {
    contract: "ChallengeEscrow",
    protocolVersion: "challenge-escrow-protocol/v1",
    eventProtocolId: "challenge-escrow-event/v1",
    challengeSchemaId: "challenge-escrow.spec/v1",
    evidenceSchemaId: "challenge-escrow.evidence/v1",
    conditionLanguageId: "challenge-escrow.condition-language/v1",
    valueMode: "TESTNET_NO_VALUE",
  };
  if (canonicalizeValue(release) !== canonicalizeValue(expected)) throw new Error("release identity drifted from manifest v1");
  return release;
}

function artifactBoundary(productionPaths) {
  const artifact = JSON.parse(readFileSync(resolve(ROOT, ARTIFACT_PATH), "utf8"));
  const runtimeHex = artifact?.deployedBytecode?.object;
  if (typeof runtimeHex !== "string" || !/^0x[0-9a-fA-F]*$/.test(runtimeHex) || runtimeHex.length % 2 !== 0) {
    throw new Error("compiled runtime bytecode is missing or malformed");
  }
  const runtimeBytes = Buffer.from(runtimeHex.slice(2), "hex");
  const metadata = artifact?.metadata;
  const optimizer = metadata?.settings?.optimizer;
  if (!metadata?.compiler?.version || !metadata?.settings?.evmVersion || typeof optimizer?.enabled !== "boolean") {
    throw new Error("compiler metadata is incomplete");
  }
  if (!Array.isArray(artifact.abi)) throw new Error("compiled ABI is missing");
  const declarations = immutableDeclarations();
  const rawImmutableReferences = artifact?.deployedBytecode?.immutableReferences;
  if (!rawImmutableReferences || typeof rawImmutableReferences !== "object" || Array.isArray(rawImmutableReferences)) {
    throw new Error("compiled immutable references are missing");
  }
  const immutableGroups = Object.entries(rawImmutableReferences).map(([compilerId, entries]) => {
    if (!/^(0|[1-9][0-9]*)$/.test(compilerId) || !declarations.has(compilerId) || !Array.isArray(entries) || entries.length === 0) {
      throw new Error(`compiled immutable group ${compilerId} is malformed`);
    }
    const references = entries.map((entry) => {
      if (!Number.isSafeInteger(entry?.start) || !Number.isSafeInteger(entry?.length) || entry.start < 0 || entry.length < 1 || entry.start + entry.length > runtimeBytes.length) {
        throw new Error("compiled immutable reference is malformed");
      }
      return { start: String(entry.start), bytes: String(entry.length) };
    }).sort((left, right) => Number(left.start) - Number(right.start) || Number(left.bytes) - Number(right.bytes));
    return { name: declarations.get(compilerId), compilerId, references };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (canonicalizeValue(immutableGroups.map((group) => group.name)) !== canonicalizeValue(EXPECTED_IMMUTABLES)) {
    throw new Error("compiled immutable reference groups are incomplete");
  }
  const immutableReferences = immutableGroups
    .flatMap((group) => group.references)
    .sort((left, right) => Number(left.start) - Number(right.start) || Number(left.bytes) - Number(right.bytes));
  for (let index = 1; index < immutableReferences.length; index += 1) {
    const previous = immutableReferences[index - 1];
    const current = immutableReferences[index];
    if (Number(previous.start) + Number(previous.bytes) > Number(current.start)) {
      throw new Error("compiled immutable references overlap");
    }
  }
  if (immutableReferences.length === 0) throw new Error("compiled release exposes no immutable references");
  const normalizedRuntime = Buffer.from(runtimeBytes);
  for (const reference of immutableReferences) {
    normalizedRuntime.fill(0, Number(reference.start), Number(reference.start) + Number(reference.bytes));
  }
  const metadataSources = metadata.sources;
  if (!metadataSources || typeof metadataSources !== "object" || Array.isArray(metadataSources)) {
    throw new Error("compiler source metadata is missing");
  }
  for (const path of productionPaths) {
    const compilerPath = path.replace(/^contracts\//, "");
    const expectedHash = metadataSources[compilerPath]?.keccak256;
    const sourceHex = `0x${readFileSync(resolve(ROOT, path)).toString("hex")}`;
    const actualHash = domainlessKeccak(sourceHex);
    if (typeof expectedHash !== "string" || expectedHash.toLowerCase() !== actualHash) {
      throw new Error(`compiled artifact is stale for ${path}`);
    }
  }
  const compiler = {
    version: metadata.compiler.version,
    evmVersion: metadata.settings.evmVersion,
    optimizer: { enabled: optimizer.enabled, runs: String(optimizer.runs) },
    metadataBytecodeHash: metadata.settings.metadata?.bytecodeHash,
  };
  const expectedCompiler = {
    version: "0.8.36+commit.8a079791",
    evmVersion: "cancun",
    optimizer: { enabled: true, runs: "1" },
    metadataBytecodeHash: "none",
  };
  if (canonicalizeValue(compiler) !== canonicalizeValue(expectedCompiler)) {
    throw new Error("compiler artifact does not match the pinned release settings");
  }
  return {
    compiler,
    runtime: {
      artifactPath: ARTIFACT_PATH,
      bytes: String(runtimeBytes.length),
      sha256: sha256Bytes(runtimeBytes),
      keccak256: domainlessKeccak(runtimeHex),
      normalizedKeccak256: domainlessKeccak(`0x${normalizedRuntime.toString("hex")}`),
      immutableReferences,
      immutableGroups,
      abiEntries: String(artifact.abi.length),
      abiSha256: sha256Bytes(Buffer.from(canonicalizeValue(artifact.abi), "utf8")),
    },
  };
}

function domainlessKeccak(hex) {
  return execFileSync("cast", ["keccak", hex], { encoding: "utf8", timeout: 10_000 }).trim().toLowerCase();
}

export function releaseManifestHash(manifest) {
  const body = structuredClone(manifest);
  delete body.manifestHash;
  return domainHash("challenge-escrow.release-manifest/v1", body);
}

export function buildReleaseManifest() {
  const productionPaths = filesUnder("contracts/src", { suffix: ".sol" });
  const publicPaths = [
    ...PUBLIC_EXACT,
    ...PUBLIC_TREES.flatMap((directory) => filesUnder(directory, { publicBoundary: true })),
  ].sort();
  if (new Set(publicPaths).size !== publicPaths.length) throw new Error("release public artifact list contains a duplicate");
  if (publicPaths.some((path) => path === "tools/formal/cache" || path.startsWith("tools/formal/cache/"))) {
    throw new Error("release public artifact list contains a workstation-specific formal cache");
  }
  validateBoundarySize(productionPaths, "production source boundary");
  validateBoundarySize(publicPaths, "public artifact boundary");
  const productionSources = productionPaths.map(fileEntry);
  const publicArtifacts = publicPaths.map(fileEntry);
  const compiled = artifactBoundary(productionPaths);
  const manifest = {
    schema: "challenge-escrow.release-manifest/v1",
    manifestHash: `0x${"0".repeat(64)}`,
    release: releaseIdentity(),
    compiler: compiled.compiler,
    runtime: compiled.runtime,
    productionSources,
    publicArtifacts,
    boundaries: {
      productionSourcesSha256: sha256Domain("challenge-escrow.release-production-sources/v1", productionSources),
      publicArtifactsSha256: sha256Domain("challenge-escrow.release-public-artifacts/v1", publicArtifacts),
    },
  };
  manifest.manifestHash = releaseManifestHash(manifest);
  return manifest;
}

export function rootRelative(path) {
  return relative(ROOT, path).split(sep).join("/");
}
