import type { Address, Hex, ReadContractRequest } from "./index.ts";
import { ReorgSafeObserver, type BlockHeader, type ChainReadProvider, type ProtocolLog } from "./observer.ts";

const address = "0x1111111111111111111111111111111111111111" as Address;
const hash = (letter: string): Hex => `0x${letter.repeat(64)}` as Hex;
const data = "0x" as Hex;

const genesis = { number: 0n, hash: hash("0"), parentHash: hash("0") };
const common1 = { number: 1n, hash: hash("1"), parentHash: genesis.hash };
const common2 = { number: 2n, hash: hash("c"), parentHash: common1.hash };
const branchA3 = { number: 3n, hash: hash("d"), parentHash: common2.hash };
const branchA4 = { number: 4n, hash: hash("f"), parentHash: branchA3.hash };
const branchB3 = { number: 3n, hash: hash("e"), parentHash: common2.hash };
const branchB4 = { number: 4n, hash: hash("9"), parentHash: branchB3.hash };
const canonicalA = new Map<bigint, BlockHeader>([
  [0n, genesis], [1n, common1], [2n, common2], [3n, branchA3], [4n, branchA4],
]);
const canonicalB = new Map<bigint, BlockHeader>([
  [0n, genesis], [1n, common1], [2n, common2], [3n, branchB3], [4n, branchB4],
]);

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
if (observer.logs.length !== 4 || observer.logs.some((entry) => entry.blockHash === branchA3.hash || entry.blockHash === branchA4.hash)) {
  throw new Error("stale reorged logs survived");
}
const reconciliation = await observer.reconcile(async () => ({ liability: 0n }));
if (reconciliation.head.hash !== branchB4.hash || reconciliation.observedLogs.length !== 4) throw new Error("direct-state reconciliation failed");
if (calls.length !== 0) throw new Error("observer called a write-capable provider method");

let directReadStarted = false;
const movingReconciliationProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return 1n; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> {
    if (number !== 1n) return null;
    return directReadStarted
      ? { ...common1, hash: hash("a") }
      : common1;
  },
  async getLogs(): Promise<readonly ProtocolLog[]> { return []; },
};
const movingReconciliationObserver = new ReorgSafeObserver(movingReconciliationProvider, address, 1n);
await movingReconciliationObserver.sync();
let movingReconciliationRejected = false;
try {
  await movingReconciliationObserver.reconcile(async () => {
    directReadStarted = true;
    return { liability: 0n };
  });
} catch (error) {
  movingReconciliationRejected = String(error).includes("direct state was read");
}
if (!movingReconciliationRejected) throw new Error("reorganization during direct-state reconciliation was accepted");

let concurrentHeadReads = 0;
let releaseConcurrentHead!: () => void;
const concurrentGate = new Promise<void>((resolve) => { releaseConcurrentHead = resolve; });
const concurrentProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> {
    concurrentHeadReads += 1;
    await concurrentGate;
    return 1n;
  },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> {
    return number === 1n ? common1 : null;
  },
  async getLogs(): Promise<readonly ProtocolLog[]> { return []; },
};
const concurrentObserver = new ReorgSafeObserver(concurrentProvider, address, 1n);
const concurrentFirst = concurrentObserver.sync();
const concurrentSecond = concurrentObserver.sync();
releaseConcurrentHead();
const [concurrentFirstResult, concurrentSecondResult] = await Promise.all([
  concurrentFirst,
  concurrentSecond,
]);
if (
  concurrentHeadReads !== 1
  || concurrentFirstResult.headHash !== concurrentSecondResult.headHash
  || concurrentObserver.head?.number !== 1n
) throw new Error("concurrent observer synchronization was not serialized");

let snapshotHead = 1n;
const snapshotProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return snapshotHead; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> {
    return number === 1n ? common1 : number === 2n ? common2 : null;
  },
  async getLogs(request): Promise<readonly ProtocolLog[]> {
    const result: ProtocolLog[] = [];
    for (let number = request.fromBlock; number <= request.toBlock; number += 1n) {
      const header = number === 1n ? common1 : number === 2n ? common2 : null;
      if (header) result.push(log(header, Number(number)));
    }
    return result;
  },
};
const snapshotObserver = new ReorgSafeObserver(snapshotProvider, address, 1n);
await snapshotObserver.sync();
const stableReconciliation = await snapshotObserver.reconcile(async (head) => {
  snapshotHead = 2n;
  await snapshotObserver.sync();
  return { readAt: head.number };
});
if (
  stableReconciliation.head.number !== 1n
  || stableReconciliation.directState.readAt !== 1n
  || stableReconciliation.observedLogs.length !== 1
  || snapshotObserver.head?.number !== 2n
) throw new Error("reconciliation mixed logs from a later observer snapshot");

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
    return [{ ...log(badHeader, 0), blockHash: hash("6") }];
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
  [1n, { number: 1n, hash: hash("7"), parentHash: hash("0") }],
  [2n, { number: 2n, hash: hash("8"), parentHash: hash("7") }],
]);
const removedProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return removedHead; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> {
    return removedHeaders.get(number) ?? null;
  },
  async getLogs(request): Promise<readonly ProtocolLog[]> {
    if (removedHead === 2n) {
      return [
        { ...log(removedHeaders.get(1n)!, 1), removed: true },
        log(removedHeaders.get(2n)!, 2),
      ];
    }
    const result: ProtocolLog[] = [];
    for (let number = request.fromBlock; number <= request.toBlock; number += 1n) {
      const header = removedHeaders.get(number);
      if (!header) continue;
      result.push(log(header, Number(number)));
    }
    return result;
  },
};
const removedObserver = new ReorgSafeObserver(removedProvider, address, 1n);
await removedObserver.sync();
removedHead = 2n;
const removedSync = await removedObserver.sync();
if (removedSync.addedLogs !== 1 || removedObserver.logs.length !== 2 || removedObserver.logs.some((entry) => entry.removed)) {
  throw new Error("provider removed log was not ignored safely");
}

const conflictingDuplicateProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return 1n; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> {
    return number === 1n ? duplicateHeader : null;
  },
  async getLogs(): Promise<readonly ProtocolLog[]> {
    const first = log(duplicateHeader, 0);
    return [first, { ...first, data: "0x00" as Hex }];
  },
};
await expectFailure(
  () => new ReorgSafeObserver(conflictingDuplicateProvider, address, 1n).sync(),
  "conflicting payloads",
);

const conflictingPositionProvider: ChainReadProvider = {
  ...conflictingDuplicateProvider,
  async getLogs(): Promise<readonly ProtocolLog[]> {
    const first = log(duplicateHeader, 0);
    return [first, { ...first, transactionIndex: 1n }];
  },
};
await expectFailure(
  () => new ReorgSafeObserver(conflictingPositionProvider, address, 1n).sync(),
  "conflicting payloads",
);

const disconnectedHeaders = new Map<bigint, BlockHeader>([
  [1n, removedHeaders.get(1n)!],
  [2n, { number: 2n, hash: hash("8"), parentHash: hash("6") }],
]);
const disconnectedProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return 2n; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> { return disconnectedHeaders.get(number) ?? null; },
  async getLogs(): Promise<readonly ProtocolLog[]> { return []; },
};
await expectFailure(
  () => new ReorgSafeObserver(disconnectedProvider, address, 1n).sync(),
  "does not extend",
);

let atomicHead = 1n;
const otherAddress = "0x2222222222222222222222222222222222222222" as Address;
const atomicProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return atomicHead; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> { return removedHeaders.get(number) ?? null; },
  async getLogs(request): Promise<readonly ProtocolLog[]> {
    if (request.toBlock === 1n) return [log(removedHeaders.get(1n)!, 1)];
    return [{ ...log(removedHeaders.get(2n)!, 2), address: otherAddress }];
  },
};
const atomicObserver = new ReorgSafeObserver(atomicProvider, address, 1n);
await atomicObserver.sync();
atomicHead = 2n;
await expectFailure(() => atomicObserver.sync(), "another contract");
if (atomicObserver.head?.number !== 1n || atomicObserver.logs.length !== 1) {
  throw new Error("failed synchronization mutated the accepted observer snapshot");
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
  negativeDeploymentRejected = String(error).includes("deployment block must fit uint64");
}
if (!negativeDeploymentRejected) throw new Error("negative deployment block was accepted");

await expectFailure(
  () => new ReorgSafeObserver(provider, address, 1n, { maxBlockSpan: 2n }).sync(),
  "initial synchronization exceeds the configured block span",
);
await expectFailure(
  () => new ReorgSafeObserver(duplicateProvider, address, 1n, { maxLogsPerSync: 1 }).sync(),
  "too many logs",
);

const retainedLimitProvider: ChainReadProvider = {
  ...duplicateProvider,
  async getLogs(): Promise<readonly ProtocolLog[]> {
    return [log(duplicateHeader, 0), log(duplicateHeader, 1)];
  },
};
const retainedLimitObserver = new ReorgSafeObserver(
  retainedLimitProvider,
  address,
  1n,
  { maxRetainedLogs: 1 },
);
await expectFailure(() => retainedLimitObserver.sync(), "retained log history");
if (retainedLimitObserver.head !== null || retainedLimitObserver.logs.length !== 0) {
  throw new Error("retained-log limit failure mutated observer state");
}

let insufficientHeaderRetentionRejected = false;
try {
  new ReorgSafeObserver(provider, address, 1n, { maxReorgDepth: 2n, maxRetainedHeaders: 2 });
} catch (error) {
  insufficientHeaderRetentionRejected = String(error).includes("retained headers must exceed");
}
if (!insufficientHeaderRetentionRejected) throw new Error("header retention shorter than reorg depth was accepted");

const oversizedDataProvider: ChainReadProvider = {
  ...duplicateProvider,
  async getLogs(): Promise<readonly ProtocolLog[]> {
    return [{ ...log(duplicateHeader, 0), data: "0x0000" as Hex }];
  },
};
await expectFailure(
  () => new ReorgSafeObserver(oversizedDataProvider, address, 1n, { maxLogDataBytes: 1 }).sync(),
  "malformed log",
);

let limitedActive = canonicalA;
const limitedReorgProvider: ChainReadProvider = {
  async readContract<T>(): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return 4n; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> { return limitedActive.get(number) ?? null; },
  async getLogs(): Promise<readonly ProtocolLog[]> { return []; },
};
const limitedReorgObserver = new ReorgSafeObserver(
  limitedReorgProvider,
  address,
  1n,
  { maxBlockSpan: 4n, maxReorgDepth: 1n },
);
await limitedReorgObserver.sync();
limitedActive = canonicalB;
await expectFailure(() => limitedReorgObserver.sync(), "configured reorg depth");
if (limitedReorgObserver.head?.hash !== branchA4.hash) {
  throw new Error("reorg limit failure mutated the accepted observer snapshot");
}

console.log(JSON.stringify({
  status: "ok",
  firstAdded: first.addedLogs,
  reorgDepth: second.reorgDepth.toString(),
  canonicalLogs: observer.logs.length,
  duplicateAdded: duplicateSync.addedLogs,
  removedAdded: removedSync.addedLogs,
  atomicHead: atomicObserver.head?.number.toString(),
  resourceLimits: "enforced",
}));
