# Security review

This local research review was completed on 2026-08-09. It records executed
evidence and is not an independent security audit.

## Scope

The review covered:

- Solidity contracts under `contracts/src`;
- adversarial-token and lifecycle tests under `contracts/test`;
- the dependency lock and package metadata;
- independent state, arithmetic, portable-semantics, client, observer-receipt,
  authority-policy, release-attestation, simulator, and authority-failure
  artifacts under `tools/` and `spec/`;
- secret, credential, dangerous-operation, and product-data exposure;
- the claims made by the public documentation.

## Current release boundary

The repository publishes no deployment script, private-key loader, environment
template, remote procedure call endpoint, production address, browser session,
database, user record, or social-platform integration. `TESTNET_NO_VALUE` is
the only declared value mode.

## Findings

### Resolved: pauser could overlap with a participant

The original implementation excluded resolver and arbiter addresses from
financial participation but did not exclude the pauser. An interested pauser could block
acceptance or a resolver proposal and influence the route toward a refund. The
contract now rejects the pauser as challenger or accepting wallet, with
regression tests for both paths.

### Resolved: canonical token could have no contract code

The constructor accepted an address with no code, creating a permanently
unusable release. It now rejects a canonical token whose address has no code.
Runtime exact-delta checks remain necessary because code presence does not
certify token behavior.

### Resolved: signature recovery detail was discarded

The acceptance path rejected invalid signatures but discarded the structured
ECDSA recovery error and its argument. The protocol error now preserves both,
improving diagnosis without weakening rejection behavior.

### Resolved: renamed commitments had no independent oracle

Product-neutral domains and namespaces changed every protocol hash. A fixed
public vector was regenerated and is checked independently with Foundry's
`cast`, rather than only against the Solidity implementation under test.

### Resolved: RPC observer shape was over-trusted

Failed synchronization could partially replace local observer
state, provider `removed` hints could suppress accepted history, and a valid ABI
shape could still carry an event the contract cannot emit. Every sync now builds
in a temporary snapshot, validates consecutive headers and a final head anchor,
ignores removal hints, enforces resource limits, and rejects non-canonical or
semantically impossible event payloads. Overlapping sync calls are serialized;
the log snapshot is frozen beside the reconciliation head before awaiting direct
state, and that head is rechecked afterward. A slow earlier sync can no longer
overwrite a newer snapshot, and a reorganization cannot combine old logs with
state read from the replacement branch.

### Resolved: public error fields allowed arbitrary uppercase data

The original implementation treated any uppercase token as an endpoint-free
provider error.
That still left room for an API key or internal identifier. Observer receipts
now accept only eight named error states, and provider IDs cannot resemble a
hostname.

### Resolved: moving compound RPC snapshot was accepted

The quorum client previously read `latest`, `safe`, and `finalized` once and
could combine them across a same-height reorganization. It now rereads the
latest block after collecting finality tags and discards the entire provider
snapshot if number, hash, or parent hash changed. The portable error vocabulary
records only `LATEST_BLOCK_CHANGED`, never a raw endpoint exception.

### Resolved: minority authority thresholds were allowed

The first authority-policy verifier rejected a one-member role but would still
have accepted 2-of-7 control. Every role threshold must now be a strict majority,
and quorum-loss incidents derive from the actual membership and threshold. The
policy hash also binds an announcement timestamp, and the verifier confirms that
each policy remains public for its declared minimum review delay before
activation; a delay value alone is no longer accepted as evidence.

### Resolved: read-only testnet snapshots were mixed

The preflight used `latest` independently for code, getter, and event reads. A
moving head could therefore produce a report assembled from several blocks. It
now reads one block header, binds code and getter calls to its canonical hash,
anchors the release log to its own header, reads the snapshot header again after
all other calls, and includes the number, hash, and parent hash in the report.

### Resolved: immutable runtime substitutions were flattened

The original implementation normalized every compiler-declared immutable slot
before matching live runtime code but discarded which repeated slots belonged
to the same variable. A crafted deployment could therefore present one value through a
getter and use another copy in authorization logic while preserving the
normalized code hash. The manifest now preserves all six compiler groups and 24
slot locations, requires every live copy in a group to agree, and binds its
32-byte word to the corresponding public getter.

