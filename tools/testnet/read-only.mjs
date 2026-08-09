import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { assertNoDuplicateKeys, canonicalizeValue, domainHash } from "../portable/canonical.mjs";

export const TESTNETS = Object.freeze({
  sepolia: Object.freeze({ name: "Sepolia", chainId: 11155111n }),
  "base-sepolia": Object.freeze({ name: "Base Sepolia", chainId: 84532n }),
});

const RELEASE_DECLARED_SIGNATURE = "0x58ff9cf3a216732baaf694943f7d64940d5bf1455c9c40a510236b3e1568c2d2";
const GETTERS = Object.freeze({
  releaseId: "0x4d78d40b",
  PROTOCOL_VERSION: "0xaa3aa460",
  EVENT_PROTOCOL_ID: "0x18b8c88c",
  CHALLENGE_SCHEMA_ID: "0x635ccd35",
  EVIDENCE_SCHEMA_ID: "0x6c6fa4e3",
  CONDITION_LANGUAGE_ID: "0x76749e6f",
  TERMS_DOMAIN: "0x05a48138",
  SPEC_DOMAIN: "0x029feabf",
  EVIDENCE_DOMAIN: "0xd853e488",
  canonicalToken: "0xceb76b55",
  tokenDecimals: "0x3b97e856",
  resolver: "0x04f3bcec",
  arbiter: "0xfe25e00a",
  pauser: "0x9fd0506d",
  paused: "0x5c975abb",
  totalOutstandingLiability: "0x26bad3d1",
});

const ALLOWED_RPC_METHODS = new Set(["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_getLogs"]);
const MAX_RPC_BODY_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;

function loadReleaseBoundary() {
  const raw = readFileSync(new URL("../../spec/release/release-manifest-v1.json", import.meta.url), "utf8");
  assertNoDuplicateKeys(raw);
  const manifest = JSON.parse(raw);
  if (manifest.schema !== "challenge-escrow.release-manifest/v1") throw new Error("testnet-preflight: release manifest schema drifted");
  const body = structuredClone(manifest);
  delete body.manifestHash;
  if (domainHash("challenge-escrow.release-manifest/v1", body) !== manifest.manifestHash) {
    throw new Error("testnet-preflight: release manifest hash does not reproduce");
  }
  return manifest.runtime;
}

const RUNTIME_BOUNDARY = loadReleaseBoundary();

