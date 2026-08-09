# Portable observer receipts

`challenge-escrow.observer-receipt/v1` is a small, closed receipt over an
observer run. It does not claim that an RPC provider is honest or that an
off-chain fact is true. It records exactly which release, chain head, provider
quorum, projected state, logs, and anomalies produced an observation.

## Bound data

Every receipt binds five boundaries:

1. the chain ID, escrow address, on-chain release ID, event protocol, and
   protocol version;
2. the selected block number, hash, parent hash, and explicit finality label;
3. every endpoint-neutral provider ID and its latest, safe, and finalized
   snapshot;
4. the complete quorum result, including supporters, dissenters, outages, and
   competing block groups;
5. SHA-256 commitments to canonical logs, projected challenge state, and the
   anomaly list, plus their exact counts.

Provider IDs use a short hostname-free vocabulary. Error fields accept only a
closed list of endpoint-free states, so an uppercase credential cannot pass as
a harmless error code. Provider IDs are sorted before building the receipt,
duplicates are rejected, every block number is constrained to the observer's
`uint64` boundary, and `parentHash` is included in the agreement key. Two
providers reporting the same height and block hash but a different parent
therefore do not count as agreement.

Both implementations recompute the release ID from the chain ID and escrow
address using the production domain and packed encoding. A well-formed but
unrelated `releaseId` is therefore rejected before the receipt is hashed.

## Quorum semantics

`latest`, `safe`, and `finalized` are compared independently. A tag is `agree`
only when exactly one block group reaches the declared threshold. Multiple
qualifying groups are `conflicted`; insufficient available support is
`unavailable`. Dissent and outages remain visible even when a threshold is met.

A receipt may label its selected head `latest`, `safe`, `finalized`, or
`unknown`. Any concrete finality label must reproduce an agreed quorum head.
`unknown` is an explicit loss of assurance, not an alias for finality.
An unknown-finality head must still appear in at least one provider group. Each
available provider must also report internally ordered and locally coherent
`latest`, `safe`, and `finalized` heads. An unavailable provider cannot retain
stale heads.

The receipt verifies an exact parent link when two reported tags are adjacent.
When they are separated by more than one block, it can verify only height
ordering because the intervening headers are not in the receipt. That is not a
proof that `finalized` is an ancestor of `safe` or `latest`.

## Reproduction boundary

The public vector is
[`spec/vectors/observer-receipt-v1.json`](../spec/vectors/observer-receipt-v1.json).
It starts from deliberately unordered provider input, records a two-of-three
quorum, and preserves one latest-head dissenter. JavaScript and an independent
Python implementation reconstruct the same canonical receipt and
domain-separated Keccak hash.

The negative corpus in
[`spec/vectors/observer-receipt-negative-v1.json`](../spec/vectors/observer-receipt-negative-v1.json)
covers duplicate and NFC-colliding JSON keys, duplicate providers, endpoint
and hostname leakage, secret-like error codes, non-canonical thresholds,
`uint256` release-field overflow, `uint64` block-number overflow, stale heads on
unavailable providers, invalid finality order,
same-height finality forks, unobserved heads, parent-hash forks, altered heads,
release drift, provider reordering, commitment changes, hidden anomalies,
non-majority thresholds, oversized evidence sets, and excessive nesting.

```sh
pnpm run observer:check
```

The current vector reproduces to 4,692 canonical bytes and receipt hash
`0x47441bcc4db2b3935b6cc6e571f98347953d7dbb6a0fc19feea0b34dcbf57a53`
in both implementations. All 24 negative cases reject with their declared
codes.

Regenerate the checked-in golden output only when the receipt format itself
changes:

```sh
pnpm run observer:vector
```

## What this still does not prove

The receipt does not establish provider independence, economic finality,
source truth, live-network availability, or correct infrastructure operation.
It does not prove that a provider returned complete logs or that its block data
matches chain consensus, and it does not carry a complete ancestry proof across
gaps between finality tags. It has no signing key and grants no contract
authority. It makes an observer run reproducible and tamper-evident; it does
not turn observation into an oracle.
