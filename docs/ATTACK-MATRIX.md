# Adversarial attack matrix

I use this matrix to spend testing time on reachable security boundaries, not
on a headline coverage number. It is a working security artifact for the
research release; it is not an audit report and it does not claim that an
uncovered branch is exploitable.

## Baseline

I generated the baseline with `pnpm run security:baseline`, which runs the
existing Foundry suite and parses its LCOV branch report. The current release
has one production branch without a hit in that report:

| Area | Uncovered branches | Why I keep it in scope |
| --- | ---: | --- |
| Constructor role and token boundaries | 0 | Self-referential role and token addresses are exercised through a CREATE factory |
| Creation identity, commitment, and funding | 0 | Commitment, identity, and funding boundaries are exercised |
| Acceptance permit and signature authorization | 0 | All ordinary binding and signer permutations are exercised |
| Open-state timeout and cancellation | 0 | Deadline rejection and cancellation boundaries are exercised |
| Proposal reason and correction cutoff | 0 | Reason and correction boundaries are exercised |
| Dispute lineage and arbitration start | 0 | Caller, deadline, evidence, and parent boundaries are exercised |
| Uncontested finalization | 0 | Early and successful finalization are exercised |
| Arbiter authorization and finalization | 0 | Authority, lineage, outcome, and timeout paths are exercised |
| Permissionless timeout void | 0 | Early and successful permissionless timeout paths are exercised |
| Claims and independent refunds | 0 | Missing, wrong-wallet, replay, and independent exits are exercised |
| Execution and deadline validation | 0 | Every ordinary execution predicate has a negative fixture |
| State access and accounting | 1 | The post-transfer insolvency guard is formally dominated by exact-delta and solvency preconditions, but remains unhit in LCOV |
| Token return and balance-delta boundaries | 0 | False, empty, malformed, non-one, and delta-mismatch returns are exercised |

The line and function reports are materially higher than branch coverage, so I
do not use them as a substitute for this matrix.

## Attack families

| ID | Attack I try to make possible | Primary oracle | Priority |
| --- | --- | --- | --- |
| `A-01` | Reuse one instance nonce or one challenge identity after a failed or successful create | Challenge existence, nonce map, and liability snapshot | P0 |
| `A-02` | Fund with a mismatched chain, release, token, decimals, stake, or supplied specification hash | Exact custom error and unchanged state | P0 |
| `A-03` | Accept with a wrong challenge, specification, signer, caller, nonce, expiry, or role wallet | Permit error plus atomicity snapshot | P0 |
| `A-04` | Cross every acceptance, observation, proposal, dispute, correction, arbitration, and timeout boundary at `t - 1`, `t`, and `t + 1` | Lifecycle state and entitlement equation | P0 |
| `A-05` | Propose or arbitrate an invalid reason, zero evidence, or a correction-sensitive `VOID` too early | Revert and unchanged proposal/dispute record | P0 |
| `A-06` | Dispute or arbitrate with a stale, zero, or unrelated parent evidence hash | Parent hash equality and final-resolution lineage | P0 |
| `A-07` | Finalize twice, claim twice, refund twice, or claim as the losing participant | One-time entitlement and aggregate liability | P0 |
| `A-08` | Make one `VOID` recipient revert while the other recipient still exits | Independent payout and residual liability | P0 |
| `A-09` | Return false, no data, malformed data, fee-adjusted data, rebased data, or wrong balance deltas from the token | Exact return decoder, sender delta, recipient delta, and atomicity | P0 |
| `A-10` | Re-enter from `transferFrom`, `transfer`, or `balanceOf` into every public mutator and read path | Reentrancy guard selector and unchanged state | P0 |
| `A-11` | Pause, unpause, or attempt to pause from the wrong authority while safe exits are pending | Pause flag and safe-exit availability | P1 |
| `A-12` | Overlap resolver, arbiter, pauser, escrow, token, challenger, or accepting wallet | Constructor rejection and participant rejection | P0 |
| `A-13` | Overflow stake payout or any derived deadline while satisfying the public execution constraints | CHC arithmetic lemmas plus boundary fixtures | P0 |
| `A-14` | Introduce an owner, proxy, delegate call, rescue, fee, or role-rotation path through a future refactor | Bytecode/source negative search and authority invariant | P0 |
| `A-15` | Treat an event replay, omission, duplication, or reorganization as a financial authorization | Direct storage reconciliation; events never create entitlement | P1 |

## Mutation baseline

I keep these mutations as explicit kill targets and run them with
`pnpm run security:mutation`. The runner copies the contract tree into a fresh
temporary directory, applies one source mutation, runs the production Foundry
suite, records the exit status, and removes the copy. The current baseline is
12 mutations killed, 0 survived. This is a representative local score; it does
not cover arbitrary future refactors or prove that every source line has a
unique mutation killer.

| Mutation | Deliberate change | Required killer |
| --- | --- | --- |
| `M-01` | Remove the pause guard from funding, acceptance, or proposal | Pause and safe-exit tests |
| `M-02` | Ignore permit challenge or specification binding | Permit permutation tests |
| `M-03` | Ignore acceptance nonce or expiry | Replay and stale-permit tests |
| `M-04` | Allow a role or participant wallet to accept | Constructor and participant overlap matrix |
| `M-05` | Ignore proposal or dispute parent evidence | Lineage fixtures |
| `M-06` | Move finalization or dispute one boundary earlier | `t - 1`, `t`, `t + 1` fixtures |
| `M-07` | Replace independent `VOID` refunds with a shared payout path | Blocked-recipient isolation |
| `M-08` | Remove exact incoming or outgoing balance-delta checks | Adversarial token corpus |
| `M-09` | Permit a second entitlement consumption | Claim/refund replay tests |
| `M-10` | Flip the winner-side mapping | A/B resolution matrix |
| `M-11` | Relax `timeoutVoidAt` path bounds | Deadline arithmetic and timeout tests |
| `M-12` | Add an authority escape hatch | Source and deployed-bytecode negative checks |

## Static-analysis interpretation

Slither still reports the deliberate low-level token calls, block-timestamp
comparisons, inline assembly, validation complexity, enum comparison, and a
medium `reentrancy-no-eth` finding around the token callback. I classify the
last item as a read-only callback surface rather than a cleared finding: every
state-changing entry point is protected by `nonReentrant`, and the adversarial
token suite checks that a callback cannot re-enter it. I keep the finding in
the matrix until an independent review confirms that no callback result is
consumed before the guarded transition completes.

The matrix is intentionally stricter than the current tests. A green test run
means that the tested behavior held; it does not mean that the remaining
unhit branches are unreachable on every future compiler or deployment path.
