# Invariant and state-transition ledger

I use this ledger as the first executable map of the protocol. It records what
the current Solidity release promises, which transition owns each promise, and
where the existing tests still provide only partial evidence. It describes the
research release at `challenge-escrow-protocol/v1`; it does not create a new
protocol namespace.

## Current evidence

I currently have 52 tests, 13 stateful invariant properties, exact token-delta
tests for incoming and outgoing transfers, and a public commitment vector. The
stateful handler compares the main lifecycle, liability, entitlement, pause,
and role fields. It does not yet compare every reason code, resolution path,
parent evidence link, event field, or constructor boundary in every generated
sequence. I mark those properties as partial below instead of treating the
handler's successful run as complete proof.

## State vocabulary

| State | How I enter it | Financial obligation created | Allowed lifecycle exits |
| --- | --- | --- | --- |
| `OPEN` | `createAndFund` pulls one exact stake | One challenger principal remains outstanding | `ACTIVE`, `CANCELLED`, `EXPIRED` |
| `ACTIVE` | `accept` pulls the second exact stake | Two principals remain outstanding | `PROPOSED`, `VOID` by proposal timeout |
| `PROPOSED` | `propose` records resolver evidence | Two principals remain outstanding | `DISPUTED`, `RESOLVED_A`, `RESOLVED_B`, `VOID` |
| `DISPUTED` | `dispute` records a competing evidence link | Two principals remain outstanding | `RESOLVED_A`, `RESOLVED_B`, `VOID` |
| `CANCELLED` | Challenger cancels before acceptance deadline | One challenger refund entitlement | No lifecycle exit; one pull refund |
| `EXPIRED` | Anyone expires after acceptance deadline | One challenger refund entitlement | No lifecycle exit; one pull refund |
| `RESOLVED_A` | Uncontested or arbiter decision selects `A` | One winner entitlement for two stakes | No lifecycle exit; one pull claim |
| `RESOLVED_B` | Uncontested or arbiter decision selects `B` | One winner entitlement for two stakes | No lifecycle exit; one pull claim |
| `VOID` | Evidence, proposal, or arbitration path ends without a winner | One refund entitlement per participant | No lifecycle exit; independent pull refunds |

Terminal state does not mean that the token has already moved. The state stores
the entitlement, while `claimWinnings` or `refundPrincipal` consumes it and
reduces the corresponding liability.

## Transition ledger

| ID | Entry point | Required state and boundary | Caller rule | Result |
| --- | --- | --- | --- | --- |
| `T-01` | `createAndFund` | No existing challenge; pause is off; execution fields and deadlines pass validation | `msg.sender` is the challenger | `OPEN`, one stake, one outstanding liability |
| `T-02` | `advanceAcceptanceNonce` | `OPEN` and before acceptance deadline | Challenger only | Same state, acceptance nonce increases by one |
| `T-03` | `accept` | `OPEN`, pause is off, current time is before acceptance deadline, permit and signature are valid | Caller is the permit wallet; challenger signs | `ACTIVE`, second stake, two outstanding liabilities |
| `T-04` | `cancelOpen` | `OPEN` and before acceptance deadline | Challenger only | `CANCELLED`, challenger refund entitlement |
| `T-05` | `expireOpen` | `OPEN` and at or after acceptance deadline | Any caller | `EXPIRED`, challenger refund entitlement |
| `T-06` | `propose` | `ACTIVE`, pause is off, observation reached, proposal deadline not reached, evidence nonzero, reason valid | Resolver only | `PROPOSED`, proposal evidence and dispute deadline |
| `T-07` | `dispute` | `PROPOSED`, dispute deadline not reached, different outcome, nonzero evidence, correct parent hash | Challenger or accepting wallet | `DISPUTED`, dispute evidence and arbitration deadline |
| `T-08` | `finalizeUncontested` | `PROPOSED` and dispute deadline reached | Any caller | Resolved outcome or evidence `VOID` |
| `T-09` | `arbitrate` | `DISPUTED`, correction cutoff reached, arbitration deadline not reached, valid evidence lineage | Arbiter only | Resolved outcome or evidence `VOID` |
| `T-10` | `voidUnproposed` | `ACTIVE` and proposal deadline reached | Any caller | `VOID`, two refund entitlements |
| `T-11` | `voidUnarbitrated` | `DISPUTED` and arbitration deadline reached | Any caller | `VOID`, two refund entitlements |
| `T-12` | `claimWinnings` | `RESOLVED_A` or `RESOLVED_B`, winner entitlement unconsumed | Winning wallet only | Same state, two-stake payment, liability reduced |
| `T-13` | `refundPrincipal` | `CANCELLED`, `EXPIRED`, or `VOID`, caller has an unconsumed refund entitlement | Challenger for open terminals; either participant for `VOID` | Same state, principal payment, liability reduced |
| `T-14` | `setPaused` | Pause value changes | Immutable pauser only | Global pause flag changes; existing safe exits remain callable |

