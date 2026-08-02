# Conformance artifacts

The source project contained a larger set of machine-readable schemas and
vectors, but their cryptographic domains and several fields were tied to the
original product namespace. Copying those files after renaming would produce
internally inconsistent or misleading results, so they are deliberately
excluded from this research extraction.

`vectors/commitments-v1.json` is a new product-neutral golden vector for the
execution commitment, specification hash, challenge identifier, and EIP-712
acceptance permit. `pnpm vectors:check` independently recomputes it with
Foundry's `cast`, while the Solidity suite checks the same values on-chain.

This remains a partial conformance package. Publishable terms and evidence
schemas, canonical JSON rules, condition-language vectors, and cross-language
implementations still need to be regenerated under the public namespace.
