#!/usr/bin/env python3
"""Independent observer-receipt conformance verifier.

This implementation deliberately does not import or execute the JavaScript
builder. It reconstructs quorum evidence, commitments, canonical bytes, and
the domain-separated receipt hash from the public vectors.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import subprocess
import unicodedata
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
VECTOR_PATH = ROOT / "spec/vectors/observer-receipt-v1.json"
NEGATIVE_PATH = ROOT / "spec/vectors/observer-receipt-negative-v1.json"
TAGS = ("latest", "safe", "finalized")
DECIMAL = re.compile(r"^(0|[1-9][0-9]*)$")
HASH = re.compile(r"^0x[0-9a-f]{64}$")
ADDRESS = re.compile(r"^0x[0-9a-f]{40}$")
PROVIDER = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
PROVIDER_ERRORS = {
    "FINALITY_TAGS_UNAVAILABLE",
    "MALFORMED_BLOCK_HEADER",
    "LATEST_NUMBER_MISMATCH",
    "FINALITY_ORDER_INVALID",
    "FINALITY_CHAIN_INVALID",
    "LATEST_BLOCK_UNAVAILABLE",
    "LATEST_BLOCK_CHANGED",
    "RPC_READ_FAILED",
}
SHA256 = re.compile(r"^sha256:[0-9a-f]{64}$")
MAX_UINT256 = (1 << 256) - 1
MAX_UINT64 = (1 << 64) - 1
MAX_EVIDENCE_ITEMS = 50_000
MAX_EVIDENCE_NODES = 2_000_000
MAX_EVIDENCE_DEPTH = 64
MAX_EVIDENCE_STRING_BYTES = 16_384
MAX_EVIDENCE_BYTES = 64 * 1024 * 1024


class ReceiptError(Exception):
    def __init__(self, code: str, path: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.path = path


def reject(code: str, path: str, message: str) -> None:
    raise ReceiptError(code, path, message)


def require(condition: bool, code: str, path: str, message: str) -> None:
    if not condition:
        reject(code, path, message)


def pairs_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    normalized_keys: set[str] = set()
    for key, value in pairs:
        normalized_key = unicodedata.normalize("NFC", key)
        if normalized_key in normalized_keys:
            reject("DuplicateKey", key, f"duplicate object key after NFC normalization: {key}")
        normalized_keys.add(normalized_key)
        result[key] = value
    return result


def parse_json(raw: str) -> Any:
    return json.loads(raw, object_pairs_hook=pairs_without_duplicates)


def load_json(path: Path) -> Any:
    return parse_json(path.read_text(encoding="utf-8"))


def require_keys(value: Any, required: tuple[str, ...], optional: tuple[str, ...], path: str) -> None:
    require(isinstance(value, dict), "Structure", path, f"{path} must be an object")
    allowed = set(required) | set(optional)
    for key in required:
        require(key in value, "Structure", f"{path}.{key}", f"{path}.{key} is required")
    for key in value:
        require(key in allowed, "UnknownField", f"{path}.{key}", f"{path}.{key} is unknown")


def decimal(value: Any, path: str) -> int:
    require(isinstance(value, str) and len(value) <= 78 and DECIMAL.fullmatch(value) is not None,
            "NonCanonicalDecimal", path, f"{path} must be a canonical decimal string")
    parsed = int(value)
    require(parsed <= MAX_UINT256, "DecimalRange", path, f"{path} exceeds uint256")
    return parsed


def hash_value(value: Any, path: str) -> str:
    require(isinstance(value, str) and HASH.fullmatch(value) is not None,
            "InvalidHash", path, f"{path} must be lowercase bytes32")
    return value


def address(value: Any, path: str) -> str:
    require(isinstance(value, str) and ADDRESS.fullmatch(value) is not None,
            "InvalidAddress", path, f"{path} must be a lowercase address")
    return value


def provider_id(value: Any, path: str) -> str:
    require(isinstance(value, str) and PROVIDER.fullmatch(value) is not None,
            "UnsafeProviderId", path, f"{path} must be endpoint-neutral")
    return value


def normalize_string(value: str) -> str:
    return unicodedata.normalize("NFC", value)


def canonicalize(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(normalize_string(value), ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (int, float)):
        raise ValueError("JSON numbers are forbidden; use decimal strings")
    if isinstance(value, list):
        return "[" + ",".join(canonicalize(item) for item in value) + "]"
    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for key, nested in value.items():
            normalized_key = normalize_string(key)
            if normalized_key in normalized:
                raise ValueError(f"object keys collide after NFC normalization: {normalized_key}")
            normalized[normalized_key] = nested
        encoded = []
        for key in sorted(normalized):
            encoded.append(f"{json.dumps(key, ensure_ascii=False)}:{canonicalize(normalized[key])}")
        return "{" + ",".join(encoded) + "}"
    raise ValueError("unsupported JSON value")


def normalize_block(value: Any, path: str) -> dict[str, str]:
    require_keys(value, ("number", "hash", "parentHash"), (), path)
    require(decimal(value["number"], f"{path}.number") <= MAX_UINT64,
            "DecimalRange", f"{path}.number", f"{path}.number exceeds uint64")
    hash_value(value["hash"], f"{path}.hash")
    hash_value(value["parentHash"], f"{path}.parentHash")
    return {"number": value["number"], "hash": value["hash"], "parentHash": value["parentHash"]}


def nullable_block(value: Any, path: str) -> dict[str, str] | None:
    return None if value is None else normalize_block(value, path)


def block_key(value: dict[str, str]) -> str:
    return f'{value["number"]}:{value["hash"]}:{value["parentHash"]}'


def same_block(left: Any, right: Any) -> bool:
    return isinstance(left, dict) and isinstance(right, dict) and block_key(left) == block_key(right)


def coherent_pair(newer: dict[str, str], older: dict[str, str]) -> bool:
    newer_number = int(newer["number"])
    older_number = int(older["number"])
    if newer_number < older_number:
        return False
    if newer_number == older_number:
        return same_block(newer, older)
    if newer_number == older_number + 1:
        return newer["parentHash"] == older["hash"]
    return True


def normalize_provider(value: Any, path: str) -> dict[str, Any]:
    require_keys(value, ("providerId", "status", "latest", "safe", "finalized", "error"), (), path)
    identifier = provider_id(value["providerId"], f"{path}.providerId")
    require(value["status"] in ("available", "unavailable"), "ProviderStatus", f"{path}.status", "invalid provider status")
    normalized = {
        "providerId": identifier,
        "status": value["status"],
        "latest": nullable_block(value["latest"], f"{path}.latest"),
        "safe": nullable_block(value["safe"], f"{path}.safe"),
        "finalized": nullable_block(value["finalized"], f"{path}.finalized"),
        "error": value["error"],
    }
    if value["status"] == "available":
        require(value["error"] is None and all(normalized[tag] is not None for tag in TAGS),
                "ProviderStatus", path, "available provider must expose all heads")
        require(coherent_pair(normalized["latest"], normalized["safe"])
                and coherent_pair(normalized["safe"], normalized["finalized"]),
                "FinalityOrder", path, "provider finality heads are internally inconsistent")
    else:
        require(all(normalized[tag] is None for tag in TAGS),
                "ProviderStatus", path, "unavailable provider cannot carry stale heads")
        error = value["error"]
        require(isinstance(error, str) and error in PROVIDER_ERRORS,
                "UnsafeProviderError", f"{path}.error", "unavailable provider needs a recognized endpoint-free error code")
    return normalized


def quorum_for_tag(providers: list[dict[str, Any]], tag: str, threshold: int) -> dict[str, Any]:
    unavailable = sorted(provider["providerId"] for provider in providers
                         if provider["status"] != "available" or provider[tag] is None)
    grouped: dict[str, dict[str, Any]] = {}
    for provider in providers:
        if provider["status"] != "available" or provider[tag] is None:
            continue
        key = block_key(provider[tag])
        group = grouped.setdefault(key, {"block": provider[tag], "providers": []})
        group["providers"].append(provider["providerId"])
    groups = []
    for key in sorted(grouped):
        group = grouped[key]
        groups.append({"block": group["block"], "providers": sorted(group["providers"])})
    winning = [group for group in groups if len(group["providers"]) >= threshold]
    if len(winning) == 1:
        supporters = winning[0]["providers"]
        supporter_set = set(supporters)
        dissenters = sorted(identifier for group in groups for identifier in group["providers"]
                            if identifier not in supporter_set)
        return {
            "status": "agree",
            "agreed": winning[0]["block"],
            "supporters": supporters,
            "dissenters": dissenters,
            "unavailable": unavailable,
            "groups": groups,
        }
    return {
        "status": "conflicted" if len(groups) > 1 else "unavailable",
        "agreed": None,
        "supporters": [],
        "dissenters": sorted(identifier for group in groups for identifier in group["providers"]),
        "unavailable": unavailable,
        "groups": groups,
    }


def build_quorum(providers_input: Any, threshold_input: Any) -> dict[str, Any]:
    require(isinstance(providers_input, list) and 2 <= len(providers_input) <= 16,
            "ProviderCount", "quorum.providers", "quorum requires two to sixteen providers")
    providers = sorted(
        (normalize_provider(value, f"quorum.providers[{index}]") for index, value in enumerate(providers_input)),
        key=lambda value: value["providerId"],
    )
    identifiers = [provider["providerId"] for provider in providers]
    require(len(set(identifiers)) == len(identifiers), "DuplicateProvider", "quorum.providers", "provider IDs must be unique")
    threshold = decimal(threshold_input, "quorum.threshold")
    require(2 <= threshold <= len(providers), "InvalidThreshold", "quorum.threshold", "threshold is outside provider set")
    require(threshold * 2 > len(providers), "InvalidThreshold", "quorum.threshold", "threshold must be a strict provider majority")
    heads = {tag: quorum_for_tag(providers, tag, threshold) for tag in TAGS}
    statuses = [heads[tag]["status"] for tag in TAGS]
    status = "conflicted" if "conflicted" in statuses else "unavailable" if "unavailable" in statuses else "agree"
    return {
        "schema": "challenge-escrow.rpc-quorum/v1",
        "status": status,
        "threshold": threshold_input,
        "compared": list(TAGS),
        "heads": heads,
        "providers": providers,
    }


def validate_release(value: Any) -> dict[str, Any]:
    require_keys(value, ("chainId", "escrowContract", "releaseId", "eventProtocolId", "protocolVersion"), (), "receipt.release")
    chain_id = decimal(value["chainId"], "receipt.release.chainId")
    require(chain_id > 0, "ReleaseDrift", "receipt.release.chainId", "release chain ID cannot be zero")
    escrow_contract = address(value["escrowContract"], "receipt.release.escrowContract")
    require(escrow_contract != "0x" + "0" * 40, "ReleaseDrift", "receipt.release.escrowContract", "release escrow cannot be zero")
    hash_value(value["releaseId"], "receipt.release.releaseId")
    require(value["eventProtocolId"] == "challenge-escrow-event/v1", "ReleaseDrift", "receipt.release.eventProtocolId", "event protocol drifted")
    require(value["protocolVersion"] == "challenge-escrow-protocol/v1", "ReleaseDrift", "receipt.release.protocolVersion", "protocol version drifted")
    preimage = (
        b"challenge-escrow.release-id/v1"
        + b"\x00"
        + chain_id.to_bytes(32, "big")
        + bytes.fromhex(escrow_contract.removeprefix("0x"))
    )
    result = subprocess.run(
        ["cast", "keccak", "0x" + preimage.hex()],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    expected_release_id = result.stdout.strip().lower()
    require(value["releaseId"] == expected_release_id, "ReleaseDrift", "receipt.release.releaseId", "release ID does not match chain and escrow")
    return copy.deepcopy(value)


def validate_head(value: Any, quorum: dict[str, Any]) -> dict[str, str]:
    require_keys(value, ("number", "hash", "parentHash", "finality"), (), "receipt.head")
    normalized = normalize_block({
        "number": value["number"],
        "hash": value["hash"],
        "parentHash": value["parentHash"],
    }, "receipt.head")
    finality = value["finality"]
    require(finality in (*TAGS, "unknown"), "Finality", "receipt.head.finality", "receipt finality is invalid")
    if finality != "unknown":
        evidence = quorum["heads"][finality]
        require(evidence["status"] == "agree" and same_block(evidence["agreed"], normalized),
                "HeadNotInQuorum", "receipt.head", "receipt head is not supported by quorum")
    else:
        observed = any(
            same_block(group["block"], normalized)
            for tag in TAGS
            for group in quorum["heads"][tag]["groups"]
        )
        require(observed, "HeadNotInQuorum", "receipt.head",
                "unknown-finality head was not reported by any provider")
    return {**normalized, "finality": finality}


def sha256_domain(domain: str, value: Any) -> str:
    payload = f"{domain}\0{canonicalize(value)}".encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def bounded_evidence(value: Any, path: str) -> None:
    stack: list[tuple[Any, int]] = [(value, 0)]
    nodes = 0
    byte_count = 0
    while stack:
        nested, depth = stack.pop()
        nodes += 1
        require(nodes <= MAX_EVIDENCE_NODES, "ResourceLimit", path, f"{path} contains too many values")
        require(depth <= MAX_EVIDENCE_DEPTH, "ResourceLimit", path, f"{path} is nested too deeply")
        if nested is None or isinstance(nested, bool):
            continue
        if isinstance(nested, str):
            string_bytes = len(nested.encode("utf-8"))
            require(string_bytes <= MAX_EVIDENCE_STRING_BYTES, "ResourceLimit", path, f"{path} contains an oversized string")
            byte_count += string_bytes
        elif isinstance(nested, list):
            stack.extend((item, depth + 1) for item in nested)
        elif isinstance(nested, dict):
            for key, item in nested.items():
                byte_count += len(key.encode("utf-8"))
                stack.append((item, depth + 1))
        else:
            reject("NonCanonicalValue", path, f"{path} must contain only JSON values without numbers")
        require(byte_count <= MAX_EVIDENCE_BYTES, "ResourceLimit", path, f"{path} exceeds the byte budget")


def build_receipt(input_value: Any) -> dict[str, Any]:
    require_keys(input_value, ("release", "head", "providers", "threshold", "logs", "challenges", "anomalies"), (), "input")
    release = validate_release(input_value["release"])
    quorum = build_quorum(input_value["providers"], input_value["threshold"])
    head = validate_head(input_value["head"], quorum)
    for field in ("logs", "challenges", "anomalies"):
        require(isinstance(input_value[field], list), "Structure", f"input.{field}", f"input.{field} must be an array")
        require(len(input_value[field]) <= MAX_EVIDENCE_ITEMS, "ResourceLimit", f"input.{field}", f"input.{field} exceeds the item limit")
        bounded_evidence(input_value[field], f"input.{field}")
    receipt = {
        "schema": "challenge-escrow.observer-receipt/v1",
        "release": release,
        "head": head,
        "quorum": quorum,
        "commitments": {
            "canonicalLogs": sha256_domain("challenge-escrow.observer-logs/v1", input_value["logs"]),
            "projectedState": sha256_domain("challenge-escrow.observer-state/v1", input_value["challenges"]),
            "anomalies": sha256_domain("challenge-escrow.observer-anomalies/v1", input_value["anomalies"]),
        },
        "counts": {
            "logs": str(len(input_value["logs"])),
            "challenges": str(len(input_value["challenges"])),
            "anomalies": str(len(input_value["anomalies"])),
        },
    }
    validate_receipt(receipt)
    return receipt


def validate_receipt(receipt: Any) -> None:
    require_keys(receipt, ("schema", "release", "head", "quorum", "commitments", "counts"), (), "receipt")
    require(receipt["schema"] == "challenge-escrow.observer-receipt/v1", "Schema", "receipt.schema", "receipt schema drifted")
    validate_release(receipt["release"])
    quorum = receipt["quorum"]
    require_keys(quorum, ("schema", "status", "threshold", "compared", "heads", "providers"), (), "receipt.quorum")
    require(quorum["schema"] == "challenge-escrow.rpc-quorum/v1", "Schema", "receipt.quorum.schema", "quorum schema drifted")
    require(quorum["compared"] == list(TAGS), "ComparedTags", "receipt.quorum.compared", "quorum tags drifted")
    recomputed = build_quorum(quorum["providers"], quorum["threshold"])
    require(canonicalize(recomputed) == canonicalize(quorum), "QuorumMismatch", "receipt.quorum", "quorum evidence does not recompute")
    validate_head(receipt["head"], quorum)
    require_keys(receipt["commitments"], ("canonicalLogs", "projectedState", "anomalies"), (), "receipt.commitments")
    for field in ("canonicalLogs", "projectedState", "anomalies"):
        require(isinstance(receipt["commitments"][field], str) and SHA256.fullmatch(receipt["commitments"][field]) is not None,
                "Commitment", f"receipt.commitments.{field}", "invalid commitment")
    require_keys(receipt["counts"], ("logs", "challenges", "anomalies"), (), "receipt.counts")
    for field in ("logs", "challenges", "anomalies"):
        count = decimal(receipt["counts"][field], f"receipt.counts.{field}")
        require(count <= MAX_EVIDENCE_ITEMS, "ResourceLimit", f"receipt.counts.{field}", f"receipt.counts.{field} exceeds the item limit")


def receipt_hash(receipt: dict[str, Any]) -> str:
    validate_receipt(receipt)
    payload = f"challenge-escrow.observer-receipt/v1\0{canonicalize(receipt)}".encode("utf-8")
    result = subprocess.run(
        ["cast", "keccak", "0x" + payload.hex()],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return result.stdout.strip().lower()


def verify(input_value: Any, expected: dict[str, Any]) -> dict[str, Any]:
    receipt = build_receipt(input_value)
    require(canonicalize(receipt) == canonicalize(expected["receipt"]),
            "ReceiptMismatch", "expected.receipt", "receipt does not reproduce")
    digest = receipt_hash(receipt)
    require(digest == expected["receiptHash"], "ReceiptHashMismatch", "expected.receiptHash", "receipt hash does not reproduce")
    canonical_bytes = str(len(canonicalize(receipt).encode("utf-8")))
    require(canonical_bytes == expected["canonicalBytes"], "CanonicalBytes", "expected.canonicalBytes", "canonical byte count drifted")
    return {"receipt": receipt, "receiptHash": digest, "canonicalBytes": canonical_bytes}


def mutate(vector: dict[str, Any], mutation: str) -> tuple[dict[str, Any], dict[str, Any]]:
    input_value = copy.deepcopy(vector["input"])
    expected = copy.deepcopy(vector["expected"])
    if mutation == "duplicate-provider":
        input_value["providers"].append(copy.deepcopy(input_value["providers"][0]))
    elif mutation == "noncanonical-threshold":
        input_value["threshold"] = "02"
    elif mutation == "non-majority-threshold":
        provider = copy.deepcopy(input_value["providers"][0])
        provider["providerId"] = "provider-d"
        input_value["providers"].append(provider)
        input_value["threshold"] = "2"
    elif mutation == "oversized-evidence-set":
        input_value["logs"] = [None] * 50_001
    elif mutation == "deep-evidence":
        nested: Any = None
        for _ in range(65):
            nested = [nested]
        input_value["anomalies"] = [nested]
    elif mutation == "uint256-overflow":
        input_value["release"]["chainId"] = str(1 << 256)
    elif mutation == "block-number-overflow":
        input_value["providers"][0]["latest"]["number"] = str(1 << 64)
    elif mutation == "release-id-mismatch":
        input_value["release"]["releaseId"] = "0x" + "1" * 64
    elif mutation == "unsafe-provider-id":
        input_value["providers"][0]["providerId"] = "https://rpc.example"
    elif mutation == "hostname-provider-id":
        input_value["providers"][0]["providerId"] = "rpc.example"
    elif mutation == "unsafe-provider-error":
        input_value["providers"][0].update({
            "status": "unavailable",
            "latest": None,
            "safe": None,
            "finalized": None,
            "error": "https://user:secret@rpc.example",
        })
    elif mutation == "unrecognized-provider-error":
        input_value["providers"][0].update({
            "status": "unavailable",
            "latest": None,
            "safe": None,
            "finalized": None,
            "error": "API_KEY_ABCDEF",
        })
    elif mutation == "unavailable-provider-carries-head":
        input_value["providers"][0]["status"] = "unavailable"
        input_value["providers"][0]["error"] = "RPC_READ_FAILED"
    elif mutation == "invalid-finality-order":
        input_value["providers"][0]["safe"]["number"] = "103"
    elif mutation == "same-height-finality-fork":
        input_value["providers"][0]["safe"]["number"] = input_value["providers"][0]["latest"]["number"]
    elif mutation == "unknown-unobserved-head":
        input_value["head"] = {
            "number": "50",
            "hash": "0x" + "4" * 64,
            "parentHash": "0x" + "3" * 64,
            "finality": "unknown",
        }
    elif mutation == "parent-hash-fork":
        provider = next(item for item in input_value["providers"] if item["providerId"] == "provider-b")
        provider["latest"]["parentHash"] = "0x" + "4" * 64
        canonical = next(item for item in input_value["providers"] if item["providerId"] == "provider-a")["latest"]
        input_value["head"] = {**copy.deepcopy(canonical), "finality": "latest"}
    elif mutation == "altered-head":
        expected["receipt"]["head"]["hash"] = "0x" + "4" * 64
    elif mutation == "release-drift":
        expected["receipt"]["release"]["protocolVersion"] = "challenge-escrow-protocol/v2"
    elif mutation == "provider-order":
        expected["receipt"]["quorum"]["providers"].reverse()
    elif mutation == "digest-mismatch":
        expected["receipt"]["commitments"]["anomalies"] = "sha256:" + "0" * 64
    elif mutation == "hidden-anomaly":
        input_value["anomalies"].append({"code": "hidden", "severity": "critical"})
    else:
        raise ValueError(f"unknown observer receipt mutation: {mutation}")
    return input_value, expected


def run_negative(vector: dict[str, Any], corpus: dict[str, Any]) -> None:
    for test_case in corpus["cases"]:
        observed = None
        try:
            if test_case["operation"] == "parse":
                raw = ('{"\\u00e9":"one","e\\u0301":"two"}'
                       if test_case["mutation"] == "nfc-colliding-json-keys"
                       else '{"schema":"one","schema":"two"}')
                parse_json(raw)
            else:
                input_value, expected = mutate(vector, test_case["mutation"])
                if test_case["operation"] == "build":
                    build_receipt(input_value)
                elif test_case["operation"] == "validate":
                    validate_receipt(expected["receipt"])
                elif test_case["operation"] == "verify":
                    verify(input_value, expected)
                else:
                    raise ValueError(f'unknown operation: {test_case["operation"]}')
        except ReceiptError as error:
            observed = error.code
        require(observed == test_case["expectedCode"], "NegativeCase", test_case["id"],
                f'{test_case["id"]}: expected {test_case["expectedCode"]}, observed {observed or "accept"}')


def main() -> None:
    vector = load_json(VECTOR_PATH)
    corpus = load_json(NEGATIVE_PATH)
    require(vector.get("schema") == "challenge-escrow.observer-receipt-vector/v1", "Schema", "vector.schema", "vector schema drifted")
    require(corpus.get("schema") == "challenge-escrow.observer-receipt-negative/v1", "Schema", "negative.schema", "negative schema drifted")
    require(vector["expected"]["receipt"] is not None, "MissingExpected", "vector.expected", "generate the observer receipt vector first")
    verified = verify(vector["input"], vector["expected"])
    run_negative(vector, corpus)
    print(json.dumps({
        "status": "ok",
        "implementation": "python",
        "receiptHash": verified["receiptHash"],
        "canonicalBytes": verified["canonicalBytes"],
        "negativeCases": len(corpus["cases"]),
        "quorumStatus": verified["receipt"]["quorum"]["status"],
    }, indent=2))


if __name__ == "__main__":
    main()
