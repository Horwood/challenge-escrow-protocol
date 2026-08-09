import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalizeValue } from "../portable/canonical.mjs";

const ARTIFACT = "contracts/out/ChallengeEscrow.sol/ChallengeEscrow.json";
const EXPECTED_SURFACE_SHA256 = "sha256:8e5476ee55b3a66930b63a543f0836feb95dcf0a7aaf71dd77821b411655486a";
const EXPECTED_WRITABLE = Object.freeze([
  "accept(bytes32,(bytes32,bytes32,address,uint256,uint64),bytes)",
  "advanceAcceptanceNonce(bytes32)",
  "arbitrate(bytes32,uint8,uint8,bytes32,bytes32)",
  "cancelOpen(bytes32)",
  "claimWinnings(bytes32)",
  "createAndFund((bytes32,uint64,uint256,address,address,uint8,address,uint8,uint256,uint64,uint64,uint64,uint64,uint64,uint64,uint64),bytes32,bytes32)",
  "dispute(bytes32,uint8,uint8,bytes32,bytes32)",
  "expireOpen(bytes32)",
  "finalizeUncontested(bytes32)",
  "propose(bytes32,uint8,uint8,bytes32)",
  "refundPrincipal(bytes32)",
  "setPaused(bool)",
  "voidUnarbitrated(bytes32)",
  "voidUnproposed(bytes32)",
]);
const FORBIDDEN_CAPABILITY_NAME = /(admin|delegate|fee|owner|proxy|recover|redirect|rescue|rotate|sweep|upgrade|withdraw)/i;

function fail(message) {
  throw new Error(`authority-surface: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8"));
const abi = artifact.abi;
const methodIdentifiers = artifact.methodIdentifiers;
assert(Array.isArray(abi), "compiled ABI is missing");
assert(methodIdentifiers && typeof methodIdentifiers === "object" && !Array.isArray(methodIdentifiers), "compiled method identifiers are missing");
assert(!abi.some((entry) => entry?.type === "fallback" || entry?.type === "receive"), "fallback or receive authority is forbidden");
const constructors = abi.filter((entry) => entry?.type === "constructor");
assert(constructors.length === 1 && constructors[0].stateMutability === "nonpayable", "constructor must be uniquely nonpayable");

const functions = abi.filter((entry) => entry?.type === "function");
const byName = new Map();
for (const entry of functions) {
  assert(typeof entry.name === "string" && !byName.has(entry.name), "function names must be unique and unambiguous");
  assert(["pure", "view", "nonpayable"].includes(entry.stateMutability), `${entry.name} has unsupported mutability`);
  assert(!FORBIDDEN_CAPABILITY_NAME.test(entry.name), `forbidden capability name entered the ABI: ${entry.name}`);
  byName.set(entry.name, entry);
}

const surface = Object.entries(methodIdentifiers).map(([signature, selector]) => {
  assert(/^[A-Za-z_][A-Za-z0-9_]*\(.*\)$/.test(signature), `malformed method signature ${signature}`);
  assert(typeof selector === "string" && /^[0-9a-f]{8}$/.test(selector), `malformed selector for ${signature}`);
  const name = signature.slice(0, signature.indexOf("("));
  const entry = byName.get(name);
  assert(entry, `method identifier has no ABI function: ${signature}`);
  return { signature, selector: `0x${selector}`, stateMutability: entry.stateMutability };
}).sort((left, right) => left.signature < right.signature ? -1 : left.signature > right.signature ? 1 : 0);

assert(surface.length === 43 && surface.length === functions.length, "public function inventory drifted");
assert(new Set(surface.map((entry) => entry.selector)).size === surface.length, "public selector collision detected");
const writable = surface
  .filter((entry) => entry.stateMutability === "nonpayable")
  .map((entry) => entry.signature);
assert(canonicalizeValue(writable) === canonicalizeValue(EXPECTED_WRITABLE), "writable function allowlist drifted");
assert(surface.every((entry) => entry.stateMutability !== "payable"), "payable entry point is forbidden");

const surfaceHash = `sha256:${createHash("sha256").update(canonicalizeValue(surface)).digest("hex")}`;
assert(surfaceHash === EXPECTED_SURFACE_SHA256, `full public surface drifted; observed ${surfaceHash}`);

console.log(JSON.stringify({
  status: "ok",
  functions: surface.length,
  writableFunctions: writable.length,
  payableFunctions: 0,
  fallbackOrReceive: false,
  constructorPayable: false,
  surfaceSha256: surfaceHash,
}, null, 2));
