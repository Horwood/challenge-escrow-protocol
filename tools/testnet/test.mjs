import { readFileSync } from "node:fs";

import { computeReleaseId, inspectReadOnlyDeployment, normalizePlan, rpcRequest } from "./read-only.mjs";

const escrowAddress = "0x1111111111111111111111111111111111111111";
const canonicalToken = "0x2222222222222222222222222222222222222222";
const resolver = "0x3333333333333333333333333333333333333333";
const arbiter = "0x4444444444444444444444444444444444444444";
const pauser = "0x5555555555555555555555555555555555555555";
const compiledArtifact = JSON.parse(readFileSync(new URL("../../contracts/out/ChallengeEscrow.sol/ChallengeEscrow.json", import.meta.url), "utf8"));
const releaseManifest = JSON.parse(readFileSync(new URL("../../spec/release/release-manifest-v1.json", import.meta.url), "utf8"));
const compiledRuntime = compiledArtifact.deployedBytecode.object;
const releaseId = computeReleaseId(11155111n, escrowAddress);
const releaseSignature = "0x58ff9cf3a216732baaf694943f7d64940d5bf1455c9c40a510236b3e1568c2d2";
const snapshotBlockHash = `0x${"f".repeat(64)}`;
const snapshotParentHash = `0x${"e".repeat(64)}`;
const releaseParentHash = `0x${"a".repeat(64)}`;

function word(value) {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function addressWord(value) {
  return `0x${"0".repeat(24)}${value.slice(2)}`;
}

function patchImmutableGroup(runtime, name, replacement) {
  const group = releaseManifest.runtime.immutableGroups.find((candidate) => candidate.name === name);
  if (!group) throw new Error(`missing immutable group ${name}`);
  const raw = Buffer.from(runtime.slice(2), "hex");
  const replacementBytes = Buffer.from(replacement.slice(2), "hex");
  for (const reference of group.references) {
    if (replacementBytes.length !== Number(reference.bytes)) throw new Error(`immutable ${name} replacement length drifted`);
    replacementBytes.copy(raw, Number(reference.start));
  }
  return `0x${raw.toString("hex")}`;
}

let deployedRuntime = compiledRuntime;
for (const [name, replacement] of Object.entries({
  canonicalToken: addressWord(canonicalToken),
  tokenDecimals: word(6n),
  resolver: addressWord(resolver),
  arbiter: addressWord(arbiter),
  releaseId: word(BigInt(releaseId)),
  pauser: addressWord(pauser),
})) deployedRuntime = patchImmutableGroup(deployedRuntime, name, replacement);

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
  ["0x9fd0506d", addressWord(pauser)],
  ["0x5c975abb", word(0n)],
  ["0x26bad3d1", word(0n)],
]);

const releaseLog = {
  address: escrowAddress,
  topics: [releaseSignature, releaseId],
  data: releaseData(),
  blockNumber: "0x2a",
  blockHash: `0x${"b".repeat(64)}`,
  transactionHash: `0x${"c".repeat(64)}`,
  transactionIndex: "0x0",
  logIndex: "0x0",
  removed: false,
};

const plan = {
  network: "sepolia",
  rpcUrl: "https://rpc.example.invalid/",
  escrowAddress,
  deploymentBlock: "42",
  mode: "read-only",
  valueMode: "TESTNET_NO_VALUE",
};

const calls = [];
const request = async (method, params) => {
  calls.push({ method, params });
  if (method === "eth_chainId") return "0xaa36a7";
  if (method === "eth_blockNumber") return "0x64";
  if (method === "eth_getBlockByNumber") {
    if (params[0] === "0x64") return { number: "0x64", hash: snapshotBlockHash, parentHash: snapshotParentHash };
    if (params[0] === "0x2a") return { number: "0x2a", hash: releaseLog.blockHash, parentHash: releaseParentHash };
  }
  if (method === "eth_getCode") return params[0] === escrowAddress ? deployedRuntime : "0x60006000";
  if (method === "eth_call") return getterResults.get(params[0].data);
  if (method === "eth_getLogs") return [releaseLog];
  throw new Error(`unexpected method ${method}`);
};

