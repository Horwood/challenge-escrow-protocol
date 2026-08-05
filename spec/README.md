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

This remains a partial conformance package: it does not prove external source
truth, live-chain finality, or every Solidity lifecycle path. The Rust verifier
is deliberately a portable boundary implementation, not an on-chain parser.