### Resolved: release boundary included a workstation-specific cache

The first release manifest enumerated every file below `tools/` except a short
generated-output list. After the formal run, that accidentally included an
ignored Foundry cache whose contents contain local absolute paths and file
timestamps. The manifest exposed only its digest, but another workstation
could not reproduce that digest. Both manifest implementations now exclude the
formal cache, reject it explicitly if it re-enters the public artifact set, and
scan the remaining public JSON for duplicate object keys before normal parsing.
They also enforce identical file-count, per-file, and aggregate byte limits
before hashing the boundary.

### Resolved: incomplete cross-event projections were accepted

The first lifecycle projector validated event ABI shape and broad state order,
but it did not bind every proposal deadline, arbitration interval, uncontested
reason, participant, terminal recipient, and evidence parent to prior events.
It also assumed callers supplied logs from one contract and one branch. The
projector now rejects mixed addresses, same-height forks, duplicate positions,
schedule drift, false arbiter identities, terminal results that do not match
their recorded lineage, and participant overlap with the declared contract,
token, resolver, or arbiter. It also enforces the early-`VOID` source-correction
rule derivable from the emitted dispute deadline.

### Resolved: `exists: false` hid unchecked tuple fields

The direct-state decoder previously ignored nonzero proposal, dispute, final
resolution, or entitlement fields when their `exists` flag was false. Those
tuples are not reachable from the production contract and could hide corrupted
or incorrectly decoded state. The decoder now requires the exact zero form for
every absent nested tuple, rejects a present entitlement with no claimable or
paid balance, and applies the production early-`VOID` correction-cutoff rule to
direct proposal state. Compound inspection now also requires one explicit `uint64`
block tag and rejects the result when decoded entitlements do not conserve the
challenge deposit.

### Resolved: provider transaction index entered event identity

Ethereum's `logIndex` is block-global. The observer previously included
`transactionIndex` in its identity key, which let two impossible records reuse
one log index under different transaction indexes. Event identity now uses
block hash and log index; conflicting duplicates and non-canonical
transaction/log ordering are rejected.

### Resolved: projector accepted arbitrary payout entitlement IDs

The projector checked payout state, recipient, amount, and duplicates, but it
accepted any nonzero `entitlementId` topic. The production contract derives
that ID from the challenge and wallet. The projector now recomputes it with a
dependency-free Ethereum Keccak-256 implementation and classifies a mismatch as
a conflict. Fixed public vectors and 128 deterministic comparisons with Foundry
`cast` bind the implementation.

### Resolved: analyzer counts were used as the static-analysis gate

Checking only for zero high-severity Slither findings allowed a new medium
finding to blend into the report. The gate now pins Slither 0.11.6, requires zero
high findings, allows the two reviewed medium findings only by exact detector ID,
function, source, and confidence, freezes the full severity-count inventory, and
pins a SHA-256 digest over every normalized finding identity, classification,
confidence, function, node, and source. Any changed finding at any severity
fails the gate.

## Remaining assurance gaps

- No independent third-party audit has been completed.
- The branch baseline has one uncovered production branch. The ordinary
  negative-path matrix is closed, the self-referential deployment guards are
  exercised through a CREATE factory, and all 12 representative mutations were
  killed in isolated temporary copies; the remaining LCOV branch is a
  post-transfer solvency guard that the arithmetic checker formally dominates under the exact
  sender-delta preconditions. The gate requires all three production files and
  110 measured branches, accepts only that source-matched dominated branch, and
  fails on any new gap.
- The deployed runtime is 23,270 bytes, leaving 1,306 bytes below the EIP-170
  limit with the pinned compiler and optimizer settings. `pnpm run size:check`
  now fails automatically if a future build crosses that limit.
- One portable terms/evidence vector is published in addition to the commitment
  vector. JavaScript, Python, and the independent Rust verifier agree on its
  canonical bytes, hashes, byte counts, and condition result; the Rust layer
  also replays a twelve-case negative corpus with stable error codes.
