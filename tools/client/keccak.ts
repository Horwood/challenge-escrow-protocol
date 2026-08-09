const MASK_64 = (1n << 64n) - 1n;
const RATE_BYTES = 136;
const ROTATION_OFFSETS = Object.freeze([
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
]);
const ROUND_CONSTANTS = Object.freeze([
  0x0000000000000001n, 0x0000000000008082n,
  0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn,
  0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n,
  0x0000000080000001n, 0x8000000080008008n,
]);

function rotateLeft(value: bigint, offset: number): bigint {
  if (offset === 0) return value;
  const shift = BigInt(offset);
  return ((value << shift) | (value >> (64n - shift))) & MASK_64;
}

function permute(state: bigint[]): void {
  for (const roundConstant of ROUND_CONSTANTS) {
    const columns = Array<bigint>(5).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) columns[x] ^= state[x + 5 * y];
    }
    for (let x = 0; x < 5; x += 1) {
      const delta = columns[(x + 4) % 5] ^ rotateLeft(columns[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] = (state[x + 5 * y] ^ delta) & MASK_64;
    }

    const mixed = Array<bigint>(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const source = x + 5 * y;
        const targetX = y;
        const targetY = (2 * x + 3 * y) % 5;
        mixed[targetX + 5 * targetY] = rotateLeft(state[source], ROTATION_OFFSETS[source]);
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const current = mixed[x + 5 * y];
        const next = mixed[(x + 1) % 5 + 5 * y];
        const afterNext = mixed[(x + 2) % 5 + 5 * y];
        state[x + 5 * y] = (current ^ ((~next) & afterNext)) & MASK_64;
      }
    }
    state[0] = (state[0] ^ roundConstant) & MASK_64;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function strictHexBytes(value: string, bytes: number, label: string): Uint8Array {
  if (!new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(value)) {
    throw new Error(`keccak: ${label} must be ${bytes} bytes`);
  }
  const result = new Uint8Array(bytes);
  for (let index = 0; index < bytes; index += 1) {
    result[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return result;
}

export function keccak256(input: Uint8Array): string {
  const paddedLength = Math.ceil((input.length + 1) / RATE_BYTES) * RATE_BYTES;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const state = Array<bigint>(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += RATE_BYTES) {
    for (let index = 0; index < RATE_BYTES; index += 1) {
      const lane = Math.floor(index / 8);
      const shift = BigInt((index % 8) * 8);
      state[lane] ^= BigInt(padded[offset + index]) << shift;
    }
    permute(state);
  }

  const digest = new Uint8Array(32);
  for (let index = 0; index < digest.length; index += 1) {
    digest[index] = Number((state[Math.floor(index / 8)] >> BigInt((index % 8) * 8)) & 0xffn);
  }
  return bytesToHex(digest);
}

export function computeEntitlementId(challengeId: string, wallet: string): string {
  const domain = new TextEncoder().encode("challenge-escrow.entitlement-id/v1");
  const challenge = strictHexBytes(challengeId, 32, "challengeId");
  const participant = strictHexBytes(wallet, 20, "wallet");
  const preimage = new Uint8Array(domain.length + 1 + challenge.length + participant.length);
  preimage.set(domain);
  preimage[domain.length] = 0;
  preimage.set(challenge, domain.length + 1);
  preimage.set(participant, domain.length + 1 + challenge.length);
  return keccak256(preimage);
}