const report = await inspectReadOnlyDeployment(plan, { request });
if (report.status !== "ok" || report.network !== "sepolia" || report.valueMode !== "TESTNET_NO_VALUE" || report.codeBytes !== String((deployedRuntime.length - 2) / 2)) throw new Error("safe Sepolia inspection failed");
if (!/^0x[0-9a-f]{64}$/.test(report.normalizedRuntimeKeccak256) || Number(report.immutableReferenceCount) < 1 || report.immutableGroupCount !== "6") throw new Error("runtime attestation was not recorded");
if (report.release.releaseId !== releaseId || report.release.canonicalToken !== canonicalToken || report.release.tokenDecimals !== "6") throw new Error("ReleaseDeclared reconciliation failed");
if (report.current.paused !== false || report.current.totalOutstandingLiability !== "0") throw new Error("current deployment state was not recorded");
if (calls.some(({ method }) => method.includes("send") || method.includes("transaction"))) throw new Error("read-only inspection attempted a write method");
if (calls.find(({ method }) => method === "eth_getLogs")?.params[0].fromBlock !== "0x2a") throw new Error("deployment block was not used to bound event search");
if (report.snapshotBlock !== "100") throw new Error("snapshot block was not recorded");
if (report.snapshotBlockHash !== snapshotBlockHash || report.snapshotParentHash !== snapshotParentHash) throw new Error("snapshot block hash anchor was not recorded");
if (calls.find(({ method }) => method === "eth_getLogs")?.params[0].toBlock !== "0x64") throw new Error("event search was not pinned to the snapshot block");
if (calls.filter(({ method }) => method === "eth_getCode").some(({ params }) => params[1]?.blockHash !== snapshotBlockHash || params[1]?.requireCanonical !== true)) throw new Error("code reads were not pinned to the snapshot block hash");
if (calls.filter(({ method }) => method === "eth_call").some(({ params }) => params[1]?.blockHash !== snapshotBlockHash || params[1]?.requireCanonical !== true)) throw new Error("getter reads were not pinned to the snapshot block hash");