- No live-chain, wallet, real key-management, monitoring, or incident-response
  tests have been run. The reorganization observer, lifecycle projector,
  N-provider quorum, portable receipt, and authority incident matrix are local
  simulations with injected provider and controller faults. The Sepolia/Base
  Sepolia preflight is also memory-only in this revision; no live RPC URL or
  address was supplied.
- The RPC quorum compares block heads, not independently fetched log payloads.
  The receipt makes omissions and changes reproducible when its inputs are
  known, but it does not prove that a provider returned every canonical log.
- The quorum checks exact parent linkage for adjacent finality-tag heads. It
  does not carry the intervening headers across larger gaps, so height ordering
  across those gaps is not a complete ancestry proof.
- A ten-property Halmos boundary harness now runs against the production
  release surface and commitment libraries. It includes one bounded
  `OPEN → CANCELLED → paid refund` path with an exact-behavior token and has zero
  counterexamples for its stated properties. Full lifecycle, arbitrary token,
  concurrent challenge, signature recovery, and live-chain symbolic coverage
  remain open.
- A deterministic manifest binds the reviewed source, schemas, vectors,
  compiler settings, ABI, raw and normalized deployed runtime, and immutable
  groups. JavaScript and Python rebuild it independently. This is local
  reproducibility evidence, not an external signature or binary-provenance guarantee. The
  optional preflight can inspect one live address, but it was not run against
  a network in this revision.
- The gates reject drift from the analyzer versions used for this review, but
  the audit environment is not hermetic. The repository does not vendor or
  independently reproduce the analyzer binaries, the Z3 package, Halmos
  transitive distributions, or the remote Semgrep registry profiles. The
  checked-in Semgrep profile is part
  of the release manifest; the two registry profiles remain external inputs.
  The Z3 gate fixes semantic version 4.16.0 and ignores only the tool's standard
  32-bit or 64-bit platform suffix.
- No legal or regulatory clearance is claimed.

## Executed checks

- The release built with the pinned Solidity compiler, and formatting checks
  remained clean.
- Fifty-two tests passed with zero failures, including adversarial incoming
  and outgoing token behavior, reentry attempts, lifecycle boundaries, and
  role-overlap regressions.
- Thirteen invariant properties ran for 256 sequences and 32,768 calls per
  property, covering solvency, conservation, terminal immutability, one-time
  claims, role exclusion, pause exits, permit replay, exact incoming deltas,
  and unexpected token balance changes.
- The independent JavaScript model ran over 10,000 sequences of 128 actions.
  Its gate requires all 14 transitions and at least one rejection to be
  exercised. The CHC/Z3 boundary proves all seven selected arithmetic
  assertions. The Medusa shadow harness passes four required properties and 36
  auxiliary panic targets; its runner verifies both sets rather than trusting
  exit code alone.
- Ten contract-coupled Halmos properties ran with zero counterexamples. Five
  additions cover production challenge and entitlement IDs, acceptance-permit
  type-hash and digest delegation, the bounded cancellation/refund path, and
  release-ID binding to chain and escrow.
- The deployed bytecode measured 23,270 bytes against the 24,576-byte
  EIP-170 limit, leaving 1,306 bytes of measured margin.
- Twelve representative source mutations ran in isolated copies of the
  contract tree. Every mutation was killed by the production test suite; no
  mutation survived and no run was invalid. A mutation counts as killed only
  when Foundry reports a failed test suite; compilation errors and timeouts are
  invalid evidence.
- The portable schemas, canonical bytes, domain-separated hashes, and condition
  result were checked in JavaScript, Python, and Rust. The run also covered the
  read-only client, block-pinned inspection, field-level `ReleaseDeclared` and `ChallengeCreated`
  reconciliation, complete event decoding, versioned observer-envelope shape,
  duplicate/omitted/misaligned event handling, reorganization replay, finality
  labels, threshold RPC agreement, split and finalized forks, stale providers,
  sanitized outages, complete outage, payout entitlement-ID derivation,
  simulator, liveness sweep, failure-lab, and authority-policy prototype checks.
- The dependency-free TypeScript Keccak-256 implementation was checked against
  two fixed digest vectors, one fixed entitlement vector, and 128 deterministic
  `cast keccak` comparisons before using it in the event projector.
