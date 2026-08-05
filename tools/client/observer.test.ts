import type { Address, Hex, ReadContractRequest } from "./index.ts";
import { ReorgSafeObserver, type BlockHeader, type ChainReadProvider, type ProtocolLog } from "./observer.ts";

const address = "0x1111111111111111111111111111111111111111" as Address;
const hash = (letter: string): Hex => `0x${letter.repeat(64)}` as Hex;
const data = "0x" as Hex;

function chain(letter: string, numbers: number[]): Map<bigint, BlockHeader> {
  const result = new Map<bigint, BlockHeader>();
  let parent = hash("0");
  for (const number of numbers) {
    const header = { number: BigInt(number), hash: hash(letter), parentHash: parent };
    result.set(header.number, header);
    parent = header.hash;
  }
  return result;
}

const canonicalA = chain("a", [0, 1, 2, 3]);
const canonicalB = chain("b", [0, 1, 2, 3]);
const common2 = { number: 2n, hash: hash("c"), parentHash: hash("1") };
canonicalA.set(2n, common2);
canonicalB.set(2n, common2);
canonicalA.set(3n, { number: 3n, hash: hash("d"), parentHash: common2.hash });
canonicalB.set(3n, { number: 3n, hash: hash("e"), parentHash: common2.hash });
canonicalA.set(4n, { number: 4n, hash: hash("f"), parentHash: canonicalA.get(3n)!.hash });
canonicalB.set(4n, { number: 4n, hash: hash("g"), parentHash: canonicalB.get(3n)!.hash });

const log = (block: BlockHeader, index: number): ProtocolLog => ({
  address,
  blockNumber: block.number,
  blockHash: block.hash,
  transactionIndex: 0n,
  logIndex: BigInt(index),
  topics: [hash("1")],
  data,
});

let active = canonicalA;
const calls: ReadContractRequest[] = [];
const provider: ChainReadProvider = {
  async readContract<T>(request: ReadContractRequest): Promise<T> {
    calls.push(request);
    return undefined as T;
  },
  async getBlockNumber(): Promise<bigint> { return 4n; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> { return active.get(number) ?? null; },
  async getLogs(request): Promise<readonly ProtocolLog[]> {
    const logs: ProtocolLog[] = [];
    for (let number = request.fromBlock; number <= request.toBlock; number += 1n) {
      const header = active.get(number);
      if (header) logs.push(log(header, Number(number)));
    }
    return logs;
  },
};

const observer = new ReorgSafeObserver(provider, address, 1n);
const first = await observer.sync();
if (first.addedLogs !== 4 || observer.logs.length !== 4) throw new Error("initial observer sync failed");
active = canonicalB;
const second = await observer.sync();
if (second.commonAncestor !== 2n || second.reorgDepth !== 2n || second.removedLogs !== 2 || second.addedLogs !== 2) {
  throw new Error("reorg reconciliation failed");
}
if (observer.logs.length !== 4 || observer.logs.some((entry) => entry.blockHash === hash("d") || entry.blockHash === hash("f"))) {
  throw new Error("stale reorged logs survived");
}
const reconciliation = await observer.reconcile(async () => ({ liability: 0n }));
if (reconciliation.head.hash !== hash("g") || reconciliation.observedLogs.length !== 4) throw new Error("direct-state reconciliation failed");
if (calls.length !== 0) throw new Error("observer called a write-capable provider method");

async function expectFailure(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!String(error).includes(message)) {
      throw new Error(`wrong observer failure: expected ${message}, got ${String(error)}`);
    }
    return;
  }
  throw new Error(`observer unexpectedly accepted ${message}`);
}

const duplicateHeader = canonicalB.get(1n)!;
const duplicateProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return 1n; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> {
    return number === 1n ? duplicateHeader : null;
  },
  async getLogs(): Promise<readonly ProtocolLog[]> {
    const duplicate = log(duplicateHeader, 0);
    return [duplicate, { ...duplicate, topics: [...duplicate.topics] }];
  },
};
const duplicateObserver = new ReorgSafeObserver(duplicateProvider, address, 1n);
const duplicateSync = await duplicateObserver.sync();
if (duplicateSync.addedLogs !== 1 || duplicateObserver.logs.length !== 1) {
  throw new Error("duplicate event identity was not collapsed");
}

const badHeader = canonicalB.get(1n)!;
const wrongHashProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return 1n; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> {
    return number === 1n ? badHeader : null;
  },
  async getLogs(): Promise<readonly ProtocolLog[]> {
    return [{ ...log(badHeader, 0), blockHash: hash("z") }];
  },
};
await expectFailure(
  () => new ReorgSafeObserver(wrongHashProvider, address, 1n).sync(),
  "not anchored",
);

const unavailableProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return 2n; },
  async getBlockByNumber(): Promise<BlockHeader | null> { return null; },
  async getLogs(): Promise<readonly ProtocolLog[]> { return []; },
};
await expectFailure(
  () => new ReorgSafeObserver(unavailableProvider, address, 1n).sync(),
  "head block 2 is unavailable",
);

let removedHead = 1n;
const removedHeaders = new Map<bigint, BlockHeader>([
  [1n, { number: 1n, hash: hash("h"), parentHash: hash("0") }],
  [2n, { number: 2n, hash: hash("i"), parentHash: hash("h") }],
]);
const removedProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return removedHead; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> {
    return removedHeaders.get(number) ?? null;
  },
  async getLogs(request): Promise<readonly ProtocolLog[]> {
    const result: ProtocolLog[] = [];
    for (let number = request.fromBlock; number <= request.toBlock; number += 1n) {
      const header = removedHeaders.get(number);
      if (!header) continue;
      const entry = log(header, Number(number));
      result.push(removedHead === 2n && number === 2n ? { ...entry, removed: true } : entry);
    }
    return result;
  },
};
const removedObserver = new ReorgSafeObserver(removedProvider, address, 1n);
await removedObserver.sync();
removedHead = 2n;
const removedSync = await removedObserver.sync();
if (removedSync.addedLogs !== 0 || removedObserver.logs.some((entry) => entry.blockNumber === 2n)) {
  throw new Error("provider removed log was not ignored safely");
}

const omissionProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return 1n; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> {
    return number === 1n ? removedHeaders.get(1n)! : null;
  },
  async getLogs(): Promise<readonly ProtocolLog[]> { return []; },
};
const omissionObserver = new ReorgSafeObserver(omissionProvider, address, 1n);
const omitted = await omissionObserver.reconcile(async () => ({ liability: 7n }));
if (omitted.observedLogs.length !== 0 || omitted.directState.liability !== 7n) {
  throw new Error("event omission was allowed to invent direct financial state");
}

let negativeDeploymentRejected = false;
try {
  new ReorgSafeObserver(provider, address, -1n);
} catch (error) {
  negativeDeploymentRejected = String(error).includes("deployment block cannot be negative");
}
if (!negativeDeploymentRejected) throw new Error("negative deployment block was accepted");

console.log(JSON.stringify({
  status: "ok",
  firstAdded: first.addedLogs,
  reorgDepth: second.reorgDepth.toString(),
  canonicalLogs: observer.logs.length,
  duplicateAdded: duplicateSync.addedLogs,
  removedAdded: removedSync.addedLogs,
}));
