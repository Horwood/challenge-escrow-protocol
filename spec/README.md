# Conformance artifacts

I left out the larger machine-readable schema and vector set from the source
project because its cryptographic domains and several fields were tied to the
original product namespace. Copying those files after renaming them would have
left me with internally inconsistent or misleading results.

I created `vectors/commitments-v1.json` as a new product-neutral golden vector
for the execution commitment, specification hash, challenge identifier, and
EIP-712 acceptance permit. `pnpm vectors:check` independently recomputes it with
Foundry's `cast`, while my Solidity suite checks the same values on-chain.

I consider this a partial conformance package. I still need to regenerate
publishable terms and evidence schemas, canonical JSON rules,
condition-language vectors, and cross-language implementations under the public
namespace.
