import { readFileSync } from "node:fs";

import { assertNoDuplicateKeys } from "../portable/canonical.mjs";
import {
  ObserverReceiptError,
  buildObserverReceipt,
  validateObserverReceipt,
  verifyObserverReceipt,
} from "./receipt.mjs";

const vectorUrl = new URL("../../spec/vectors/observer-receipt-v1.json", import.meta.url);
const negativeUrl = new URL("../../spec/vectors/observer-receipt-negative-v1.json", import.meta.url);

function readJson(url) {
  const raw = readFileSync(url, "utf8");
  assertNoDuplicateKeys(raw);
  return JSON.parse(raw);
}

function clone(value) {
  return structuredClone(value);
}

function mutate(vector, mutation) {
  const input = clone(vector.input);
  const expected = clone(vector.expected);
  if (mutation === "duplicate-provider") input.providers.push(clone(input.providers[0]));
  else if (mutation === "noncanonical-threshold") input.threshold = "02";
  else if (mutation === "non-majority-threshold") {
    input.providers.push({ ...clone(input.providers[0]), providerId: "provider-d" });
    input.threshold = "2";
  } else if (mutation === "oversized-evidence-set") input.logs = Array.from({ length: 50_001 }, () => null);
  else if (mutation === "deep-evidence") {
    let nested = null;
    for (let depth = 0; depth < 65; depth += 1) nested = [nested];
    input.anomalies = [nested];
  }
  else if (mutation === "uint256-overflow") input.release.chainId = (1n << 256n).toString();
  else if (mutation === "block-number-overflow") input.providers[0].latest.number = (1n << 64n).toString();
  else if (mutation === "release-id-mismatch") input.release.releaseId = `0x${"1".repeat(64)}`;
  else if (mutation === "unsafe-provider-id") input.providers[0].providerId = "https://rpc.example";
  else if (mutation === "hostname-provider-id") input.providers[0].providerId = "rpc.example";
  else if (mutation === "unsafe-provider-error") {
    input.providers[0] = {
      ...input.providers[0],
      status: "unavailable",
      latest: null,
      safe: null,
      finalized: null,
      error: "https://user:secret@rpc.example",
    };
  } else if (mutation === "unrecognized-provider-error") {
    input.providers[0] = {
      ...input.providers[0],
      status: "unavailable",
      latest: null,
      safe: null,
      finalized: null,
      error: "API_KEY_ABCDEF",
    };
  } else if (mutation === "unavailable-provider-carries-head") {
    input.providers[0].status = "unavailable";
    input.providers[0].error = "RPC_READ_FAILED";
  } else if (mutation === "invalid-finality-order") {
    input.providers[0].safe.number = "103";
  } else if (mutation === "same-height-finality-fork") {
    input.providers[0].safe.number = input.providers[0].latest.number;
  } else if (mutation === "unknown-unobserved-head") {
    input.head = {
      number: "50",
      hash: `0x${"4".repeat(64)}`,
      parentHash: `0x${"3".repeat(64)}`,
      finality: "unknown",
    };
  } else if (mutation === "parent-hash-fork") {
    const provider = input.providers.find((entry) => entry.providerId === "provider-b");
    provider.latest.parentHash = `0x${"4".repeat(64)}`;
    const canonical = input.providers.find((entry) => entry.providerId === "provider-a").latest;
    input.head = { ...clone(canonical), finality: "latest" };
  } else if (mutation === "altered-head") expected.receipt.head.hash = `0x${"4".repeat(64)}`;
  else if (mutation === "release-drift") expected.receipt.release.protocolVersion = "challenge-escrow-protocol/v2";
  else if (mutation === "provider-order") expected.receipt.quorum.providers.reverse();
  else if (mutation === "digest-mismatch") expected.receipt.commitments.anomalies = `sha256:${"0".repeat(64)}`;
  else if (mutation === "hidden-anomaly") input.anomalies.push({ code: "hidden", severity: "critical" });
  else throw new Error(`unknown observer receipt mutation: ${mutation}`);
  return { input, expected };
}

function codeFor(error) {
  if (error instanceof ObserverReceiptError) return error.code;
  if (String(error).includes("duplicate object key")) return "DuplicateKey";
  return "UnexpectedError";
}

const vector = readJson(vectorUrl);
if (vector.schema !== "challenge-escrow.observer-receipt-vector/v1") throw new Error("observer receipt vector schema drifted");
if (!vector.expected.receipt || !vector.expected.receiptHash || !vector.expected.canonicalBytes) {
  throw new Error("observer receipt vector has not been generated");
}
const verified = verifyObserverReceipt(vector.input, vector.expected.receipt, vector.expected.receiptHash);
if (verified.canonicalBytes !== vector.expected.canonicalBytes) throw new Error("observer receipt canonical byte count drifted");

const negative = readJson(negativeUrl);
if (negative.schema !== "challenge-escrow.observer-receipt-negative/v1") throw new Error("observer receipt negative schema drifted");
for (const testCase of negative.cases) {
  let observed = null;
  try {
    if (testCase.operation === "parse") {
      const raw = testCase.mutation === "nfc-colliding-json-keys"
        ? '{"\\u00e9":"one","e\\u0301":"two"}'
        : '{"schema":"one","schema":"two"}';
      assertNoDuplicateKeys(raw);
    } else {
      const candidate = mutate(vector, testCase.mutation);
      if (testCase.operation === "build") buildObserverReceipt(candidate.input);
      else if (testCase.operation === "validate") validateObserverReceipt(candidate.expected.receipt);
      else if (testCase.operation === "verify") verifyObserverReceipt(candidate.input, candidate.expected.receipt, candidate.expected.receiptHash);
      else throw new Error(`unknown observer receipt operation: ${testCase.operation}`);
    }
  } catch (error) {
    observed = codeFor(error);
  }
  if (observed !== testCase.expectedCode) {
    throw new Error(`${testCase.id}: expected ${testCase.expectedCode}, observed ${observed ?? "accept"}`);
  }
}

console.log(JSON.stringify({
  status: "ok",
  implementation: "javascript",
  receiptHash: verified.receiptHash,
  canonicalBytes: verified.canonicalBytes,
  negativeCases: negative.cases.length,
  quorumStatus: verified.receipt.quorum.status,
}, null, 2));
