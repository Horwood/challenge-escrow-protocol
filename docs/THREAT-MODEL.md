# Threat model

I use this threat model to separate the properties I protect in the contract
from the assumptions I leave with people, tokens, and the chain.

## Properties I protect

- I protect escrow solvency and conservation.
- I prevent an unauthorized claim or refund recipient.
- I keep final outcomes immutable.
- I make acceptance authorization resistant to replay.
- I keep safe exits available during pause or authority failure.
- I make event history rebuildable without letting it create financial rights.

## Trust boundaries

| Boundary | Primary risk | Control I use |
| --- | --- | --- |
| Terms to contract | Different or unavailable terms | I use a composite hash; clients must verify exact bytes and availability |
| Wallet to contract | Wrong chain, release, stake, or permit | I use typed execution, an EIP-712 domain, caller binding, nonce, and expiry |
| Contract to token | False return, malformed return, fee, rebase, callback | I use exact sender and recipient balance deltas with a reentrancy guard |
| Resolver to participants | Wrong or unavailable proposal | I use an evidence hash, dispute window, separate arbiter, and proposal timeout |
| Arbiter to participants | Wrong or unavailable decision | I use an immutable role, evidence lineage, and arbitration timeout to `VOID` |
| Pauser to participants | Interested party blocks progress | I separate the role and keep disputes and safe exits available during pause |
| Events to indexer | Reorg, omission, duplication | I use ordered event identity, rollback and replay, and direct chain reconciliation |

## Authority I deliberately omit

I include no owner withdrawal, canonical-token rescue, proxy, delegate call, role
rotation, fee receiver, backend permit key, payout redirection, crowd pool,
batching dependency, or automatic oracle.

## Risks I still accept

- I accept that a resolver and arbiter may be dishonest, collude, or lose their
  keys.
- I accept that a pauser may deny new actions until another release is deployed.
- I accept that a configured token may blacklist wallets, change behavior, or
  become unavailable; exact-delta checks fail closed but cannot restore
  liveness.
- I accept that full terms and evidence may disappear even while their hashes
  remain valid.
- I accept that two different addresses may have the same controller.
- I accept chain censorship, gas unavailability, deep reorganization, and
  consensus failure as external risks.
- I have not received an independent audit for this public extraction.
