# Research evolution

This note keeps the decisions that survived implementation and adversarial
testing. It is design history, not a production-readiness claim.

## From a document hash to a composite commitment

The first design treated one hash of a terms document as the challenge identity.
That became insufficient once execution fields such as wallets, chain, release,
asset, stake, and deadlines also entered the contract. The current design hashes
those typed fields independently, hashes the canonical terms bytes
independently, and combines both under an ordered domain. Disagreement at either
boundary becomes visible without putting full documents on-chain.

## From market-specific rules to a closed condition language

Rules tied to one price feed or event source made the financial kernel depend on
a particular product. The contract remains category-neutral instead: terms and
evidence are committed artifacts, while resolver and arbiter roles interpret a
deliberately limited off-chain condition language. Every new condition kind
requires a new namespace, so old commitments cannot silently change meaning.

## Evidence lineage and correction windows

Every result proposal commits to evidence. A dispute references that proposal
evidence while adding its own challenge evidence, and arbitration begins only
after the source-correction cutoff. These links do not
prove truth or availability, but they stop later parties from silently changing
which artifacts a decision refers to.

## Failure becomes a financial outcome

Authority silence, missing evidence, or unresolved disagreement must not trap
funds indefinitely. Proposal and arbitration deadlines therefore end in a
permissionless `VOID`, which creates one refund entitlement per participant. An
emergency pause blocks new exposure while leaving disputes, timeouts, claims,
and refunds available.

## Exact token accounting

An ERC-20 return value is not sufficient evidence of a correct transfer.
Fee-on-transfer, rebasing, malformed, callback-capable, or deliberately
deceptive tokens can all break accounting. Exact sender, recipient, and escrow
balance deltas are checked around every transfer; any mismatch is rejected. This
narrows the supported asset set by design and keeps accounting failures atomic.

## Events as a rebuildable read model

Deterministic identities and committed hashes let an indexer roll back, replay,
and reconcile after a reorganization. The read model improves discovery and
presentation; it never creates financial rights or replaces direct contract
state.

## From open-ended evidence to a closed condition language

The resolver's interpretation must not become an undocumented program that
different clients execute differently.
`challenge-escrow.condition-language/v1` is therefore fixed to a small
declarative tree with exact tagged values, bounded depth, bounded fan-out, and no
network or clock access.
Integer and decimal comparisons are rational, timestamps stay explicit, and
mixed types are a validation error. A future operator or coercion rule gets a
new language identifier and a new vector instead of silently changing old
terms.

## Public extraction

The public extraction removes interface code, social-network integration,
deployment operations, infrastructure addresses, private history, and user
data. It keeps the protocol kernel, tests, public semantics, threat model, and
conformance boundary so the work can be reviewed independently of the product
that motivated it.
