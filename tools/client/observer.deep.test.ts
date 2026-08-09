import type { Address, Hex, ReadContractRequest } from "./index.ts";
import { decodeProtocolEvent, eventSignature, type EventKind } from "./events.ts";
import { projectProtocolLogs } from "./projector.ts";
import { computeEntitlementId } from "./keccak.ts";
import { compareRpcHeads, compareRpcQuorum, type RpcHeadProvider } from "./rpc.ts";
import { ReorgSafeObserver, type BlockHeader, type ChainReadProvider, type ProtocolLog } from "./observer.ts";

const address = "0x1111111111111111111111111111111111111111" as Address;
const challenger = "0x2222222222222222222222222222222222222222" as Address;
const acceptor = "0x3333333333333333333333333333333333333333" as Address;
const resolver = "0x4444444444444444444444444444444444444444" as Address;
const arbiter = "0x5555555555555555555555555555555555555555" as Address;
const token = "0x6666666666666666666666666666666666666666" as Address;
const challengeId = `0x${"a".repeat(64)}` as Hex;
const executionHash = `0x${"b".repeat(64)}` as Hex;
const termsHash = `0x${"c".repeat(64)}` as Hex;
const specHash = `0x${"d".repeat(64)}` as Hex;
const nonce = `0x${"e".repeat(64)}` as Hex;
const evidenceOne = `0x${"1".repeat(64)}` as Hex;
const evidenceTwo = `0x${"2".repeat(64)}` as Hex;
const entitlement = computeEntitlementId(challengeId, acceptor) as Hex;
const challengerEntitlement = computeEntitlementId(challengeId, challenger) as Hex;

function hash(letter: string): Hex {
  return `0x${letter.repeat(64)}` as Hex;
}

