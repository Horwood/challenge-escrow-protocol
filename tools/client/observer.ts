import type { Address, Hex, ReadProvider } from "./index.ts";

export interface BlockHeader {
  readonly number: bigint;
  readonly hash: Hex;
  readonly parentHash: Hex;
}

export interface ProtocolLog {
  readonly address: Address;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionIndex: bigint;
  readonly logIndex: bigint;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly removed?: boolean;
}

export interface ChainReadProvider extends ReadProvider {
  getBlockNumber(): Promise<bigint>;
  getBlockByNumber(blockNumber: bigint): Promise<BlockHeader | null>;
  getLogs(request: { readonly address: Address; readonly fromBlock: bigint; readonly toBlock: bigint }): Promise<readonly ProtocolLog[]>;
}

export interface SyncResult {
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  readonly commonAncestor: bigint | null;
  readonly reorgDepth: bigint;
  readonly addedLogs: number;
  readonly removedLogs: number;
  readonly headHash: Hex;
}

export interface Reconciliation<T> {
  readonly head: BlockHeader;
  readonly directState: T;
  readonly observedLogs: readonly ProtocolLog[];
}

function fail(message: string): never {
  throw new Error(`reorg-observer: ${message}`);
}

function compareLogs(left: ProtocolLog, right: ProtocolLog): number {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
  if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex < right.transactionIndex ? -1 : 1;
  if (left.logIndex !== right.logIndex) return left.logIndex < right.logIndex ? -1 : 1;
  return 0;
}

function eventKey(log: ProtocolLog): string {
  return `${log.blockHash}:${log.transactionIndex}:${log.logIndex}`.toLowerCase();
}

function copyLog(log: ProtocolLog): ProtocolLog {
  return { ...log, topics: [...log.topics] };
}

export class ReorgSafeObserver {
  readonly #provider: ChainReadProvider;
  readonly #address: Address;
  readonly #deploymentBlock: bigint;
  readonly #headers = new Map<bigint, BlockHeader>();
  readonly #logs = new Map<string, ProtocolLog>();
  #head: BlockHeader | null = null;

  constructor(provider: ChainReadProvider, address: Address, deploymentBlock: bigint) {
    if (deploymentBlock < 0n) fail("deployment block cannot be negative");
    this.#provider = provider;
    this.#address = address;
    this.#deploymentBlock = deploymentBlock;
  }

  get head(): BlockHeader | null {
    return this.#head;
  }

  get logs(): readonly ProtocolLog[] {
    return [...this.#logs.values()].sort(compareLogs).map(copyLog);
  }

  async sync(): Promise<SyncResult> {
    const latestNumber = await this.#provider.getBlockNumber();
    const latest = await this.#provider.getBlockByNumber(latestNumber);
    if (!latest) fail(`head block ${latestNumber} is unavailable`);
    const previousHead = this.#head;
    const ancestor = previousHead ? await this.#findCommonAncestor(latest) : null;
    const retainedBlock = ancestor?.number ?? this.#deploymentBlock - 1n;
    const fromBlock = retainedBlock + 1n;
    const reorgDepth = previousHead ? previousHead.number - retainedBlock : 0n;
    let removedLogs = 0;
    for (const [number] of this.#headers) {
      if (number > retainedBlock) this.#headers.delete(number);
    }
    for (const [key, log] of this.#logs) {
      if (log.blockNumber > retainedBlock) {
        this.#logs.delete(key);
        removedLogs += 1;
      }
    }
    const headers = await this.#loadHeaders(fromBlock, latest.number);
    for (const header of headers) this.#headers.set(header.number, header);
    const fetched = fromBlock <= latest.number
      ? await this.#provider.getLogs({ address: this.#address, fromBlock, toBlock: latest.number })
      : [];
    let addedLogs = 0;
    for (const log of fetched) {
      if (log.removed) {
        if (this.#logs.delete(eventKey(log))) removedLogs += 1;
        continue;
      }
      const header = this.#headers.get(log.blockNumber);
      if (!header || header.hash.toLowerCase() !== log.blockHash.toLowerCase()) {
        fail(`log ${eventKey(log)} is not anchored to the canonical block header`);
      }
      const key = eventKey(log);
      if (!this.#logs.has(key)) {
        this.#logs.set(key, copyLog(log));
        addedLogs += 1;
      }
    }
    this.#head = latest;
    return {
      fromBlock,
      toBlock: latest.number,
      commonAncestor: ancestor?.number ?? null,
      reorgDepth,
      addedLogs,
      removedLogs,
      headHash: latest.hash,
    };
  }

  async reconcile<T>(readDirectState: () => Promise<T>): Promise<Reconciliation<T>> {
    if (!this.#head) await this.sync();
    if (!this.#head) fail("observer has no head after sync");
    return { head: this.#head, directState: await readDirectState(), observedLogs: this.logs };
  }

  async #findCommonAncestor(latest: BlockHeader): Promise<BlockHeader | null> {
    let candidate: BlockHeader | null = latest;
    while (candidate && candidate.number >= this.#deploymentBlock - 1n) {
      const known = this.#headers.get(candidate.number);
      if (known && known.hash.toLowerCase() === candidate.hash.toLowerCase()) return candidate;
      if (candidate.number === 0n) break;
      candidate = await this.#provider.getBlockByNumber(candidate.number - 1n);
    }
    return null;
  }

  async #loadHeaders(fromBlock: bigint, toBlock: bigint): Promise<readonly BlockHeader[]> {
    if (fromBlock > toBlock) return [];
    const headers: BlockHeader[] = [];
    for (let number = fromBlock; number <= toBlock; number += 1n) {
      const header = await this.#provider.getBlockByNumber(number);
      if (!header) fail(`block ${number} is unavailable`);
      headers.push(header);
    }
    return headers;
  }
}
