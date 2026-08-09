# Reading guide

The repository has two layers: a small Solidity release and the research that
explains its shape. Start where the active question lives.

## Five minutes: the protocol shape

Start with [the root README](../README.md), then move to [protocol
semantics](PROTOCOL.md). The essential move is simple: the chain holds the money
and finalizes a result, while people interpret evidence inside a set of
commitments and deadlines.

## Thirty minutes: the design argument

Read [research evolution](EVOLUTION.md) after the protocol semantics. It records
the discarded shortcuts: a single document hash, category-bound conditions, and
authority paths without a defined financial answer to silence.

Then read [the threat model](THREAT-MODEL.md). It separates contract guarantees
from risks that can only be made visible or limited.

## An audit-oriented pass

1. Start with [the security review](SECURITY-REVIEW.md) for the executed checks
   and remaining assurance gaps.
2. Read `contracts/src/ChallengeEscrow.sol`, then
   `contracts/src/ChallengeEscrowKernel.sol`. The outer contract fixes the
   release boundary; the kernel implements the lifecycle.
3. Read `contracts/src/libraries/ExactTokenDelta.sol` before assuming ordinary
   ERC-20 behavior is sufficient.
4. Read the adversarial tests in `contracts/test/ChallengeEscrowSecurity.t.sol`.
5. Read the stateful handlers in `contracts/test/invariant/` and the public
   vector in `spec/vectors/`.

## Conformance work

The hashes at the protocol boundary are reproducible outside the contract.
`spec/vectors/commitments-v1.json` is fixed input and expected output;
`tools/verify-vectors.mjs` recalculates it with Foundry's command-line tools.

Another implementation, client verifier, or formal model can use that boundary.
A compatible implementation must preserve byte order, domains, and namespace,
not merely produce values that look similar.

## Read-only integration and reorgs

The transport-neutral TypeScript reader in `tools/client/` loads
immutable release metadata, nested challenge state, and entitlements without a
signer. The reorganization-safe observer in `tools/client/observer.ts` keeps
events useful for discovery while requiring direct state reconciliation before
any financial interpretation.

[Portable observer receipts](OBSERVER-RECEIPTS.md) hand an observer run to
another implementation without hiding its release identity, head, quorum
dissent, projected state, or anomalies.

## Operations and exact release identity

The contract's immutable roles remain separate from any hypothetical operational
setup. [The authority policy](AUTHORITY-POLICY.md) makes epochs, thresholds,
controller separation, forbidden powers, and incident outcomes reviewable
without publishing keys or pretending a ceremony occurred.

[The release attestation](RELEASE-ATTESTATION.md) is the shortest route from a
review comment to exact source bytes, compiler settings, ABI, and deployed
runtime hashes. It detects research-package drift; it does not replace an
auditor or live-chain verification.

## The shortest honest safety statement

The code has local evidence behind it but no independent audit, and it is not
published for real-value use. Read in this order: security policy first, claims
second, code third.
