# Reorganization-safe observer

I keep the observer separate from financial authorization. It stores only
canonical logs anchored to block hashes, walks back to a common ancestor when a
head changes, removes logs from the orphaned branch, and reloads the new range.
It ignores provider-supplied `removed` logs and rejects a log whose block hash
does not match the canonical header.

`reconcile()` reads direct state after synchronization and returns both views to
the caller. An indexer can use the event stream for discovery, but it must use
the direct contract snapshot for entitlements, liability, and finality. The
memory-only test simulates a two-block reorganization and verifies that stale
events do not survive it. It also checks duplicate collapse, provider-supplied
removals, block-hash mismatches, unavailable heads, omitted events, and invalid
deployment boundaries.
