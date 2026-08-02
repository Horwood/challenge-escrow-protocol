# Research evolution

This note records the protocol decisions that survived implementation and
adversarial testing. It is a design history, not a production-readiness claim.

## From a document hash to a composite commitment

An early design treated one hash of a terms document as the challenge identity.
That was insufficient once execution fields such as wallets, chain, release,
asset, stake, and deadlines were also passed separately to the contract. The
current design hashes those typed fields independently, hashes the canonical
terms bytes independently, then combines both under an ordered domain. This
makes disagreement at either boundary visible without putting full documents
on-chain.

## From market-specific rules to a closed condition language

Rules tied to one price feed or event source made the financial kernel depend on
a particular product. The surviving boundary keeps the contract category
neutral: terms and evidence are committed artifacts, while resolver and arbiter
roles interpret a deliberately limited off-chain condition language. New
condition kinds require explicit versioning instead of silently extending the
meaning of old commitments.

## Evidence lineage and correction windows

A result proposal commits to evidence, and a dispute must reference that
proposal evidence while adding its own challenge evidence. Arbitration begins
only after the source-correction cutoff. These links do not prove truth or
availability, but they prevent later parties from silently changing which
artifacts a decision refers to.

## Failure becomes a financial outcome

Authority silence, missing evidence, or unresolved disagreement must not trap
funds indefinitely. Proposal and arbitration deadlines therefore end in a
permissionless `VOID`, which creates one refund entitlement per participant.
Emergency pause blocks new exposure while leaving disputes, timeouts, claims,
and refunds available.

## Exact token accounting

Checking only an ERC-20 return value is insufficient for fee-on-transfer,
rebasing, malformed, callback-capable, or deliberately deceptive tokens. The
implementation checks exact sender, recipient, and escrow balance deltas around
every transfer and rejects any mismatch. This narrows supported assets by
design and keeps accounting failures atomic.

## Events as a rebuildable read model

Events carry deterministic identities and committed hashes so an indexer can
roll back, replay, and reconcile after a reorganization. The read model may
improve discovery and presentation, but it never grants a claim or substitutes
for direct contract state when money is at stake.

## Public extraction

The research release removes interface code, social-network integration,
deployment operations, infrastructure addresses, private history, and user
data. It keeps only the protocol kernel, tests, public semantics, threat model,
and conformance boundary so the work can be reviewed independently of the
product that motivated it.
