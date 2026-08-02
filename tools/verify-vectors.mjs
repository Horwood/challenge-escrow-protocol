import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const vector = JSON.parse(
  readFileSync(new URL("../spec/vectors/commitments-v1.json", import.meta.url), "utf8"),
);

function cast(...args) {
  return execFileSync("cast", args, { encoding: "utf8" }).trim().toLowerCase();
}

function hexUtf8(value) {
  return Buffer.from(value, "utf8").toString("hex");
}

function assertEqual(label, actual, expected) {
  if (actual !== expected.toLowerCase()) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

const executionTypeHash = cast("keccak", vector.executionType);
const protocolVersionHash = cast("keccak", vector.protocolVersion);
const e = vector.execution;
const executionEncoding = cast(
  "abi-encode",
  "f(bytes32,bytes32,bytes32,uint64,uint256,address,address,uint8,address,uint8,uint256,uint64,uint64,uint64,uint64,uint64,uint64,uint64)",
  executionTypeHash,
  protocolVersionHash,
  e.nonce,
  e.createdAt,
  e.chainId,
  e.escrowContract,
  e.challengerWallet,
  e.challengerSide,
  e.token,
  e.tokenDecimals,
  e.stakeAmount,
  e.acceptanceDeadline,
  e.observationTime,
  e.sourceCorrectionCutoff,
  e.proposalDeadline,
  e.disputeWindowSeconds,
  e.arbitrationWindowSeconds,
  e.timeoutVoidAt,
);
const executionHash = cast("keccak", executionEncoding);
const specHash = cast(
  "keccak",
  `0x${hexUtf8(vector.domains.spec)}00${executionHash.slice(2)}${vector.termsHash.slice(2)}`,
);
const challengeId = cast(
  "keccak",
  `0x${hexUtf8(vector.domains.challengeId)}00${specHash.slice(2)}`,
);

const domainTypeHash = cast(
  "keccak",
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
);
const permitTypeHash = cast(
  "keccak",
  "AcceptancePermit(bytes32 challengeId,bytes32 specHash,address acceptingWallet,uint256 acceptanceNonce,uint64 expiresAt)",
);
const nameHash = cast("keccak", vector.domains.eip712Name);
const domainSeparator = cast(
  "keccak",
  cast(
    "abi-encode",
    "f(bytes32,bytes32,bytes32,uint256,address)",
    domainTypeHash,
    nameHash,
    protocolVersionHash,
    e.chainId,
    e.escrowContract,
  ),
);
const permit = vector.acceptancePermit;
const permitStructHash = cast(
  "keccak",
  cast(
    "abi-encode",
    "f(bytes32,bytes32,bytes32,address,uint256,uint64)",
    permitTypeHash,
    challengeId,
    specHash,
    permit.acceptingWallet,
    permit.acceptanceNonce,
    permit.expiresAt,
  ),
);
const permitDigest = cast(
  "keccak",
  `0x1901${domainSeparator.slice(2)}${permitStructHash.slice(2)}`,
);

for (const [label, actual] of Object.entries({
  executionTypeHash,
  protocolVersionHash,
  executionHash,
  specHash,
  challengeId,
  domainSeparator,
  permitStructHash,
  permitDigest,
})) {
  assertEqual(label, actual, vector.expected[label]);
}

console.log("PASS: public commitment vectors match independent cast calculations");
