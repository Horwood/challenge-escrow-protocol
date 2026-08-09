import { buildRpcQuorum } from "../observer/receipt.mjs";
import { compareRpcQuorum, type RpcHeadProvider, type RpcQuorumHead } from "./rpc.ts";
import type { BlockHeader } from "./observer.ts";

// The package gate type-checks the TypeScript quorum separately. This runtime
// differential uses --no-check because the independent receipt implementation
// deliberately targets Node.js and imports node:* modules.
const CASES = 512;

function hash(value: bigint, uppercase: boolean): `0x${string}` {
  const encoded = value.toString(16).padStart(64, "0");
  return `0x${uppercase ? encoded.toUpperCase() : encoded}`;
}

function header(number: bigint, variant: bigint, uppercase = false): BlockHeader {
  return {
    number,
    hash: hash(number * 1000n + variant + 1n, uppercase),
    parentHash: hash((number - 1n) * 1000n + variant + 1n, uppercase),
  };
}

function provider(
  latest: BlockHeader,
  safe: BlockHeader,
  finalized: BlockHeader,
): RpcHeadProvider {
  return {
    async getBlockNumber(): Promise<bigint> { return latest.number; },
    async getBlockByNumber(number: bigint): Promise<BlockHeader | null> {
      return number === latest.number ? latest : null;
    },
    async getBlockByTag(tag): Promise<BlockHeader | null> {
      return tag === "safe" ? safe : tag === "finalized" ? finalized : latest;
    },
  };
}

function receiptBlock(value: BlockHeader | null): Record<string, string> | null {
  if (!value) return null;
  return {
    number: value.number.toString(),
    hash: value.hash.toLowerCase(),
    parentHash: value.parentHash.toLowerCase(),
  };
}

function receiptHead(value: RpcQuorumHead): Record<string, unknown> {
  return {
    status: value.status,
    agreed: receiptBlock(value.agreed),
    supporters: [...value.supporters],
    dissenters: [...value.dissenters],
    unavailable: [...value.unavailable],
    groups: value.groups.map((group) => ({
      block: receiptBlock(group.block),
      providers: [...group.providers],
    })),
  };
}

for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
  const providerCount = 2 + (caseIndex % 5);
  const minimumThreshold = Math.floor(providerCount / 2) + 1;
  const threshold = minimumThreshold + (Math.floor(caseIndex / 5) % (providerCount - minimumThreshold + 1));
  const providerInputs = [];
  const receiptInputs = [];
  for (let providerIndex = 0; providerIndex < providerCount; providerIndex += 1) {
    const name = `rpc-${providerIndex}`;
    const available = ((caseIndex * 17 + providerIndex * 13) % 7) !== 0;
    if (!available) {
      const down: RpcHeadProvider = {
        async getBlockNumber(): Promise<bigint> { throw new Error("credential-like raw error"); },
        async getBlockByNumber(): Promise<BlockHeader | null> { return null; },
        async getBlockByTag(): Promise<BlockHeader | null> { throw new Error("credential-like raw error"); },
      };
      providerInputs.push({ name, provider: down });
      receiptInputs.push({
        providerId: name,
        status: "unavailable",
        latest: null,
        safe: null,
        finalized: null,
        error: "RPC_READ_FAILED",
      });
      continue;
    }
    const latestVariant = BigInt((caseIndex + providerIndex * 3) % 4);
    const safeVariant = BigInt((Math.floor(caseIndex / 3) + providerIndex) % 3);
    const finalizedVariant = BigInt((Math.floor(caseIndex / 11) + providerIndex * 2) % 3);
    const uppercase = (caseIndex + providerIndex) % 2 === 0;
    const latest = header(100n, latestVariant, uppercase);
    const safe = header(98n, safeVariant, uppercase);
    const finalized = header(96n, finalizedVariant, uppercase);
    providerInputs.push({ name, provider: provider(latest, safe, finalized) });
    receiptInputs.push({
      providerId: name,
      status: "available",
      latest: receiptBlock(latest),
      safe: receiptBlock(safe),
      finalized: receiptBlock(finalized),
      error: null,
    });
  }

  const rotation = caseIndex % providerCount;
  const permutedProviders = [...providerInputs.slice(rotation), ...providerInputs.slice(0, rotation)].reverse();
  const permutedReceipts = [...receiptInputs.slice(rotation), ...receiptInputs.slice(0, rotation)].reverse();
  const rpc = await compareRpcQuorum(permutedProviders, threshold);
  const actual = {
    schema: rpc.schema,
    status: rpc.status,
    threshold: String(rpc.threshold),
    compared: [...rpc.compared],
    heads: {
      latest: receiptHead(rpc.heads.latest),
      safe: receiptHead(rpc.heads.safe),
      finalized: receiptHead(rpc.heads.finalized),
    },
    providers: rpc.endpoints.map((endpoint) => ({
      providerId: endpoint.name,
      status: endpoint.error === null ? "available" : "unavailable",
      latest: endpoint.error === null ? receiptBlock(endpoint.latest) : null,
      safe: endpoint.error === null ? receiptBlock(endpoint.safe) : null,
      finalized: endpoint.error === null ? receiptBlock(endpoint.finalized) : null,
      error: endpoint.error,
    })),
  };
  const expected = buildRpcQuorum(permutedReceipts, String(threshold));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `RPC and receipt quorum semantics diverged in case ${caseIndex}: `
      + `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
    );
  }
}

console.log(JSON.stringify({ status: "ok", differentialCases: CASES }));
