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

function sameBlock(left: BlockHeader | null, right: BlockHeader | null): boolean {
  if (!left || !right) return left === right;
  return left.number === right.number && left.hash.toLowerCase() === right.hash.toLowerCase();
}

async function snapshot(name: string, provider: RpcHeadProvider): Promise<RpcEndpointSnapshot> {
  if (!provider.getBlockByTag) {
    return { name, latest: null, safe: null, finalized: null, error: "safe and finalized block tags are unavailable" };
  }
  try {
    const latestNumber = await provider.getBlockNumber();
    const [latest, safe, finalized] = await Promise.all([
      provider.getBlockByNumber(latestNumber),
      provider.getBlockByTag?.("safe") ?? Promise.resolve(null),
      provider.getBlockByTag?.("finalized") ?? Promise.resolve(null),
    ]);
    let error: string | null = latest ? null : `latest block ${latestNumber} is unavailable`;
    if (!safe || !finalized) error ??= "safe and finalized block tags are unavailable";
    return { name, latest, safe, finalized, error };
  } catch (error) {
    return { name, latest: null, safe: null, finalized: null, error: String(error) };
  }
}

export async function compareRpcHeads(
  left: { readonly name: string; readonly provider: RpcHeadProvider },
  right: { readonly name: string; readonly provider: RpcHeadProvider },
): Promise<RpcDivergenceReport> {
  const endpoints = await Promise.all([snapshot(left.name, left.provider), snapshot(right.name, right.provider)]);
  if (endpoints.some((endpoint) => endpoint.error !== null)) {
    return { schema: "challenge-escrow.rpc-observer/v1", status: "unavailable", compared: ["latest", "safe", "finalized"], divergenceAt: null, endpoints };
  }
  const tags: FinalityTag[] = ["latest", "safe", "finalized"];
  const divergenceAt = tags.find((tag) => !sameBlock(endpoints[0][tag], endpoints[1][tag])) ?? null;
  return { schema: "challenge-escrow.rpc-observer/v1", status: divergenceAt ? "divergent" : "agree", compared: tags, divergenceAt, endpoints };
}
