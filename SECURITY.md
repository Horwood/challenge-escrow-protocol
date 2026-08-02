# Security policy

## Research status

This repository is an unaudited research reference. It has not been approved
for production, mainnet, custody, real-value deposits, or unattended operation.
Do not deploy it with assets of value.

The implementation deliberately exposes no owner withdrawal, proxy upgrade,
fee extraction, arbitrary rescue of the escrow asset, backend custody, or
automatic oracle. Resolver, arbiter, and pauser addresses are immutable trust
assumptions. A malicious or unavailable authority can delay the intended flow;
timeout and pull-based exits limit but do not remove that trust.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** control on this repository's Security
page. It creates a private report for the maintainers. Do not open a public
issue containing an exploit, private key, credential, funded address, or
personal data.

If private reporting is temporarily unavailable, open a minimal issue requesting
a private security contact and disclose details only after a private channel is
confirmed.

## Supported versions

No version is production-supported. The current branch is maintained only as a
research artifact.

## Required gate before any real-value use

At minimum: independent smart-contract audit, complete invariant coverage for
the published protocol namespace, reproducible builds, reviewed deployment and
key-management procedures, live-chain failure testing, monitoring, incident
response, and applicable legal review.
