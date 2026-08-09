import { computeEntitlementId } from "./keccak.ts";

const domain = new TextEncoder().encode("challenge-escrow.entitlement-id/v1");

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array((value.length - 2) / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return bytes;
}

function preimage(challengeId: string, wallet: string): string {
  const challenge = hexBytes(challengeId);
  const participant = hexBytes(wallet);
  const bytes = new Uint8Array(domain.length + 1 + challenge.length + participant.length);
  bytes.set(domain);
  bytes.set(challenge, domain.length + 1);
  bytes.set(participant, domain.length + 1 + challenge.length);
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

for (let index = 0; index < 128; index += 1) {
  const challengeId = `0x${(BigInt(index) * 0x1000003n + 1n).toString(16).padStart(64, "0")}`;
  const wallet = `0x${(BigInt(index) * 0x1009n + 1n).toString(16).padStart(40, "0")}`;
  const output = await new Deno.Command("cast", { args: ["keccak", preimage(challengeId, wallet)] }).output();
  if (!output.success) throw new Error(`cast failed for differential case ${index}`);
  const expected = new TextDecoder().decode(output.stdout).trim().toLowerCase();
  const actual = computeEntitlementId(challengeId, wallet);
  if (actual !== expected) throw new Error(`entitlement ID differs from cast at case ${index}`);
}

console.log(JSON.stringify({ status: "ok", entitlementDifferentialCases: 128 }));
