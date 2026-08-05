# Formal proof ledger

I use this ledger to separate the properties I prove symbolically from the
properties I only test or model. The harness calls the production release
surface and the production commitment libraries, while the arithmetic checks
keep their assumptions visible. I do not describe this as a whole-contract
proof.

## Reproduction

From the repository root, I run:

```text
pnpm run formal:check
pnpm run formal:contract
```

The contract-coupled run uses `Halmos 0.3.3` with `Z3`, a 30-second assertion
limit, and a 10-millisecond branch limit. The command writes its machine-
readable result to an ignored path and fails unless all five properties finish
with zero counterexamples.

## Current ledger

| ID | Property | Harness | Status |
| --- | --- | --- | --- |
| `F-01` | The release execution-hash accessor delegates to the production commitment library for every symbolic seed | `check_executionHashDelegates` | `PROVED` |
| `F-02` | The release specification-hash accessor delegates to the production commitment library for symbolic execution and terms hashes | `check_specHashDelegates` | `PROVED` |
| `F-03` | The release domain-separator accessor delegates to the production EIP-712 domain construction | `check_domainSeparatorDelegates` | `PROVED` |
| `F-04` | Equal-stake payout arithmetic remains representable under the production nonzero and half-range precondition | `check_stakePayoutBoundary` | `PROVED` |
| `F-05` | Arbitration deadline arithmetic remains representable under the execution validation bounds | `check_deadlineBoundary` | `PROVED` |

The current run proves five properties with zero counterexamples. The result
does not cover arbitrary external token behavior, every stateful lifecycle
sequence, every event field, or live-chain behavior. Those remain separate
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
