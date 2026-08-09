# Reproducible release attestation

`challenge-escrow.release-manifest/v1` makes the reviewed research boundary
explicit. The manifest is deterministic: it contains no timestamp,
Git branch, workstation path, RPC endpoint, signer, or deployment address.

## What the manifest binds

The checked-in manifest records:

- every Solidity file under `contracts/src`, with byte count and SHA-256;
- the pinned compiler version, EVM target, optimizer settings, and metadata
  hash mode read from the Foundry artifact;
- the compiler metadata hash for every production source, checked against the
  current raw source bytes so a stale artifact cannot represent edited code;
- the deployed runtime byte count, raw SHA-256, raw Keccak-256, and Keccak-256
  after the compiler-declared immutable slots are normalized;
- six named public immutable groups and all 24 compiler-declared runtime
  substitutions, preserving which repeated slots belong to one value;
- the canonical ABI entry count and SHA-256;
- every public schema and vector;
- the formal proof ledger and bounded Halmos harness;
- the observer receipt implementations, their canonicalization dependency,
  and the authority-policy implementation;
- the relevant conformance documentation and reproducibility configuration;
- SHA-256 boundaries over the source and public-artifact sets; and
- a domain-separated Keccak hash over the complete manifest body.

The generator rejects symlinks and paths that escape the repository. Paths are
relative and sorted. Ignored formal output and workstation-specific cache files
are excluded and rejected if they re-enter the public artifact set. The runtime
limit is checked against EIP-170 during verification. In a Git checkout, the
JavaScript verifier also fails if any listed public artifact matches the
repository ignore rules.
Both independent implementations also cap the file count, each file size, and
the aggregate bytes in either enumerated boundary. This keeps an unreviewed
large file from turning manifest verification into an unbounded local resource
operation.

## Two implementations

The JavaScript builder reconstructs the manifest from the current tree and
compiler output. A separate Python verifier independently enumerates the same
closed file sets, parses compiler metadata, canonicalizes the ABI, computes
both runtime digests, and rebuilds the manifest hash.

```sh
pnpm run release:check
```

The current manifest covers seven production source files and 126 public
artifacts. Both implementations reproduce a 23,270-byte deployed runtime with
Keccak-256
`0x30d6efa6dfb6c41174980ad79a10bf05c1c85e28951e6e250e6783dd13c7b6b1`
and the canonical digest of a 140-entry ABI.

The separate testnet preflight uses the normalized runtime hash to compare a
live address with this reviewed code template. It then requires every repeated
slot in an immutable group to contain the same word and binds that word back to
the corresponding public getter. This prevents a getter from presenting one
role while another runtime use of the same immutable contains a different
address. The same preflight binds code and getter calls to a canonical block
hash, anchors the release event to its header, and fails if the snapshot header
changes before the report is complete.

When a reviewed release boundary changes, first rebuild the contract and then
regenerate the checked-in manifest:

```sh
pnpm run release:write
```

The public artifact is
[`spec/release/release-manifest-v1.json`](../spec/release/release-manifest-v1.json),
and its closed schema is
[`spec/schemas/release-manifest-v1.json`](../spec/schemas/release-manifest-v1.json).

## What this does not attest

This is a reproducibility boundary, not a signature from an independent
auditor. By itself it does not prove that a live address contains this runtime,
that a deployment was configured correctly, that compiler binaries are
trustworthy, or that an operator followed the authority policy. The optional
preflight can check one address through one read-only endpoint, but compiler
provenance, independent chain evidence, a real ceremony, and external review
remain separate obligations.
