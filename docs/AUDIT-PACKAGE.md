# Audit package

This package is a reproducible handoff for a reviewer. It collects the
protocol checks, the independent state models, the attack matrix, the static
analysis boundaries, and the exact places that still need human review. It
is evidence for this research release, not an audit certificate.

## Scope

`contracts/src` is the production boundary. The following independent evidence
sits beside it:

| Layer | Artifact | Purpose |
| --- | --- | --- |
| Specification | `docs/INVARIANTS.md` | State vocabulary, transition ledger, and property status |
| Differential model | `tools/model/` | A pure JavaScript execution model with deterministic and random traces |
| Arithmetic and symbolic boundary | `tools/formal/` | Solc CHC/Z3 checks plus a Halmos conformance harness for the production release surface |
| Attack planning | `docs/ATTACK-MATRIX.md` | Reachable attack families, branch gaps, and mutation kill targets |
| Independent EVM run | `tools/medusa/` | A shadow state machine fuzzed by a separate execution engine |
| Public conformance | `spec/vectors/`, `tools/portable/`, and `rust/portable-verifier/` | Commitment bytes, canonical JSON, errors, and hashes outside the Solidity implementation |
| Observer boundary | `tools/client/{observer,events,projector,rpc}.ts`, `tools/observer/`, and the observer schemas | Reorganization-safe logs, full event decoding, lifecycle projection, N-provider quorum, and portable receipts |
| Testnet safety boundary | `tools/testnet/read-only.mjs`, `tools/testnet/test.mjs`, and `spec/schemas/testnet-preflight-v1.json` | Allowlisted Sepolia/Base Sepolia read-only inspection with no credentials or transaction method |
| Authority policy | `tools/operations/` and `spec/schemas/authority-policy-v1.json` | Epoch lineage, controller separation, thresholds, forbidden powers, and incident decisions |
| Release attestation | `tools/release/` and `spec/release/release-manifest-v1.json` | Sorted source/artifact digests, compiler settings, ABI, runtime, and manifest reproduction |
| Cycle handoff | `docs/DEPTH-CYCLE-3.md` | Five dependent three-stage lanes, final integrated gate, and residual claims |

The JavaScript and Solidity harnesses intentionally do not import production
state. They are useful only because they can disagree with it; a shadow-model
pass never counts as a production-bytecode proof.

## Reproduction order

From the repository root:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run supply-chain:check
pnpm run authority-surface:check
pnpm run check
pnpm run model:test
pnpm run formal:check
pnpm run formal:contract
pnpm run size:check
pnpm run schemas:check
pnpm run portable:check
pnpm run portable:rust
pnpm run portable:differential
pnpm run client:check
pnpm run observer:check
pnpm run testnet:check
pnpm run simulator:test
pnpm run liveness:sweep
pnpm run failure:lab
pnpm run authority:v2
pnpm run authority:check
pnpm run release:check
pnpm run security:baseline
pnpm run security:mutation
pnpm run medusa:test
gitleaks detect --source . --redact
gitleaks detect --source . --no-git --redact
semgrep scan --no-git-ignore --config tools/security/semgrep-local.yml \
  --config p/security-audit --config p/secrets --error \
  --exclude node_modules --exclude tools/medusa/corpus \
  --exclude contracts/cache --exclude contracts/out --exclude contracts/broadcast \
  .github contracts/src contracts/test tools docs README.md SECURITY.md package.json