function word(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

function bytes32(value: Hex): Hex {
  return value;
}

function addressWord(value: Address): Hex {
  return `0x${"0".repeat(24)}${value.slice(2)}` as Hex;
}

function data(words: readonly Hex[]): Hex {
  return `0x${words.map((value) => value.slice(2)).join("")}` as Hex;
}

function replaceDataWord(payload: Hex, index: number, replacement: Hex): Hex {
  const start = 2 + index * 64;
  return `${payload.slice(0, start)}${replacement.slice(2)}${payload.slice(start + 64)}` as Hex;
}

function encodedString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const payload = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${word(BigInt(bytes.length)).slice(2)}${payload.padEnd(Math.ceil(bytes.length / 32) * 64, "0")}`;
}

function releaseData(): Hex {
  const strings = ["challenge-escrow-event/v1", "challenge-escrow-protocol/v1", "challenge-escrow.spec/v1", "challenge-escrow.evidence/v1"];
  const headBytes = 12 * 32;
  const heads: Hex[] = [];
  let offset = headBytes;
  for (const string of strings) {
    const encoded = encodedString(string);
    heads.push(word(BigInt(offset)));
    offset += encoded.length / 2;
  }
  heads.push(word(11155111n), addressWord(address), addressWord(token), word(6n), word(0n), addressWord(resolver), addressWord(arbiter), word(0n));
  return `0x${heads.map((value) => value.slice(2)).join("")}${strings.map(encodedString).join("")}` as Hex;
}

function log(block: BlockHeader, index: number, kind: EventKind, topics: readonly Hex[], payload: Hex): ProtocolLog {
  return { address, blockNumber: block.number, blockHash: block.hash, transactionIndex: 0n, logIndex: BigInt(index), topics: [eventSignature(kind), ...topics], data: payload };
}

const headerDigits = ["1", "2", "3", "4", "5", "6", "7"] as const;
const headers: BlockHeader[] = headerDigits.map((digit, index) => ({ number: BigInt(index + 1), hash: hash(digit), parentHash: index === 0 ? hash("0") : hash(headerDigits[index - 1]) }));
const createdData = data([
  bytes32(specHash),
  bytes32(nonce),
  word(0n),
  word(10n),
  word(0n),
  word(100n),
  word(110n),
  word(120n),
  word(130n),
  word(20n),
  word(20n),
  word(170n),
  bytes32(executionHash),
  bytes32(termsHash),
  word(90n),
]);
const logs: ProtocolLog[] = [
  log(headers[0], 0, "ReleaseDeclared", [hash("9")], releaseData()),
  log(headers[1], 0, "ChallengeCreated", [challengeId, addressWord(challenger)], createdData),
  log(headers[2], 0, "ChallengeAccepted", [challengeId, addressWord(acceptor)], data([word(1n), word(0n), word(95n), word(10n)])),
  log(headers[3], 0, "OutcomeProposed", [challengeId, addressWord(resolver)], data([word(0n), word(0n), bytes32(evidenceOne), word(140n)])),
  log(headers[4], 0, "OutcomeDisputed", [challengeId, addressWord(challenger)], data([word(1n), word(0n), bytes32(evidenceTwo), bytes32(evidenceOne), word(139n), word(159n)])),
  log(headers[5], 0, "ChallengeResolved", [challengeId, addressWord(arbiter), addressWord(acceptor)], data([word(1n), word(0n), bytes32(evidenceTwo), bytes32(evidenceTwo), word(1n), word(20n)])),
  log(headers[6], 0, "WinningsClaimed", [challengeId, entitlement, addressWord(acceptor)], data([word(20n)])),
];

const eventCoverageLogs: ProtocolLog[] = [
  log(headers[0], 1, "PauseStatusChanged", [], data([addressWord(challenger), word(0n), word(1n)])),
  log(headers[1], 1, "AcceptanceNonceAdvanced", [challengeId, addressWord(challenger)], data([word(0n), word(1n)])),
  log(headers[2], 1, "ChallengeCancelled", [challengeId, addressWord(challenger)], data([word(10n)])),
  log(headers[3], 1, "ChallengeExpired", [challengeId, addressWord(challenger)], data([addressWord(arbiter), word(10n)])),
  log(headers[4], 1, "ChallengeVoided", [challengeId, addressWord(arbiter)], data([word(0n), bytes32(evidenceOne), bytes32(evidenceTwo), word(1n), word(10n)])),
  log(headers[5], 1, "PrincipalRefunded", [challengeId, challengerEntitlement, addressWord(challenger)], data([word(4n), word(10n)])),
];

const decodedEventKinds = new Set([...logs, ...eventCoverageLogs].map((entry) => decodeProtocolEvent(entry).kind));
if (decodedEventKinds.size !== 13) throw new Error(`event decoder coverage is incomplete: ${decodedEventKinds.size}/13 kinds`);

const decoded = decodeProtocolEvent(logs[5]);
if (decoded.kind !== "ChallengeResolved" || decoded.finalOutcome !== "B" || decoded.claimAmount !== 20n) throw new Error("static event decoding failed");
const release = decodeProtocolEvent(logs[0]);
if (release.kind !== "ReleaseDeclared" || release.eventProtocolId !== "challenge-escrow-event/v1" || release.chainId !== 11155111n || release.tokenDecimals !== 6) throw new Error("dynamic ReleaseDeclared decoding failed");

const finalized = projectProtocolLogs(logs, headers[6], { safe: headers[6], finalized: headers[6] });
if (finalized.status !== "consistent" || finalized.head.finality !== "finalized" || finalized.challenges[0]?.state !== "RESOLVED_B" || finalized.challenges[0]?.payoutCount !== 1) throw new Error("consistent event projection failed");
JSON.stringify(finalized);

function expectProjectionConflict(candidateLogs: readonly ProtocolLog[], marker: string): void {
  const projection = projectProtocolLogs(candidateLogs, headers[6]);
  if (projection.status !== "conflicted" || !projection.anomalies.some((anomaly) => anomaly.message.includes(marker))) {
    throw new Error(`projector accepted cross-event mismatch: ${marker}`);
  }
}

expectProjectionConflict([
  ...logs.slice(0, 4),
  log(headers[4], 3, "OutcomeProposed", [challengeId, addressWord(resolver)], logs[3].data),
], "cannot follow projected PROPOSED");
expectProjectionConflict([
  ...logs.slice(0, 3),
  log(headers[3], 3, "ChallengeExpired", [challengeId, addressWord(challenger)], data([addressWord(arbiter), word(10n)])),
], "cannot follow projected ACTIVE");
expectProjectionConflict([
  ...logs.slice(0, 3),
  log(headers[3], 3, "AcceptanceNonceAdvanced", [challengeId, addressWord(challenger)], data([word(0n), word(1n)])),
], "does not match the open challenge");
expectProjectionConflict([
  ...logs.slice(0, 3),
  log(headers[3], 3, "OutcomeProposed", [challengeId, addressWord(acceptor)], logs[3].data),
], "declared resolver");
expectProjectionConflict([
  ...logs.slice(0, 4),
  log(headers[4], 3, "OutcomeDisputed", [challengeId, addressWord(challenger)], data([word(1n), word(0n), bytes32(evidenceTwo), hash("4"), word(139n), word(159n)])),
], "does not match its proposal");
expectProjectionConflict([
  ...logs.slice(0, 4),
  log(headers[4], 3, "OutcomeDisputed", [challengeId, addressWord(challenger)], data([word(1n), word(0n), bytes32(evidenceTwo), bytes32(evidenceOne), word(119n), word(139n)])),
], "does not match its proposal");
expectProjectionConflict([
  ...logs.slice(0, 3),
  log(headers[3], 3, "OutcomeProposed", [challengeId, addressWord(resolver)], data([word(0n), word(0n), bytes32(evidenceOne), word(151n)])),
], "challenge schedule");
expectProjectionConflict([
  ...logs.slice(0, 3),
  log(headers[3], 3, "OutcomeProposed", [challengeId, addressWord(resolver)], data([word(0n), word(0n), bytes32(evidenceOne), word(125n)])),
], "challenge schedule");
expectProjectionConflict([
  ...logs.slice(0, 3),
  log(headers[3], 3, "OutcomeProposed", [challengeId, addressWord(resolver)], data([word(2n), word(0n), bytes32(evidenceOne), word(139n)])),
], "source correction cutoff");
const earlyUnresolvable = projectProtocolLogs([
  ...logs.slice(0, 3),
  log(headers[3], 3, "OutcomeProposed", [challengeId, addressWord(resolver)], data([word(2n), word(5n), bytes32(evidenceOne), word(139n)])),
], headers[3]);
if (earlyUnresolvable.status !== "incomplete" || earlyUnresolvable.anomalies.length !== 0) {
  throw new Error("TERMS_UNRESOLVABLE exception was rejected before the correction cutoff");
}
expectProjectionConflict([
  logs[0],
  log(headers[1], 0, "ChallengeCreated", [challengeId, addressWord(resolver)], createdData),
], "participant overlaps");
expectProjectionConflict([
  ...logs.slice(0, 2),
  log(headers[2], 0, "ChallengeAccepted", [challengeId, addressWord(resolver)], data([word(1n), word(0n), word(95n), word(10n)])),
], "does not match the created challenge");
expectProjectionConflict([
  ...logs.slice(0, 4),
  log(headers[4], 3, "OutcomeDisputed", [challengeId, addressWord(challenger)], data([word(1n), word(0n), bytes32(evidenceTwo), bytes32(evidenceOne), word(140n), word(160n)])),
], "does not match its proposal");
expectProjectionConflict([
  logs[1],
  log(headers[2], 3, "ReleaseDeclared", [hash("9")], releaseData()),
], "appeared after another protocol event");
expectProjectionConflict([
  ...logs.slice(0, 4),
  log(headers[4], 3, "ChallengeResolved", [challengeId, addressWord(challenger), addressWord(acceptor)], data([word(1n), word(0n), bytes32(evidenceOne), hash("0"), word(0n), word(20n)])),
], "evidence lineage, winner, or authority");
expectProjectionConflict([
  ...logs.slice(0, 4),
  log(headers[4], 3, "ChallengeVoided", [challengeId, addressWord(challenger)], data([word(0n), bytes32(evidenceOne), hash("0"), word(0n), word(10n)])),
], "evidence lineage, refund, or authority");
expectProjectionConflict([
  ...logs.slice(0, 2),
  log(headers[2], 3, "ChallengeVoided", [challengeId, addressWord(arbiter)], data([word(0n), hash("0"), hash("0"), word(2n), word(10n)])),
], "path 2 cannot follow projected OPEN");
expectProjectionConflict([
  ...logs.slice(0, 6),
  log(headers[6], 3, "WinningsClaimed", [challengeId, challengerEntitlement, addressWord(challenger)], data([word(20n)])),
], "payout amount or recipient");
expectProjectionConflict([
  ...logs.slice(0, 6),
  log(headers[6], 4, "WinningsClaimed", [challengeId, hash("3"), addressWord(acceptor)], data([word(20n)])),
], "entitlement ID does not match");
const duplicatePayout = projectProtocolLogs([
  ...logs,
  log(headers[6], 3, "WinningsClaimed", [challengeId, entitlement, addressWord(acceptor)], data([word(20n)])),
], headers[6]);
if (duplicatePayout.anomalies.at(-1)?.code !== "duplicate_payout" || duplicatePayout.challenges[0]?.payoutCount !== 1) {
  throw new Error("duplicate payout changed the accepted payout count");
}

function expectProjectionReject(candidateLogs: readonly ProtocolLog[], candidateHead: BlockHeader, marker: string): void {
  let rejected = false;
  try {
    projectProtocolLogs(candidateLogs, candidateHead);
  } catch (error) {
    rejected = String(error).includes(marker);
  }
  if (!rejected) throw new Error(`projector accepted invalid log boundary: ${marker}`);
}

expectProjectionReject([logs[0], { ...logs[1], address: challenger }], headers[1], "more than one contract address");
expectProjectionReject([logs[0], { ...eventCoverageLogs[0], blockHash: hash("f") }], headers[0], "two forks at one height");
expectProjectionReject([logs[0], { ...logs[0] }], headers[0], "duplicate event position");
expectProjectionReject([
  logs[0],
  { ...eventCoverageLogs[0], transactionIndex: 1n, logIndex: logs[0].logIndex },
], headers[0], "duplicate event position");
expectProjectionReject([
  { ...logs[0], logIndex: 2n },
  { ...eventCoverageLogs[0], transactionIndex: 1n, logIndex: 1n },
], headers[0], "non-canonical event ordering");
expectProjectionReject([{ ...logs[6], blockHash: hash("f") }], headers[6], "not anchored to the observed head");
expectProjectionReject([], { ...headers[6], number: 1n << 64n }, "head is malformed");
expectProjectionReject([
  { ...logs[1], data: replaceDataWord(createdData, 4, word(1n)) },
], headers[1], "acceptanceNonce must start at zero");

const orphan = projectProtocolLogs([logs[3]], headers[3]);
if (orphan.status !== "conflicted" || orphan.anomalies[0]?.code !== "orphan_event") throw new Error("orphan event was not surfaced");

const observerProvider: ChainReadProvider = {
  async readContract<T>(_request: ReadContractRequest): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return headers[6].number; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> { return headers.find((header) => header.number === number) ?? null; },
  async getLogs(): Promise<readonly ProtocolLog[]> { return logs; },
};
const observer = new ReorgSafeObserver(observerProvider, address, 1n);
const evidence = await observer.evidence({ safe: headers[6], finalized: headers[6] });
if (evidence.status !== "consistent" || evidence.eventCount !== logs.length || evidence.head.finality !== "finalized") throw new Error("observer evidence record failed");

function rpcProvider(safe: BlockHeader, finalizedBlock: BlockHeader, latest: BlockHeader = headers[6]): RpcHeadProvider {
  return {
    async getBlockNumber(): Promise<bigint> { return latest.number; },
    async getBlockByNumber(number: bigint): Promise<BlockHeader | null> { return number === latest.number ? latest : headers.find((header) => header.number === number) ?? null; },
    async getBlockByTag(tag): Promise<BlockHeader | null> { return tag === "safe" ? safe : tag === "finalized" ? finalizedBlock : latest; },
  };
}
const agree = await compareRpcHeads({ name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) }, { name: "rpc-b", provider: rpcProvider(headers[5], headers[4]) });
if (agree.status !== "agree") throw new Error("matching RPC heads diverged");
const divergent = await compareRpcHeads({ name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) }, { name: "rpc-b", provider: rpcProvider(headers[4], headers[4]) });
if (divergent.status !== "divergent" || divergent.divergenceAt !== "safe") throw new Error("RPC safe-head divergence was not labeled");
const unavailable = await compareRpcHeads({ name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) }, { name: "rpc-down", provider: { async getBlockNumber(): Promise<bigint> { throw new Error("https://user:secret@rpc.example refused"); }, async getBlockByNumber(): Promise<BlockHeader | null> { return null; }, async getBlockByTag(): Promise<BlockHeader | null> { return null; } } });
if (unavailable.status !== "unavailable" || unavailable.endpoints[1]?.error !== "RPC_READ_FAILED") throw new Error("RPC outage was not sanitized and labeled unavailable");
const unsupportedFinality = await compareRpcHeads({ name: "rpc-a", provider: { async getBlockNumber(): Promise<bigint> { return headers[6].number; }, async getBlockByNumber(number: bigint): Promise<BlockHeader | null> { return headers.find((header) => header.number === number) ?? null; } } }, { name: "rpc-b", provider: rpcProvider(headers[5], headers[4]) });
if (unsupportedFinality.status !== "unavailable") throw new Error("missing safe/finalized tags were treated as agreement");

const latestDissent = { ...headers[6], hash: hash("f") };
const twoOfThree = await compareRpcQuorum([
  { name: "rpc-c", provider: rpcProvider(headers[5], headers[4], latestDissent) },
  { name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-b", provider: rpcProvider(headers[5], headers[4]) },
], 2);
if (
  twoOfThree.status !== "agree"
  || twoOfThree.heads.latest.supporters.join(",") !== "rpc-a,rpc-b"
  || twoOfThree.heads.latest.dissenters.join(",") !== "rpc-c"
  || twoOfThree.endpoints.map((endpoint) => endpoint.name).join(",") !== "rpc-a,rpc-b,rpc-c"
) throw new Error("two-of-three RPC quorum did not preserve normalized support and dissent");

const splitQuorum = await compareRpcQuorum([
  { name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-b", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-c", provider: rpcProvider(headers[5], headers[4], latestDissent) },
  { name: "rpc-d", provider: rpcProvider(headers[5], headers[4], latestDissent) },
], 3);
if (splitQuorum.status !== "conflicted" || splitQuorum.heads.latest.groups.length !== 2) {
  throw new Error("competing threshold groups were not labeled conflicted");
}

let minorityThresholdRejected = false;
try {
  await compareRpcQuorum([
    { name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) },
    { name: "rpc-b", provider: rpcProvider(headers[5], headers[4]) },
    { name: "rpc-c", provider: rpcProvider(headers[5], headers[4]) },
    { name: "rpc-d", provider: rpcProvider(headers[5], headers[4]) },
  ], 2);
} catch (error) {
  minorityThresholdRejected = String(error).includes("strict provider majority");
}
if (!minorityThresholdRejected) throw new Error("non-majority RPC threshold was accepted");

const parentFork = { ...headers[6], parentHash: hash("4") };
const parentConflict = await compareRpcQuorum([
  { name: "rpc-a", provider: rpcProvider(headers[4], headers[3]) },
  { name: "rpc-b", provider: rpcProvider(headers[4], headers[3], parentFork) },
], 2);
if (parentConflict.heads.latest.status !== "conflicted") throw new Error("parent-hash fork was counted as agreement");

const rpcDown: RpcHeadProvider = {
  async getBlockNumber(): Promise<bigint> { throw new Error("connection refused"); },
  async getBlockByNumber(): Promise<BlockHeader | null> { return null; },
};
const quorumWithOutage = await compareRpcQuorum([
  { name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-b", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-down", provider: rpcDown },
], 2);
if (quorumWithOutage.status !== "agree" || quorumWithOutage.heads.finalized.unavailable.join(",") !== "rpc-down") {
  throw new Error("quorum did not preserve an outage alongside threshold agreement");
}

const insufficientQuorum = await compareRpcQuorum([
  { name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-down-a", provider: rpcDown },
  { name: "rpc-down-b", provider: rpcDown },
], 2);
if (insufficientQuorum.status !== "unavailable" || insufficientQuorum.heads.safe.status !== "unavailable") {
  throw new Error("insufficient RPC support was not fail-closed");
}

const staleLatest = headers[5];
const quorumWithStaleProvider = await compareRpcQuorum([
  { name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-b", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-stale", provider: rpcProvider(headers[5], headers[4], staleLatest) },
], 2);
if (quorumWithStaleProvider.status !== "agree" || quorumWithStaleProvider.heads.latest.dissenters.join(",") !== "rpc-stale") {
  throw new Error("stale latest head was not preserved as dissent");
}

const finalizedFork = { ...headers[4], hash: hash("e"), parentHash: hash("d") };
const deepFinalityConflict = await compareRpcQuorum([
  { name: "rpc-a", provider: rpcProvider(headers[6], headers[4]) },
  { name: "rpc-b", provider: rpcProvider(headers[6], headers[4]) },
  { name: "rpc-c", provider: rpcProvider(headers[6], finalizedFork) },
  { name: "rpc-d", provider: rpcProvider(headers[6], finalizedFork) },
], 3);
if (deepFinalityConflict.status !== "conflicted" || deepFinalityConflict.heads.finalized.status !== "conflicted") {
  throw new Error("competing finalized forks were not treated as a deep ambiguity");
}

const completeOutage = await compareRpcQuorum([
  { name: "rpc-down-a", provider: rpcDown },
  { name: "rpc-down-b", provider: rpcDown },
  { name: "rpc-down-c", provider: rpcDown },
], 2);
if (completeOutage.status !== "unavailable" || completeOutage.heads.latest.unavailable.length !== 3) {
  throw new Error("complete RPC outage did not remain unavailable");
}

const invalidFinalityOrder = await compareRpcQuorum([
  { name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-b", provider: rpcProvider(headers[6], headers[4], headers[5]) },
], 2);
if (invalidFinalityOrder.endpoints[1]?.error !== "FINALITY_ORDER_INVALID" || invalidFinalityOrder.status !== "unavailable") {
  throw new Error("invalid finality ordering was not rejected without raw provider data");
}

const oversizedRpcHeader = { ...headers[6], number: 1n << 64n };
const invalidHeaderBounds = await compareRpcQuorum([
  { name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-b", provider: rpcProvider(headers[5], headers[4], oversizedRpcHeader) },
], 2);
if (invalidHeaderBounds.endpoints[1]?.error !== "MALFORMED_BLOCK_HEADER" || invalidHeaderBounds.status !== "unavailable") {
  throw new Error("out-of-range RPC block number was accepted");
}

const sameHeightSafeFork = { ...headers[6], hash: hash("0") };
const invalidFinalityChain = await compareRpcQuorum([
  { name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-b", provider: rpcProvider(sameHeightSafeFork, headers[4], headers[6]) },
], 2);
if (invalidFinalityChain.endpoints[1]?.error !== "FINALITY_CHAIN_INVALID" || invalidFinalityChain.status !== "unavailable") {
  throw new Error("same-height finality fork was not rejected");
}

let movingRpcReads = 0;
const movingRpcProvider: RpcHeadProvider = {
  async getBlockNumber(): Promise<bigint> { return headers[6].number; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> {
    if (number !== headers[6].number) return null;
    movingRpcReads += 1;
    return movingRpcReads === 1 ? headers[6] : { ...headers[6], hash: hash("0") };
  },
  async getBlockByTag(tag): Promise<BlockHeader | null> {
    return tag === "safe" ? headers[5] : tag === "finalized" ? headers[4] : headers[6];
  },
};
const movingRpcSnapshot = await compareRpcQuorum([
  { name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-moving", provider: movingRpcProvider },
], 2);
if (
  movingRpcSnapshot.endpoints[1]?.error !== "LATEST_BLOCK_CHANGED"
  || movingRpcSnapshot.status !== "unavailable"
) throw new Error("same-height reorganization during an RPC snapshot was accepted");

const conflictWithOutage = await compareRpcQuorum([
  { name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) },
  { name: "rpc-c", provider: rpcProvider(headers[5], headers[4], latestDissent) },
  { name: "rpc-down-a", provider: rpcDown },
  { name: "rpc-down-b", provider: rpcDown },
], 3);
if (
  conflictWithOutage.heads.latest.status !== "conflicted"
  || conflictWithOutage.heads.latest.unavailable.join(",") !== "rpc-down-a,rpc-down-b"
) throw new Error("RPC conflict discarded concurrent outage evidence");

let invalidProjectionFinalityRejected = false;
try {
  projectProtocolLogs(logs, headers[6], { safe: headers[5], finalized: headers[6] });
} catch (error) {
  invalidProjectionFinalityRejected = String(error).includes("finalized head is inconsistent");
}
if (!invalidProjectionFinalityRejected) throw new Error("projector accepted impossible finality ordering");

let hostnameProviderRejected = false;
try {
  await compareRpcQuorum([
    { name: "rpc.example", provider: rpcProvider(headers[5], headers[4]) },
    { name: "rpc-b", provider: rpcProvider(headers[5], headers[4]) },
  ], 2);
} catch (error) {
  hostnameProviderRejected = String(error).includes("endpoint-neutral identifier");
}
if (!hostnameProviderRejected) throw new Error("hostname-shaped RPC provider identifier was accepted");

let unknownRejected = false;
try {
  decodeProtocolEvent({ ...logs[0], topics: [hash("f")], data: "0x" });
} catch (error) {
  unknownRejected = String(error).includes("unknown event signature");
}
if (!unknownRejected) throw new Error("unknown event signature was accepted");

function expectDecodeReject(candidate: ProtocolLog, marker: string): void {
  let rejected = false;
  try {
    decodeProtocolEvent(candidate);
  } catch (error) {
    rejected = String(error).includes(marker);
  }
  if (!rejected) throw new Error(`event decoder accepted invalid payload: ${marker}`);
}

const canonicalReleaseData = releaseData();
const firstDynamicOffset = canonicalReleaseData.slice(2, 66);
const aliasedReleaseData = `0x${canonicalReleaseData.slice(2, 66)}${firstDynamicOffset}${canonicalReleaseData.slice(130)}` as Hex;
expectDecodeReject({ ...logs[0], data: aliasedReleaseData }, "non-canonical ABI offset");
expectDecodeReject({ ...logs[0], data: `${canonicalReleaseData}${"0".repeat(64)}` as Hex }, "trailing ABI data");
expectDecodeReject(
  { ...logs[3], data: data([word(0n), word(5n), bytes32(evidenceOne), word(140n)]) },
  "reasonCode is outside its enum range",
);
expectDecodeReject(
  { ...logs[5], data: data([word(2n), word(0n), bytes32(evidenceTwo), bytes32(evidenceOne), word(1n), word(20n)]) },
  "cannot carry a VOID outcome",
);
expectDecodeReject(
  log(headers[4], 2, "ChallengeVoided", [challengeId, addressWord(arbiter)], data([word(0n), bytes32(evidenceOne), bytes32(evidenceTwo), word(2n), word(10n)])),
  "timeout path must not carry evidence hashes",
);
expectDecodeReject(
  log(headers[5], 2, "PrincipalRefunded", [challengeId, entitlement, addressWord(challenger)], data([word(0n), word(10n)])),
  "originState is not refundable",
);
expectDecodeReject({ ...logs[0], topics: [] }, "event signature topic is missing");
expectDecodeReject({ ...logs[1], data: replaceDataWord(createdData, 11, word(150n)) }, "timeout does not cover every authority path");
expectDecodeReject({ ...logs[1], data: replaceDataWord(createdData, 5, word(1n << 64n)) }, "exceeds uint64");
expectDecodeReject({ ...logs[2], data: replaceDataWord(logs[2].data, 3, word(0n)) }, "permit expiry and stake must be positive");

console.log(JSON.stringify({ status: "ok", decodedEvents: decodedEventKinds.size, projectionEvents: logs.length, projectionStatus: finalized.status, finality: finalized.head.finality, rpc: { agree: agree.status, divergent: divergent.status, unavailable: unavailable.status, quorum: twoOfThree.status, split: splitQuorum.status, parentFork: parentConflict.heads.latest.status, outage: quorumWithOutage.status, insufficient: insufficientQuorum.status, stale: quorumWithStaleProvider.status, finalizedFork: deepFinalityConflict.status, completeOutage: completeOutage.status, invalidFinalityOrder: invalidFinalityOrder.status, invalidFinalityChain: invalidFinalityChain.status, movingSnapshot: movingRpcSnapshot.status, conflictWithOutage: conflictWithOutage.heads.latest.status } }));
