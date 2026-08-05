# Reorganization-safe observer

I keep the observer separate from financial authorization. It stores only
canonical logs anchored to block hashes, walks back to a common ancestor when a
head changes, removes logs from the orphaned branch, and reloads the new range.
It ignores provider-supplied `removed` logs and rejects a log whose block hash
does not match the canonical header.

`reconcile()` reads direct state after synchronization and returns both views to
the caller. `evidence()` decodes the complete v1 event set, projects challenge
lifecycle state, serializes big integers as decimal strings, and emits a
machine-readable `challenge-escrow.observer/v1` record. It labels the observed
head as `latest`, `safe`, or `finalized` when the caller supplies those headers;
an open lifecycle is reported as `incomplete`, while an orphan, impossible
transition, duplicate payout, or conflicting release is `conflicted`.

An indexer can use the event stream for discovery, but it must use the direct
contract snapshot for entitlements, liability, and finality. The observer does
not treat a log as proof merely because its ABI decodes. `rpc.ts` compares two
read-only endpoints across latest, safe, and finalized heads and reports
`agree`, `divergent`, or `unavailable` instead of silently selecting one.

The memory-only tests simulate a two-block reorganization and verify that stale
events do not survive it. The deep observer test also decodes dynamic
`ReleaseDeclared` data, all lifecycle event families, an end-to-end projected
record, an orphan event, an RPC safe-head divergence, an RPC outage, malformed
signatures, and finality labels.
