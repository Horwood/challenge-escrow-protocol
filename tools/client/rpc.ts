import type { BlockHeader } from "./observer.ts";

export type FinalityTag = "latest" | "safe" | "finalized";

export interface RpcHeadProvider {
  readonly getBlockNumber: () => Promise<bigint>;
  readonly getBlockByNumber: (blockNumber: bigint) => Promise<BlockHeader | null>;
  readonly getBlockByTag?: (tag: FinalityTag) => Promise<BlockHeader | null>;
}

export interface RpcEndpointSnapshot {
  readonly name: string;
  readonly latest: BlockHeader | null;
  readonly safe: BlockHeader | null;
  readonly finalized: BlockHeader | null;
  readonly error: string | null;
}

export interface RpcDivergenceReport {
  readonly schema: "challenge-escrow.rpc-observer/v1";
  readonly status: "agree" | "divergent" | "unavailable";
  readonly compared: readonly FinalityTag[];
  readonly divergenceAt: FinalityTag | null;
  readonly endpoints: readonly RpcEndpointSnapshot[];
}

export interface RpcProviderInput {
  readonly name: string;
  readonly provider: RpcHeadProvider;
}

export interface RpcQuorumGroup {
  readonly block: BlockHeader;
  readonly providers: readonly string[];
}

export interface RpcQuorumHead {
  readonly status: "agree" | "conflicted" | "unavailable";
  readonly agreed: BlockHeader | null;
  readonly supporters: readonly string[];
  readonly dissenters: readonly string[];
  readonly unavailable: readonly string[];
  readonly groups: readonly RpcQuorumGroup[];
}

export interface RpcQuorumReport {
  readonly schema: "challenge-escrow.rpc-quorum/v1";
  readonly status: "agree" | "conflicted" | "unavailable";
  readonly threshold: number;
  readonly compared: readonly FinalityTag[];
  readonly heads: Readonly<Record<FinalityTag, RpcQuorumHead>>;
  readonly endpoints: readonly RpcEndpointSnapshot[];
}

const MAX_UINT64 = (1n << 64n) - 1n;

function normalizedHeader(value: BlockHeader | null): BlockHeader | null {
  if (
    value === null
    || typeof value.number !== "bigint"
    || value.number < 0n
    || value.number > MAX_UINT64
    || !/^0x[0-9a-fA-F]{64}$/.test(value.hash)
    || !/^0x[0-9a-fA-F]{64}$/.test(value.parentHash)
  ) return null;
  return {
    number: value.number,
    hash: value.hash.toLowerCase() as BlockHeader["hash"],
    parentHash: value.parentHash.toLowerCase() as BlockHeader["parentHash"],
  };
}

function sameBlock(left: BlockHeader, right: BlockHeader): boolean {
  return left.number === right.number
    && left.hash === right.hash
    && left.parentHash === right.parentHash;
}

function coherentPair(newer: BlockHeader, older: BlockHeader): boolean {
  if (newer.number < older.number) return false;
  if (newer.number === older.number) return sameBlock(newer, older);
  if (newer.number === older.number + 1n) return newer.parentHash === older.hash;
  return true;
}

async function snapshot(name: string, provider: RpcHeadProvider): Promise<RpcEndpointSnapshot> {
  if (!provider.getBlockByTag) {
    return { name, latest: null, safe: null, finalized: null, error: "FINALITY_TAGS_UNAVAILABLE" };
  }
  try {
    const latestNumber = await provider.getBlockNumber();
    if (typeof latestNumber !== "bigint" || latestNumber < 0n || latestNumber > MAX_UINT64) {
      return { name, latest: null, safe: null, finalized: null, error: "MALFORMED_BLOCK_HEADER" };
    }
    const [rawLatest, rawSafe, rawFinalized] = await Promise.all([
      provider.getBlockByNumber(latestNumber),
      provider.getBlockByTag?.("safe") ?? Promise.resolve(null),
      provider.getBlockByTag?.("finalized") ?? Promise.resolve(null),
    ]);
    const latest = normalizedHeader(rawLatest);
    const safe = normalizedHeader(rawSafe);
    const finalized = normalizedHeader(rawFinalized);
    if (
      (rawLatest !== null && latest === null)
      || (rawSafe !== null && safe === null)
      || (rawFinalized !== null && finalized === null)
    ) return { name, latest: null, safe: null, finalized: null, error: "MALFORMED_BLOCK_HEADER" };
    if (latest && latest.number !== latestNumber) {
      return { name, latest: null, safe: null, finalized: null, error: "LATEST_NUMBER_MISMATCH" };
    }
    if (!latest) return { name, latest: null, safe: null, finalized: null, error: "LATEST_BLOCK_UNAVAILABLE" };
    const finalLatest = normalizedHeader(await provider.getBlockByNumber(latestNumber));
    if (!finalLatest || !sameBlock(finalLatest, latest)) {
      return { name, latest: null, safe: null, finalized: null, error: "LATEST_BLOCK_CHANGED" };
    }
    if (latest && safe && finalized && (finalized.number > safe.number || safe.number > latest.number)) {
      return { name, latest: null, safe: null, finalized: null, error: "FINALITY_ORDER_INVALID" };
    }
    if (latest && safe && finalized && (!coherentPair(latest, safe) || !coherentPair(safe, finalized))) {
      return { name, latest: null, safe: null, finalized: null, error: "FINALITY_CHAIN_INVALID" };
    }
    let error: string | null = null;
    if (!safe || !finalized) error ??= "FINALITY_TAGS_UNAVAILABLE";
    return { name, latest, safe, finalized, error };
  } catch {
    return { name, latest: null, safe: null, finalized: null, error: "RPC_READ_FAILED" };
  }
}