- JavaScript and Python reproduced the same 4,692-byte observer receipt and
  receipt hash. Both rejected all 24 negative cases, including duplicate and
  NFC-colliding keys, duplicate providers, endpoint or hostname leakage,
  secret-like error codes, decimal and block-number overflow, stale unavailable
  heads, finality conflict, parent-hash conflict, release drift, reordered
  providers, commitment drift, and hidden
  anomalies. A 512-case differential corpus matched quorum results across two
  to six providers.
- The authority-policy verifier accepted one three-role, eight-member,
  strict-majority reference policy, reproduced its policy hash and five
  incident decisions, and rejected all 19 unsafe, prematurely activated, or
  stale variants. This remains a static policy test with synthetic
  fingerprints, not a real key ceremony.
- The testnet safety suite ran with no endpoint or key. It rejects credential
  URLs, query- or path-bearing RPC URLs, unknown secret fields, write methods,
  wrong chains, missing escrow/token bytecode, and non-`TESTNET_NO_VALUE` release
  events. The optional live preflight remains read-only and requires an explicit
  exact deployment block. Code and getter reads are pinned to one reported
  snapshot hash, with a final header check against an in-progress reorganization. The
  suite matches the runtime outside immutable slots and rejects
  internally inconsistent immutable copies or a getter/runtime disagreement,
  but was not run against a real chain.
- Core line coverage measured 86.36% for `ChallengeEscrow.sol`, 83.42% for
  `ChallengeEscrowKernel.sol`, and 100% for `ExactTokenDelta.sol`.
- Manual classification of Slither's output found no confirmed exploitable
  finding. It reported two medium, fourteen low, and nine informational findings,
  with no high-severity finding. The two medium findings are the explicit
  two-value enum comparison in `accept` and the guarded token callback in `createAndFund`.
  Version 0.11.6, both medium finding identities, the full severity counts, and
  a digest over all 25 normalized findings are now machine-gated; any changed
  finding fails.
- Semgrep reports zero findings under the selected security and secret rules.
  The scan includes the `.github` workflow boundary as well as source, tests,
  tools, schemas, and documentation.
  Gitleaks reports zero secrets in both Git history and the full worktree. The
  locked dependency audit reports no known vulnerability at high severity or
  above.
- The supply-chain check binds six GitHub Action revisions, read-only workflow
  permissions, a script-free pnpm install, one integrity-locked Solidity
  dependency, one hash-locked Python verification dependency, 16 checksummed
  Rust dependencies, and the release toolchain markers, including an isolated,
  exact Python version. The CHC and Medusa runners also reject any solc core
  version other
  than 0.8.36, and Medusa has a finite execution timeout. The complete audit
  additionally requires Z3 4.16.0, Medusa 1.5.1,
  Gitleaks 8.30.1, Semgrep 1.172.0, and Slither 0.11.6, while the formal runner
  requests Halmos 0.3.3 explicitly.
- The compiled authority surface contains exactly 43 public functions and 14
  nonpayable entry points, with one nonpayable constructor, no selector
  collision, and no payable, fallback, or receive path. A fixed
  selector/mutability digest rejects a newly introduced external capability.
- The final audit report completed all 29 checks successfully, including the
  ten-property formal boundary, observer receipt, authority policy, release
  attestation, mutation, secret, static-analysis, and read-only testnet gates.
  Its temporary logs remain outside the repository; neither the report nor the
  release manifest is a third-party audit.
- The public extraction contains no original product name, endpoint, address,
  local path, seed phrase, mnemonic, or credential pattern.
- Every fixed identifier and hash in the public commitment vector was reproduced.

## Static-analysis warning interpretation

External token calls are wrapped with `nonReentrant`; any false return,
malformed return, callback manipulation, fee, or unexpected balance delta
reverts the whole transition. Timestamp comparisons enforce explicit
participant deadlines, so bounded block-time influence remains an accepted
chain property. Low-level calls are deliberate because ERC-20 contracts differ
in return-value behavior, and the adversarial suite covers the supported and
rejected cases.
