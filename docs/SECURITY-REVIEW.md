# Security review

Status: local research review completed on 2026-08-02. This file records
executed evidence, not an independent security audit.

## Scope

- Solidity contracts under `contracts/src`.
- Adversarial-token and lifecycle tests under `contracts/test`.
- Dependency lock and package metadata.
- Secret, credential, dangerous-operation, and product-data exposure.
- Public documentation claims.

## Current release boundary

The repository contains no deployment script, private key loader, environment
template, remote procedure call endpoint, production address, browser session,
database, user record, or social-platform integration. Its only declared value
mode is `TESTNET_NO_VALUE`.

## Findings

### Resolved: pauser could overlap with a participant

The source implementation excluded resolver and arbiter addresses from
financial participation but did not exclude the pauser. An interested pauser
could block acceptance or resolver proposal and influence the route toward a
refund. The public extraction now rejects the pauser as challenger or accepting
wallet, with regression tests for both paths.

### Resolved: canonical token could be a non-contract address

The constructor accepted an address with no code, creating a permanently
unusable release. The public extraction now rejects a canonical token whose
address has no code. This does not certify token behavior; runtime exact-delta
checks remain required.

### Resolved: signature recovery detail was discarded

The acceptance path rejected invalid signatures but discarded the structured
ECDSA recovery error and its argument. The public extraction preserves both in
the protocol error, improving diagnosis without weakening rejection behavior.

### Resolved: renamed commitments lacked an independent oracle

Product-neutral domains and namespaces changed every protocol hash. A fixed
public vector was regenerated and is now checked independently with Foundry's
`cast`, rather than only against the Solidity implementation under test.

## Unresolved assurance gaps

- No independent third-party audit.
- Core branch coverage remains materially lower than line coverage, especially
  in the validation kernel; more negative-path and differential tests are due.
- The deployed runtime is 23,270 bytes, leaving 1,306 bytes below the EIP-170
  limit with the pinned compiler and optimizer settings. Every code change must
  recheck this margin.
- Only the commitment boundary has a public conformance vector. Terms,
  evidence, and condition schemas still need independent implementations.
- No live-chain, wallet, key-management, monitoring, or incident-response test.
- No legal or regulatory clearance is claimed.

## Executed checks

- The pinned Solidity compiler built the release with formatting checks clean.
- Forty-one tests passed with zero failures, including adversarial incoming and
  outgoing token behavior, reentry attempts, lifecycle boundaries, and role
  overlap regressions.
- Thirteen stateful invariant properties ran for 256 sequences and 32,768 calls
  per property. They cover solvency, conservation, terminal immutability,
  one-time claims, role exclusion, pause exits, permit replay, exact incoming
  deltas, and unexpected token balance changes.
- Core line coverage is 86.36% for `ChallengeEscrow.sol`, 83.42% for
  `ChallengeEscrowKernel.sol`, and 100% for `ExactTokenDelta.sol`.
- Slither reported no confirmed exploitable finding after manual classification.
  Its remaining warnings concern guarded token callbacks, deadline timestamps,
  deliberate low-level ERC-20 handling, assembly used for exact return decoding
  and event emission, validation complexity, and an enum comparison.
- Semgrep ran 64 security and secret-detection rules across 26 files with zero
  findings. Gitleaks found zero secrets. The locked dependency audit found no
  known vulnerabilities at high severity or above.
- A product and credential exposure scan found no original product name,
  endpoint, address, local path, seed phrase, mnemonic, or credential pattern.
- The public commitment vector reproduced every fixed identifier and hash.

## Interpretation of static-analysis warnings

External token calls are wrapped by `nonReentrant`; any false return, malformed
return, callback manipulation, fee, or unexpected balance delta reverts the
whole transition. Timestamp comparisons implement explicit participant
deadlines, so bounded block-time influence remains an accepted chain property.
Low-level calls are deliberate because ERC-20 contracts differ in return-value
behavior, and the adversarial suite covers the supported and rejected cases.
