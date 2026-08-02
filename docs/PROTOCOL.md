# Protocol semantics

## Purpose

Two participant wallets lock the same amount of one configured ERC-20 asset
against immutable execution fields and a hash of retrievable terms. A resolver
proposes `A`, `B`, or `VOID`; either participant may dispute; an independent
arbiter may decide a disputed outcome. Missing proposals or arbitration lead to
permissionless `VOID`, and every terminal financial exit is pull-based.

## Trust statement

The backend is non-custodial, but the protocol is not trustless. The resolver
and arbiter interpret evidence, and the pauser controls an incident flag.
Those roles are immutable, mutually distinct, excluded from financial
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

- Both deposits must equal the configured stake exactly.
- The contract accepts one immutable asset and charges no fee.
- An open cancellation or expiry refunds one stake to the challenger.
- `VOID` refunds one stake to each participant.
- `A` or `B` creates one entitlement for twice the stake.
- A wallet can consume its entitlement once.
- State changes and token movement revert together on malformed calls or
  unexpected balance deltas.
- Resolver, arbiter, and pauser roles have no escrow withdrawal path.
- Pause blocks new funding, acceptance, and resolver proposals, while disputes,
  finalization, timeout voiding, claims, and refunds remain available.

## Resolution paths

The resolver may propose only after observation and before the proposal
deadline. Participants can dispute before the dispute deadline using evidence
that links to the proposal evidence hash. Arbitration begins no earlier than
the source-correction cutoff and ends at a deterministic deadline. An
unproposed active challenge and an unarbitrated dispute can be voided by any
caller after their respective deadlines.

## Versioning

The public research namespace is `challenge-escrow-protocol/v1`. Contract
releases are direct and non-upgradeable. A semantic or cryptographic change
requires a new namespace and new conformance vectors.
