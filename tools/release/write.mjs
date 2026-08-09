import { renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildReleaseManifest, MANIFEST_PATH, ROOT } from "./manifest.mjs";

const manifest = buildReleaseManifest();
const manifestPath = resolve(ROOT, MANIFEST_PATH);
const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
try {
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  renameSync(temporaryPath, manifestPath);
} finally {
  rmSync(temporaryPath, { force: true });
}
console.log(JSON.stringify({
  status: "written",
  path: MANIFEST_PATH,
  manifestHash: manifest.manifestHash,
  productionSources: manifest.productionSources.length,
  publicArtifacts: manifest.publicArtifacts.length,
  runtimeBytes: manifest.runtime.bytes,
  immutableGroups: manifest.runtime.immutableGroups.length,
  immutableReferences: manifest.runtime.immutableReferences.length,
}, null, 2));
