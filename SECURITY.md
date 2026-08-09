# Security policy

## Research status

I publish this as an unaudited research reference. I have not approved it for
production, mainnet, custody, real-value deposits, or unattended operation. I
do not want it deployed with assets of value.

I deliberately expose no owner withdrawal, proxy upgrade, fee extraction,
arbitrary rescue of the escrow asset, backend custody, or automatic oracle. I
treat resolver, arbiter, and pauser addresses as immutable trust assumptions. A
malicious or unavailable authority can delay the intended flow; my timeout and
pull-based exits limit that trust but do not remove it.

I publish machine-readable observer receipts, RPC quorum evidence, an authority
policy, and a reproducible release manifest to make those assumptions easier to
inspect. They contain no live endpoint, credential, private key, funded address,
or deployment procedure. They are review artifacts, not evidence that a real
provider set, key ceremony, incident process, or live deployment exists.

## Reporting a vulnerability

I receive vulnerability reports through GitHub's **Report a vulnerability**
control on this repository's Security page. It creates a private report for
me. I ask reporters not to open a public issue containing an exploit, private key,
credential, funded address, or personal data.

If private reporting is temporarily unavailable, I ask reporters to open a
minimal issue asking for a private security contact. I will need a private
channel confirmed before details are disclosed.

## Supported versions

I do not production-support any version. I maintain this branch only as a
research artifact.

## Required gate before any real-value use

Before I would consider real-value use, I would require an independent
smart-contract audit, complete invariant coverage for the published protocol
namespace, reproducible builds, reviewed deployment and key-management
procedures, live-chain failure testing, monitoring, incident response, and
applicable legal review.
