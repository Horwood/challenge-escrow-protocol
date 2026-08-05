import type { Address, Hex, ReadContractRequest } from "./index.ts";
import { decodeProtocolEvent, eventSignature, type EventKind } from "./events.ts";
import { projectProtocolLogs } from "./projector.ts";
import { compareRpcHeads, type RpcHeadProvider } from "./rpc.ts";
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
const entitlement = `0x${"3".repeat(64)}` as Hex;

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

const headers: BlockHeader[] = Array.from({ length: 7 }, (_, index) => ({ number: BigInt(index + 1), hash: hash(String.fromCharCode(65 + index)), parentHash: index === 0 ? hash("0") : hash(String.fromCharCode(65 + index - 1)) }));
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
  word(150n),
  bytes32(executionHash),
  bytes32(termsHash),
  word(90n),
]);
const logs: ProtocolLog[] = [
  log(headers[0], 0, "ReleaseDeclared", [hash("9")], releaseData()),
  log(headers[1], 0, "ChallengeCreated", [challengeId, addressWord(challenger)], createdData),
  log(headers[2], 0, "ChallengeAccepted", [challengeId, addressWord(acceptor)], data([word(1n), word(0n), word(105n), word(10n)])),
  log(headers[3], 0, "OutcomeProposed", [challengeId, addressWord(resolver)], data([word(0n), word(0n), bytes32(evidenceOne), word(140n)])),
  log(headers[4], 0, "OutcomeDisputed", [challengeId, addressWord(challenger)], data([word(1n), word(0n), bytes32(evidenceTwo), bytes32(evidenceOne), word(141n), word(160n)])),
  log(headers[5], 0, "ChallengeResolved", [challengeId, addressWord(arbiter), addressWord(acceptor)], data([word(1n), word(0n), bytes32(evidenceTwo), bytes32(evidenceOne), word(1n), word(20n)])),
  log(headers[6], 0, "WinningsClaimed", [challengeId, entitlement, addressWord(acceptor)], data([word(20n)])),
];

const eventCoverageLogs: ProtocolLog[] = [
  log(headers[0], 1, "PauseStatusChanged", [], data([addressWord(challenger), word(0n), word(1n)])),
  log(headers[1], 1, "AcceptanceNonceAdvanced", [challengeId, addressWord(challenger)], data([word(0n), word(1n)])),
  log(headers[2], 1, "ChallengeCancelled", [challengeId, addressWord(challenger)], data([word(10n)])),
  log(headers[3], 1, "ChallengeExpired", [challengeId, addressWord(challenger)], data([addressWord(arbiter), word(10n)])),
  log(headers[4], 1, "ChallengeVoided", [challengeId, addressWord(arbiter)], data([word(0n), bytes32(evidenceOne), bytes32(evidenceTwo), word(1n), word(10n)])),
  log(headers[5], 1, "PrincipalRefunded", [challengeId, entitlement, addressWord(challenger)], data([word(0n), word(10n)])),
];

const decodedEventKinds = new Set([...logs, ...eventCoverageLogs].map((entry) => decodeProtocolEvent(entry).kind));
if (decodedEventKinds.size !== 13) throw new Error(`event decoder coverage is incomplete: ${decodedEventKinds.size}/13 kinds`);

const decoded = decodeProtocolEvent(logs[5]);
if (decoded.kind !== "ChallengeResolved" || decoded.finalOutcome !== "B" || decoded.claimAmount !== 20n) throw new Error("static event decoding failed");
const release = decodeProtocolEvent(logs[0]);
if (release.kind !== "ReleaseDeclared" || release.eventProtocolId !== "challenge-escrow-event/v1" || release.chainId !== 11155111n || release.tokenDecimals !== 6) throw new Error("dynamic ReleaseDeclared decoding failed");

const finalized = projectProtocolLogs(logs, headers[6], { safe: headers[5], finalized: headers[6] });
if (finalized.status !== "consistent" || finalized.head.finality !== "finalized" || finalized.challenges[0]?.state !== "RESOLVED_B" || finalized.challenges[0]?.payoutCount !== 1) throw new Error("consistent event projection failed");
JSON.stringify(finalized);

const orphan = projectProtocolLogs([logs[3]], headers[3]);
if (orphan.status !== "conflicted" || orphan.anomalies[0]?.code !== "orphan_event") throw new Error("orphan event was not surfaced");

const observerProvider: ChainReadProvider = {
  async readContract<T>(_request: ReadContractRequest): Promise<T> { return undefined as T; },
  async getBlockNumber(): Promise<bigint> { return headers[6].number; },
  async getBlockByNumber(number: bigint): Promise<BlockHeader | null> { return headers.find((header) => header.number === number) ?? null; },
  async getLogs(): Promise<readonly ProtocolLog[]> { return logs; },
};
const observer = new ReorgSafeObserver(observerProvider, address, 1n);
const evidence = await observer.evidence({ safe: headers[5], finalized: headers[6] });
if (evidence.status !== "consistent" || evidence.eventCount !== logs.length || evidence.head.finality !== "finalized") throw new Error("observer evidence record failed");

function rpcProvider(safe: BlockHeader, finalizedBlock: BlockHeader): RpcHeadProvider {
  return {
    async getBlockNumber(): Promise<bigint> { return headers[6].number; },
    async getBlockByNumber(number: bigint): Promise<BlockHeader | null> { return headers.find((header) => header.number === number) ?? null; },
    async getBlockByTag(tag): Promise<BlockHeader | null> { return tag === "safe" ? safe : tag === "finalized" ? finalizedBlock : headers[6]; },
  };
}
const agree = await compareRpcHeads({ name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) }, { name: "rpc-b", provider: rpcProvider(headers[5], headers[4]) });
if (agree.status !== "agree") throw new Error("matching RPC heads diverged");
const divergent = await compareRpcHeads({ name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) }, { name: "rpc-b", provider: rpcProvider(headers[4], headers[4]) });
if (divergent.status !== "divergent" || divergent.divergenceAt !== "safe") throw new Error("RPC safe-head divergence was not labeled");
const unavailable = await compareRpcHeads({ name: "rpc-a", provider: rpcProvider(headers[5], headers[4]) }, { name: "rpc-down", provider: { async getBlockNumber(): Promise<bigint> { throw new Error("connection refused"); }, async getBlockByNumber(): Promise<BlockHeader | null> { return null; } } });
if (unavailable.status !== "unavailable") throw new Error("RPC outage was not labeled unavailable");

let unknownRejected = false;
try {
  decodeProtocolEvent({ ...logs[0], topics: [hash("f")], data: "0x" });
} catch (error) {
  unknownRejected = String(error).includes("unknown event signature");
}
if (!unknownRejected) throw new Error("unknown event signature was accepted");

console.log(JSON.stringify({ status: "ok", decodedEvents: decodedEventKinds.size, projectionEvents: logs.length, projectionStatus: finalized.status, finality: finalized.head.finality, rpc: { agree: agree.status, divergent: divergent.status, unavailable: unavailable.status } }));
