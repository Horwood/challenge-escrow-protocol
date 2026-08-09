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
| Events to indexer | Reorg, omission, duplication, malformed semantics, concurrent sync | I use serialized atomic rollback and replay, header anchoring, bounded ingestion, strict event grammar, frozen reconciliation snapshots, and direct chain reconciliation |
| RPC providers to observer | Fork, stale or moving head, outage, false finality | I require an explicit N-provider threshold over number, hash, and parent hash, recheck each provider's latest header, and preserve dissent and outages |
| Observer run to reviewer | Hidden log, state, anomaly, or release drift | I commit a closed portable receipt and reproduce it in JavaScript and Python |
| RPC to testnet preflight | Wrong chain, credential leakage, mixed snapshots, write-method misuse, fake release tuple or split immutable values | I allowlist Sepolia/Base Sepolia, require HTTPS and the exact deployment block, pin code and getter reads to one canonical block hash, recheck its header, anchor the release log, call only read methods, match the normalized runtime, require each immutable group to agree internally, and reconcile it with `ReleaseDeclared` and getters |
| Operational policy to authority role | Shared controller, weak threshold, instant or stale epoch, excess capability | I use controller fingerprints, cross-role separation, strict-majority thresholds, a hashed announcement delay, predecessor lineage, and an exact forbidden-power set |
| Reviewed source to release artifact | Compiler, ABI, runtime, schema, or vector drift | I bind sorted file bytes and compiler output in an independently rebuilt release manifest |

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
- I accept that endpoint-neutral provider IDs do not prove provider
  independence or honest infrastructure.
- I accept that one HTTPS RPC hostname still relies on local DNS, TLS, and
  network routing. URL validation does not prove that the hostname resolves to
  a public or independent service.
- I accept that head quorum does not prove log completeness. A malicious
  provider can omit events unless the caller compares log payloads or verifies
  them against stronger chain evidence.
- I accept that the transport-neutral direct-state client cannot prove that a
  caller-supplied adapter honored its requested block tag. I require the tag,
  bound all returned fields, and use observer header reconciliation when that
  adapter trust is not sufficient.
- I accept that a quorum receipt proves direct ancestry only for adjacent tag
  heads. When `latest`, `safe`, and `finalized` are separated by several blocks,
  the receipt lacks the intervening headers and proves ordering rather than a
  complete ancestor path.
- I accept that the normalized-runtime check trusts the immutable layout in my
  checked-in compiler artifact. It binds live substitutions to getters but does
  not establish compiler-binary provenance.
- I accept that the audit environment is not fully hermetic. I reject analyzer
  version drift, but I do not vendor the analyzer binaries, Z3 package, Halmos
  transitive distributions, or the two remote Semgrep rule packs. My checked-in
  Semgrep rules and release manifest remain reproducible; external package and
  rule provenance still needs an independent build environment.
- I accept that the authority policy is a static model until real independent
  operators complete a valueless ceremony and incident exercise.
- I have not received an independent audit for this public extraction.
