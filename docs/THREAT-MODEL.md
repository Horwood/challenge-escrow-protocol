# Threat model

This threat model separates properties protected by the contract from
assumptions left with people, tokens, and the chain.

## Protected properties

- escrow solvency and conservation;
- authorized claim and refund recipients;
- immutable final outcomes;
- replay-resistant acceptance authorization;
- safe exits during pause or authority failure;
- rebuildable event history that cannot create financial rights.

## Trust boundaries

| Boundary | Primary risk | Control |
| --- | --- | --- |
| Terms to contract | Different or unavailable terms | Composite hash; clients verify exact bytes and availability |
| Wallet to contract | Wrong chain, release, stake, or permit | Typed execution, EIP-712 domain, caller binding, nonce, and expiry |
| Contract to token | False return, malformed return, fee, rebase, callback | Exact sender and recipient balance deltas with a reentrancy guard |
| Resolver to participants | Wrong or unavailable proposal | Evidence hash, dispute window, separate arbiter, and proposal timeout |
| Arbiter to participants | Wrong or unavailable decision | Immutable role, evidence lineage, and arbitration timeout to `VOID` |
| Pauser to participants | Interested party blocks progress | Separate role; disputes and safe exits remain available during pause |
| Events to indexer | Reorg, omission, duplication, malformed semantics, concurrent sync | Serialized atomic rollback and replay, header anchoring, bounded ingestion, strict event grammar, frozen reconciliation snapshots, and direct chain reconciliation |
| RPC providers to observer | Fork, stale or moving head, outage, false finality | Explicit N-provider threshold over number, hash, and parent hash; final header recheck; preserved dissent and outages |
| Observer run to reviewer | Hidden log, state, anomaly, or release drift | Closed portable receipt reproduced in JavaScript and Python |
| RPC to testnet preflight | Wrong chain, credential leakage, mixed snapshots, write-method misuse, fake release tuple or split immutable values | Sepolia/Base Sepolia allowlist, HTTPS and exact deployment block, one rechecked canonical block hash, anchored release log, read-only methods, normalized runtime match, immutable-group consistency, and reconciliation with `ReleaseDeclared` and getters |
| Operational policy to authority role | Shared controller, weak threshold, instant or stale epoch, excess capability | Controller fingerprints, cross-role separation, strict-majority thresholds, hashed announcement delay, predecessor lineage, and exact forbidden-power set |
| Reviewed source to release artifact | Compiler, ABI, runtime, schema, or vector drift | Sorted file bytes and compiler output bound in an independently rebuilt release manifest |

## Deliberately omitted authority

The release includes no owner withdrawal, canonical-token rescue, proxy,
delegate call, role rotation, fee receiver, backend permit key, payout
redirection, crowd pool, batching dependency, or automatic oracle.

## Accepted risks

- A resolver and arbiter may be dishonest, collude, or lose their
  keys.
- A pauser may deny new actions until another release is deployed.
- A configured token may blacklist wallets, change behavior, or
  become unavailable; exact-delta checks fail closed but cannot restore
  liveness.
- Full terms and evidence may disappear even while their hashes
  remain valid.
- Two different addresses may have the same controller.
- Chain censorship, gas unavailability, deep reorganization, and consensus
  failure remain external risks.
- Endpoint-neutral provider IDs do not prove provider
  independence or honest infrastructure.
- One HTTPS RPC hostname still relies on local DNS, TLS, and
  network routing. URL validation does not prove that the hostname resolves to
  a public or independent service.
- Head quorum does not prove log completeness. A malicious
  provider can omit events unless the caller compares log payloads or verifies
  them against stronger chain evidence.
- The transport-neutral direct-state client cannot prove that a caller-supplied
  adapter honored its requested block tag. The client requires the tag, binds
  all returned fields, and uses observer header reconciliation when that
  adapter trust is not sufficient.
- A quorum receipt proves direct ancestry only for adjacent tag
  heads. When `latest`, `safe`, and `finalized` are separated by several blocks,
  the receipt lacks the intervening headers and proves ordering rather than a
  complete ancestor path.
- The normalized-runtime check trusts the immutable layout in the
  checked-in compiler artifact. It binds live substitutions to getters but does
  not establish compiler-binary provenance.
- The audit environment is not fully hermetic. The gates reject analyzer version
  drift but do not vendor the analyzer binaries, Z3 package, Halmos
  transitive distributions, or the two remote Semgrep rule packs. The checked-in
  Semgrep rules and release manifest remain reproducible; external package and
  rule provenance still needs an independent build environment.
- The authority policy is a static model until real independent
  operators complete a valueless ceremony and incident exercise.
- This public extraction has not received an independent audit.
