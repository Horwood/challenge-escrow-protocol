import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { assertNoDuplicateKeys, canonicalizeValue } from "../portable/canonical.mjs";
import { buildReleaseManifest, MANIFEST_PATH, ROOT, releaseManifestHash } from "./manifest.mjs";

const raw = readFileSync(resolve(ROOT, MANIFEST_PATH), "utf8");
assertNoDuplicateKeys(raw);
const expected = JSON.parse(raw);
if (expected.schema !== "challenge-escrow.release-manifest/v1") throw new Error("release manifest schema drifted");
if (releaseManifestHash(expected) !== expected.manifestHash) throw new Error("checked-in release manifest hash does not reproduce");
if (BigInt(expected.runtime.bytes) > 24_576n) throw new Error("release runtime exceeds the EIP-170 deployed-bytecode limit");
const actual = buildReleaseManifest();
if (canonicalizeValue(actual) !== canonicalizeValue(expected)) throw new Error("release manifest does not reproduce from the current tree and compiler artifact");
if (existsSync(resolve(ROOT, ".git"))) {
  const ignored = spawnSync(
    "git",
    ["check-ignore", "--stdin"],
    {
      cwd: ROOT,
      encoding: "utf8",
      input: `${actual.publicArtifacts.map((entry) => entry.path).join("\n")}\n`,
    },
  );
  if (ignored.error || ![0, 1].includes(ignored.status)) throw new Error("Git ignore boundary could not be checked");
  if (ignored.status === 0 && ignored.stdout.trim()) {
    throw new Error(`release manifest includes ignored public artifacts: ${ignored.stdout.trim()}`);
  }
}

console.log(JSON.stringify({
  status: "ok",
  implementation: "javascript",
  manifestHash: actual.manifestHash,
  productionSources: actual.productionSources.length,
  publicArtifacts: actual.publicArtifacts.length,
  runtimeBytes: actual.runtime.bytes,
  runtimeKeccak256: actual.runtime.keccak256,
  immutableGroups: actual.runtime.immutableGroups.length,
  immutableReferences: actual.runtime.immutableReferences.length,
  abiEntries: actual.runtime.abiEntries,
}, null, 2));
