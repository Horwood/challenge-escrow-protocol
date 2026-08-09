import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

import { canonicalizeValue, domainHash } from "../portable/canonical.mjs";

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const PROVIDER = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const PROVIDER_ERRORS = new Set([
  "FINALITY_TAGS_UNAVAILABLE",
  "MALFORMED_BLOCK_HEADER",
  "LATEST_NUMBER_MISMATCH",
  "FINALITY_ORDER_INVALID",
  "FINALITY_CHAIN_INVALID",
  "LATEST_BLOCK_UNAVAILABLE",
  "LATEST_BLOCK_CHANGED",
  "RPC_READ_FAILED",
]);
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const TAGS = Object.freeze(["latest", "safe", "finalized"]);
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_EVIDENCE_ITEMS = 50_000;
const MAX_EVIDENCE_NODES = 2_000_000;
const MAX_EVIDENCE_DEPTH = 64;
const MAX_EVIDENCE_STRING_BYTES = 16_384;
const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;

export class ObserverReceiptError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "ObserverReceiptError";
    this.code = code;
    this.path = path;
  }
}

function reject(code, path, message) {
  throw new ObserverReceiptError(code, path, message);
}

function requireValue(condition, code, path, message) {
  if (!condition) reject(code, path, message);
}

function keys(value, required, optional, path) {
  requireValue(value && typeof value === "object" && !Array.isArray(value), "Structure", path, `${path} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) requireValue(Object.hasOwn(value, key), "Structure", `${path}.${key}`, `${path}.${key} is required`);
  for (const key of Object.keys(value)) requireValue(allowed.has(key), "UnknownField", `${path}.${key}`, `${path}.${key} is unknown`);
}

function decimal(value, path) {
  requireValue(typeof value === "string" && DECIMAL.test(value) && value.length <= 78, "NonCanonicalDecimal", path, `${path} must be a canonical decimal string`);
  const parsed = BigInt(value);
  requireValue(parsed <= MAX_UINT256, "DecimalRange", path, `${path} exceeds uint256`);
  return parsed;
}

function hash(value, path) {
  requireValue(typeof value === "string" && HASH.test(value), "InvalidHash", path, `${path} must be lowercase bytes32`);
  return value;
}

function address(value, path) {
  requireValue(typeof value === "string" && ADDRESS.test(value), "InvalidAddress", path, `${path} must be a lowercase address`);
  return value;
}

function providerId(value, path) {
  requireValue(typeof value === "string" && PROVIDER.test(value), "UnsafeProviderId", path, `${path} must be endpoint-neutral`);
  return value;
}

function block(value, path) {
  keys(value, ["number", "hash", "parentHash"], [], path);
  requireValue(decimal(value.number, `${path}.number`) <= MAX_UINT64, "DecimalRange", `${path}.number`, `${path}.number exceeds uint64`);
  hash(value.hash, `${path}.hash`);
  hash(value.parentHash, `${path}.parentHash`);
  return { number: value.number, hash: value.hash, parentHash: value.parentHash };
}

function nullableBlock(value, path) {
  return value === null ? null : block(value, path);
}

function blockKey(value) {
  return `${value.number}:${value.hash}:${value.parentHash}`;
}

function sameBlock(left, right) {
  return left !== null && right !== null && blockKey(left) === blockKey(right);
}

function coherentPair(newer, older) {
  const newerNumber = BigInt(newer.number);
  const olderNumber = BigInt(older.number);
  if (newerNumber < olderNumber) return false;
  if (newerNumber === olderNumber) return sameBlock(newer, older);
  if (newerNumber === olderNumber + 1n) return newer.parentHash === older.hash;
  return true;
}

function sortedUnique(values, path) {
  requireValue(Array.isArray(values), "Structure", path, `${path} must be an array`);
  const normalized = values.map((value, index) => providerId(value, `${path}[${index}]`));
  const expected = [...new Set(normalized)].sort();
  requireValue(expected.length === normalized.length, "DuplicateProvider", path, `${path} contains a duplicate provider`);
  requireValue(expected.every((value, index) => value === normalized[index]), "ProviderOrder", path, `${path} must be sorted`);
  return normalized;
}

function normalizeProvider(value, path) {
  keys(value, ["providerId", "status", "latest", "safe", "finalized", "error"], [], path);
  const id = providerId(value.providerId, `${path}.providerId`);
  requireValue(value.status === "available" || value.status === "unavailable", "ProviderStatus", `${path}.status`, `${path}.status is invalid`);
  const normalized = {
    providerId: id,
    status: value.status,
    latest: nullableBlock(value.latest, `${path}.latest`),
    safe: nullableBlock(value.safe, `${path}.safe`),
    finalized: nullableBlock(value.finalized, `${path}.finalized`),
    error: value.error,
  };
  if (value.status === "available") {
    requireValue(value.error === null && TAGS.every((tag) => normalized[tag] !== null), "ProviderStatus", path, `${path} available provider must expose all heads`);
    requireValue(
      coherentPair(normalized.latest, normalized.safe) && coherentPair(normalized.safe, normalized.finalized),
      "FinalityOrder",
      path,
      `${path} finality heads are internally inconsistent`,
    );
  } else {
    requireValue(TAGS.every((tag) => normalized[tag] === null), "ProviderStatus", path, `${path} unavailable provider cannot carry stale heads`);
    requireValue(typeof value.error === "string" && PROVIDER_ERRORS.has(value.error), "UnsafeProviderError", `${path}.error`, `${path} unavailable provider needs a recognized endpoint-free error code`);
  }
  return normalized;
}

function quorumForTag(providers, tag, threshold) {
  const unavailable = providers.filter((provider) => provider.status !== "available" || provider[tag] === null).map((provider) => provider.providerId).sort();
  const grouped = new Map();
  for (const provider of providers) {
    if (provider.status !== "available" || provider[tag] === null) continue;
    const key = blockKey(provider[tag]);
    const group = grouped.get(key) ?? { block: provider[tag], providers: [] };
    group.providers.push(provider.providerId);
    grouped.set(key, group);
  }
  const groups = [...grouped.values()]
    .map((group) => ({ block: group.block, providers: group.providers.sort() }))
    .sort((left, right) => blockKey(left.block).localeCompare(blockKey(right.block)));
  const winning = groups.filter((group) => BigInt(group.providers.length) >= threshold);
  if (winning.length === 1) {
    const supporters = winning[0].providers;
    const supporterSet = new Set(supporters);
    return {
      status: "agree",
      agreed: winning[0].block,
      supporters,
      dissenters: groups.flatMap((group) => group.providers).filter((id) => !supporterSet.has(id)).sort(),
      unavailable,
      groups,
    };
  }
  return {
    status: groups.length > 1 ? "conflicted" : "unavailable",
    agreed: null,
    supporters: [],
    dissenters: groups.flatMap((group) => group.providers).sort(),
    unavailable,
    groups,
  };
}

export function buildRpcQuorum(providersInput, thresholdInput) {
  requireValue(Array.isArray(providersInput) && providersInput.length >= 2 && providersInput.length <= 16, "ProviderCount", "quorum.providers", "quorum requires two to sixteen providers");
  const providers = providersInput.map((value, index) => normalizeProvider(value, `quorum.providers[${index}]`))
    .sort((left, right) => left.providerId.localeCompare(right.providerId));
  requireValue(new Set(providers.map((provider) => provider.providerId)).size === providers.length, "DuplicateProvider", "quorum.providers", "provider IDs must be unique");
  const threshold = decimal(thresholdInput, "quorum.threshold");
  requireValue(threshold >= 2n && threshold <= BigInt(providers.length), "InvalidThreshold", "quorum.threshold", "threshold is outside the provider set");
  requireValue(threshold * 2n > BigInt(providers.length), "InvalidThreshold", "quorum.threshold", "threshold must be a strict provider majority");
  const heads = Object.fromEntries(TAGS.map((tag) => [tag, quorumForTag(providers, tag, threshold)]));
  const statuses = TAGS.map((tag) => heads[tag].status);
  const status = statuses.includes("conflicted") ? "conflicted" : statuses.includes("unavailable") ? "unavailable" : "agree";
  return {
    schema: "challenge-escrow.rpc-quorum/v1",
    status,
    threshold: thresholdInput,
    compared: [...TAGS],
    heads,
    providers,
  };
}

function validateRelease(value) {
  keys(value, ["chainId", "escrowContract", "releaseId", "eventProtocolId", "protocolVersion"], [], "receipt.release");
  const chainId = decimal(value.chainId, "receipt.release.chainId");
  requireValue(chainId > 0n, "ReleaseDrift", "receipt.release.chainId", "release chain ID cannot be zero");
  const escrowContract = address(value.escrowContract, "receipt.release.escrowContract");
  requireValue(escrowContract !== `0x${"0".repeat(40)}`, "ReleaseDrift", "receipt.release.escrowContract", "release escrow cannot be zero");
  hash(value.releaseId, "receipt.release.releaseId");
  requireValue(value.eventProtocolId === "challenge-escrow-event/v1", "ReleaseDrift", "receipt.release.eventProtocolId", "event protocol drifted");
  requireValue(value.protocolVersion === "challenge-escrow-protocol/v1", "ReleaseDrift", "receipt.release.protocolVersion", "protocol version drifted");
  const domain = Buffer.from("challenge-escrow.release-id/v1", "utf8");
  const chainBytes = Buffer.from(chainId.toString(16).padStart(64, "0"), "hex");
  const addressBytes = Buffer.from(escrowContract.slice(2), "hex");
  const preimage = Buffer.concat([domain, Buffer.from([0]), chainBytes, addressBytes]);
  const expectedReleaseId = execFileSync(
    "cast",
    ["keccak", `0x${preimage.toString("hex")}`],
    { encoding: "utf8", timeout: 10_000 },
  ).trim().toLowerCase();
  requireValue(value.releaseId === expectedReleaseId, "ReleaseDrift", "receipt.release.releaseId", "release ID does not match chain and escrow");
  return structuredClone(value);
}

function validateReceiptHead(value, quorum) {
  keys(value, ["number", "hash", "parentHash", "finality"], [], "receipt.head");
  const normalized = block(
    { number: value.number, hash: value.hash, parentHash: value.parentHash },
    "receipt.head",
  );
  requireValue(["latest", "safe", "finalized", "unknown"].includes(value.finality), "Finality", "receipt.head.finality", "receipt finality is invalid");
  if (value.finality !== "unknown") {
    const evidence = quorum.heads[value.finality];
    requireValue(evidence.status === "agree" && sameBlock(evidence.agreed, normalized), "HeadNotInQuorum", "receipt.head", "receipt head is not supported by the declared quorum");
  } else {
    const observed = TAGS.some((tag) => quorum.heads[tag].groups.some((group) => sameBlock(group.block, normalized)));
    requireValue(observed, "HeadNotInQuorum", "receipt.head", "unknown-finality head was not reported by any provider");
  }
  return { ...normalized, finality: value.finality };
}

function sha256Domain(domain, value) {
  const bytes = Buffer.from(`${domain}\0${canonicalizeValue(value)}`, "utf8");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function requireArray(value, path) {
  requireValue(Array.isArray(value), "Structure", path, `${path} must be an array`);
  return value;
}

function boundedEvidence(value, path) {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  let bytes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    requireValue(nodes <= MAX_EVIDENCE_NODES, "ResourceLimit", path, `${path} contains too many values`);
    requireValue(current.depth <= MAX_EVIDENCE_DEPTH, "ResourceLimit", path, `${path} is nested too deeply`);
    const nested = current.value;
    if (nested === null || typeof nested === "boolean") continue;
    if (typeof nested === "string") {
      const stringBytes = Buffer.byteLength(nested);
      requireValue(stringBytes <= MAX_EVIDENCE_STRING_BYTES, "ResourceLimit", path, `${path} contains an oversized string`);
      bytes += stringBytes;
    } else if (Array.isArray(nested)) {
      for (const item of nested) stack.push({ value: item, depth: current.depth + 1 });
    } else if (nested && typeof nested === "object") {
      for (const [key, item] of Object.entries(nested)) {
        bytes += Buffer.byteLength(key);
        stack.push({ value: item, depth: current.depth + 1 });
      }
    } else {
      reject("NonCanonicalValue", path, `${path} must contain only JSON values without numbers`);
    }
    requireValue(bytes <= MAX_EVIDENCE_BYTES, "ResourceLimit", path, `${path} exceeds the byte budget`);
  }
}

export function buildObserverReceipt(input) {
  keys(input, ["release", "head", "providers", "threshold", "logs", "challenges", "anomalies"], [], "input");
  const release = validateRelease(input.release);
  const quorum = buildRpcQuorum(input.providers, input.threshold);
  const head = validateReceiptHead(input.head, quorum);
  const logs = requireArray(input.logs, "input.logs");
  const challenges = requireArray(input.challenges, "input.challenges");
  const anomalies = requireArray(input.anomalies, "input.anomalies");
  for (const [name, values] of [["logs", logs], ["challenges", challenges], ["anomalies", anomalies]]) {
    requireValue(values.length <= MAX_EVIDENCE_ITEMS, "ResourceLimit", `input.${name}`, `input.${name} exceeds the item limit`);
    boundedEvidence(values, `input.${name}`);
  }
  const receipt = {
    schema: "challenge-escrow.observer-receipt/v1",
    release,
    head,
    quorum,
    commitments: {
      canonicalLogs: sha256Domain("challenge-escrow.observer-logs/v1", logs),
      projectedState: sha256Domain("challenge-escrow.observer-state/v1", challenges),
      anomalies: sha256Domain("challenge-escrow.observer-anomalies/v1", anomalies),
    },
    counts: {
      logs: String(logs.length),
      challenges: String(challenges.length),
      anomalies: String(anomalies.length),
    },
  };
  validateObserverReceipt(receipt);
  return receipt;
}

function validateQuorumHead(value, path) {
  keys(value, ["status", "agreed", "supporters", "dissenters", "unavailable", "groups"], [], path);
  requireValue(["agree", "conflicted", "unavailable"].includes(value.status), "QuorumStatus", `${path}.status`, `${path}.status is invalid`);
  nullableBlock(value.agreed, `${path}.agreed`);
  sortedUnique(value.supporters, `${path}.supporters`);
  sortedUnique(value.dissenters, `${path}.dissenters`);
  sortedUnique(value.unavailable, `${path}.unavailable`);
  requireValue(Array.isArray(value.groups), "Structure", `${path}.groups`, `${path}.groups must be an array`);
  let previous = null;
  for (const [index, group] of value.groups.entries()) {
    const groupPath = `${path}.groups[${index}]`;
    keys(group, ["block", "providers"], [], groupPath);
    const normalizedBlock = block(group.block, `${groupPath}.block`);
    sortedUnique(group.providers, `${groupPath}.providers`);
    const key = blockKey(normalizedBlock);
    requireValue(previous === null || previous < key, "GroupOrder", `${path}.groups`, `${path}.groups must be sorted and unique`);
    previous = key;
  }
}

export function validateObserverReceipt(receipt) {
  keys(receipt, ["schema", "release", "head", "quorum", "commitments", "counts"], [], "receipt");
  requireValue(receipt.schema === "challenge-escrow.observer-receipt/v1", "Schema", "receipt.schema", "receipt schema drifted");
  validateRelease(receipt.release);
  keys(receipt.quorum, ["schema", "status", "threshold", "compared", "heads", "providers"], [], "receipt.quorum");
  requireValue(receipt.quorum.schema === "challenge-escrow.rpc-quorum/v1", "Schema", "receipt.quorum.schema", "quorum schema drifted");
  requireValue(JSON.stringify(receipt.quorum.compared) === JSON.stringify(TAGS), "ComparedTags", "receipt.quorum.compared", "quorum tags drifted");
  const recomputed = buildRpcQuorum(receipt.quorum.providers, receipt.quorum.threshold);
  requireValue(canonicalizeValue(recomputed) === canonicalizeValue(receipt.quorum), "QuorumMismatch", "receipt.quorum", "quorum evidence does not recompute");
  for (const tag of TAGS) validateQuorumHead(receipt.quorum.heads[tag], `receipt.quorum.heads.${tag}`);
  validateReceiptHead(receipt.head, receipt.quorum);
  keys(receipt.commitments, ["canonicalLogs", "projectedState", "anomalies"], [], "receipt.commitments");
  for (const field of ["canonicalLogs", "projectedState", "anomalies"]) {
    requireValue(typeof receipt.commitments[field] === "string" && SHA256.test(receipt.commitments[field]), "Commitment", `receipt.commitments.${field}`, `receipt.commitments.${field} is invalid`);
  }
  keys(receipt.counts, ["logs", "challenges", "anomalies"], [], "receipt.counts");
  for (const field of ["logs", "challenges", "anomalies"]) {
    const count = decimal(receipt.counts[field], `receipt.counts.${field}`);
    requireValue(count <= BigInt(MAX_EVIDENCE_ITEMS), "ResourceLimit", `receipt.counts.${field}`, `receipt.counts.${field} exceeds the item limit`);
  }
  return receipt;
}

export function observerReceiptHash(receipt) {
  validateObserverReceipt(receipt);
  return domainHash("challenge-escrow.observer-receipt/v1", receipt);
}

export function verifyObserverReceipt(input, expectedReceipt, expectedHash) {
  const receipt = buildObserverReceipt(input);
  requireValue(canonicalizeValue(receipt) === canonicalizeValue(expectedReceipt), "ReceiptMismatch", "expected.receipt", "receipt does not reproduce");
  const hashValue = observerReceiptHash(receipt);
  requireValue(hashValue === expectedHash, "ReceiptHashMismatch", "expected.receiptHash", "receipt hash does not reproduce");
  return { receipt, receiptHash: hashValue, canonicalBytes: String(Buffer.byteLength(canonicalizeValue(receipt))) };
}
