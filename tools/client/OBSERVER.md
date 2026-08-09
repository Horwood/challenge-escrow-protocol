# Reorganization-safe observer

The observer remains separate from financial authorization. It stores only
canonical logs anchored to block hashes, walks back to a common ancestor when a
head changes, removes logs from the orphaned branch, and reloads the new range.
It ignores provider-supplied `removed` logs and rejects a log whose block hash
does not match the canonical header.

Each synchronization is serialized and transactional in memory. Concurrent
callers share the same in-flight synchronization instead of racing an older
head against a newer one. Headers and logs are built in a temporary snapshot,
the head is read again after log loading, and accepted state changes only if
the whole range still anchors to one consecutive chain.
The implementation bounds the block span, reorganization depth, number of logs
per sync, retained headers, total retained logs, topic count, and event-data size. A caller can
tune those limits, but cannot disable them with a zero or unbounded value.

`reconcile()` freezes the current logs and head together, reads direct state,
rechecks the same head hash after that read, and returns both views only if the
anchor remains stable.
`evidence()` decodes the complete v1 event set, projects challenge
lifecycle state, serializes big integers as decimal strings, and emits a
machine-readable `challenge-escrow.observer/v1` record. It labels the observed
head as `latest`, `safe`, or `finalized` when the caller supplies those headers;
an absent release declaration or open lifecycle is reported as `incomplete`,
while an orphan, impossible
transition, duplicate payout, or conflicting release is `conflicted`.

An indexer can use the event stream for discovery, but it must use the direct
contract snapshot for entitlements, liability, and finality. The observer does
not treat a log as proof merely because its ABI decodes. `rpc.ts` retains the
two-endpoint compatibility report and also supports an explicit N-provider
threshold. It groups latest, safe, and finalized heads by number, hash, and
parent hash; preserves supporters, dissenters, outages, and competing groups;
and reports `agree`, `conflicted`, or `unavailable` instead of silently
selecting one endpoint. It rereads each provider's latest block at the end of
that provider snapshot and rejects a same-height hash change.

Provider names are endpoint-neutral identifiers rather than URLs. Input order
does not affect the report. Exactly one block group must reach the threshold:
two qualifying groups are a conflict, while too little available support is an
availability failure.

The event decoder accepts only canonical ABI layouts and combinations the
production contract can emit. It rejects aliased dynamic tails, trailing data,
impossible outcome and reason pairs, timeout evidence on a no-evidence path,
non-refundable payout origins, mixed contract addresses, duplicate block-global
log positions, non-canonical transaction/log ordering, same-height forks,
payout entitlement-ID drift, and cross-event
schedule or lineage drift. The projector also binds participants to the
declared release boundary and enforces the source-correction cutoff for early
`VOID` proposals except `TERMS_UNRESOLVABLE`. These checks do not make a
provider honest, but they keep malformed provider data from becoming a normal
projected event.

The memory-only tests simulate a two-block reorganization, concurrent sync
calls, and a sync triggered during direct-state reconciliation. They verify
that stale events do not survive and that the returned logs remain paired with
the reconciled head. The deep observer test also decodes dynamic
`ReleaseDeclared` data, all lifecycle event families, an end-to-end projected
record, an orphan event, an RPC safe-head divergence, an RPC outage, malformed
signatures, finality labels, two-of-three agreement, split quorums,
parent-hash forks, provider ordering, same-height movement during a provider
snapshot, outages, and insufficient support. The
same corpus preserves a stale latest head as dissent, treats competing
finalized groups as a deep finality ambiguity, and keeps a complete outage
unavailable. Raw provider exceptions are reduced to stable endpoint-free error
codes before they enter any report. A deterministic 512-case differential
corpus compares the TypeScript quorum with the independent receipt builder
across two to six providers, thresholds, outages, forks, permutations, and hex
case normalization. The
portable receipt format and independent conformance boundary are documented in
[`docs/OBSERVER-RECEIPTS.md`](../../docs/OBSERVER-RECEIPTS.md).
