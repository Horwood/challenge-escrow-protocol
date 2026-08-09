import { readFileSync, writeFileSync } from "node:fs";

import { assertNoDuplicateKeys, canonicalizeValue } from "../portable/canonical.mjs";
import { buildObserverReceipt, observerReceiptHash } from "./receipt.mjs";

const vectorUrl = new URL("../../spec/vectors/observer-receipt-v1.json", import.meta.url);
const raw = readFileSync(vectorUrl, "utf8");
assertNoDuplicateKeys(raw);
const vector = JSON.parse(raw);
const receipt = buildObserverReceipt(vector.input);
vector.expected = {
  receipt,
  receiptHash: observerReceiptHash(receipt),
  canonicalBytes: String(Buffer.byteLength(canonicalizeValue(receipt))),
};
const serialized = `${JSON.stringify(vector, null, 2)}\n`;

if (process.argv.includes("--write")) writeFileSync(vectorUrl, serialized);
else process.stdout.write(serialized);
