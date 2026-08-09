# Formal proof ledger

This ledger separates properties proved symbolically from properties supported
only by tests or models. The harness calls the production release
surface and the production commitment libraries, while the arithmetic checks
keep their assumptions visible. This is not a whole-contract proof.

## Reproduction

From the repository root:

```text
pnpm run formal:check
pnpm run formal:contract
```

The arithmetic runner rejects a `solc` core version other than
`0.8.36+commit.8a079791`. The contract-coupled run uses `Halmos 0.3.3` with
`Z3`, a 30-second assertion limit, a 10-millisecond branch limit, and bounded
build and solver processes. The command writes its machine-readable result to
an ignored path and fails unless all ten properties finish with zero
counterexamples. The separate CHC run is bound to all seven
assertions in its arithmetic lemma source, so removing an assertion cannot
silently reduce the reported proof set.

## Current ledger

| ID | Property | Harness | Status |
| --- | --- | --- | --- |
| `F-01` | Under the explicit `uint64` timestamp construction bound, the release execution-hash accessor delegates to the production commitment library for every symbolic seed | `check_executionHashDelegates` | `PROVED` |
| `F-02` | The release specification-hash accessor delegates to the production commitment library for symbolic execution and terms hashes | `check_specHashDelegates` | `PROVED` |
| `F-03` | The release domain-separator accessor delegates to the production EIP-712 domain construction | `check_domainSeparatorDelegates` | `PROVED` |
| `F-04` | Equal-stake payout arithmetic remains representable under the production nonzero and half-range precondition | `check_stakePayoutBoundary` | `PROVED` |
| `F-05` | Arbitration deadline arithmetic remains representable under the execution validation bounds | `check_deadlineBoundary` | `PROVED` |
| `F-06` | The challenge-ID accessor delegates to the production identifier library | `check_challengeIdDelegates` | `PROVED` |
| `F-07` | The entitlement-ID accessor delegates to the production identifier library | `check_entitlementIdDelegates` | `PROVED` |
| `F-08` | The acceptance-permit type hash and digest delegate to the production permit library | `check_acceptancePermitDelegates` | `PROVED` |
| `F-09` | Under a bounded exact-token model, `OPEN → CANCELLED → paid refund` preserves challenge and aggregate liability and restores the original wallet balance | `check_cancelRefundConservesLiability` | `PROVED` |
| `F-10` | The deployed release identifier binds the production chain ID and escrow address through the production identifier library | `check_releaseIdBindsChainAndEscrow` | `PROVED` |

The current configuration contains ten properties. `F-09` is stateful but
bounded: it uses one exact-behavior token, one caller, one challenge, a
nonzero `uint96` stake, nonce, and terms hash, a timestamp with seven seconds
of headroom, and the open cancellation path. It does not generalize to arbitrary
ERC-20 behavior,
acceptance signatures, proposals, disputes, winner claims, concurrent
challenges, every event field, or live-chain behavior. Those remain separate
test, model, observer, and review obligations.

## Scope vocabulary

- `PROVED` means that the configured symbolic run found no counterexample for
  the stated harness and bounds.
- `BOUNDED` is reserved for a property that depends on an explicit loop,
  array, or path bound and must not be presented as an unbounded proof.
- `TESTED` identifies evidence supplied by Foundry, the JavaScript model, the
  Python implementation, or the independent EVM runner.
- `OPEN` identifies a property that still needs another implementation,
  adversarial fixture, or human review.
