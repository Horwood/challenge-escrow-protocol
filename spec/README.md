# Conformance artifacts

I left out the larger machine-readable schema and vector set from the source
project because its cryptographic domains and several fields were tied to the
original product namespace. Copying those files after renaming them would have
left me with internally inconsistent or misleading results.

I created `vectors/commitments-v1.json` as a new product-neutral golden vector
for the execution commitment, specification hash, challenge identifier, and
EIP-712 acceptance permit. `pnpm vectors:check` independently recomputes it with
Foundry's `cast`, while my Solidity suite checks the same values on-chain.

I now include a product-neutral terms schema, evidence schema, closed condition
language, canonical JSON rules, one cross-language vector, and a machine-readable
negative corpus. JavaScript, Python, and an independent Rust crate validate the
envelope, canonical bytes, domain-separated Keccak hashes, duplicate-key
rejection, and bounded condition evaluation. `pnpm run portable:differential`
compares the three implementations byte-for-byte on the golden vector.

The read-only observer emits a separate `challenge-escrow.observer/v1` envelope
under `schemas/observer-v1.json`. It records the block-pinned head, finality
labels, decoded event records, projected challenge states, and explicit
conflict/incompleteness anomalies without granting any financial authority.

I also publish `challenge-escrow.observer-receipt/v1`. It commits the release,
selected head, N-provider latest/safe/finalized quorum, canonical logs,
projected state, and anomalies. JavaScript and an independent Python verifier
reconstruct the golden receipt and replay a 24-case negative corpus. A
separate 512-case differential run keeps the receipt and TypeScript quorum
semantics aligned.

`challenge-escrow.authority-policy/v1` describes role epochs, predecessor
lineage, controller fingerprints, thresholds, custody classes, rotation
windows, and forbidden capabilities. Its public incident matrix covers member
loss, suspected compromise, quorum loss, pauser loss, and stale-policy replay
without containing a key, endpoint, or live address. Accepted thresholds must
be strict majorities.

The generated `challenge-escrow.release-manifest/v1` binds production Solidity
bytes, compiler settings, ABI, raw and immutable-normalized runtime hashes, the
six public immutable groups, schemas, vectors, proof ledger, and research
tooling. JavaScript and Python independently rebuild it from the current tree
and compiled artifact.

The testnet boundary emits `challenge-escrow.testnet-preflight/v1` only after
checking an allowlisted Sepolia or Base Sepolia chain, the reviewed runtime
outside immutable slots, consistency of every repeated immutable substitution,
the `ReleaseDeclared` event, and the public release getters. The preflight has
no write method or credential path. It binds code and getter reads to one
canonical snapshot hash, anchors the release log to its block header, and
rejects a changed snapshot header before emitting a report.

This remains a partial conformance package: it does not prove external source
truth, provider independence, live-chain finality, real key custody, or every
Solidity lifecycle path. The Rust verifier is deliberately a portable boundary
implementation, not an on-chain parser, and the release manifest is not an
external auditor's signature.
