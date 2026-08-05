# Reading guide

I split my repository into two layers: a small Solidity release and the
research that explains why I shaped it this way. I would start where your
question lives.

## Five minutes: the protocol shape

I would start with [the root README](../README.md), then move to [protocol
semantics](PROTOCOL.md). My essential move is simple: I let the chain hold the
money and finalize a result, while people interpret evidence inside a set of
commitments and deadlines.

## Thirty minutes: the design argument

I would read [research evolution](EVOLUTION.md) after the protocol semantics. I
use it to show the shortcuts I discarded: a single document hash,
category-bound conditions, and authority paths without a defined financial
answer to silence.

I would then read [the threat model](THREAT-MODEL.md). I use it to separate
what I can guarantee in the contract from what I can only make visible or limit.

## An audit-oriented pass

1. I start with [the security review](SECURITY-REVIEW.md) to show both the
   checks I ran and the assurance gaps I still carry.
2. I read `contracts/src/ChallengeEscrow.sol`, then
   `contracts/src/ChallengeEscrowKernel.sol`. The outer contract fixes my
   release boundary; the kernel implements my lifecycle.
3. I read `contracts/src/libraries/ExactTokenDelta.sol` before I assume ordinary
   ERC-20 behavior is sufficient.
4. I read the adversarial tests in `contracts/test/ChallengeEscrowSecurity.t.sol`.
5. I read the stateful handlers in `contracts/test/invariant/` and the public
   vector in `spec/vectors/`.

## Conformance work

I made the hashes at the protocol boundary reproducible outside the contract.
`spec/vectors/commitments-v1.json` is fixed input and expected output;
`tools/verify-vectors.mjs` recalculates it with Foundry's command-line tools.

I use that boundary when I write another implementation, a client verifier, or
a formal model. I expect a compatible implementation to preserve byte order,
domains, and namespace, not merely produce values that look similar.

## Read-only integration and reorgs

I keep the transport-neutral TypeScript reader in `tools/client/`. It loads
immutable release metadata, nested challenge state, and entitlements without a
signer. The reorganization-safe observer in `tools/client/observer.ts` keeps
events useful for discovery while requiring direct state reconciliation before
any financial interpretation.

## The shortest honest safety statement

I have local evidence behind the code, but I have not received an independent
audit and I do not publish it for real-value use. I therefore suggest this order:
security policy first, claims second, code third.
