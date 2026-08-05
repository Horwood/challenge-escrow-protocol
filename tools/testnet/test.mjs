import { inspectReadOnlyDeployment, normalizePlan, rpcRequest } from "./read-only.mjs";

const escrowAddress = "0x1111111111111111111111111111111111111111";
const canonicalToken = "0x2222222222222222222222222222222222222222";
const resolver = "0x3333333333333333333333333333333333333333";
const arbiter = "0x4444444444444444444444444444444444444444";
const releaseId = `0x${"a".repeat(64)}`;
const releaseSignature = "0x58ff9cf3a216732baaf694943f7d64940d5bf1455c9c40a510236b3e1568c2d2";

function word(value) {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function addressWord(value) {
  return `0x${"0".repeat(24)}${value.slice(2)}`;
}

function encodedString(value) {
  const bytes = new TextEncoder().encode(value);
  const payload = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${word(BigInt(bytes.length)).slice(2)}${payload.padEnd(Math.ceil(bytes.length / 32) * 64, "0")}`;
}

function releaseData() {
  const strings = ["challenge-escrow-event/v1", "challenge-escrow-protocol/v1", "challenge-escrow.spec/v1", "challenge-escrow.evidence/v1"];
  const heads = [];
  let offset = 12 * 32;
  for (const value of strings) {
    const encoded = encodedString(value);
    heads.push(word(BigInt(offset)));
    offset += encoded.length / 2;
  }
  heads.push(word(11155111n), addressWord(escrowAddress), addressWord(canonicalToken), word(6n), word(0n), addressWord(resolver), addressWord(arbiter), word(0n));
  return `0x${heads.map((value) => value.slice(2)).join("")}${strings.map(encodedString).join("")}`;
}

function stringResult(value) {
  const encoded = encodedString(value);
  return `0x${word(32n).slice(2)}${encoded}`;
}

const getterResults = new Map([
  ["0x4d78d40b", word(BigInt(releaseId))],
  ["0xaa3aa460", stringResult("challenge-escrow-protocol/v1")],
  ["0x18b8c88c", stringResult("challenge-escrow-event/v1")],
  ["0x635ccd35", stringResult("challenge-escrow.spec/v1")],
  ["0x6c6fa4e3", stringResult("challenge-escrow.evidence/v1")],
  ["0x76749e6f", stringResult("challenge-escrow.condition-language/v1")],
  ["0x05a48138", stringResult("challenge-escrow.terms/v1")],
  ["0x029feabf", stringResult("challenge-escrow.spec/v1")],
  ["0xd853e488", stringResult("challenge-escrow.evidence/v1")],
  ["0xceb76b55", addressWord(canonicalToken)],
  ["0x3b97e856", word(6n)],
  ["0x04f3bcec", addressWord(resolver)],
  ["0xfe25e00a", addressWord(arbiter)],
  ["0x9fd0506d", addressWord("0x5555555555555555555555555555555555555555")],
  ["0x5c975abb", word(0n)],
  ["0x26bad3d1", word(0n)],
]);

const releaseLog = {
  address: escrowAddress,
  topics: [releaseSignature, releaseId],
  data: releaseData(),
  blockNumber: "0x2a",
};

const plan = {
  network: "sepolia",
  rpcUrl: "https://rpc.example.invalid/read-only",
  escrowAddress,
  deploymentBlock: "42",
  mode: "read-only",
  valueMode: "TESTNET_NO_VALUE",
};

const calls = [];
const request = async (method, params) => {
  calls.push({ method, params });
  if (method === "eth_chainId") return "0xaa36a7";
  if (method === "eth_getCode") return "0x60006000";
  if (method === "eth_call") return getterResults.get(params[0].data);
  if (method === "eth_getLogs") return [releaseLog];
  throw new Error(`unexpected method ${method}`);
};

const report = await inspectReadOnlyDeployment(plan, { request });
if (report.status !== "ok" || report.network !== "sepolia" || report.valueMode !== "TESTNET_NO_VALUE" || report.codeBytes !== "4") throw new Error("safe Sepolia inspection failed");
if (report.release.releaseId !== releaseId || report.release.canonicalToken !== canonicalToken || report.release.tokenDecimals !== "6") throw new Error("ReleaseDeclared reconciliation failed");
if (calls.some(({ method }) => method.includes("send") || method.includes("transaction"))) throw new Error("read-only inspection attempted a write method");
if (calls.find(({ method }) => method === "eth_getLogs")?.params[0].fromBlock !== "0x2a") throw new Error("deployment block was not used to bound event search");

let rejected = 0;
for (const invalid of [
  { ...plan, privateKey: "0xsecret" },
  { ...plan, rpcUrl: "https://user:pass@example.invalid/rpc" },
  { ...plan, rpcUrl: "https://example.invalid/rpc?api_key=secret" },
  { ...plan, rpcUrl: "http://127.0.0.1:8545" },
  { ...plan, network: "mainnet" },
  { ...plan, valueMode: "VALUE" },
  { ...plan, deploymentBlock: 42 },
  { ...plan, escrowAddress: "0x0000000000000000000000000000000000000000" },
]) {
  try {
    normalizePlan(invalid);
  } catch {
    rejected += 1;
  }
}
if (rejected !== 8) throw new Error(`unsafe plans were not rejected: ${rejected}/8`);
if (normalizePlan({ ...plan, rpcUrl: "http://127.0.0.1:8545", allowLocalRpc: true }).allowLocalRpc !== true) throw new Error("explicit local test RPC was rejected");

let chainMismatchRejected = false;
try {
  await inspectReadOnlyDeployment({ ...plan, network: "base-sepolia" }, { request });
} catch (error) {
  chainMismatchRejected = String(error).includes("does not match");
}
if (!chainMismatchRejected) throw new Error("wrong-chain RPC was accepted");

let writeRejected = false;
try {
  await rpcRequest(plan.rpcUrl, "eth_sendRawTransaction", ["0xdeadbeef"], { fetchImpl: async () => { throw new Error("must not be called"); } });
} catch (error) {
  writeRejected = String(error).includes("not permitted");
}
if (!writeRejected) throw new Error("write RPC method was accepted");

const goodRpc = await rpcRequest(plan.rpcUrl, "eth_chainId", [], {
  fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xaa36a7" }); } }),
});
if (goodRpc !== "0xaa36a7") throw new Error("JSON-RPC response was not decoded");

let malformedRejected = false;
try {
  await rpcRequest(plan.rpcUrl, "eth_chainId", [], {
    fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify({ jsonrpc: "2.0", id: 2, result: "0xaa36a7" }); } }),
  });
} catch {
  malformedRejected = true;
}
if (!malformedRejected) throw new Error("mismatched JSON-RPC id was accepted");

let oversizedRejected = false;
try {
  await rpcRequest(plan.rpcUrl, "eth_chainId", [], {
    fetchImpl: async () => ({ ok: true, async text() { return "x".repeat(1024 * 1024 + 1); } }),
  });
} catch (error) {
  oversizedRejected = String(error).includes("bounded body size");
}
if (!oversizedRejected) throw new Error("oversized RPC response was accepted");

let valueModeRejected = false;
try {
  await inspectReadOnlyDeployment(plan, {
    request: async (method, params) => {
      if (method === "eth_getLogs") return [{ ...releaseLog, data: `${releaseLog.data.slice(0, 2 + 8 * 64)}${word(1n).slice(2)}${releaseLog.data.slice(2 + 9 * 64)}` }];
      return request(method, params);
    },
  });
} catch (error) {
  valueModeRejected = String(error).includes("TESTNET_NO_VALUE");
}
if (!valueModeRejected) throw new Error("non-zero ReleaseDeclared value mode was accepted");

console.log(JSON.stringify({ status: "ok", network: report.network, checkedMethods: report.checkedRpcMethods, rejectedPlans: rejected, writeBoundary: "enforced", valueModeBoundary: "enforced" }));
