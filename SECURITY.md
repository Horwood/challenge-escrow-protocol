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

Until a private disclosure address is published, do not open an issue that
contains an exploit, private key, credential, funded address, or personal data.
Open a minimal issue requesting a private security contact and disclose details
only after a private channel is confirmed.

## Supported versions

No version is production-supported. The current branch is maintained only as a
research artifact.

## Required gate before any real-value use

At minimum: independent smart-contract audit, complete invariant coverage for
the published protocol namespace, reproducible builds, reviewed deployment and
key-management procedures, live-chain failure testing, monitoring, incident
response, and applicable legal review.
