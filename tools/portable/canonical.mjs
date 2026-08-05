import { execFileSync } from "node:child_process";

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9._~-]{1,64}$/;
const REF_PATTERN = /^\/observations\/[A-Za-z0-9._~-]{1,64}\/value$/;
const TIMESTAMP_PATTERN = /^[0-9]{1,20}$/;
const INTEGER_PATTERN = /^-?(0|[1-9][0-9]*)$/;
const DECIMAL_PATTERN = /^-?(0|[1-9][0-9]*)\.[0-9]+$/;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertKeys(value, required, optional, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) assert(Object.hasOwn(value, key), `${label}.${key} is required`);
  for (const key of Object.keys(value)) assert(allowed.has(key), `${label}.${key} is unknown`);
}

function normalizedString(value, label) {
  assert(typeof value === "string", `${label} must be a string`);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      assert(next >= 0xdc00 && next <= 0xdfff, `${label} contains an unpaired surrogate`);
      index += 1;
    } else {
      assert(code < 0xdc00 || code > 0xdfff, `${label} contains an unpaired surrogate`);
    }
  }
  return value.normalize("NFC");
}

function compareCodePoints(left, right) {
  const a = [...left].map((character) => character.codePointAt(0));
  const b = [...right].map((character) => character.codePointAt(0));
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function scanString(text, start) {
  assert(text[start] === '"', `expected a JSON string at ${start}`);
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === '"') return index + 1;
    index += 1;
  }
  fail("unterminated JSON string");
}

