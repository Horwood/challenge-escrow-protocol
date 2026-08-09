import type { Address, Hex, ReadProvider } from "./index.ts";
import { projectProtocolLogs, type ObserverEvidenceRecord } from "./projector.ts";

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

export interface ObserverLimits {
  readonly maxBlockSpan?: bigint;
  readonly maxReorgDepth?: bigint;
  readonly maxLogsPerSync?: number;
  readonly maxLogDataBytes?: number;
  readonly maxRetainedHeaders?: number;
  readonly maxRetainedLogs?: number;
}

interface NormalizedObserverLimits {
  readonly maxBlockSpan: bigint;
  readonly maxReorgDepth: bigint;
  readonly maxLogsPerSync: number;
  readonly maxLogDataBytes: number;
  readonly maxRetainedHeaders: number;
  readonly maxRetainedLogs: number;
}

function fail(message: string): never {
  throw new Error(`reorg-observer: ${message}`);
}

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const DATA_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;
const MAX_UINT64 = (1n << 64n) - 1n;

function copyHeader(header: BlockHeader): BlockHeader {
  return { ...header };
}

function normalizeHeader(value: BlockHeader | null, expectedNumber: bigint, label: string): BlockHeader {
  if (!value) fail(`${label} ${expectedNumber} is unavailable`);
  if (
    typeof value.number !== "bigint"
    || value.number !== expectedNumber
    || value.number < 0n
    || value.number > MAX_UINT64
    || !HASH_PATTERN.test(value.hash)
    || !HASH_PATTERN.test(value.parentHash)
  ) fail(`${label} ${expectedNumber} is malformed`);
  return {
    number: value.number,
    hash: value.hash.toLowerCase() as Hex,
    parentHash: value.parentHash.toLowerCase() as Hex,
  };
}

function sameHeader(left: BlockHeader, right: BlockHeader): boolean {
  return left.number === right.number
    && left.hash.toLowerCase() === right.hash.toLowerCase()
    && left.parentHash.toLowerCase() === right.parentHash.toLowerCase();
}

function extendsHeader(child: BlockHeader, parent: BlockHeader): boolean {
  return child.number === parent.number + 1n
    && child.parentHash.toLowerCase() === parent.hash.toLowerCase();
}

function compareLogs(left: ProtocolLog, right: ProtocolLog): number {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
  if (left.transactionIndex !== right.transactionIndex) return left.transactionIndex < right.transactionIndex ? -1 : 1;
  if (left.logIndex !== right.logIndex) return left.logIndex < right.logIndex ? -1 : 1;
  return 0;
}

function eventKey(log: ProtocolLog): string {
  return `${log.blockHash}:${log.logIndex}`.toLowerCase();
}

function copyLog(log: ProtocolLog): ProtocolLog {
  return {
    address: log.address.toLowerCase() as Address,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash.toLowerCase() as Hex,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
    topics: log.topics.map((topic) => topic.toLowerCase() as Hex),
    data: log.data.toLowerCase() as Hex,
  };
}

function normalizeLog(
  log: ProtocolLog,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
  maxLogDataBytes: number,
): ProtocolLog {
  if (!log || typeof log !== "object") fail("provider returned a malformed log");
  if (log.removed !== undefined && log.removed !== false) fail("provider returned an invalid removed marker");
  if (
    typeof log.address !== "string"
    || !ADDRESS_PATTERN.test(log.address)
    || log.address.toLowerCase() !== address.toLowerCase()
  ) fail("provider returned a log for another contract");
  if (typeof log.blockNumber !== "bigint" || log.blockNumber < fromBlock || log.blockNumber > toBlock) {
    fail("provider returned a log outside the requested block range");
  }
  if (
    !HASH_PATTERN.test(log.blockHash)
    || typeof log.transactionIndex !== "bigint"
    || log.transactionIndex < 0n
    || log.transactionIndex > MAX_UINT64
    || typeof log.logIndex !== "bigint"
    || log.logIndex < 0n
    || log.logIndex > MAX_UINT64
    || !Array.isArray(log.topics)
    || log.topics.length < 1
    || log.topics.length > 4
    || log.topics.some((topic) => typeof topic !== "string" || !HASH_PATTERN.test(topic))
    || typeof log.data !== "string"
    || !DATA_PATTERN.test(log.data)
    || (log.data.length - 2) / 2 > maxLogDataBytes
  ) fail("provider returned a malformed log");
  return copyLog(log);
}

function positiveBigInt(value: bigint | undefined, fallback: bigint, label: string): bigint {
  const normalized = value ?? fallback;
  if (typeof normalized !== "bigint" || normalized <= 0n || normalized > 1_000_000n) {
    fail(`${label} must be between one and one million`);
  }
  return normalized;
}

function positiveInteger(value: number | undefined, fallback: number, maximum: number, label: string): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized <= 0 || normalized > maximum) {
    fail(`${label} must be a positive safe integer no greater than ${maximum}`);
  }
  return normalized;
}

