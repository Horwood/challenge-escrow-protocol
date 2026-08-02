# Protocol semantics

## Purpose

I let two participant wallets lock the same amount of one configured ERC-20
asset against immutable execution fields and a hash of retrievable terms. I let
a resolver propose `A`, `B`, or `VOID`; I let either participant dispute; I let
an independent arbiter decide a disputed outcome. I let missing proposals or
arbitration end in permissionless `VOID`, and I make every terminal financial
exit pull-based.

## Trust statement

I keep the backend non-custodial, but I do not call the protocol trustless. I
let the resolver and arbiter interpret evidence, and I give the pauser control
of an incident flag. I make those roles immutable and mutually distinct, exclude
them from financial participation, and give them no way to withdraw escrowed
assets.

## Commitments

I bind:

1. a typed execution commitment containing chain, release, wallets, asset,
   stake, deadlines, and protocol namespace;
2. a hash of the canonical terms artifact;
3. an ordered specification hash of both commitments;
4. a domain-separated challenge identifier;
5. a wallet-bound EIP-712 acceptance permit.

I use hashes to authenticate exact bytes. I do not claim that they prove
availability, truth, completeness, or the correct interpretation of evidence.

## Financial invariants

I require the following properties:

- both deposits equal the configured stake exactly;
- I accept one immutable asset and charge no fee;
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

I let the resolver propose only after observation and before the proposal
deadline. I let participants dispute before the dispute deadline using evidence
that links to the proposal evidence hash. I start arbitration no earlier than
the source-correction cutoff and end it at a deterministic deadline. I let any
caller void an unproposed active challenge or an unarbitrated dispute after its
deadline.

## Versioning

I publish the research namespace as `challenge-escrow-protocol/v1`. I keep
contract releases direct and non-upgradeable. I require a new namespace and new
conformance vectors for every semantic or cryptographic change.