let rejected = 0;
for (const invalid of [
  { ...plan, privateKey: "0xsecret" },
  { ...plan, rpcUrl: "https://user:pass@example.invalid/rpc" },
  { ...plan, rpcUrl: "https://example.invalid/rpc?api_key=secret" },
  { ...plan, rpcUrl: "https://example.invalid/api-key-abcdef" },
  { ...plan, rpcUrl: "http://127.0.0.1:8545" },
  { ...plan, rpcUrl: "https://127.0.0.1:8545" },
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
if (rejected !== 10) throw new Error(`unsafe plans were not rejected: ${rejected}/10`);
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

let predeploymentSnapshotRejected = false;
try {
  await inspectReadOnlyDeployment(plan, {
    request: async (method, params) => method === "eth_blockNumber" ? "0x29" : request(method, params),
  });
} catch (error) {
  predeploymentSnapshotRejected = String(error).includes("precedes the configured deployment block");
}
if (!predeploymentSnapshotRejected) throw new Error("pre-deployment snapshot was accepted");

let impreciseDeploymentBlockRejected = false;
try {
  await inspectReadOnlyDeployment({ ...plan, deploymentBlock: "41" }, { request });
} catch (error) {
  impreciseDeploymentBlockRejected = String(error).includes("configured deployment block");
}
if (!impreciseDeploymentBlockRejected) throw new Error("an imprecise deployment block was accepted");

let movingSnapshotRejected = false;
let snapshotReads = 0;
try {
  await inspectReadOnlyDeployment(plan, {
    request: async (method, params) => {
      if (method === "eth_getBlockByNumber" && params[0] === "0x64") {
        snapshotReads += 1;
        if (snapshotReads > 1) return { number: "0x64", hash: `0x${"9".repeat(64)}`, parentHash: snapshotParentHash };
      }
      return request(method, params);
    },
  });
} catch (error) {
  movingSnapshotRejected = String(error).includes("snapshot block changed");
}
if (!movingSnapshotRejected) throw new Error("a snapshot reorganization during preflight was accepted");

let runtimeMismatchRejected = false;
try {
  const firstByte = deployedRuntime.slice(2, 4) === "00" ? "01" : "00";
  const mutatedRuntime = `0x${firstByte}${deployedRuntime.slice(4)}`;
  await inspectReadOnlyDeployment(plan, {
    request: async (method, params) => {
      if (method === "eth_getCode" && params[0] === escrowAddress) return mutatedRuntime;
      return request(method, params);
    },
  });
} catch (error) {
  runtimeMismatchRejected = String(error).includes("runtime does not match the reviewed release");
}
if (!runtimeMismatchRejected) throw new Error("unreviewed escrow runtime was accepted");

let inconsistentImmutableRejected = false;
try {
  const group = releaseManifest.runtime.immutableGroups.find((candidate) => candidate.name === "resolver");
  const raw = Buffer.from(deployedRuntime.slice(2), "hex");
  raw[Number(group.references[0].start) + 31] ^= 1;
  await inspectReadOnlyDeployment(plan, {
    request: async (method, params) => {
      if (method === "eth_getCode" && params[0] === escrowAddress) return `0x${raw.toString("hex")}`;
      return request(method, params);
    },
  });
} catch (error) {
  inconsistentImmutableRejected = String(error).includes("inconsistent runtime substitutions");
}
if (!inconsistentImmutableRejected) throw new Error("inconsistent copies of one immutable were accepted");

let immutableGetterMismatchRejected = false;
try {
  const substituted = patchImmutableGroup(deployedRuntime, "resolver", addressWord("0x7777777777777777777777777777777777777777"));
  await inspectReadOnlyDeployment(plan, {
    request: async (method, params) => {
      if (method === "eth_getCode" && params[0] === escrowAddress) return substituted;
      return request(method, params);
    },
  });
} catch (error) {
  immutableGetterMismatchRejected = String(error).includes("getter differs from its immutable runtime substitutions");
}
if (!immutableGetterMismatchRejected) throw new Error("immutable runtime value different from its getter was accepted");

let releaseIdMismatchRejected = false;
try {
  await inspectReadOnlyDeployment(plan, {
    request: async (method, params) => {
      if (method === "eth_getLogs") return [{ ...releaseLog, topics: [releaseSignature, `0x${"a".repeat(64)}`] }];
      return request(method, params);
    },
  });
} catch (error) {
  releaseIdMismatchRejected = String(error).includes("release ID does not match chain and escrow");
}
if (!releaseIdMismatchRejected) throw new Error("release ID unrelated to chain and escrow was accepted");

let aliasedReleaseRejected = false;
try {
  const canonical = releaseLog.data;
  const firstOffset = canonical.slice(2, 66);
  const aliased = `0x${canonical.slice(2, 66)}${firstOffset}${canonical.slice(130)}`;
  await inspectReadOnlyDeployment(plan, {
    request: async (method, params) => {
      if (method === "eth_getLogs") return [{ ...releaseLog, data: aliased }];
      return request(method, params);
    },
  });
} catch (error) {
  aliasedReleaseRejected = String(error).includes("non-canonical ABI offset");
}
if (!aliasedReleaseRejected) throw new Error("aliased ReleaseDeclared ABI tail was accepted");

for (const [candidate, marker] of [
  [{ ...releaseLog, removed: "false" }, "non-canonical removed marker"],
  [{ ...releaseLog, endpoint: "hidden" }, "unknown field"],
]) {
  let invalidLogRejected = false;
  try {
    await inspectReadOnlyDeployment(plan, {
      request: async (method, params) => method === "eth_getLogs" ? [candidate] : request(method, params),
    });
  } catch (error) {
    invalidLogRejected = String(error).includes(marker);
  }
  if (!invalidLogRejected) throw new Error(`non-canonical ReleaseDeclared log was accepted: ${marker}`);
}

const pausedReport = await inspectReadOnlyDeployment(plan, {
  request: async (method, params) => {
    if (method === "eth_call" && params[0].data === "0x5c975abb") return word(1n);
    return request(method, params);
  },
});
if (pausedReport.release.initialPaused !== false || pausedReport.current.paused !== true) {
  throw new Error("current pause state was confused with the deployment-time state");
}

let duplicateKeyRejected = false;
try {
  await rpcRequest(plan.rpcUrl, "eth_chainId", [], {
    fetchImpl: async () => ({ ok: true, async text() { return '{"jsonrpc":"2.0","id":1,"result":"0x1","result":"0x2"}'; } }),
  });
} catch (error) {
  duplicateKeyRejected = String(error).includes("duplicate object key");
}
if (!duplicateKeyRejected) throw new Error("duplicate JSON-RPC response key was accepted");

let unknownEnvelopeFieldRejected = false;
try {
  await rpcRequest(plan.rpcUrl, "eth_chainId", [], {
    fetchImpl: async () => ({ ok: true, async text() { return JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1", endpoint: "hidden" }); } }),
  });
} catch (error) {
  unknownEnvelopeFieldRejected = String(error).includes("unknown envelope field");
}
if (!unknownEnvelopeFieldRejected) throw new Error("unknown JSON-RPC envelope field was accepted");

let oddLengthQuantityAccepted = false;
try {
  await inspectReadOnlyDeployment({ ...plan, network: "base-sepolia" }, {
    request: async (method, params) => method === "eth_chainId" ? "0x14a34" : request(method, params),
  });
} catch (error) {
  oddLengthQuantityAccepted = String(error).includes("ReleaseDeclared chain id does not match");
}
if (!oddLengthQuantityAccepted) throw new Error("canonical odd-length hex quantity was not parsed");

let redirectPolicyObserved = false;
await rpcRequest(plan.rpcUrl, "eth_chainId", [], {
  fetchImpl: async (_url, init) => {
    redirectPolicyObserved = init.redirect === "error";
    return { ok: true, async text() { return JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xaa36a7" }); } };
  },
});
if (!redirectPolicyObserved) throw new Error("RPC transport allowed implicit redirects");

console.log(JSON.stringify({ status: "ok", network: report.network, checkedMethods: report.checkedRpcMethods, rejectedPlans: rejected, writeBoundary: "enforced", valueModeBoundary: "enforced" }));