Read-only commitment, identifier, challenge, entitlement, and role accessors
do not change lifecycle state and therefore sit outside this transition graph.

## Property ledger

| ID | Property | Current supporting evidence | Status |
| --- | --- | --- | --- |
| `P-01` | A challenge identity is the domain-separated hash of one specification hash, and a challenger nonce cannot be reused | `ChallengeEscrow.t.sol` golden vector; `ChallengeEscrowInvariantHandler` | Confirmed for current implementation and vector |
| `P-02` | Execution commitments bind chain, release, wallets, token, decimals, stake, deadlines, sides, and protocol namespace | `ChallengeCommitment.sol`; golden vector tests | Confirmed for current encoding |
| `P-03` | A created challenge receives exactly one configured stake | Security tests; incoming-token invariant handler | Confirmed for exercised token behaviors |
| `P-04` | Acceptance adds exactly one equal stake and changes `OPEN` to `ACTIVE` | Lifecycle tests; incoming-token invariant handler | Confirmed for exercised paths |
| `P-05` | `totalOutstandingLiability` equals the sum of challenge-level outstanding liabilities | Stateful financial invariant | Confirmed for generated handler sequences |
| `P-06` | Escrow balance is never below aggregate liability; unsolicited surplus is excluded from liability | Solvency invariant and surplus regression test | Confirmed for exercised paths |
| `P-07` | Lifecycle states move only along the transition graph above | Stateful lifecycle invariant | Confirmed for modeled actions; full transition metadata is partial |
| `P-08` | Deadline intervals are ordered and each timeout path ends no later than `timeoutVoidAt` | Execution validation tests and deadline invariant | Confirmed for generated valid executions |
| `P-09` | Acceptance authorization binds challenge, specification, wallet, nonce, expiry, chain, release, and challenger signature | Permit tests, security suite, EIP-712 vector | Confirmed for exercised invalid permutations |
| `P-10` | Resolver, arbiter, pauser, token, escrow, challenger, and accepting wallet cannot overlap where the release forbids overlap | Constructor tests, role tests, pauser tests | Confirmed for tested overlaps; constructor matrix is incomplete |
| `P-11` | Pause blocks new funding, acceptance, and proposals while disputes, finalization, timeouts, claims, and refunds remain available | Pause regression and stateful pause invariant | Confirmed for exercised actions |
| `P-12` | Every dispute parent hash equals the immediately preceding proposal evidence; arbitration points to dispute evidence | Evidence boundary tests and transition checks | Confirmed for direct tests; full reason and path metadata is partial |
| `P-13` | A terminal lifecycle state and its final resolution cannot be rewritten | Finality regression and stateful finality invariant | Confirmed for exercised terminal transitions |
| `P-14` | A resolved outcome creates exactly one winner entitlement for two stakes; `VOID` creates one principal entitlement per participant | Payout tests and financial invariant | Confirmed for exercised paths |
| `P-15` | Each entitlement can be consumed once, and a failed token transfer leaves it retryable | Security suite and adversarial token tests | Confirmed for exercised transfer failures |
| `P-16` | Every token movement requires exact return semantics and exact sender and recipient balance deltas | `ExactTokenDelta.sol` tests and incoming/outgoing adversarial handlers | Confirmed for covered token behaviors |
| `P-17` | One blocked recipient cannot prevent another participant from claiming or refunding | Independent void-refund regression test | Confirmed for direct path |
| `P-18` | Resolver, arbiter, and pauser have no withdrawal or payout-redirection path | Authority invariant and source inspection | Confirmed for current surface; formal exclusion remains pending |
| `P-19` | Events expose deterministic identities and committed hashes, while event history never creates a financial right | `ChallengeCreated` storage-reconciliation fixture, reorganization observer tests, and public threat model | Partial: every event payload and live-chain rollback/censorship path are not yet executable |
| `P-20` | Invalid calls revert atomically, preserving challenge storage, entitlements, aggregate liability, and escrow balance | Snapshot assertions in the stateful handler and adversarial token tests | Confirmed for modeled failures; complete error matrix is pending |
| `P-21` | Release configuration is direct and immutable: no proxy, delegatecall, owner withdrawal, rescue, or fee-redirection path can change the token, roles, or payout rules | Constructor and source inspection | Partial: this becomes an explicit negative property in the independent model and symbolic checks |
| `P-22` | `ReleaseDeclared` is emitted once with the same protocol, schema, chain, release, token, decimals, and role tuple that the release exposes afterward | Constructor event test decodes and compares every non-indexed field, plus the indexed release identity | Confirmed for the tested constructor tuple; a broader parameter matrix remains useful |

