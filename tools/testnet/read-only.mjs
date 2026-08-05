import { pathToFileURL } from "node:url";

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

const ALLOWED_RPC_METHODS = new Set(["eth_chainId", "eth_getCode", "eth_call", "eth_getLogs"]);
const MAX_RPC_BODY_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function fail(message) {
  throw new Error(`testnet-preflight: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function decimal(value, label) {
  assert(typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value), `${label} must be an unsigned decimal string`);
  return BigInt(value);
}

function hex(value, label) {
  assert(typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value) && value.length % 2 === 0, `${label} must be even-length hex`);
  return value.toLowerCase();
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

function decodeString(data, index, label, minimumHeadBytes = 12 * 32) {
  const raw = bytes(data, label);
  const offset = uintWord(data, index, label);
  assert(offset <= BigInt(Number.MAX_SAFE_INTEGER), `${label} offset is too large`);
  const start = Number(offset);
  assert(start >= minimumHeadBytes && start % 32 === 0 && start + 32 <= raw.length, `${label} offset is outside the ABI tail`);
  const length = uintWord(data, start / 32, label);
  assert(length <= BigInt(Number.MAX_SAFE_INTEGER), `${label} length is too large`);
  const payloadLength = Number(length);
  const payloadStart = start + 32;
  const paddedLength = Math.ceil(payloadLength / 32) * 32;
  assert(payloadStart + paddedLength <= raw.length, `${label} payload is truncated`);
  const payload = raw.slice(payloadStart, payloadStart + payloadLength);
  for (const padding of raw.slice(payloadStart + payloadLength, payloadStart + paddedLength)) assert(padding === 0, `${label} has non-zero ABI padding`);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(payload);
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
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
  if (parsed.protocol === "https:") return parsed.toString();
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
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
  const deploymentBlock = decimal(plan.deploymentBlock, "deploymentBlock");
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
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    assert(response && response.ok, "RPC endpoint returned a non-success HTTP status");
    return await boundedResponseText(response);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("testnet-preflight:")) throw error;
    fail("RPC request failed without exposing endpoint details");
  } finally {
    clearTimeout(timer);
  }
}

export async function rpcRequest(rpcUrl, method, params, options = {}) {
  assert(ALLOWED_RPC_METHODS.has(method), `RPC method ${method} is not permitted by the read-only boundary`);
  assert(Array.isArray(params), "RPC params must be an array");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  assert(typeof fetchImpl === "function", "fetch is unavailable");
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const text = await fetchText(fetchImpl, rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response;
  try {
    response = JSON.parse(text);
  } catch {
    fail("RPC response is not valid JSON");
  }
  assert(response && typeof response === "object" && !Array.isArray(response), "RPC response must be an object");
  assert(response.jsonrpc === "2.0" && response.id === 1, "RPC response envelope is not canonical");
  assert(!Object.hasOwn(response, "error"), "RPC endpoint returned a JSON-RPC error");
  assert(Object.hasOwn(response, "result"), "RPC response has no result");
  return response.result;
}

async function requestResult(plan, request, method, params) {
  const result = await request(method, params);
  return result;
}

function decodeReleaseLog(log, escrowAddress, chainId, deploymentBlock) {
  assert(log && typeof log === "object" && !Array.isArray(log), "ReleaseDeclared log must be an object");
  assert(typeof log.address === "string" && log.address.toLowerCase() === escrowAddress, "ReleaseDeclared log address does not match the escrow");
  assert(typeof log.blockNumber === "string", "ReleaseDeclared log has no block number");
  const logBlock = BigInt(hex(log.blockNumber, "ReleaseDeclared blockNumber"));
  assert(logBlock >= deploymentBlock, "ReleaseDeclared log is outside the bounded deployment range");
  assert(Array.isArray(log.topics) && log.topics.length === 2, "ReleaseDeclared log has an unexpected topic count");
  assert(hex(log.topics[0], "ReleaseDeclared topic0") === RELEASE_DECLARED_SIGNATURE, "ReleaseDeclared signature does not match the protocol");
  const releaseId = hex(log.topics[1], "ReleaseDeclared releaseId");
  assert(releaseId.length === 66, "ReleaseDeclared releaseId must be bytes32");
  const data = hex(log.data, "ReleaseDeclared data");
  assert(data.length >= 2 + 12 * 64 && (data.length - 2) % 64 === 0, "ReleaseDeclared data has an invalid ABI shape");
  const event = {
    releaseId,
    eventProtocolId: decodeString(data, 0, "ReleaseDeclared.eventProtocolId"),
    protocolVersion: decodeString(data, 1, "ReleaseDeclared.protocolVersion"),
    challengeSchemaId: decodeString(data, 2, "ReleaseDeclared.challengeSchemaId"),
    evidenceSchemaId: decodeString(data, 3, "ReleaseDeclared.evidenceSchemaId"),
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
  for (const [field, expected] of Object.entries({
    eventProtocolId: "challenge-escrow-event/v1",
    protocolVersion: "challenge-escrow-protocol/v1",
    challengeSchemaId: "challenge-escrow.spec/v1",
    evidenceSchemaId: "challenge-escrow.evidence/v1",
  })) assert(event[field] === expected, `ReleaseDeclared ${field} does not match the versioned protocol tuple`);
  return event;
}

export async function inspectReadOnlyDeployment(plan, options = {}) {
  const normalized = normalizePlan(plan);
  const request = options.request ?? ((method, params) => rpcRequest(normalized.rpcUrl, method, params, options));
  assert(typeof request === "function", "request transport must be a function");
  const network = TESTNETS[normalized.network];
  const chainResult = hex(await requestResult(normalized, request, "eth_chainId", []), "eth_chainId result");
  assert(chainResult.length > 2, "eth_chainId result cannot be empty");
  const chainId = BigInt(chainResult);
  assert(chainId === network.chainId, `RPC chain id ${chainId} does not match ${normalized.network}`);
  const code = hex(await requestResult(normalized, request, "eth_getCode", [normalized.escrowAddress, "latest"]), "eth_getCode result");
  assert(code.length > 2, "escrow address has no deployed bytecode");
  const values = {};
  const stringGetters = new Set(["PROTOCOL_VERSION", "EVENT_PROTOCOL_ID", "CHALLENGE_SCHEMA_ID", "EVIDENCE_SCHEMA_ID", "CONDITION_LANGUAGE_ID", "TERMS_DOMAIN", "SPEC_DOMAIN", "EVIDENCE_DOMAIN"]);
  for (const [name, selector] of Object.entries(GETTERS)) {
    const result = await requestResult(normalized, request, "eth_call", [{ to: normalized.escrowAddress, data: selector }, "latest"]);
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
  const logs = await requestResult(normalized, request, "eth_getLogs", [{ address: normalized.escrowAddress, fromBlock: blockHex(normalized.deploymentBlock), toBlock: "latest", topics: [RELEASE_DECLARED_SIGNATURE] }]);
  assert(Array.isArray(logs) && logs.length === 1, "expected exactly one ReleaseDeclared log in the bounded deployment range");
  const release = decodeReleaseLog(logs[0], normalized.escrowAddress, chainId, normalized.deploymentBlock);
  const tokenCode = hex(await requestResult(normalized, request, "eth_getCode", [release.canonicalToken, "latest"]), "canonical token eth_getCode result");
  assert(tokenCode.length > 2, "canonical token address has no deployed bytecode");
  assert(hex(values.releaseId, "releaseId") === release.releaseId, "releaseId getter does not match ReleaseDeclared");
  assert(addressWord(values.canonicalToken, 0, "canonicalToken") === release.canonicalToken, "canonicalToken getter does not match ReleaseDeclared");
  assert(uintWord(values.tokenDecimals, 0, "tokenDecimals") === release.tokenDecimals, "tokenDecimals getter does not match ReleaseDeclared");
  assert(addressWord(values.resolver, 0, "resolver") === release.resolver, "resolver getter does not match ReleaseDeclared");
  assert(addressWord(values.arbiter, 0, "arbiter") === release.arbiter, "arbiter getter does not match ReleaseDeclared");
  assert(boolWord(values.paused, 0, "paused") === release.initialPaused, "paused getter does not match ReleaseDeclared initial state");
  assert(uintWord(values.totalOutstandingLiability, 0, "totalOutstandingLiability") >= 0n, "liability getter is invalid");
  return {
    schema: "challenge-escrow.testnet-preflight/v1",
    status: "ok",
    network: normalized.network,
    chainId: chainId.toString(),
    deploymentBlock: normalized.deploymentBlock.toString(),
    escrowAddress: normalized.escrowAddress,
    codeBytes: ((code.length - 2) / 2).toString(),
    tokenCodeBytes: ((tokenCode.length - 2) / 2).toString(),
    valueMode: "TESTNET_NO_VALUE",
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
    checkedRpcMethods: ["eth_chainId", "eth_getCode", "eth_call", "eth_getLogs"],
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
