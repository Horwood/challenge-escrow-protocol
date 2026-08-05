# Liveness and authority failure

I measure liveness as a financial exit, not as a promise that a resolver or an
arbiter will answer. A valid execution must let the challenger exit after the
acceptance deadline, let both participants exit after an unproposed active
challenge reaches its proposal deadline, and let a disputed challenge reach a
deterministic arbitration timeout bounded by `timeoutVoidAt`.

## What I sweep

`tools/liveness/sweep.mjs` generates 10,000 deterministic deadline schedules,
including exact-boundary cases and intentionally invalid values. It checks the
same ordering rules as the execution validator, then asks the JavaScript model
to accept or reject the same schedule. For every valid schedule it measures:

| Measurement | Meaning |
| --- | --- |
| Challenger open exit | Time from opening until cancellation or expiry is available |
| Resolver silence | Time until anyone can void an active challenge with no proposal |
| Arbiter silence | Worst dispute path through the arbitration timeout |
| Protocol bound | Configured `timeoutVoidAt` from opening |
| Timeout slack | Extra time between the latest authorized path and `timeoutVoidAt` |

The sweep is a parameter diagnostic, not a claim about wall-clock finality;
block production, censorship, gas availability, and reorganization remain
external assumptions.

## Authority failure policy

| Failure | New exposure | Existing funds | Permissionless end |
| --- | --- | --- | --- |
| Pauser stays paused | Funding, acceptance, and proposals stop | Disputes, finalization, timeout voids, claims, and refunds remain available | The path already active in the challenge |
| Resolver disappears | No new proposal | An active challenge reaches `VOID` at the proposal deadline | `voidUnproposed` |
| Arbiter disappears | No new authority decision | A dispute reaches `VOID` at its bounded arbitration deadline | `voidUnarbitrated` |
| Resolver or arbiter lies | The result may be wrong | Evidence lineage, dispute, and independent claims remain explicit | Dispute or timeout, not an administrative override |

I do not add an owner, role rotation, emergency withdrawal, or proxy to solve
authority silence. Any v2 authority policy must show measured latency, the
extra trust it introduces, and the exact failure path it preserves.

## Measured v2 prototype

I model a possible v2 certificate policy in `tools/liveness/authority-v2.mjs`.
It uses an epoch, three named authority members, a quorum of two, an evidence
parent link, and a 30-unit decision window. The prototype measures the normal
certificate latency, tolerates one missing member, and falls back to
permissionless `VOID` when quorum is unavailable. It rejects an old epoch
before considering the certificate valid.

This is an off-chain policy experiment. It does not change the immutable
resolver or arbiter in the Solidity release, and I would not merge it into the
contract without signature-domain design, key-rotation analysis, gas and size
measurements, independent review, and new conformance vectors.
