import { computeEntitlementId, keccak256 } from "./keccak.ts";

const encoder = new TextEncoder();
const vectors = [
  [new Uint8Array(), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"],
  [encoder.encode("abc"), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"],
] as const;
for (const [input, expected] of vectors) {
  if (keccak256(input) !== expected) throw new Error("Keccak-256 fixed vector drifted");
}

const entitlement = computeEntitlementId(
  `0x${"d".repeat(64)}`,
  "0x1111111111111111111111111111111111111111",
);
if (entitlement !== "0x471e4edb24bb04f9af556b4e937d6dcac574e1bd6eff709778bd25916361ec60") {
  throw new Error("entitlement ID fixed vector drifted");
}

console.log(JSON.stringify({ status: "ok", keccakVectors: vectors.length, entitlementVectors: 1 }));
