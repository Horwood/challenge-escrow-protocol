# Reading guide

This repository has two layers: a small Solidity release and the research that
explains why it is shaped this way. Start where your question lives.

## Five minutes: the protocol shape

Read [the root README](../README.md), then [protocol semantics](PROTOCOL.md).
The essential move is simple: the chain holds the money and finalizes a result;
humans interpret evidence within a set of commitments and deadlines.

## Thirty minutes: the design argument

Read [research evolution](EVOLUTION.md) after the protocol semantics. It shows
the discarded shortcuts: a single document hash, category-bound conditions,
and authority paths without a defined financial answer to silence.

Then read [the threat model](THREAT-MODEL.md). It separates things the contract
can guarantee from things it can only make visible or limit.

## An audit-oriented pass

1. Start with [the security review](SECURITY-REVIEW.md) to understand both the
   executed checks and the explicit assurance gaps.
2. Read `contracts/src/ChallengeEscrow.sol`, then
   `contracts/src/ChallengeEscrowKernel.sol`. The outer contract fixes the
   release boundary; the kernel implements the lifecycle.
3. Read `contracts/src/libraries/ExactTokenDelta.sol` before assuming ordinary
   ERC-20 behavior is sufficient.
4. Read the adversarial tests in `contracts/test/ChallengeEscrowSecurity.t.sol`.
5. Read the stateful handlers in `contracts/test/invariant/` and the public
   vector in `spec/vectors/`.

## Conformance work

The hashes at the protocol boundary are intentionally reproducible outside the
contract. `spec/vectors/commitments-v1.json` is fixed input and expected output;
`tools/verify-vectors.mjs` recalculates it with Foundry's command-line tools.

Use that boundary when writing another implementation, a client verifier, or a
formal model. A compatible implementation must preserve byte order, domains,
and namespace, not merely produce values that look similar.

## The shortest honest safety statement

The code has local evidence behind it, but it has not received an independent
audit and is not for real-value use. The intended reading order is therefore:
security policy first, claims second, code third.
