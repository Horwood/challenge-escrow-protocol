# Protocol semantics

## Purpose

Two participant wallets lock the same amount of one configured ERC-20 asset
against immutable execution fields and a hash of retrievable terms. A resolver
can propose `A`, `B`, or `VOID`; either participant can dispute; an independent
arbiter decides a disputed outcome. Missing proposals or arbitration end in
permissionless `VOID`, and every terminal financial exit is pull-based.

## Trust statement

The protocol is non-custodial, but it is not trustless. The resolver
and arbiter interpret evidence, and the pauser controls an incident flag. Those
roles are immutable and mutually distinct, excluded from financial
participation, and unable to withdraw escrowed assets.

## Commitments

The protocol binds:

1. a typed execution commitment containing chain, release, wallets, asset,
   stake, deadlines, and protocol namespace;
2. a hash of the canonical terms artifact;
3. an ordered specification hash of both commitments;
4. a domain-separated challenge identifier;
5. a wallet-bound EIP-712 acceptance permit.

Hashes authenticate exact bytes. They do not prove availability, truth,
completeness, or the correct interpretation of evidence.

## Financial invariants

The financial boundary requires:

- both deposits equal the configured stake exactly;
- one immutable asset and no fee;
- an open cancellation or expiry refunds one stake to the challenger;
- `VOID` refunds one stake to each participant;
- `A` or `B` creates one entitlement for twice the stake;
- a wallet consumes its entitlement once;
- state changes and token movement revert together on malformed calls or
  unexpected balance deltas;
- resolver, arbiter, and pauser roles have no escrow withdrawal path;
- pause blocks new funding, acceptance, and resolver proposals, while disputes,
  finalization, timeout voiding, claims, and refunds remain available.

## Resolution paths

The resolver can propose only after observation and before the proposal
deadline. Participants can dispute before the dispute deadline using evidence
linked to the proposal evidence hash. Arbitration starts no earlier than the
source-correction cutoff and ends at a deterministic deadline. Any caller can
void an unproposed active challenge or an unarbitrated dispute after its
deadline.

## Versioning

The research namespace is `challenge-escrow-protocol/v1`. Contract releases are
direct and non-upgradeable. Every semantic or cryptographic change requires a
new namespace and new conformance vectors. The portable
terms, evidence, and condition envelopes use their own versioned identifiers;
their canonical bytes and domain-separated hashes are documented in
[portable semantics](PORTABLE-SEMANTICS.md).
