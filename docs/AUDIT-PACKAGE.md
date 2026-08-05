# Audit package

I keep this package as a reproducible handoff for a reviewer. It collects the
protocol checks, the independent state models, the attack matrix, the static
analysis boundaries, and the exact places where I still need human review. It
is evidence for this research release, not an audit certificate.

## Scope

I treat `contracts/src` as the production boundary. I keep the following
independent evidence beside it:

| Layer | Artifact | What I use it for |
| --- | --- | --- |
| Specification | `docs/INVARIANTS.md` | State vocabulary, transition ledger, and property status |
| Differential model | `tools/model/` | A pure JavaScript execution model with deterministic and random traces |
| Arithmetic boundary | `tools/formal/` | Solc CHC/Z3 checks for derived payout and deadline arithmetic |
| Attack planning | `docs/ATTACK-MATRIX.md` | Reachable attack families, branch gaps, and mutation kill targets |
| Independent EVM run | `tools/medusa/` | A shadow state machine fuzzed by a separate execution engine |
| Public conformance | `spec/vectors/` and `tools/verify-vectors.mjs` | Commitment bytes and hashes outside the Solidity implementation |

The JavaScript and Solidity harnesses intentionally do not import production
state. They are useful only because they can disagree with it; I never count a
shadow-model pass as a production-bytecode proof.

## Reproduction order

From the repository root, I run:

```text
pnpm install --frozen-lockfile
pnpm run check
pnpm run model:test
pnpm run formal:check
pnpm run size:check
pnpm run schemas:check
pnpm run portable:check
pnpm run client:check
pnpm run simulator:test
pnpm run liveness:sweep
pnpm run failure:lab
pnpm run authority:v2
pnpm run security:baseline
pnpm run security:mutation
pnpm run medusa:test
gitleaks detect --source . --no-git --redact
semgrep scan --no-git-ignore --config p/security-audit --config p/secrets --error \
  --exclude node_modules --exclude tools/medusa/corpus \
  --exclude contracts/cache --exclude contracts/out --exclude contracts/broadcast \
  contracts/src contracts/test tools docs README.md SECURITY.md package.json
slither contracts --exclude-dependencies --print human-summary
pnpm audit --audit-level high
```

The single local command `pnpm run audit:baseline` executes this complete
sequence, stores each full log in a temporary directory, and prints a JSON
manifest with tool versions and exit codes. The five `check:lineN` commands are
the smaller line-specific baselines I run after each three-stage branch.

## Evidence from the current run

I have the following local results for this revision:

- The production Foundry suite passes 52 tests and 13 stateful invariant
  properties under the security profile.
- The independent JavaScript model passes 10,000 random sequences of 128
  actions after its deterministic transition matrix.
- The CHC/Z3 arithmetic boundary checks prove the selected payout and deadline
  assertions safe under the production preconditions; they do not prove the
  whole contract.
- The branch baseline reports one uncovered production branch. I ran the 12
  representative mutation targets in isolated temporary copies: all 12 were
  killed and none survived. This is a measured local mutation baseline, not a
  proof against every possible future refactor.
- The independent Medusa harness completes its 30-second run with no failed
  property or assertion test. Its corpus is local, ignored, and reproducible;
  it is not a minimized counterexample set.
- Gitleaks reports no secrets. Semgrep reports no finding under the selected
  security and secret rules. The locked dependency audit reports no known
  vulnerability at high severity or above.
- Slither reports no high-severity finding, while still reporting two medium,
  fourteen low, and nine informational findings. I retain the medium
  token-callback `reentrancy-no-eth` warning for independent review instead of
  classifying it as resolved.

The exact counts can change with compiler, analyzer, or corpus versions, so I
always attach the JSON manifest and tool versions to a review request.

## Counterexample handling

At this revision I have no failing counterexample to publish. If a property or
mutation fails, I preserve the smallest replayable call sequence, the exact
tool versions, the relevant source hash, and the pre/post state snapshot under
`tools/security/counterexamples/`. I redact addresses, credentials, and funded
test material before sharing anything outside the local review.

I do not treat a green fuzzing run as evidence that a mutation is killed: every
mutation in the attack matrix needs a named test or a minimized counterexample.

## Human review still required

I still need an independent audit of the production bytecode, a full negative
constructor matrix, field-level comparison for every remaining lifecycle event
and evidence lineage, live-chain reorganization and censorship testing,
deployment and key-management review, and a fresh runtime-size check after
every code change. This package does not authorize real-value deployment.
