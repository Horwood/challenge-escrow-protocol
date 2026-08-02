# Threat model

## Protected properties

- Escrow solvency and conservation.
- No unauthorized claim or refund recipient.
- Immutable final outcomes.
- Replay-resistant acceptance authorization.
- Safe exits during pause or authority failure.
- A rebuildable event history that cannot create financial rights.

## Trust boundaries

| Boundary | Primary risk | Current control |
|---|---|---|
| Terms to contract | Different or unavailable terms | Composite hash; clients must verify exact bytes and availability |
| Wallet to contract | Wrong chain, release, stake, or permit | Typed execution, EIP-712 domain, caller binding, nonce, expiry |
| Contract to token | False return, malformed return, fee, rebase, callback | Exact sender/recipient balance deltas and reentrancy guard |
| Resolver to participants | Wrong or unavailable proposal | Evidence hash, dispute window, separate arbiter, proposal timeout |
| Arbiter to participants | Wrong or unavailable decision | Immutable role, evidence lineage, arbitration timeout to `VOID` |
| Pauser to participants | Interested party blocks progress | Role separation; pause cannot block disputes or safe exits |
| Events to indexer | Reorg, omission, duplication | Ordered event identity, rollback/replay, direct chain reconciliation |

## Explicitly absent authority

There is no owner withdrawal, canonical-token rescue, proxy, delegate call,
role rotation, fee receiver, backend permit key, payout redirection, crowd
pool, batching dependency, or automatic oracle.

## Residual risks

- Resolver and arbiter may be dishonest, collude, or lose their keys.
- The pauser may deny new actions until another release is deployed.
- A configured token may blacklist wallets, change behavior, or become
  unavailable; exact-delta checks fail closed but cannot restore liveness.
- Full terms and evidence may disappear even though their hashes remain valid.
- Two different addresses may have the same controller.
- Chain censorship, gas unavailability, deep reorganization, and consensus
  failure remain external risks.
- The current public extraction has not received an independent audit.
