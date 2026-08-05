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
language, canonical JSON rules, and one cross-language vector in
`schemas/` and `vectors/portable-v1.json`. JavaScript and Python both validate
the envelope, canonical bytes, domain-separated Keccak hashes, duplicate-key
rejection, and selected negative cases. I still treat this as a partial
conformance package because a second production implementation and a larger
negative vector corpus remain future work.