function skipWhitespace(text, index) {
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

function scanValue(text, start) {
  let index = skipWhitespace(text, start);
  const marker = text[index];
  if (marker === '"') return scanString(text, index);
  if (marker === "{") return scanObject(text, index);
  if (marker === "[") return scanArray(text, index);
  while (index < text.length && !",]}".includes(text[index]) && !/\s/.test(text[index])) index += 1;
  assert(index > start, `invalid JSON value at ${start}`);
  return index;
}

function scanArray(text, start) {
  let index = skipWhitespace(text, start + 1);
  if (text[index] === "]") return index + 1;
  while (index < text.length) {
    index = scanValue(text, index);
    index = skipWhitespace(text, index);
    if (text[index] === "]") return index + 1;
    assert(text[index] === ",", `expected an array separator at ${index}`);
    index = skipWhitespace(text, index + 1);
  }
  fail("unterminated JSON array");
}

function scanObject(text, start) {
  const keys = new Set();
  let index = skipWhitespace(text, start + 1);
  if (text[index] === "}") return index + 1;
  while (index < text.length) {
    assert(text[index] === '"', `expected an object key at ${index}`);
    const keyStart = index;
    index = scanString(text, index);
    const key = JSON.parse(text.slice(keyStart, index));
    assert(!keys.has(key), `duplicate object key: ${key}`);
    keys.add(key);
    index = skipWhitespace(text, index);
    assert(text[index] === ":", `expected an object colon at ${index}`);
    index = scanValue(text, index + 1);
    index = skipWhitespace(text, index);
    if (text[index] === "}") return index + 1;
    assert(text[index] === ",", `expected an object separator at ${index}`);
    index = skipWhitespace(text, index + 1);
  }
  fail("unterminated JSON object");
}

export function assertNoDuplicateKeys(text) {
  assert(typeof text === "string", "raw JSON must be a string");
  const end = scanValue(text, 0);
  assert(skipWhitespace(text, end) === text.length, "trailing JSON data");
}

export function canonicalizeValue(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(normalizedString(value, "string"));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" || typeof value === "bigint") {
    fail("JSON numbers are forbidden; use a tagged decimal or integer string");
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeValue).join(",")}]`;
  assert(value && typeof value === "object", "unsupported JSON value");
  const entries = new Map();
  for (const key of Object.keys(value)) {
    const normalizedKey = normalizedString(key, "object key");
    assert(!entries.has(normalizedKey), `object keys collide after NFC normalization: ${normalizedKey}`);
    entries.set(normalizedKey, value[key]);
  }
  const sorted = [...entries.entries()].sort(([left], [right]) => compareCodePoints(left, right));
  return `{${sorted.map(([key, nested]) => `${JSON.stringify(key)}:${canonicalizeValue(nested)}`).join(",")}}`;
}

export function canonicalizeJson(text) {
  assertNoDuplicateKeys(text);
  return canonicalizeValue(JSON.parse(text));
}

export function domainHash(domain, value) {
  const bytes = Buffer.from(`${domain}\0${canonicalizeValue(value)}`, "utf8");
  const encoded = `0x${bytes.toString("hex")}`;
  return execFileSync("cast", ["keccak", encoded], { encoding: "utf8" }).trim().toLowerCase();
}

export function validateCondition(document, label = "condition") {
  assertKeys(document, ["schema", "root"], [], label);
  assert(document.schema === "challenge-escrow.condition-language/v1", `${label}.schema drifted`);
  validateNode(document.root, `${label}.root`, 0);
}

function validateNode(node, label, depth) {
  assert(depth <= 32, `${label} exceeds maximum depth`);
  assert(node && typeof node === "object" && !Array.isArray(node), `${label} must be an object`);
  assert(typeof node.op === "string", `${label}.op is required`);
  if (node.op === "all" || node.op === "any") {
    assertKeys(node, ["op", "args"], [], label);
    assert(Array.isArray(node.args) && node.args.length >= 1 && node.args.length <= 32, `${label}.args length`);
    node.args.forEach((child, index) => validateNode(child, `${label}.args[${index}]`, depth + 1));
    return;
  }
  if (node.op === "not") {
    assertKeys(node, ["op", "arg"], [], label);
    validateNode(node.arg, `${label}.arg`, depth + 1);
    return;
  }
  if (["eq", "neq", "lt", "lte", "gt", "gte"].includes(node.op)) {
    assertKeys(node, ["op", "left", "right"], [], label);
    validateValue(node.left, `${label}.left`);
    validateValue(node.right, `${label}.right`);
    return;
  }
  if (node.op === "between") {
    assertKeys(node, ["op", "value", "lower", "upper", "inclusive"], [], label);
    validateValue(node.value, `${label}.value`);
    validateValue(node.lower, `${label}.lower`);
    validateValue(node.upper, `${label}.upper`);
    assert(typeof node.inclusive === "boolean", `${label}.inclusive must be boolean`);
    return;
  }
  fail(`${label}.op is unknown`);
}

function validateValue(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  if (Object.hasOwn(value, "ref")) {
    assertKeys(value, ["ref"], [], label);
    assert(REF_PATTERN.test(value.ref), `${label}.ref is outside the observation namespace`);
    return;
  }
  assertKeys(value, ["kind", "value"], [], label);
  assert(typeof value.kind === "string", `${label}.kind must be a string`);
  if (value.kind === "integer") assert(INTEGER_PATTERN.test(value.value), `${label}.value is not an integer string`);
  else if (value.kind === "decimal") assert(DECIMAL_PATTERN.test(value.value), `${label}.value is not a decimal string`);
  else if (value.kind === "text") assert(typeof value.value === "string" && value.value.length <= 4096, `${label}.value is not bounded text`);
  else if (value.kind === "boolean") assert(typeof value.value === "boolean", `${label}.value is not boolean`);
  else if (value.kind === "timestamp") assert(TIMESTAMP_PATTERN.test(value.value), `${label}.value is not a timestamp string`);
  else if (value.kind === "hash") assert(HASH_PATTERN.test(value.value), `${label}.value is not a hash`);
  else fail(`${label}.kind is unknown`);
}

export function validateTerms(terms) {
  assertKeys(terms, ["schema", "condition", "sources", "resolutionPolicy"], ["title", "statement", "metadata"], "terms");
  assert(terms.schema === "challenge-escrow.terms/v1", "terms.schema drifted");
  validateCondition(terms.condition, "terms.condition");
  assert(Array.isArray(terms.sources) && terms.sources.length >= 1 && terms.sources.length <= 16, "terms.sources length");
  const sourceIds = new Set();
  terms.sources.forEach((source, index) => {
    const label = `terms.sources[${index}]`;
    assertKeys(source, ["id", "kind", "locator"], ["trust"], label);
    assert(ID_PATTERN.test(source.id), `${label}.id is invalid`);
    assert(!sourceIds.has(source.id), `${label}.id is duplicated`);
    sourceIds.add(source.id);
    assert(["chain-log", "api", "document", "manual"].includes(source.kind), `${label}.kind is invalid`);
    assert(typeof source.locator === "string" && source.locator.length >= 1 && source.locator.length <= 2048, `${label}.locator is invalid`);
    if (Object.hasOwn(source, "trust")) assert(["untrusted", "authenticated"].includes(source.trust), `${label}.trust is invalid`);
  });
  const policy = terms.resolutionPolicy;
  assertKeys(policy, ["conditionLanguage", "allowedOutcomes", "voidReasons"], [], "terms.resolutionPolicy");
  assert(policy.conditionLanguage === "challenge-escrow.condition-language/v1", "terms condition language drifted");
  assert(Array.isArray(policy.allowedOutcomes) && policy.allowedOutcomes.length >= 1 && policy.allowedOutcomes.length <= 3, "terms.allowedOutcomes length");
  assert(new Set(policy.allowedOutcomes).size === policy.allowedOutcomes.length && policy.allowedOutcomes.every((item) => ["A", "B", "VOID"].includes(item)), "terms.allowedOutcomes is invalid");
  assert(Array.isArray(policy.voidReasons) && policy.voidReasons.length >= 1 && policy.voidReasons.length <= 6, "terms.voidReasons length");
  assert(new Set(policy.voidReasons).size === policy.voidReasons.length, "terms.voidReasons is duplicated");
  if (Object.hasOwn(terms, "title")) assert(typeof terms.title === "string" && terms.title.length >= 1 && terms.title.length <= 256, "terms.title is invalid");
  if (Object.hasOwn(terms, "statement")) assert(typeof terms.statement === "string" && terms.statement.length >= 1 && terms.statement.length <= 4096, "terms.statement is invalid");
}

export function validateEvidence(evidence) {
  assertKeys(evidence, ["schema", "challengeId", "specHash", "role", "outcome", "reasonCode", "capturedAt", "conditionLanguage", "observations", "artifacts"], ["parentEvidenceHash", "evaluations"], "evidence");
  assert(evidence.schema === "challenge-escrow.evidence/v1", "evidence.schema drifted");
  assert(HASH_PATTERN.test(evidence.challengeId), "evidence.challengeId is invalid");
  assert(HASH_PATTERN.test(evidence.specHash), "evidence.specHash is invalid");
  if (Object.hasOwn(evidence, "parentEvidenceHash")) assert(HASH_PATTERN.test(evidence.parentEvidenceHash), "evidence.parentEvidenceHash is invalid");
  assert(["resolver", "challenger", "acceptor", "arbiter", "timeout"].includes(evidence.role), "evidence.role is invalid");
  assert(["A", "B", "VOID"].includes(evidence.outcome), "evidence.outcome is invalid");
  assert(typeof evidence.reasonCode === "string" && /^[0-9]{1,2}$/.test(evidence.reasonCode) && Number(evidence.reasonCode) <= (evidence.outcome === "VOID" ? 5 : 3), "evidence.reasonCode is invalid");
  assert(TIMESTAMP_PATTERN.test(evidence.capturedAt), "evidence.capturedAt is invalid");
  assert(evidence.conditionLanguage === "challenge-escrow.condition-language/v1", "evidence condition language drifted");
  assert(Array.isArray(evidence.observations) && evidence.observations.length >= 1 && evidence.observations.length <= 64, "evidence.observations length");
  const ids = new Set();
  evidence.observations.forEach((observation, index) => {
    const label = `evidence.observations[${index}]`;
    assertKeys(observation, ["id", "sourceId", "observedAt", "value"], [], label);
    assert(ID_PATTERN.test(observation.id) && !ids.has(observation.id), `${label}.id is invalid or duplicated`);
    ids.add(observation.id);
    assert(ID_PATTERN.test(observation.sourceId), `${label}.sourceId is invalid`);
    assert(TIMESTAMP_PATTERN.test(observation.observedAt), `${label}.observedAt is invalid`);
    validateValue(observation.value, `${label}.value`);
  });
  if (Object.hasOwn(evidence, "evaluations")) {
    assert(Array.isArray(evidence.evaluations) && evidence.evaluations.length <= 64, "evidence.evaluations length");
    evidence.evaluations.forEach((evaluation, index) => {
      const label = `evidence.evaluations[${index}]`;
      assertKeys(evaluation, ["path", "result", "observationIds"], [], label);
      assert(typeof evaluation.path === "string" && /^\/[A-Za-z0-9._~-]{1,64}(?:\/[A-Za-z0-9._~-]{1,64})*$/.test(evaluation.path), `${label}.path is invalid`);
      assert(typeof evaluation.result === "boolean", `${label}.result is invalid`);
      assert(Array.isArray(evaluation.observationIds) && evaluation.observationIds.length >= 1 && evaluation.observationIds.length <= 32, `${label}.observationIds length`);
      assert(evaluation.observationIds.every((id) => ids.has(id)), `${label}.observationIds references an unknown observation`);
    });
  }
  assert(Array.isArray(evidence.artifacts) && evidence.artifacts.length <= 64, "evidence.artifacts length");
  evidence.artifacts.forEach((artifact, index) => {
    const label = `evidence.artifacts[${index}]`;
    assertKeys(artifact, ["hash", "mediaType"], ["sizeBytes"], label);
    assert(HASH_PATTERN.test(artifact.hash), `${label}.hash is invalid`);
    assert(typeof artifact.mediaType === "string" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(artifact.mediaType), `${label}.mediaType is invalid`);
    if (Object.hasOwn(artifact, "sizeBytes")) assert(/^(0|[1-9][0-9]*)$/.test(artifact.sizeBytes), `${label}.sizeBytes is invalid`);
  });
}

export function evaluateCondition(condition, observations) {
  validateCondition(condition);
  assert(Array.isArray(observations), "observations must be an array");
  const values = new Map();
  for (const observation of observations) {
    assert(observation && typeof observation.id === "string", "observation id is required");
    assert(!values.has(observation.id), `observation id is duplicated: ${observation.id}`);
    validateValue(observation.value, `observation ${observation.id}.value`);
    values.set(observation.id, observation.value);
  }
  return evaluateNode(condition.root, values);
}

function evaluateNode(node, values) {
  if (node.op === "all") return node.args.every((child) => evaluateNode(child, values));
  if (node.op === "any") return node.args.some((child) => evaluateNode(child, values));
  if (node.op === "not") return !evaluateNode(node.arg, values);
  if (node.op === "between") {
    const actual = resolveValue(node.value, values);
    const lower = resolveValue(node.lower, values);
    const upper = resolveValue(node.upper, values);
    assert(compareValues(lower, upper) <= 0, "between bounds are reversed");
    const lowerComparison = compareValues(actual, lower);
    const upperComparison = compareValues(actual, upper);
    return node.inclusive
      ? lowerComparison >= 0 && upperComparison <= 0
      : lowerComparison > 0 && upperComparison < 0;
  }
  const comparison = compareValues(resolveValue(node.left, values), resolveValue(node.right, values));
  if (node.op === "eq") return comparison === 0;
  if (node.op === "neq") return comparison !== 0;
  if (node.op === "lt") return comparison < 0;
  if (node.op === "lte") return comparison <= 0;
  if (node.op === "gt") return comparison > 0;
  if (node.op === "gte") return comparison >= 0;
  fail(`unsupported evaluation operator: ${node.op}`);
}

function resolveValue(value, observations) {
  if (Object.hasOwn(value, "ref")) {
    const match = /^\/observations\/([A-Za-z0-9._~-]{1,64})\/value$/.exec(value.ref);
    assert(match && observations.has(match[1]), `missing observation: ${value.ref}`);
    return observations.get(match[1]);
  }
  return value;
}

function compareValues(left, right) {
  const numericLeft = left.kind === "integer" || left.kind === "decimal";
  const numericRight = right.kind === "integer" || right.kind === "decimal";
  assert(numericLeft === numericRight, `incompatible value kinds: ${left.kind} and ${right.kind}`);
  if (numericLeft) {
    const leftRational = rational(left.value);
    const rightRational = rational(right.value);
    const difference = leftRational.numerator * rightRational.denominator
      - rightRational.numerator * leftRational.denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }
  assert(left.kind === right.kind, `incompatible value kinds: ${left.kind} and ${right.kind}`);
  if (left.kind === "boolean") return left.value === right.value ? 0 : left.value ? 1 : -1;
  if (left.kind === "timestamp") {
    const a = BigInt(left.value);
    const b = BigInt(right.value);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const a = left.kind === "hash" ? left.value.toLowerCase() : left.value;
  const b = right.kind === "hash" ? right.value.toLowerCase() : right.value;
  return compareCodePoints(a, b);
}

function rational(value) {
  const [whole, fraction = ""] = value.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const sign = whole.startsWith("-") ? -1n : 1n;
  const unsignedWhole = whole.replace(/^-/, "");
  return {
    numerator: sign * (BigInt(unsignedWhole) * scale + BigInt(fraction || "0")),
    denominator: scale,
  };
}
