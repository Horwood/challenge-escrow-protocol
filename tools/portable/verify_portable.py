#!/usr/bin/env python3
"""Independent portable-semantics verifier using only the Python stdlib and PyCryptodome."""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

from Crypto.Hash import keccak


ROOT = Path(__file__).resolve().parents[2]
VECTOR_PATH = ROOT / "spec" / "vectors" / "portable-v1.json"
HASH_RE = re.compile(r"^0x[0-9a-fA-F]{64}$")
ID_RE = re.compile(r"^[A-Za-z0-9._~-]{1,64}$")
REF_RE = re.compile(r"^/observations/([A-Za-z0-9._~-]{1,64})/value$")
TIMESTAMP_RE = re.compile(r"^[0-9]{1,20}$")
INTEGER_RE = re.compile(r"^-?(0|[1-9][0-9]*)$")
DECIMAL_RE = re.compile(r"^-?(0|[1-9][0-9]*)\.[0-9]+$")


def fail(message: str) -> None:
    raise ValueError(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def parse_no_duplicates(text: str) -> Any:
    def hook(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            require(key not in result, f"duplicate object key: {key}")
            result[key] = value
        return result

    return json.loads(text, object_pairs_hook=hook)


def normalized(value: str, label: str) -> str:
    require(isinstance(value, str), f"{label} must be a string")
    for index, character in enumerate(value):
        code = ord(character)
        require(not 0xD800 <= code <= 0xDFFF, f"{label} contains a surrogate")
    return unicodedata.normalize("NFC", value)


def canonical(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(normalized(value, "string"), ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (int, float)):
        fail("JSON numbers are forbidden; use tagged strings")
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    require(isinstance(value, dict), "unsupported JSON value")
    entries: dict[str, Any] = {}
    for key, nested in value.items():
        normalized_key = normalized(key, "object key")
        require(normalized_key not in entries, f"object keys collide after NFC normalization: {normalized_key}")
        entries[normalized_key] = nested
    return "{" + ",".join(
        json.dumps(key, ensure_ascii=False, separators=(",", ":")) + ":" + canonical(entries[key])
        for key in sorted(entries, key=lambda item: tuple(ord(character) for character in item))
    ) + "}"


def hash_domain(domain: str, value: Any) -> str:
    digest = keccak.new(digest_bits=256)
    digest.update((domain + "\0" + canonical(value)).encode("utf-8"))
    return "0x" + digest.hexdigest()


def keys(value: Any, required: set[str], optional: set[str], label: str) -> None:
    require(isinstance(value, dict), f"{label} must be an object")
    require(required.issubset(value), f"{label} is missing a required key")
    require(set(value).issubset(required | optional), f"{label} has an unknown key")


def validate_value(value: Any, label: str) -> None:
    require(isinstance(value, dict), f"{label} must be an object")
    if "ref" in value:
        keys(value, {"ref"}, set(), label)
        require(isinstance(value["ref"], str) and REF_RE.fullmatch(value["ref"]), f"{label}.ref is invalid")
        return
    keys(value, {"kind", "value"}, set(), label)
    kind = value["kind"]
    item = value["value"]
    if kind == "integer":
        require(isinstance(item, str) and INTEGER_RE.fullmatch(item) and len(item) <= 78, f"{label}.value is not an integer")
    elif kind == "decimal":
        require(isinstance(item, str) and DECIMAL_RE.fullmatch(item) and len(item) <= 128, f"{label}.value is not a decimal")
    elif kind == "text":
        require(isinstance(item, str) and len(item) <= 4096, f"{label}.value is not bounded text")
    elif kind == "boolean":
        require(isinstance(item, bool), f"{label}.value is not boolean")
    elif kind == "timestamp":
        require(isinstance(item, str) and TIMESTAMP_RE.fullmatch(item), f"{label}.value is not a timestamp")
    elif kind == "hash":
        require(isinstance(item, str) and HASH_RE.fullmatch(item), f"{label}.value is not a hash")
    else:
        fail(f"{label}.kind is unknown")


def validate_node(node: Any, label: str, depth: int = 0) -> None:
    require(depth <= 32, f"{label} exceeds maximum depth")
    require(isinstance(node, dict) and isinstance(node.get("op"), str), f"{label} is invalid")
    operation = node["op"]
    if operation in {"all", "any"}:
        keys(node, {"op", "args"}, set(), label)
        require(isinstance(node["args"], list) and 1 <= len(node["args"]) <= 32, f"{label}.args length")
        for index, child in enumerate(node["args"]):
            validate_node(child, f"{label}.args[{index}]", depth + 1)
    elif operation == "not":
        keys(node, {"op", "arg"}, set(), label)
        validate_node(node["arg"], f"{label}.arg", depth + 1)
    elif operation in {"eq", "neq", "lt", "lte", "gt", "gte"}:
        keys(node, {"op", "left", "right"}, set(), label)
        validate_value(node["left"], f"{label}.left")
        validate_value(node["right"], f"{label}.right")
    elif operation == "between":
        keys(node, {"op", "value", "lower", "upper", "inclusive"}, set(), label)
        validate_value(node["value"], f"{label}.value")
        validate_value(node["lower"], f"{label}.lower")
        validate_value(node["upper"], f"{label}.upper")
        require(isinstance(node["inclusive"], bool), f"{label}.inclusive is invalid")
    else:
        fail(f"{label}.op is unknown")


def validate_condition(condition: Any, label: str) -> None:
    keys(condition, {"schema", "root"}, set(), label)
    require(condition["schema"] == "challenge-escrow.condition-language/v1", f"{label}.schema drifted")
    validate_node(condition["root"], f"{label}.root")


def validate_terms(terms: Any) -> None:
    keys(terms, {"schema", "condition", "sources", "resolutionPolicy"}, {"title", "statement", "metadata"}, "terms")
    require(terms["schema"] == "challenge-escrow.terms/v1", "terms.schema drifted")
    validate_condition(terms["condition"], "terms.condition")
    require(isinstance(terms["sources"], list) and 1 <= len(terms["sources"]) <= 16, "terms.sources length")
    source_ids: set[str] = set()
    for index, source in enumerate(terms["sources"]):
        label = f"terms.sources[{index}]"
        keys(source, {"id", "kind", "locator"}, {"trust"}, label)
        require(isinstance(source["id"], str) and ID_RE.fullmatch(source["id"]) and source["id"] not in source_ids, f"{label}.id is invalid or duplicated")
        source_ids.add(source["id"])
        require(source["kind"] in {"chain-log", "api", "document", "manual"}, f"{label}.kind is invalid")
        require(isinstance(source["locator"], str) and 1 <= len(source["locator"]) <= 2048, f"{label}.locator is invalid")
        if "trust" in source:
            require(source["trust"] in {"untrusted", "authenticated"}, f"{label}.trust is invalid")
    policy = terms["resolutionPolicy"]
    keys(policy, {"conditionLanguage", "allowedOutcomes", "voidReasons"}, set(), "terms.resolutionPolicy")
    require(policy["conditionLanguage"] == "challenge-escrow.condition-language/v1", "terms condition language drifted")
    require(isinstance(policy["allowedOutcomes"], list) and 1 <= len(policy["allowedOutcomes"]) <= 3, "terms.allowedOutcomes length")
    require(len(set(policy["allowedOutcomes"])) == len(policy["allowedOutcomes"]) and set(policy["allowedOutcomes"]) <= {"A", "B", "VOID"}, "terms.allowedOutcomes is invalid")
    require(isinstance(policy["voidReasons"], list) and 1 <= len(policy["voidReasons"]) <= 6, "terms.voidReasons length")
    require(len(set(policy["voidReasons"])) == len(policy["voidReasons"]), "terms.voidReasons is duplicated")


def validate_evidence(evidence: Any) -> None:
    keys(evidence, {"schema", "challengeId", "specHash", "role", "outcome", "reasonCode", "capturedAt", "conditionLanguage", "observations", "artifacts"}, {"parentEvidenceHash", "evaluations"}, "evidence")
    require(evidence["schema"] == "challenge-escrow.evidence/v1", "evidence.schema drifted")
    for field in ("challengeId", "specHash"):
        require(isinstance(evidence[field], str) and HASH_RE.fullmatch(evidence[field]), f"evidence.{field} is invalid")
    if "parentEvidenceHash" in evidence:
        require(isinstance(evidence["parentEvidenceHash"], str) and HASH_RE.fullmatch(evidence["parentEvidenceHash"]), "evidence.parentEvidenceHash is invalid")
    require(evidence["role"] in {"resolver", "challenger", "acceptor", "arbiter", "timeout"}, "evidence.role is invalid")
    require(evidence["outcome"] in {"A", "B", "VOID"}, "evidence.outcome is invalid")
    max_reason = 5 if evidence["outcome"] == "VOID" else 3
    require(isinstance(evidence["reasonCode"], str) and evidence["reasonCode"].isdigit() and 0 <= int(evidence["reasonCode"]) <= max_reason, "evidence.reasonCode is invalid")
    require(isinstance(evidence["capturedAt"], str) and TIMESTAMP_RE.fullmatch(evidence["capturedAt"]), "evidence.capturedAt is invalid")
    require(evidence["conditionLanguage"] == "challenge-escrow.condition-language/v1", "evidence condition language drifted")
    require(isinstance(evidence["observations"], list) and 1 <= len(evidence["observations"]) <= 64, "evidence.observations length")
    observation_ids: set[str] = set()
    for index, observation in enumerate(evidence["observations"]):
        label = f"evidence.observations[{index}]"
        keys(observation, {"id", "sourceId", "observedAt", "value"}, set(), label)
        require(isinstance(observation["id"], str) and ID_RE.fullmatch(observation["id"]) and observation["id"] not in observation_ids, f"{label}.id is invalid or duplicated")
        observation_ids.add(observation["id"])
        require(isinstance(observation["sourceId"], str) and ID_RE.fullmatch(observation["sourceId"]), f"{label}.sourceId is invalid")
        require(isinstance(observation["observedAt"], str) and TIMESTAMP_RE.fullmatch(observation["observedAt"]), f"{label}.observedAt is invalid")
        validate_value(observation["value"], f"{label}.value")
    if "evaluations" in evidence:
        require(isinstance(evidence["evaluations"], list) and len(evidence["evaluations"]) <= 64, "evidence.evaluations length")
        for index, evaluation in enumerate(evidence["evaluations"]):
            label = f"evidence.evaluations[{index}]"
            keys(evaluation, {"path", "result", "observationIds"}, set(), label)
            require(isinstance(evaluation["path"], str) and re.fullmatch(r"/[A-Za-z0-9._~-]{1,64}(?:/[A-Za-z0-9._~-]{1,64})*", evaluation["path"]), f"{label}.path is invalid")
            require(isinstance(evaluation["result"], bool), f"{label}.result is invalid")
            require(isinstance(evaluation["observationIds"], list) and 1 <= len(evaluation["observationIds"]) <= 32, f"{label}.observationIds length")
            require(all(item in observation_ids for item in evaluation["observationIds"]), f"{label}.observationIds references an unknown observation")
    require(isinstance(evidence["artifacts"], list) and len(evidence["artifacts"]) <= 64, "evidence.artifacts length")
    for index, artifact in enumerate(evidence["artifacts"]):
        label = f"evidence.artifacts[{index}]"
        keys(artifact, {"hash", "mediaType"}, {"sizeBytes"}, label)
        require(isinstance(artifact["hash"], str) and HASH_RE.fullmatch(artifact["hash"]), f"{label}.hash is invalid")
        require(isinstance(artifact["mediaType"], str) and re.fullmatch(r"[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+", artifact["mediaType"]), f"{label}.mediaType is invalid")
        if "sizeBytes" in artifact:
            require(isinstance(artifact["sizeBytes"], str) and re.fullmatch(r"(0|[1-9][0-9]*)", artifact["sizeBytes"]), f"{label}.sizeBytes is invalid")


def rational(value: str) -> tuple[int, int]:
    whole, _, fraction = value.partition(".")
    sign = -1 if whole.startswith("-") else 1
    unsigned = whole.removeprefix("-")
    denominator = 10 ** len(fraction)
    return sign * (int(unsigned) * denominator + int(fraction or "0")), denominator


def compare_values(left: dict[str, Any], right: dict[str, Any]) -> int:
    numeric_left = left["kind"] in {"integer", "decimal"}
    numeric_right = right["kind"] in {"integer", "decimal"}
    require(numeric_left == numeric_right, f"incompatible value kinds: {left['kind']} and {right['kind']}")
    if numeric_left:
        left_numerator, left_denominator = rational(left["value"])
        right_numerator, right_denominator = rational(right["value"])
        difference = left_numerator * right_denominator - right_numerator * left_denominator
        return -1 if difference < 0 else 1 if difference > 0 else 0
    require(left["kind"] == right["kind"], f"incompatible value kinds: {left['kind']} and {right['kind']}")
    if left["kind"] == "boolean":
        return 0 if left["value"] == right["value"] else (1 if left["value"] else -1)
    if left["kind"] == "timestamp":
        return -1 if int(left["value"]) < int(right["value"]) else 1 if int(left["value"]) > int(right["value"]) else 0
    left_text = left["value"].lower() if left["kind"] == "hash" else left["value"]
    right_text = right["value"].lower() if right["kind"] == "hash" else right["value"]
    return -1 if left_text < right_text else 1 if left_text > right_text else 0


def evaluate_value(value: dict[str, Any], observations: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if "ref" not in value:
        return value
    match = REF_RE.fullmatch(value["ref"])
    require(match is not None and match.group(1) in observations, f"missing observation: {value['ref']}")
    return observations[match.group(1)]


def evaluate_node(node: dict[str, Any], observations: dict[str, dict[str, Any]]) -> bool:
    operation = node["op"]
    if operation == "all":
        return all(evaluate_node(child, observations) for child in node["args"])
    if operation == "any":
        return any(evaluate_node(child, observations) for child in node["args"])
    if operation == "not":
        return not evaluate_node(node["arg"], observations)
    if operation == "between":
        actual = evaluate_value(node["value"], observations)
        lower = evaluate_value(node["lower"], observations)
        upper = evaluate_value(node["upper"], observations)
        require(compare_values(lower, upper) <= 0, "between bounds are reversed")
        lower_result = compare_values(actual, lower)
        upper_result = compare_values(actual, upper)
        return (lower_result >= 0 and upper_result <= 0) if node["inclusive"] else (lower_result > 0 and upper_result < 0)
    comparison = compare_values(evaluate_value(node["left"], observations), evaluate_value(node["right"], observations))
    return {
        "eq": comparison == 0,
        "neq": comparison != 0,
        "lt": comparison < 0,
        "lte": comparison <= 0,
        "gt": comparison > 0,
        "gte": comparison >= 0,
    }[operation]


def evaluate_condition(condition: dict[str, Any], evidence: dict[str, Any]) -> bool:
    observations: dict[str, dict[str, Any]] = {}
    for observation in evidence["observations"]:
        observations[observation["id"]] = observation["value"]
    return evaluate_node(condition["root"], observations)


def main() -> None:
    for raw, fragment in [('{"a":"one","a":"two"}', "duplicate"), ('{"a":1}', "numbers")]:
        try:
            canonical(parse_no_duplicates(raw))
            fail(f"{fragment} input was accepted")
        except ValueError as error:
            require(fragment in str(error), f"unexpected negative-case error: {error}")
    require(canonical(parse_no_duplicates('{"text":"e\\u0301"}')) == '{"text":"é"}', "NFC normalization is not deterministic")
    decimal_condition = {
        "schema": "challenge-escrow.condition-language/v1",
        "root": {"op": "eq", "left": {"kind": "decimal", "value": "1.50"}, "right": {"kind": "decimal", "value": "1.5"}},
    }
    validate_condition(decimal_condition, "decimal condition")
    require(evaluate_node(decimal_condition["root"], {}), "exact decimal comparison drifted")
    vector = parse_no_duplicates(VECTOR_PATH.read_text(encoding="utf-8"))
    require(vector["version"] == "portable-v1", "vector version drifted")
    terms = vector["terms"]
    evidence = vector["evidence"]
    validate_terms(terms)
    validate_evidence(evidence)
    terms_canonical = canonical(terms)
    evidence_canonical = canonical(evidence)
    terms_hash = hash_domain("challenge-escrow.terms/v1", terms)
    evidence_hash = hash_domain("challenge-escrow.evidence/v1", evidence)
    condition_result = evaluate_condition(terms["condition"], evidence)
    expected = vector["expected"]
    require(terms_canonical == expected["termsCanonical"], "terms canonical bytes drifted")
    require(evidence_canonical == expected["evidenceCanonical"], "evidence canonical bytes drifted")
    require(terms_hash == expected["termsHash"], "terms hash drifted")
    require(evidence_hash == expected["evidenceHash"], "evidence hash drifted")
    require(condition_result == expected["conditionResult"], "condition result drifted")
    print(json.dumps({"status": "ok", "termsHash": terms_hash, "evidenceHash": evidence_hash, "conditionResult": condition_result, "termsBytes": len(terms_canonical.encode()), "evidenceBytes": len(evidence_canonical.encode())}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # pragma: no cover - command-line boundary
        print(f"portable-python: {error}", file=sys.stderr)
        raise SystemExit(1)