function fail(message) {
  throw new Error(`testnet-preflight: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function decimal(value, label, maximum = MAX_UINT256) {
  assert(typeof value === "string" && value.length <= 78 && /^(0|[1-9][0-9]*)$/.test(value), `${label} must be an unsigned decimal string`);
  const parsed = BigInt(value);
  assert(parsed <= maximum, `${label} exceeds its numeric range`);
  return parsed;
}

function hex(value, label) {
  assert(typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0, `${label} must be even-length hex`);
  return value.toLowerCase();
}

function quantity(value, label, maximum = MAX_UINT256) {
  assert(typeof value === "string" && /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value), `${label} must be a canonical hex quantity`);
  const parsed = BigInt(value);
  assert(parsed <= maximum, `${label} exceeds its numeric range`);
  return parsed;
}

function keccakHex(value, label) {
  const result = execFileSync("cast", ["keccak", value], { encoding: "utf8", timeout: 10_000 }).trim().toLowerCase();
  assert(/^0x[0-9a-f]{64}$/.test(result), `${label} could not be hashed`);
  return result;
}

export function computeReleaseId(chainId, escrowAddress) {
  assert(typeof chainId === "bigint" && chainId > 0n && chainId <= MAX_UINT256, "release chain id is invalid");
  const normalizedAddress = address(escrowAddress, "release escrow address");
  const domain = Buffer.from("challenge-escrow.release-id/v1", "utf8");
  const chainBytes = Buffer.from(chainId.toString(16).padStart(64, "0"), "hex");
  const addressBytes = Buffer.from(normalizedAddress.slice(2), "hex");
  const preimage = Buffer.concat([domain, Buffer.from([0]), chainBytes, addressBytes]);
  return keccakHex(`0x${preimage.toString("hex")}`, "release ID");
}

function normalizedRuntimeBoundary(code) {
  const raw = Buffer.from(code.slice(2), "hex");
  const expectedBytes = decimal(RUNTIME_BOUNDARY.bytes, "release runtime bytes", MAX_UINT64);
  assert(BigInt(raw.length) === expectedBytes, "escrow runtime byte length does not match the reviewed release");
  assert(Array.isArray(RUNTIME_BOUNDARY.immutableReferences) && RUNTIME_BOUNDARY.immutableReferences.length > 0, "release immutable reference boundary is missing");
  assert(Array.isArray(RUNTIME_BOUNDARY.immutableGroups), "release immutable group boundary is missing");
  const expectedNames = ["arbiter", "canonicalToken", "pauser", "releaseId", "resolver", "tokenDecimals"];
  assert(
    canonicalizeValue(RUNTIME_BOUNDARY.immutableGroups.map((group) => group?.name)) === canonicalizeValue(expectedNames),
    "release immutable group inventory drifted",
  );
  const immutableWords = {};
  const groupedReferences = [];
  const compilerIds = new Set();
  for (const [groupIndex, group] of RUNTIME_BOUNDARY.immutableGroups.entries()) {
    assert(group && typeof group === "object" && !Array.isArray(group), `immutable group ${groupIndex} is malformed`);
    assert(Object.keys(group).every((key) => ["name", "compilerId", "references"].includes(key)), `immutable group ${groupIndex} has an unknown field`);
    decimal(group.compilerId, `immutable group ${groupIndex} compiler ID`, MAX_UINT64);
    assert(!compilerIds.has(group.compilerId), `immutable group ${groupIndex} repeats a compiler ID`);
    compilerIds.add(group.compilerId);
    assert(Array.isArray(group.references) && group.references.length > 0, `immutable group ${groupIndex} has no references`);
    let expectedWord = null;
    let previousGroupEnd = 0n;
    for (const [referenceIndex, reference] of group.references.entries()) {
      assert(reference && typeof reference === "object" && !Array.isArray(reference), `immutable group ${groupIndex} reference ${referenceIndex} is malformed`);
      assert(Object.keys(reference).every((key) => ["start", "bytes"].includes(key)), `immutable group ${groupIndex} reference ${referenceIndex} has an unknown field`);
      const start = decimal(reference.start, `immutable group ${groupIndex} reference ${referenceIndex} start`, MAX_UINT64);
      const bytes = decimal(reference.bytes, `immutable group ${groupIndex} reference ${referenceIndex} bytes`, MAX_UINT64);
      assert(bytes === 32n && start >= previousGroupEnd && start + bytes <= BigInt(raw.length), `immutable group ${groupIndex} reference ${referenceIndex} is out of range or unordered`);
      const word = `0x${raw.subarray(Number(start), Number(start + bytes)).toString("hex")}`;
      assert(expectedWord === null || expectedWord === word, `live immutable ${group.name} has inconsistent runtime substitutions`);
      expectedWord = word;
      previousGroupEnd = start + bytes;
      groupedReferences.push({ start: reference.start, bytes: reference.bytes });
    }
    immutableWords[group.name] = expectedWord;
  }
  groupedReferences.sort((left, right) => Number(left.start) - Number(right.start) || Number(left.bytes) - Number(right.bytes));
  assert(
    canonicalizeValue(groupedReferences) === canonicalizeValue(RUNTIME_BOUNDARY.immutableReferences),
    "flat and grouped immutable reference boundaries differ",
  );
  let previousEnd = 0;
  for (const [index, reference] of RUNTIME_BOUNDARY.immutableReferences.entries()) {
    assert(reference && typeof reference === "object" && !Array.isArray(reference), `immutable reference ${index} is malformed`);
    const start = decimal(reference.start, `immutable reference ${index} start`, MAX_UINT64);
    const bytes = decimal(reference.bytes, `immutable reference ${index} bytes`, MAX_UINT64);
    assert(bytes > 0n && start >= BigInt(previousEnd) && start + bytes <= BigInt(raw.length), `immutable reference ${index} is out of range or overlaps`);
    raw.fill(0, Number(start), Number(start + bytes));
    previousEnd = Number(start + bytes);
  }
  const normalized = keccakHex(`0x${raw.toString("hex")}`, "normalized escrow runtime");
  assert(normalized === RUNTIME_BOUNDARY.normalizedKeccak256, "escrow runtime does not match the reviewed release outside immutable slots");
  return { normalized, immutableWords };
}

function address(value, label) {
  assert(typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value), `${label} must be an address`);
  const normalized = value.toLowerCase();
  assert(normalized !== ZERO_ADDRESS, `${label} cannot be zero`);
  return normalized;
}

function blockHex(value) {
  return `0x${value.toString(16)}`;
}

function decodeBlockHeader(value, expectedNumber, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  for (const field of ["number", "hash", "parentHash"]) assert(Object.hasOwn(value, field), `${label} is missing ${field}`);
  const number = quantity(value.number, `${label}.number`, MAX_UINT64);
  const hashValue = hex(value.hash, `${label}.hash`);
  const parentHash = hex(value.parentHash, `${label}.parentHash`);
  assert(number === expectedNumber, `${label} number does not match its request`);
  assert(hashValue.length === 66 && parentHash.length === 66, `${label} hashes must be bytes32`);
  return { number, hash: hashValue, parentHash };
}

function sameHeader(left, right) {
  return left.number === right.number && left.hash === right.hash && left.parentHash === right.parentHash;
}

function word(data, index, label) {
  const start = 2 + index * 64;
  assert(data.length >= start + 64, `${label} is truncated at ABI word ${index}`);
  return `0x${data.slice(start, start + 64)}`;
}

function uintWord(data, index, label) {
  return BigInt(word(data, index, label));
}

function addressWord(data, index, label) {
  const value = word(data, index, label);
  assert(value.slice(2, 26) === "0".repeat(24), `${label} has non-zero address padding`);
  return `0x${value.slice(-40)}`;
}

function boolWord(data, index, label) {
  const value = uintWord(data, index, label);
  assert(value === 0n || value === 1n, `${label} is not a canonical ABI bool`);
  return value === 1n;
}

function bytes(data, label) {
  const normalized = hex(data, label);
  return new Uint8Array(normalized.slice(2).match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
}

function decodeStringPart(data, index, label, minimumHeadBytes, expectedStart) {
  const raw = bytes(data, label);
  const offset = uintWord(data, index, label);
  assert(offset <= BigInt(Number.MAX_SAFE_INTEGER), `${label} offset is too large`);
  const start = Number(offset);
  assert(start === expectedStart && start >= minimumHeadBytes && start % 32 === 0 && start + 32 <= raw.length, `${label} has a non-canonical ABI offset`);
  const length = uintWord(data, start / 32, label);
  assert(length <= BigInt(Number.MAX_SAFE_INTEGER), `${label} length is too large`);
  const payloadLength = Number(length);
  const payloadStart = start + 32;
  const paddedLength = Math.ceil(payloadLength / 32) * 32;
  assert(payloadStart + paddedLength <= raw.length, `${label} payload is truncated`);
  const payload = raw.slice(payloadStart, payloadStart + payloadLength);
  for (const padding of raw.slice(payloadStart + payloadLength, payloadStart + paddedLength)) assert(padding === 0, `${label} has non-zero ABI padding`);
  try {
    return {
      value: new TextDecoder("utf-8", { fatal: true }).decode(payload),
      end: payloadStart + paddedLength,
      total: raw.length,
    };
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
}

function decodeString(data, index, label, minimumHeadBytes = 12 * 32) {
  const decoded = decodeStringPart(data, index, label, minimumHeadBytes, minimumHeadBytes);
  assert(decoded.end === decoded.total, `${label} has trailing ABI data`);
  return decoded.value;
}

function decodeStatic(result, label) {
  const value = hex(result, label);
  assert(value.length === 66, `${label} must contain exactly one ABI word`);
  return value;
}

function validateRpcUrl(value, allowLocalRpc) {
  assert(typeof value === "string" && value.length <= 2048, "rpcUrl must be a bounded string");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("rpcUrl is not a valid URL");
  }
  assert(!parsed.username && !parsed.password, "rpcUrl must not contain credentials");
  assert(!parsed.search && !parsed.hash, "rpcUrl must not contain query or fragment data");
  assert(parsed.pathname === "/", "rpcUrl must not contain a credential-bearing or provider-specific path");
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const ipLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname) || parsed.hostname.startsWith("[");
  if (parsed.protocol === "https:") {
    assert((!localHosts.has(parsed.hostname) && !ipLiteral) || allowLocalRpc, "local or IP-literal RPC URLs require explicit local-test permission");
    return parsed.toString();
  }
  assert(parsed.protocol === "http:" && allowLocalRpc && localHosts.has(parsed.hostname), "rpcUrl must use HTTPS; plain HTTP is only allowed for explicit local tests");
  return parsed.toString();
}

export function normalizePlan(plan) {
  assert(plan && typeof plan === "object" && !Array.isArray(plan), "plan must be an object");
  const allowed = new Set(["network", "rpcUrl", "escrowAddress", "deploymentBlock", "mode", "valueMode", "allowLocalRpc"]);
  for (const key of Object.keys(plan)) assert(allowed.has(key), `unknown plan field ${key}`);
  for (const key of ["network", "rpcUrl", "escrowAddress", "deploymentBlock", "mode", "valueMode"]) assert(Object.hasOwn(plan, key), `plan.${key} is required`);
  assert(typeof plan.network === "string" && Object.hasOwn(TESTNETS, plan.network), "network must be sepolia or base-sepolia");
  assert(plan.mode === "read-only", "mode must be read-only");
  assert(plan.valueMode === "TESTNET_NO_VALUE", "valueMode must be TESTNET_NO_VALUE");
  assert(plan.allowLocalRpc === undefined || typeof plan.allowLocalRpc === "boolean", "allowLocalRpc must be boolean");
  const deploymentBlock = decimal(plan.deploymentBlock, "deploymentBlock", MAX_UINT64);
  return Object.freeze({
    network: plan.network,
    rpcUrl: validateRpcUrl(plan.rpcUrl, plan.allowLocalRpc === true),
    escrowAddress: address(plan.escrowAddress, "escrowAddress"),
    deploymentBlock,
    mode: "read-only",
    valueMode: "TESTNET_NO_VALUE",
    allowLocalRpc: plan.allowLocalRpc === true,
  });
}

async function boundedResponseText(response) {
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      assert(total <= MAX_RPC_BODY_BYTES, "RPC response exceeded the bounded body size");
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail("RPC response is not valid UTF-8");
    }
  }
  const body = await response.text();
  assert(new TextEncoder().encode(body).byteLength <= MAX_RPC_BODY_BYTES, "RPC response exceeded the bounded body size");
  return body;
}

async function fetchText(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
    assert(response && response.ok, "RPC endpoint returned a non-success HTTP status");
    return await boundedResponseText(response);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("testnet-preflight:")) throw error;
    fail("RPC request failed without exposing endpoint details");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function rpcRequest(rpcUrl, method, params, options = {}) {
  assert(ALLOWED_RPC_METHODS.has(method), `RPC method ${method} is not permitted by the read-only boundary`);
  assert(Array.isArray(params), "RPC params must be an array");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  assert(typeof fetchImpl === "function", "fetch is unavailable");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60_000, "RPC timeout must be between 1 and 60000 milliseconds");
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const normalizedRpcUrl = validateRpcUrl(rpcUrl, options.allowLocalRpc === true);
  const text = await fetchText(fetchImpl, normalizedRpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body }, timeoutMs);
  let response;
  try {
    assertNoDuplicateKeys(text);
    response = JSON.parse(text);
  } catch (error) {
    if (String(error).includes("duplicate object key")) fail("RPC response contains a duplicate object key");
    fail("RPC response is not valid JSON");
  }
  assert(response && typeof response === "object" && !Array.isArray(response), "RPC response must be an object");
  assert(Object.keys(response).every((key) => ["jsonrpc", "id", "result"].includes(key)), "RPC response contains an unknown envelope field");
  assert(response.jsonrpc === "2.0" && response.id === 1, "RPC response envelope is not canonical");
  assert(!Object.hasOwn(response, "error"), "RPC endpoint returned a JSON-RPC error");
  assert(Object.hasOwn(response, "result"), "RPC response has no result");
  return response.result;
}

async function requestResult(request, method, params) {
  const result = await request(method, params);
  return result;
}

function decodeReleaseLog(log, escrowAddress, chainId, deploymentBlock, snapshotBlock) {
  assert(log && typeof log === "object" && !Array.isArray(log), "ReleaseDeclared log must be an object");
  const requiredFields = ["address", "blockNumber", "blockHash", "transactionHash", "transactionIndex", "logIndex", "topics", "data"];
  for (const field of requiredFields) assert(Object.hasOwn(log, field), `ReleaseDeclared log is missing ${field}`);
  assert(Object.keys(log).every((key) => [...requiredFields, "removed"].includes(key)), "ReleaseDeclared log contains an unknown field");
  assert(typeof log.address === "string" && log.address.toLowerCase() === escrowAddress, "ReleaseDeclared log address does not match the escrow");
  assert(typeof log.blockNumber === "string", "ReleaseDeclared log has no block number");
  const logBlock = quantity(log.blockNumber, "ReleaseDeclared blockNumber", MAX_UINT64);
  assert(logBlock === deploymentBlock, "ReleaseDeclared log is not at the configured deployment block");
  assert(logBlock <= snapshotBlock, "ReleaseDeclared log is newer than the pinned snapshot");
  assert(log.removed === undefined || log.removed === false, "ReleaseDeclared log has a non-canonical removed marker");
  assert(hex(log.blockHash, "ReleaseDeclared blockHash").length === 66, "ReleaseDeclared blockHash must be bytes32");
  assert(hex(log.transactionHash, "ReleaseDeclared transactionHash").length === 66, "ReleaseDeclared transactionHash must be bytes32");
  quantity(log.transactionIndex, "ReleaseDeclared transactionIndex", MAX_UINT64);
  quantity(log.logIndex, "ReleaseDeclared logIndex", MAX_UINT64);
  assert(Array.isArray(log.topics) && log.topics.length === 2, "ReleaseDeclared log has an unexpected topic count");
  assert(hex(log.topics[0], "ReleaseDeclared topic0") === RELEASE_DECLARED_SIGNATURE, "ReleaseDeclared signature does not match the protocol");
  const releaseId = hex(log.topics[1], "ReleaseDeclared releaseId");
  assert(releaseId.length === 66, "ReleaseDeclared releaseId must be bytes32");
  const data = hex(log.data, "ReleaseDeclared data");
  assert(data.length >= 2 + 12 * 64 && (data.length - 2) % 64 === 0, "ReleaseDeclared data has an invalid ABI shape");
  const stringFields = ["eventProtocolId", "protocolVersion", "challengeSchemaId", "evidenceSchemaId"];
  const decodedStrings = {};
  let tailEnd = 12 * 32;
  let totalBytes = 0;
  for (const [index, field] of stringFields.entries()) {
    const decoded = decodeStringPart(data, index, `ReleaseDeclared.${field}`, 12 * 32, tailEnd);
    decodedStrings[field] = decoded.value;
    tailEnd = decoded.end;
    totalBytes = decoded.total;
  }
  assert(tailEnd === totalBytes, "ReleaseDeclared has trailing ABI data");
  const event = {
    releaseId,
    eventProtocolId: decodedStrings.eventProtocolId,
    protocolVersion: decodedStrings.protocolVersion,
    challengeSchemaId: decodedStrings.challengeSchemaId,
    evidenceSchemaId: decodedStrings.evidenceSchemaId,
    chainId: uintWord(data, 4, "ReleaseDeclared.chainId"),
    escrowContract: addressWord(data, 5, "ReleaseDeclared.escrowContract"),
    canonicalToken: addressWord(data, 6, "ReleaseDeclared.canonicalToken"),
    tokenDecimals: uintWord(data, 7, "ReleaseDeclared.tokenDecimals"),
    valueMode: uintWord(data, 8, "ReleaseDeclared.valueMode"),
    resolver: addressWord(data, 9, "ReleaseDeclared.resolver"),
    arbiter: addressWord(data, 10, "ReleaseDeclared.arbiter"),
    initialPaused: boolWord(data, 11, "ReleaseDeclared.initialPaused"),
  };
  assert(event.chainId === chainId, "ReleaseDeclared chain id does not match the selected testnet");
  assert(event.escrowContract === escrowAddress, "ReleaseDeclared escrow address does not match the target");
  assert(event.valueMode === 0n, "ReleaseDeclared is not TESTNET_NO_VALUE");
  assert(event.tokenDecimals <= 18n, "ReleaseDeclared token decimals exceed the contract boundary");
  assert(event.canonicalToken !== ZERO_ADDRESS, "ReleaseDeclared canonical token is zero");
  assert(event.resolver !== ZERO_ADDRESS && event.arbiter !== ZERO_ADDRESS, "ReleaseDeclared authority is zero");
  assert(event.resolver !== event.arbiter, "ReleaseDeclared resolver and arbiter overlap");
  assert(event.canonicalToken !== escrowAddress, "ReleaseDeclared token equals the escrow");
  assert(new Set([event.escrowContract, event.canonicalToken, event.resolver, event.arbiter]).size === 4, "ReleaseDeclared roles or token overlap");
  assert(event.releaseId === computeReleaseId(chainId, escrowAddress), "ReleaseDeclared release ID does not match chain and escrow");
  for (const [field, expected] of Object.entries({
    eventProtocolId: "challenge-escrow-event/v1",
    protocolVersion: "challenge-escrow-protocol/v1",
    challengeSchemaId: "challenge-escrow.spec/v1",
    evidenceSchemaId: "challenge-escrow.evidence/v1",
  })) assert(event[field] === expected, `ReleaseDeclared ${field} does not match the versioned protocol tuple`);
  return { ...event, blockNumber: logBlock, blockHash: hex(log.blockHash, "ReleaseDeclared blockHash") };
}

export async function inspectReadOnlyDeployment(plan, options = {}) {
  const normalized = normalizePlan(plan);
  const request = options.request ?? ((method, params) => rpcRequest(normalized.rpcUrl, method, params, { ...options, allowLocalRpc: normalized.allowLocalRpc }));
  assert(typeof request === "function", "request transport must be a function");
  const network = TESTNETS[normalized.network];
  const chainId = quantity(await requestResult(request, "eth_chainId", []), "eth_chainId result");
  assert(chainId === network.chainId, `RPC chain id ${chainId} does not match ${normalized.network}`);
  const snapshotBlock = quantity(await requestResult(request, "eth_blockNumber", []), "eth_blockNumber result", MAX_UINT64);
  assert(snapshotBlock >= normalized.deploymentBlock, "snapshot block precedes the configured deployment block");
  const snapshotTag = blockHex(snapshotBlock);
  const snapshotHeader = decodeBlockHeader(
    await requestResult(request, "eth_getBlockByNumber", [snapshotTag, false]),
    snapshotBlock,
    "snapshot block",
  );
  const snapshotSelector = { blockHash: snapshotHeader.hash, requireCanonical: true };
  const code = hex(await requestResult(request, "eth_getCode", [normalized.escrowAddress, snapshotSelector]), "eth_getCode result");
  assert(code.length > 2, "escrow address has no deployed bytecode");
  const runtimeBoundary = normalizedRuntimeBoundary(code);
  const values = {};
  const stringGetters = new Set(["PROTOCOL_VERSION", "EVENT_PROTOCOL_ID", "CHALLENGE_SCHEMA_ID", "EVIDENCE_SCHEMA_ID", "CONDITION_LANGUAGE_ID", "TERMS_DOMAIN", "SPEC_DOMAIN", "EVIDENCE_DOMAIN"]);
  for (const [name, selector] of Object.entries(GETTERS)) {
    const result = await requestResult(request, "eth_call", [{ to: normalized.escrowAddress, data: selector }, snapshotSelector]);
    const label = `eth_call ${name}`;
    values[name] = stringGetters.has(name) ? decodeString(hex(result, label), 0, label, 32) : decodeStatic(result, label);
  }
  for (const [name, expected] of Object.entries({
    PROTOCOL_VERSION: "challenge-escrow-protocol/v1",
    EVENT_PROTOCOL_ID: "challenge-escrow-event/v1",
    CHALLENGE_SCHEMA_ID: "challenge-escrow.spec/v1",
    EVIDENCE_SCHEMA_ID: "challenge-escrow.evidence/v1",
    CONDITION_LANGUAGE_ID: "challenge-escrow.condition-language/v1",
    TERMS_DOMAIN: "challenge-escrow.terms/v1",
    SPEC_DOMAIN: "challenge-escrow.spec/v1",
    EVIDENCE_DOMAIN: "challenge-escrow.evidence/v1",
  })) assert(values[name] === expected, `${name} getter does not match the versioned protocol tuple`);
  for (const name of ["releaseId", "canonicalToken", "tokenDecimals", "resolver", "arbiter", "pauser"]) {
    assert(hex(values[name], `${name} getter word`) === runtimeBoundary.immutableWords[name], `${name} getter differs from its immutable runtime substitutions`);
  }
  const logs = await requestResult(request, "eth_getLogs", [{ address: normalized.escrowAddress, fromBlock: blockHex(normalized.deploymentBlock), toBlock: snapshotTag, topics: [RELEASE_DECLARED_SIGNATURE] }]);
  assert(Array.isArray(logs) && logs.length === 1, "expected exactly one ReleaseDeclared log in the bounded deployment range");
  const release = decodeReleaseLog(logs[0], normalized.escrowAddress, chainId, normalized.deploymentBlock, snapshotBlock);
  const releaseHeader = decodeBlockHeader(
    await requestResult(request, "eth_getBlockByNumber", [blockHex(release.blockNumber), false]),
    release.blockNumber,
    "ReleaseDeclared block",
  );
  assert(releaseHeader.hash === release.blockHash, "ReleaseDeclared log is not anchored to its canonical block");
  const tokenCode = hex(await requestResult(request, "eth_getCode", [release.canonicalToken, snapshotSelector]), "canonical token eth_getCode result");
  assert(tokenCode.length > 2, "canonical token address has no deployed bytecode");
  assert(hex(values.releaseId, "releaseId") === release.releaseId, "releaseId getter does not match ReleaseDeclared");
  assert(addressWord(values.canonicalToken, 0, "canonicalToken") === release.canonicalToken, "canonicalToken getter does not match ReleaseDeclared");
  assert(uintWord(values.tokenDecimals, 0, "tokenDecimals") === release.tokenDecimals, "tokenDecimals getter does not match ReleaseDeclared");
  assert(addressWord(values.resolver, 0, "resolver") === release.resolver, "resolver getter does not match ReleaseDeclared");
  assert(addressWord(values.arbiter, 0, "arbiter") === release.arbiter, "arbiter getter does not match ReleaseDeclared");
  const currentPauser = addressWord(values.pauser, 0, "pauser");
  assert(currentPauser !== ZERO_ADDRESS, "current pauser is zero");
  assert(![normalized.escrowAddress, release.canonicalToken, release.resolver, release.arbiter].includes(currentPauser), "current pauser overlaps the contract, token, resolver, or arbiter");
  const currentPaused = boolWord(values.paused, 0, "paused");
  const totalOutstandingLiability = uintWord(values.totalOutstandingLiability, 0, "totalOutstandingLiability");
  const finalSnapshotHeader = decodeBlockHeader(
    await requestResult(request, "eth_getBlockByNumber", [snapshotTag, false]),
    snapshotBlock,
    "final snapshot block",
  );
  assert(sameHeader(finalSnapshotHeader, snapshotHeader), "snapshot block changed while deployment data was read");
  return {
    schema: "challenge-escrow.testnet-preflight/v1",
    status: "ok",
    network: normalized.network,
    chainId: chainId.toString(),
    snapshotBlock: snapshotBlock.toString(),
    snapshotBlockHash: snapshotHeader.hash,
    snapshotParentHash: snapshotHeader.parentHash,
    deploymentBlock: normalized.deploymentBlock.toString(),
    escrowAddress: normalized.escrowAddress,
    codeBytes: ((code.length - 2) / 2).toString(),
    normalizedRuntimeKeccak256: runtimeBoundary.normalized,
    immutableReferenceCount: String(RUNTIME_BOUNDARY.immutableReferences.length),
    immutableGroupCount: String(RUNTIME_BOUNDARY.immutableGroups.length),
    tokenCodeBytes: ((tokenCode.length - 2) / 2).toString(),
    valueMode: "TESTNET_NO_VALUE",
    current: {
      pauser: currentPauser,
      paused: currentPaused,
      totalOutstandingLiability: totalOutstandingLiability.toString(),
    },
    release: {
      releaseId: release.releaseId,
      eventProtocolId: release.eventProtocolId,
      protocolVersion: release.protocolVersion,
      challengeSchemaId: release.challengeSchemaId,
      evidenceSchemaId: release.evidenceSchemaId,
      chainId: release.chainId.toString(),
      escrowContract: release.escrowContract,
      canonicalToken: release.canonicalToken,
      tokenDecimals: release.tokenDecimals.toString(),
      resolver: release.resolver,
      arbiter: release.arbiter,
      initialPaused: release.initialPaused,
    },
    checkedRpcMethods: ["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_getLogs"],
  };
}

function env(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required; no network is contacted without an explicit read-only plan`);
  return value;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const report = await inspectReadOnlyDeployment({
      network: env("TESTNET_NETWORK"),
      rpcUrl: env("TESTNET_RPC_URL"),
      escrowAddress: env("TESTNET_ESCROW_ADDRESS"),
      deploymentBlock: env("TESTNET_DEPLOYMENT_BLOCK"),
      mode: "read-only",
      valueMode: "TESTNET_NO_VALUE",
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "testnet-preflight: failed");
    process.exitCode = 1;
  }
}