pnpm run slither:gate
pnpm audit --audit-level high
```

The single local command `pnpm run audit:baseline` executes this complete
sequence, stores each full log in a temporary directory, and prints a JSON
report with tool versions and exit codes. The cycle-specific gates and their
three-stage dependencies are listed in `docs/DEPTH-CYCLE-3.md`; the older
`check:lineN` commands remain as smaller compatibility baselines.

## Evidence from the current run

The current revision produced these local results:

- The production Foundry suite passes 52 tests and 13 stateful invariant
  properties under the security profile.
- The independent JavaScript model passes 10,000 random sequences of 128
  actions after its deterministic transition matrix. The runner requires every
  one of the 14 transition families to occur in the random corpus.
- The CHC/Z3 arithmetic boundary checks prove the selected payout and deadline
  assertions safe under the production preconditions. The runner binds the
  output to all seven assertions present in the lemma source; it does not prove
  the whole contract.
- The Halmos contract boundary proves ten selected delegation, arithmetic, and
  bounded stateful properties with zero counterexamples. Its ledger is in
  `docs/FORMAL-PROOF-LEDGER.md`; the cancellation/refund property uses one exact
  token, one participant, and one challenge and does not prove arbitrary token
  behavior or every lifecycle path.
- The portable semantics boundary now has three implementations. The Rust
  verifier passes its twelve-case negative corpus and the three-way differential
  check reproduces the same terms/evidence hashes, byte counts, and condition
  result as JavaScript and Python.
- The read-only observer decodes the complete v1 event set, projects lifecycle
  state into the versioned observer envelope, labels the supplied head's
  finality, and reports orphan or impossible events as explicit anomalies.
  Synchronization is serialized, atomic, and resource-bounded; event identity
  is fixed to block hash plus the block-global log index; direct-state
  reconciliation freezes the log snapshot and rechecks its head after the
  read; and the event decoder rejects
  non-canonical ABI tails and contract-impossible semantics. Payout event IDs
  are recomputed from challenge and wallet through a dependency-free Keccak-256
  implementation checked against fixed vectors and 128 `cast` comparisons.
  The deep client test covers threshold agreement, split and finalized forks,
  stale providers, same-height movement during one provider snapshot,
  parent-hash conflict, sanitized outage codes, and complete unavailability.
- JavaScript and Python independently reproduce the 4,692-byte portable
  observer receipt and its domain-separated hash. They reject all 24 cases in
  the receipt negative corpus. A 512-case differential corpus compares the
  TypeScript and receipt quorum implementations across provider counts,
  thresholds, outages, forks, ordering, and hex normalization.
- The authority-policy verifier reproduces a three-role, eight-member policy
  hash and five incident decisions and rejects 19 weak, overlapping, expired,
  stale, prematurely activated, or tampered variants. Every accepted threshold
  is a strict majority, and the hashed announcement time must precede activation
  by the declared review delay.
  The fingerprints are synthetic; no key ceremony or live signer is
  represented.
- JavaScript and Python independently rebuild the same release manifest over
  seven production sources and 126 public artifacts. They agree on the
  23,270-byte runtime, its SHA-256 and Keccak-256, and the canonical 140-entry
  ABI digest. They also match every current production source to the Keccak
  recorded in compiler metadata and preserve six public immutable groups with
  24 runtime substitutions. The manifest identifies local bytes; it does not
  attest a live address or compiler-binary provenance.
- Both manifest builders exclude and explicitly reject the ignored formal
  cache, whose generated contents can carry workstation paths and timestamps.
  The schema gate also rejects duplicate or NFC-colliding object keys across
  every public JSON document before a standard parser can collapse them.
- The testnet preflight suite is memory-only and rejects unsafe URLs, unknown
  secret-bearing fields, credential-bearing URL paths, write RPC methods, wrong
  chains, and a nonzero
  `ReleaseDeclared` value mode. It binds reads to one canonical block hash,
  anchors the release log, and rejects a changed snapshot header. The
  memory-only deployment fixture also proves
  that code drift, inconsistent copies of one immutable, and a getter/runtime
  mismatch are rejected. Its optional real endpoint command performs
  only `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_getCode`,
  `eth_call`, and `eth_getLogs`, with code and getter reads pinned to the
  recorded block hash.
- The branch baseline reports one uncovered production branch. The 12
  representative mutation targets ran in isolated temporary copies: all 12 were
  killed, none survived, and none failed to compile or time out. The coverage
  gate accepts only the source-matched dominated solvency branch and fails on a
  new production gap. This is a measured local mutation baseline, not a proof
  against every possible future refactor.
- The independent Medusa harness completes its 30-second run with four required
  properties and 36 auxiliary panic targets passing. The runner checks Medusa
  1.5.1, solc 0.8.36, the exact property inventory, the output summary, and an
  outer execution timeout. Its corpus is local and ignored; it is not a
  minimized counterexample set.
- Gitleaks reports no secrets. Semgrep reports no finding under the selected
  security and secret rules. The locked dependency audit reports no known
  vulnerability at high severity or above.
- The supply-chain gate checks six immutable GitHub Action revisions,
  read-only workflow permissions, script-free pnpm installation, one
  integrity-locked Solidity dependency, 16 checksummed Rust dependencies, and
  the exact Node, Deno, Foundry, Rust, uv, and Solidity release markers. It also
  fixes the top-level Halmos version and the expected Z3, Medusa, Gitleaks,
  Semgrep, and Slither versions; the complete audit fails if any installed
  analyzer reports another version. For Z3, the gate compares the exact semantic version
  while ignoring only its standard 32-bit or 64-bit platform suffix.
- Slither reports no high-severity finding, while still reporting two medium,
  fourteen low, and nine informational findings. One medium warning is the
  two-value enum comparison that selects the opposite participant side. The
  other is the guarded token callback in `createAndFund`. The Slither gate pins
  version 0.11.6, the exact two reviewed medium finding IDs, and the complete
  severity-count inventory. It also pins a SHA-256 digest over all 25 normalized
  finding identities, classifications, confidences, functions, nodes, and
  sources, so any changed finding fails instead of blending into the report.
- The compiled authority-surface gate allows exactly 43 public functions, 14
  nonpayable entry points, one nonpayable constructor, no selector collision,
  no payable, fallback, or receive path, and one fixed selector/mutability
  digest. Any new external capability fails the gate.
- The complete audit command ran all 29 configured checks successfully. Its
  logs remain in a temporary local directory and are not part of the public
  release.

Exact counts can change with compiler, analyzer, or corpus versions. Every
review request should therefore include the JSON manifest and tool versions.

## Counterexample handling

This revision has no failing counterexample to publish. If a property or
mutation fails, preserve the smallest replayable call sequence, the exact
tool versions, the relevant source hash, and the pre/post state snapshot under
`tools/security/counterexamples/`. Redact addresses, credentials, and funded
test material before sharing anything outside the local review.

A green fuzzing run is not evidence that a mutation is killed. Every mutation
in the attack matrix needs a named test or a minimized counterexample.

## Human review still required

The remaining work includes an independent audit of the production bytecode,
independent review of every lifecycle and projector relation, live-chain
reorganization and censorship testing, deployment and key-management review,
and a fresh runtime-size check after every code change. Byte-for-byte provenance
for analyzer binaries, the Z3 package, Halmos transitive distributions, and the
remote Semgrep registry profiles would also require a hermetic audit image.
This package does not authorize real-value deployment.
