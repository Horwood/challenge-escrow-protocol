#!/usr/bin/env python3
"""Independent release-manifest verifier.

The verifier rebuilds the file sets, compiler boundary, ABI digest, deployed
runtime digests, and manifest hash without importing the JavaScript generator.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import unicodedata
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = ROOT / "spec/release/release-manifest-v1.json"
ARTIFACT_RELATIVE = "contracts/out/ChallengeEscrow.sol/ChallengeEscrow.json"
IMMUTABLE_AST_ARTIFACTS = (
    ARTIFACT_RELATIVE,
    "contracts/out/ChallengeEscrowKernel.sol/ChallengeEscrowKernel.json",
)
EXPECTED_IMMUTABLES = (
    "arbiter",
    "canonicalToken",
    "pauser",
    "releaseId",
    "resolver",
    "tokenDecimals",
)
MAX_BOUNDARY_FILES = 4_096
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_BOUNDARY_BYTES = 128 * 1024 * 1024
PUBLIC_EXACT = (
    ".gitignore",
    ".npmrc",
    "CITATION.cff",
    "CONTRIBUTING.md",
    "LICENSE",
    "NOTICE.md",
    "README.md",
    "SECURITY.md",
    "contracts/foundry.toml",
    "contracts/package.json",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "rust-toolchain.toml",
    "spec/README.md",
)
PUBLIC_TREES = (
    ".github",
    "contracts/test",
    "docs",
    "rust/portable-verifier",
    "spec/schemas",
    "spec/vectors",
    "tools",
)
PUBLIC_EXCLUSIONS = (
    "rust/portable-verifier/target",
    "tools/formal/cache",
    "tools/formal/out",
    "tools/medusa/corpus",
    "tools/medusa/crytic-export",
    "tools/medusa/slither_results.json",
)


def pairs_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    normalized_keys: set[str] = set()
    for key, value in pairs:
        normalized_key = unicodedata.normalize("NFC", key)
        if normalized_key in normalized_keys:
            raise ValueError(f"duplicate object key after NFC normalization: {key}")
        normalized_keys.add(normalized_key)
        result[key] = value
    return result


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=pairs_without_duplicates)


def canonicalize(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(unicodedata.normalize("NFC", value), ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (int, float)):
        raise ValueError("JSON numbers are forbidden in release canonicalization")
    if isinstance(value, list):
        return "[" + ",".join(canonicalize(item) for item in value) + "]"
    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for key, nested in value.items():
            normalized_key = unicodedata.normalize("NFC", key)
            if normalized_key in normalized:
                raise ValueError(f"object keys collide after NFC normalization: {normalized_key}")
            normalized[normalized_key] = nested
        return "{" + ",".join(
            f"{json.dumps(key, ensure_ascii=False)}:{canonicalize(normalized[key])}"
            for key in sorted(normalized)
        ) + "}"
    raise ValueError("unsupported JSON value")


def sha256_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def sha256_domain(domain: str, value: Any) -> str:
    return sha256_bytes(f"{domain}\0{canonicalize(value)}".encode("utf-8"))


def cast_keccak_hex(hex_value: str) -> str:
    result = subprocess.run(
        ["cast", "keccak", hex_value],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return result.stdout.strip().lower()


def domain_hash(domain: str, value: Any) -> str:
    payload = f"{domain}\0{canonicalize(value)}".encode("utf-8")
    return cast_keccak_hex("0x" + payload.hex())


def safe_file(relative_path: str) -> Path:
    candidate = Path(relative_path)
    if candidate.is_absolute() or ".." in candidate.parts or "\\" in relative_path:
        raise ValueError(f"unsafe release path: {relative_path}")
    absolute = ROOT / candidate
    if absolute.is_symlink() or not absolute.is_file():
        raise ValueError(f"release path is not a regular file: {relative_path}")
    resolved = absolute.resolve(strict=True)
    if ROOT.resolve() not in resolved.parents:
        raise ValueError(f"release path escapes root: {relative_path}")
    return resolved


def file_entry(relative_path: str) -> dict[str, str]:
    path = safe_file(relative_path)
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError(f"release file exceeds the per-file byte limit: {relative_path}")
    payload = path.read_bytes()
    return {"path": relative_path, "bytes": str(len(payload)), "sha256": sha256_bytes(payload)}


def validate_boundary_size(paths: list[str], label: str) -> None:
    if len(paths) > MAX_BOUNDARY_FILES:
        raise ValueError(f"{label} contains too many files")
    total = 0
    for relative_path in paths:
        size = safe_file(relative_path).stat().st_size
        if size > MAX_FILE_BYTES:
            raise ValueError(f"{label} file exceeds the per-file byte limit: {relative_path}")
        total += size
        if total > MAX_BOUNDARY_BYTES:
            raise ValueError(f"{label} exceeds the aggregate byte limit")


def excluded_public_path(relative_path: str) -> bool:
    name = Path(relative_path).name
    return name in (".DS_Store", "__pycache__") or name.endswith(".pyc") or any(
        relative_path == excluded or relative_path.startswith(excluded + "/")
        for excluded in PUBLIC_EXCLUSIONS
    )


def files_under(relative_directory: str, suffix: str | None = None, public_boundary: bool = False) -> list[str]:
    result: list[str] = []

    def visit(directory: Path) -> None:
        with os.scandir(directory) as entries:
            for entry in entries:
                relative = (Path(directory.relative_to(ROOT)) / entry.name).as_posix()
                if public_boundary and excluded_public_path(relative):
                    continue
                if entry.is_symlink():
                    raise ValueError(f"symlink is forbidden in release boundary: {relative}")
                if entry.is_dir(follow_symlinks=False):
                    visit(Path(entry.path))
                elif entry.is_file(follow_symlinks=False) and (suffix is None or entry.name.endswith(suffix)):
                    result.append(relative)

    visit(ROOT / relative_directory)
    return sorted(result)


def exact_string(source: str, name: str) -> str:
    match = re.search(rf'string\s+public\s+constant\s+{name}\s*=\s*"([^"]+)"\s*;', source)
    if not match:
        raise ValueError(f"missing release constant {name}")
    return match.group(1)


def immutable_declarations() -> dict[str, str]:
    declarations: dict[str, str] = {}

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for nested in value:
                visit(nested)
            return
        if not isinstance(value, dict):
            return
        if value.get("nodeType") == "VariableDeclaration" and value.get("mutability") == "immutable":
            compiler_id = value.get("id")
            name = value.get("name")
            if (isinstance(compiler_id, bool) or not isinstance(compiler_id, int)
                    or not isinstance(name, str) or value.get("visibility") != "public"):
                raise ValueError("compiled immutable declaration is malformed or non-public")
            key = str(compiler_id)
            if key in declarations:
                raise ValueError(f"duplicate immutable compiler ID {key}")
            declarations[key] = name
        for nested in value.values():
            visit(nested)

    for path in IMMUTABLE_AST_ARTIFACTS:
        visit(load_json(ROOT / path).get("ast"))
    if tuple(sorted(declarations.values())) != EXPECTED_IMMUTABLES:
        raise ValueError("compiled public immutable inventory drifted")
    return declarations


def release_identity() -> dict[str, str]:
    kernel = (ROOT / "contracts/src/ChallengeEscrowKernel.sol").read_text(encoding="utf-8")
    if "ChallengeTypes.ValueMode.TESTNET_NO_VALUE" not in kernel:
        raise ValueError("release value mode drifted")
    release = {
        "contract": "ChallengeEscrow",
        "protocolVersion": exact_string(kernel, "PROTOCOL_VERSION"),
        "eventProtocolId": exact_string(kernel, "EVENT_PROTOCOL_ID"),
        "challengeSchemaId": exact_string(kernel, "CHALLENGE_SCHEMA_ID"),
        "evidenceSchemaId": exact_string(kernel, "EVIDENCE_SCHEMA_ID"),
        "conditionLanguageId": exact_string(kernel, "CONDITION_LANGUAGE_ID"),
        "valueMode": "TESTNET_NO_VALUE",
    }
    expected = {
        "contract": "ChallengeEscrow",
        "protocolVersion": "challenge-escrow-protocol/v1",
        "eventProtocolId": "challenge-escrow-event/v1",
        "challengeSchemaId": "challenge-escrow.spec/v1",
        "evidenceSchemaId": "challenge-escrow.evidence/v1",
        "conditionLanguageId": "challenge-escrow.condition-language/v1",
        "valueMode": "TESTNET_NO_VALUE",
    }
    if release != expected:
        raise ValueError("release identity drifted from manifest v1")
    return release


def artifact_boundary(production_paths: list[str]) -> tuple[dict[str, Any], dict[str, str]]:
    artifact = load_json(ROOT / ARTIFACT_RELATIVE)
    runtime_hex = artifact.get("deployedBytecode", {}).get("object")
    if not isinstance(runtime_hex, str) or re.fullmatch(r"0x[0-9a-fA-F]*", runtime_hex) is None or len(runtime_hex) % 2:
        raise ValueError("compiled runtime bytecode is missing or malformed")
    runtime_bytes = bytes.fromhex(runtime_hex[2:])
    raw_immutable_references = artifact.get("deployedBytecode", {}).get("immutableReferences")
    if not isinstance(raw_immutable_references, dict):
        raise ValueError("compiled immutable references are missing")
    declarations = immutable_declarations()
    immutable_groups: list[dict[str, Any]] = []
    for compiler_id, entries in raw_immutable_references.items():
        if (re.fullmatch(r"(0|[1-9][0-9]*)", compiler_id) is None
                or compiler_id not in declarations or not isinstance(entries, list) or not entries):
            raise ValueError(f"compiled immutable group {compiler_id} is malformed")
        references: list[dict[str, str]] = []
        for entry in entries:
            start = entry.get("start") if isinstance(entry, dict) else None
            length = entry.get("length") if isinstance(entry, dict) else None
            if (
                isinstance(start, bool) or not isinstance(start, int)
                or isinstance(length, bool) or not isinstance(length, int)
                or start < 0 or length < 1 or start + length > len(runtime_bytes)
            ):
                raise ValueError("compiled immutable reference is malformed")
            references.append({"start": str(start), "bytes": str(length)})
        references.sort(key=lambda item: (int(item["start"]), int(item["bytes"])))
        immutable_groups.append({
            "name": declarations[compiler_id],
            "compilerId": compiler_id,
            "references": references,
        })
    immutable_groups.sort(key=lambda group: group["name"])
    if tuple(group["name"] for group in immutable_groups) != EXPECTED_IMMUTABLES:
        raise ValueError("compiled immutable reference groups are incomplete")
    immutable_references = [
        reference
        for group in immutable_groups
        for reference in group["references"]
    ]
    immutable_references.sort(key=lambda item: (int(item["start"]), int(item["bytes"])))
    if not immutable_references:
        raise ValueError("compiled release exposes no immutable references")
    for previous, current in zip(immutable_references, immutable_references[1:]):
        if int(previous["start"]) + int(previous["bytes"]) > int(current["start"]):
            raise ValueError("compiled immutable references overlap")
    normalized_runtime = bytearray(runtime_bytes)
    for reference in immutable_references:
        start = int(reference["start"])
        normalized_runtime[start:start + int(reference["bytes"])] = b"\x00" * int(reference["bytes"])
    metadata = artifact.get("metadata", {})
    settings = metadata.get("settings", {})
    optimizer = settings.get("optimizer", {})
    compiler = {
        "version": metadata.get("compiler", {}).get("version"),
        "evmVersion": settings.get("evmVersion"),
        "optimizer": {
            "enabled": optimizer.get("enabled"),
            "runs": str(optimizer.get("runs")),
        },
        "metadataBytecodeHash": settings.get("metadata", {}).get("bytecodeHash"),
    }
    if not isinstance(compiler["version"], str) or not isinstance(compiler["evmVersion"], str) or not isinstance(compiler["optimizer"]["enabled"], bool):
        raise ValueError("compiler metadata is incomplete")
    expected_compiler = {
        "version": "0.8.36+commit.8a079791",
        "evmVersion": "cancun",
        "optimizer": {"enabled": True, "runs": "1"},
        "metadataBytecodeHash": "none",
    }
    if compiler != expected_compiler:
        raise ValueError("compiler artifact does not match the pinned release settings")
    abi = artifact.get("abi")
    if not isinstance(abi, list):
        raise ValueError("compiled ABI is missing")
    metadata_sources = metadata.get("sources")
    if not isinstance(metadata_sources, dict):
        raise ValueError("compiler source metadata is missing")
    for path in production_paths:
        compiler_path = path.removeprefix("contracts/")
        source_entry = metadata_sources.get(compiler_path)
        expected_hash = source_entry.get("keccak256") if isinstance(source_entry, dict) else None
        actual_hash = cast_keccak_hex("0x" + (ROOT / path).read_bytes().hex())
        if not isinstance(expected_hash, str) or expected_hash.lower() != actual_hash:
            raise ValueError(f"compiled artifact is stale for {path}")
    runtime = {
        "artifactPath": ARTIFACT_RELATIVE,
        "bytes": str(len(runtime_bytes)),
        "sha256": sha256_bytes(runtime_bytes),
        "keccak256": cast_keccak_hex(runtime_hex),
        "normalizedKeccak256": cast_keccak_hex("0x" + bytes(normalized_runtime).hex()),
        "immutableReferences": immutable_references,
        "immutableGroups": immutable_groups,
        "abiEntries": str(len(abi)),
        "abiSha256": sha256_bytes(canonicalize(abi).encode("utf-8")),
    }
    return compiler, runtime


def build_manifest() -> dict[str, Any]:
    production_paths = files_under("contracts/src", ".sol")
    public_paths = sorted(
        list(PUBLIC_EXACT)
        + [path for directory in PUBLIC_TREES for path in files_under(directory, public_boundary=True)]
    )
    if len(set(public_paths)) != len(public_paths):
        raise ValueError("release public artifact list contains a duplicate")
    if any(path == "tools/formal/cache" or path.startswith("tools/formal/cache/") for path in public_paths):
        raise ValueError("release public artifact list contains a workstation-specific formal cache")
    validate_boundary_size(production_paths, "production source boundary")
    validate_boundary_size(public_paths, "public artifact boundary")
    production_sources = [file_entry(path) for path in production_paths]
    public_artifacts = [file_entry(path) for path in public_paths]
    compiler, runtime = artifact_boundary(production_paths)
    manifest: dict[str, Any] = {
        "schema": "challenge-escrow.release-manifest/v1",
        "manifestHash": "0x" + "0" * 64,
        "release": release_identity(),
        "compiler": compiler,
        "runtime": runtime,
        "productionSources": production_sources,
        "publicArtifacts": public_artifacts,
        "boundaries": {
            "productionSourcesSha256": sha256_domain("challenge-escrow.release-production-sources/v1", production_sources),
            "publicArtifactsSha256": sha256_domain("challenge-escrow.release-public-artifacts/v1", public_artifacts),
        },
    }
    body = dict(manifest)
    del body["manifestHash"]
    manifest["manifestHash"] = domain_hash("challenge-escrow.release-manifest/v1", body)
    return manifest


def main() -> None:
    expected = load_json(MANIFEST_PATH)
    actual = build_manifest()
    if canonicalize(actual) != canonicalize(expected):
        raise ValueError("release manifest does not reproduce in the independent verifier")
    if int(actual["runtime"]["bytes"]) > 24_576:
        raise ValueError("release runtime exceeds the EIP-170 deployed-bytecode limit")
    print(json.dumps({
        "status": "ok",
        "implementation": "python",
        "manifestHash": actual["manifestHash"],
        "productionSources": len(actual["productionSources"]),
        "publicArtifacts": len(actual["publicArtifacts"]),
        "runtimeBytes": actual["runtime"]["bytes"],
        "runtimeKeccak256": actual["runtime"]["keccak256"],
        "immutableGroups": len(actual["runtime"]["immutableGroups"]),
        "immutableReferences": len(actual["runtime"]["immutableReferences"]),
        "abiEntries": actual["runtime"]["abiEntries"],
    }, indent=2))


if __name__ == "__main__":
    main()
