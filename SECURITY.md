# Security policy

## Research status

This is an unaudited research reference. It is not approved for production,
mainnet, custody, real-value deposits, or unattended operation. Do not deploy it
with assets of value.

The contract deliberately exposes no owner withdrawal, proxy upgrade, fee
extraction, arbitrary rescue of the escrow asset, backend custody, or automatic
oracle. Resolver, arbiter, and pauser addresses are immutable trust assumptions.
A malicious or unavailable authority can delay the intended flow; timeout and
pull-based exits limit that trust but do not remove it.

Machine-readable observer receipts, RPC quorum evidence, an authority policy,
and a reproducible release manifest make those assumptions easier to inspect.
They contain no live endpoint, credential, private key, funded address, or
deployment procedure. They are review artifacts, not evidence that a real
provider set, key ceremony, incident process, or live deployment exists.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** control on the repository's Security
page. It creates a private report. Do not open a public issue containing an
exploit, private key, credential, funded address, or personal data.

If private reporting is temporarily unavailable, open a minimal issue asking
for a private security contact. Wait for that channel to be confirmed before
disclosing details.

## Supported versions

No version has production support. This branch is maintained only as a research
artifact.

## Required gate before any real-value use

Any consideration of real-value use would first require an independent
smart-contract audit, complete invariant coverage for the published protocol
namespace, reproducible builds, reviewed deployment and key-management
procedures, live-chain failure testing, monitoring, incident response, and
applicable legal review.