## Financial equations

For every challenge `c`, I use these equations as the model's accounting
boundary:

```text
challengeOutstanding(c)
  = deposited(c) - paidToChallenger(c) - paidToAcceptor(c)

totalOutstandingLiability
  = sum(challengeOutstanding(c) for every existing challenge c)

escrowTokenBalance
  >= totalOutstandingLiability

OPEN cancellation or expiry
  => challenger entitlement = stake

ACTIVE evidence or timeout VOID
  => challenger entitlement = stake
  + accepting entitlement = stake

RESOLVED_A or RESOLVED_B
  => winner entitlement = 2 * stake
```

An unsolicited token surplus is outside these equations. I keep it visible in
the balance but do not make it claimable or treat it as protocol liability.

## Third-stage formal boundary check

I added a solver-facing arithmetic specification in
`tools/formal/ChallengeEscrowArithmeticProperties.sol`. With the production
preconditions encoded as assumptions, the Solidity SMTChecker proved the
stake-times-two payout bound, the proposal dispute-deadline addition, the
arbitration-deadline addition, and the post-transfer solvency guard's logical
dominance under exact sender-delta semantics safe for `uint256` and `uint64`
arithmetic. I run the check through `pnpm run formal:check` with Z3 and fail
the command when the solver is missing or returns an unproved target.

This is a bounded proof of the arithmetic lemmas, not a claim that the solver
has verified the entire stateful contract. The independent model and the
Foundry stateful suite remain separate evidence sources, and the formal file
is deliberately a shadow specification so that it cannot silently replace the
production implementation.

## Evidence still required for this ledger

I consider the first stage complete only after the following gaps have a named
owner in the next stage:

1. I need an independent executable model rather than a handler that mirrors
   the contract's fields and assumptions.
2. I need generated tests for the complete constructor overlap matrix, every
   reason code, every resolution and void path, and all evidence parent links.
3. I need lifecycle-event fixtures for every emitted field and ordering, while
   the current `ReleaseDeclared` and `ChallengeCreated` fixtures plus the
   read-only observer cover direct state reconciliation, omission, duplication,
   anchoring, and local rollback.
4. I need a formal status for the external-token boundary, where the model must
   represent arbitrary callback behavior and exact balance changes without
   claiming to prove arbitrary token correctness.
5. I need to connect the proved arithmetic lemmas to a full contract-level
   symbolic run, or record a counterexample for any production path that is
   not covered by the shadow specification.

I use this ledger as the input to the independent model. I do not treat a green
Foundry run as permission to skip that model.