function sameLog(left: ProtocolLog, right: ProtocolLog): boolean {
  return left.address === right.address
    && left.blockNumber === right.blockNumber
    && left.blockHash === right.blockHash
    && left.transactionIndex === right.transactionIndex
    && left.logIndex === right.logIndex
    && left.data === right.data
    && left.topics.length === right.topics.length
    && left.topics.every((topic, index) => topic === right.topics[index]);
}

export class ReorgSafeObserver {
  readonly #provider: ChainReadProvider;
  readonly #address: Address;
  readonly #deploymentBlock: bigint;
  readonly #limits: NormalizedObserverLimits;
  readonly #headers = new Map<bigint, BlockHeader>();
  readonly #logs = new Map<string, ProtocolLog>();
  #head: BlockHeader | null = null;
  #syncPromise: Promise<SyncResult> | null = null;

  constructor(
    provider: ChainReadProvider,
    address: Address,
    deploymentBlock: bigint,
    limits: ObserverLimits = {},
  ) {
    if (typeof deploymentBlock !== "bigint" || deploymentBlock < 0n || deploymentBlock > MAX_UINT64) fail("deployment block must fit uint64");
    if (typeof address !== "string" || !ADDRESS_PATTERN.test(address)) fail("contract address is malformed");
    this.#provider = provider;
    this.#address = address.toLowerCase() as Address;
    this.#deploymentBlock = deploymentBlock;
    const maxBlockSpan = positiveBigInt(limits.maxBlockSpan, 10_000n, "maximum block span");
    const maxReorgDepth = positiveBigInt(limits.maxReorgDepth, 512n, "maximum reorg depth");
    const maxRetainedHeaders = positiveInteger(
      limits.maxRetainedHeaders,
      Math.max(2_048, Number(maxReorgDepth) + 1),
      1_000_001,
      "maximum retained headers",
    );
    if (BigInt(maxRetainedHeaders) <= maxReorgDepth) fail("retained headers must exceed the maximum reorg depth");
    this.#limits = {
      maxBlockSpan,
      maxReorgDepth,
      maxLogsPerSync: positiveInteger(limits.maxLogsPerSync, 50_000, 1_000_000, "maximum logs per sync"),
      maxLogDataBytes: positiveInteger(limits.maxLogDataBytes, 4_096, 1_048_576, "maximum log data bytes"),
      maxRetainedHeaders,
      maxRetainedLogs: positiveInteger(limits.maxRetainedLogs, 250_000, 1_000_000, "maximum retained logs"),
    };
  }

  get head(): BlockHeader | null {
    return this.#head ? copyHeader(this.#head) : null;
  }

  get logs(): readonly ProtocolLog[] {
    return [...this.#logs.values()].sort(compareLogs).map(copyLog);
  }

  async sync(): Promise<SyncResult> {
    if (this.#syncPromise) return this.#syncPromise;
    const pending = this.#syncOnce();
    this.#syncPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.#syncPromise === pending) this.#syncPromise = null;
    }
  }

  async #syncOnce(): Promise<SyncResult> {
    const latestNumber = await this.#provider.getBlockNumber();
    if (typeof latestNumber !== "bigint" || latestNumber < this.#deploymentBlock || latestNumber > MAX_UINT64) {
      fail("provider head is before the configured deployment block");
    }
    const previousHead = this.#head ? copyHeader(this.#head) : null;
    if (!previousHead && latestNumber - this.#deploymentBlock + 1n > this.#limits.maxBlockSpan) {
      fail("initial synchronization exceeds the configured block span");
    }
    if (previousHead && latestNumber > previousHead.number + this.#limits.maxBlockSpan) {
      fail("synchronization exceeds the configured block span");
    }
    if (previousHead && previousHead.number > latestNumber + this.#limits.maxReorgDepth) {
      fail("provider head exceeds the configured rollback depth");
    }
    const latest = normalizeHeader(
      await this.#provider.getBlockByNumber(latestNumber),
      latestNumber,
      "head block",
    );
    const ancestor = previousHead ? await this.#findCommonAncestor(latest) : null;
    const retainedBlock = ancestor?.number ?? this.#deploymentBlock - 1n;
    const fromBlock = retainedBlock + 1n;
    const reorgDepth = previousHead ? previousHead.number - retainedBlock : 0n;
    if (reorgDepth > this.#limits.maxReorgDepth) {
      fail("common ancestor exceeds the configured reorg depth");
    }

    const nextHeaders = new Map(this.#headers);
    let removedLogs = 0;
    for (const [number] of nextHeaders) {
      if (number > retainedBlock) nextHeaders.delete(number);
    }
    const nextLogs = new Map(this.#logs);
    for (const [key, log] of nextLogs) {
      if (log.blockNumber > retainedBlock) {
        nextLogs.delete(key);
        removedLogs += 1;
      }
    }

    const headers = await this.#loadHeaders(fromBlock, latest.number, ancestor);
    for (const header of headers) nextHeaders.set(header.number, header);
    if (headers.length > 0 && !sameHeader(headers[headers.length - 1], latest)) {
      fail("provider head changed while headers were loaded");
    }
    const fetched = fromBlock <= latest.number
      ? await this.#provider.getLogs({ address: this.#address, fromBlock, toBlock: latest.number })
      : [];
    if (!Array.isArray(fetched) || fetched.length > this.#limits.maxLogsPerSync) {
      fail("provider returned too many logs for one synchronization");
    }
    let addedLogs = 0;
    for (const rawLog of fetched) {
      if (rawLog?.removed === true) continue;
      const log = normalizeLog(
        rawLog,
        this.#address,
        fromBlock,
        latest.number,
        this.#limits.maxLogDataBytes,
      );
      const header = nextHeaders.get(log.blockNumber);
      if (!header || header.hash !== log.blockHash) {
        fail(`log ${eventKey(log)} is not anchored to the validated block header`);
      }
      const key = eventKey(log);
      const existing = nextLogs.get(key);
      if (existing && !sameLog(existing, log)) fail(`log ${key} has conflicting payloads`);
      if (!existing) {
        nextLogs.set(key, log);
        addedLogs += 1;
      }
    }
    if (nextLogs.size > this.#limits.maxRetainedLogs) {
      fail("retained log history exceeds the configured limit");
    }

    const finalAnchor = normalizeHeader(
      await this.#provider.getBlockByNumber(latest.number),
      latest.number,
      "final head block",
    );
    if (!sameHeader(finalAnchor, latest)) fail("provider head changed while logs were loaded");

    const earliestRetainedHeader = latest.number - BigInt(this.#limits.maxRetainedHeaders) + 1n;
    for (const [number] of nextHeaders) {
      if (number < earliestRetainedHeader) nextHeaders.delete(number);
    }

    this.#headers.clear();
    for (const [number, header] of nextHeaders) this.#headers.set(number, header);
    this.#logs.clear();
    for (const [key, log] of nextLogs) this.#logs.set(key, log);
    this.#head = copyHeader(latest);
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

  async reconcile<T>(readDirectState: (head: BlockHeader) => Promise<T>): Promise<Reconciliation<T>> {
    if (this.#syncPromise) await this.#syncPromise;
    if (!this.#head) await this.sync();
    if (!this.#head) fail("observer has no head after sync");
    const head = copyHeader(this.#head);
    const observedLogs = this.logs;
    const directState = await readDirectState(head);
    const finalAnchor = normalizeHeader(
      await this.#provider.getBlockByNumber(head.number),
      head.number,
      "reconciliation head block",
    );
    if (!sameHeader(finalAnchor, head)) fail("provider head changed while direct state was read");
    return { head, directState, observedLogs };
  }

  async evidence(options: { readonly safe?: BlockHeader | null; readonly finalized?: BlockHeader | null } = {}): Promise<ObserverEvidenceRecord> {
    if (this.#syncPromise) await this.#syncPromise;
    if (!this.#head) await this.sync();
    if (!this.#head) fail("observer has no head after sync");
    return projectProtocolLogs(this.logs, this.#head, options);
  }

  async #findCommonAncestor(latest: BlockHeader): Promise<BlockHeader | null> {
    let candidate = copyHeader(latest);
    let traversed = 0n;
    while (candidate.number >= this.#deploymentBlock - 1n) {
      const known = this.#headers.get(candidate.number);
      if (known && sameHeader(known, candidate)) return candidate;
      if (candidate.number === 0n) break;
      traversed += 1n;
      if (traversed > this.#limits.maxBlockSpan + this.#limits.maxReorgDepth) {
        fail("common-ancestor search exceeded the configured traversal limit");
      }
      const parent = normalizeHeader(
        await this.#provider.getBlockByNumber(candidate.number - 1n),
        candidate.number - 1n,
        "ancestor block",
      );
      if (!extendsHeader(candidate, parent)) fail(`block ${candidate.number} does not extend its reported parent`);
      candidate = parent;
    }
    return null;
  }

  async #loadHeaders(
    fromBlock: bigint,
    toBlock: bigint,
    retained: BlockHeader | null,
  ): Promise<readonly BlockHeader[]> {
    if (fromBlock > toBlock) return [];
    const headers: BlockHeader[] = [];
    let previous = retained;
    for (let number = fromBlock; number <= toBlock; number += 1n) {
      const header = normalizeHeader(
        await this.#provider.getBlockByNumber(number),
        number,
        "block",
      );
      if (previous && !extendsHeader(header, previous)) fail(`block ${number} does not extend block ${previous.number}`);
      headers.push(header);
      previous = header;
    }
    return headers;
  }
}
