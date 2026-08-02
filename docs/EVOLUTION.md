# Research evolution

I am keeping the decisions that survived implementation and adversarial
testing. I treat this as my design history, not as a production-readiness
claim.

## From a document hash to a composite commitment

I started by treating one hash of a terms document as the challenge identity. I
found that insufficient once I was also passing execution fields such as
wallets, chain, release, asset, stake, and deadlines to the contract. I now hash
those typed fields independently, hash the canonical terms bytes independently,
and combine both under an ordered domain. That makes disagreement at either
boundary visible without putting full documents on-chain.

## From market-specific rules to a closed condition language

I tested rules tied to one price feed or event source and found that they made
the financial kernel depend on a particular product. I kept the contract
category-neutral instead: I treat terms and evidence as committed artifacts,
while resolver and arbiter roles interpret a deliberately limited off-chain
condition language. I require a new namespace whenever I add a condition kind,
so old commitments do not silently change meaning.

## Evidence lineage and correction windows

I make every result proposal commit to evidence, and I require a dispute to
reference that proposal evidence while adding its own challenge evidence. I let
arbitration begin only after the source-correction cutoff. These links do not
prove truth or availability, but they stop later parties from silently changing
which artifacts a decision refers to.

## Failure becomes a financial outcome

I do not want authority silence, missing evidence, or unresolved disagreement to
trap funds indefinitely. I therefore make proposal and arbitration deadlines
end in a permissionless `VOID`, which creates one refund entitlement per
participant. I let an emergency pause block new exposure while leaving
disputes, timeouts, claims, and refunds available.

## Exact token accounting

I do not trust an ERC-20 return value by itself. Fee-on-transfer, rebasing,
malformed, callback-capable, or deliberately deceptive tokens can all break
accounting. I check exact sender, recipient, and escrow balance deltas around
every transfer and reject any mismatch. That narrows the supported asset set by
design and keeps accounting failures atomic.

## Events as a rebuildable read model

I emit deterministic identities and committed hashes so an indexer can roll
back, replay, and reconcile after a reorganization. I treat the read model as a
way to improve discovery and presentation, never as a source of financial
rights or a replacement for direct contract state.

## Public extraction

I removed interface code, social-network integration, deployment operations,
infrastructure addresses, private history, and user data. I kept the protocol
kernel, tests, public semantics, threat model, and conformance boundary so I can
have the work reviewed independently of the product that motivated it.