function providerName(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(value)) {
    throw new Error("RPC provider name must be an endpoint-neutral identifier");
  }
  return value;
}

function blockKey(block: BlockHeader): string {
  return `${block.number}:${block.hash.toLowerCase()}:${block.parentHash.toLowerCase()}`;
}

function quorumHead(
  endpoints: readonly RpcEndpointSnapshot[],
  tag: FinalityTag,
  threshold: number,
): RpcQuorumHead {
  const unavailable = endpoints
    .filter((endpoint) => endpoint.error !== null || endpoint[tag] === null)
    .map((endpoint) => endpoint.name)
    .sort();
  const grouped = new Map<string, { block: BlockHeader; providers: string[] }>();
  for (const endpoint of endpoints) {
    const block = endpoint.error === null ? endpoint[tag] : null;
    if (!block) continue;
    const key = blockKey(block);
    const group = grouped.get(key) ?? { block, providers: [] };
    group.providers.push(endpoint.name);
    grouped.set(key, group);
  }
  const groups = [...grouped.values()]
    .map((group) => ({ block: group.block, providers: group.providers.sort() }))
    .sort((left, right) => blockKey(left.block).localeCompare(blockKey(right.block)));
  const winning = groups.filter((group) => group.providers.length >= threshold);
  if (winning.length === 1) {
    const supporters = winning[0].providers;
    const supporterSet = new Set(supporters);
    return {
      status: "agree",
      agreed: winning[0].block,
      supporters,
      dissenters: groups.flatMap((group) => group.providers).filter((name) => !supporterSet.has(name)).sort(),
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

export async function compareRpcQuorum(
  providers: readonly RpcProviderInput[],
  threshold: number,
): Promise<RpcQuorumReport> {
  if (providers.length < 2 || providers.length > 16) {
    throw new Error("RPC quorum requires two to sixteen providers");
  }
  if (!Number.isSafeInteger(threshold) || threshold < 2 || threshold > providers.length) {
    throw new Error("RPC quorum threshold is outside the provider set");
  }
  if (threshold * 2 <= providers.length) {
    throw new Error("RPC quorum threshold must be a strict provider majority");
  }
  const names = providers.map((entry) => providerName(entry.name));
  if (new Set(names).size !== names.length) throw new Error("RPC provider names must be unique");
  const endpoints = (await Promise.all(providers.map((entry) => snapshot(entry.name, entry.provider))))
    .sort((left, right) => left.name.localeCompare(right.name));
  const tags: readonly FinalityTag[] = ["latest", "safe", "finalized"];
  const heads = {
    latest: quorumHead(endpoints, "latest", threshold),
    safe: quorumHead(endpoints, "safe", threshold),
    finalized: quorumHead(endpoints, "finalized", threshold),
  } as const;
  const values = tags.map((tag) => heads[tag].status);
  const status = values.includes("conflicted")
    ? "conflicted"
    : values.includes("unavailable")
      ? "unavailable"
      : "agree";
  return {
    schema: "challenge-escrow.rpc-quorum/v1",
    status,
    threshold,
    compared: tags,
    heads,
    endpoints,
  };
}

export async function compareRpcHeads(
  left: { readonly name: string; readonly provider: RpcHeadProvider },
  right: { readonly name: string; readonly provider: RpcHeadProvider },
): Promise<RpcDivergenceReport> {
  const report = await compareRpcQuorum([left, right], 2);
  const tags: FinalityTag[] = ["latest", "safe", "finalized"];
  const divergenceAt = tags.find((tag) => report.heads[tag].status === "conflicted") ?? null;
  const status = report.status === "agree"
    ? "agree"
    : report.status === "conflicted"
      ? "divergent"
      : "unavailable";
  return { schema: "challenge-escrow.rpc-observer/v1", status, compared: tags, divergenceAt, endpoints: report.endpoints };
}
