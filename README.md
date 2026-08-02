# Challenge Escrow Protocol

An experimental reference protocol for a named two-wallet challenge with equal
stakes, committed terms, evidence-linked resolution, disputes, timeout-based
voiding, and pull-based settlement.

This repository is a product-neutral extraction of protocol research. It is
useful as a specification and implementation study, not as production-ready
financial infrastructure.

> **Security status:** unaudited research code. Local and testnet use with
> valueless assets only. Do not deploy with real funds. Read
> [SECURITY.md](SECURITY.md) and [docs/SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md).

## What is included

- a direct, non-upgradeable Solidity escrow release;
- equal and exact ERC-20 funding checks;
- wallet-bound EIP-712 acceptance permits;
- immutable resolver, arbiter, and pauser roles;
- evidence-linked proposal, dispute, arbitration, and timeout paths;
- per-wallet pull claims and refunds;
- domain-separated commitments and identifiers;
- adversarial-token tests, lifecycle tests, and stateful invariant checks;
- a machine-verifiable public commitment vector;
- protocol, trust, and failure-model notes.

Product interface code, social-platform integration, deployment operators,
private project history, databases, environment files, and external-network
configuration are intentionally excluded.

## Core lifecycle

```text
OPEN -> ACTIVE -> PROPOSED -> RESOLVED_A | RESOLVED_B | VOID
  |        |           |
  |        |           +-> DISPUTED -> RESOLVED_A | RESOLVED_B | VOID
  |        +-> VOID after proposal timeout
  +-> CANCELLED | EXPIRED
```

Terminal states create claimable entitlements. They do not push funds to every
participant in a loop. Each entitled wallet claims or refunds independently.

## Local verification

Requirements: Node.js 22+, pnpm 10, and Foundry.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm audit:dependencies
```

No deployment script is included. The contract reports
`TESTNET_NO_VALUE` as its only value mode.

## Repository map

- `contracts/src` — reference implementation;
- `contracts/test` — lifecycle and adversarial-token checks;
- `docs/PROTOCOL.md` — public semantic contract;
- `docs/EVOLUTION.md` — research path and discarded designs;
- `docs/THREAT-MODEL.md` — trust boundaries and known residual risks;
- `docs/SECURITY-REVIEW.md` — checks actually run and unresolved assurance gaps;
- `spec` — boundary and regeneration requirements for future conformance artifacts.

## Design boundaries

The backend is never a financial source of truth and cannot move escrowed
funds. A database or indexer may be rebuilt from events, while balances and
eligibility require direct chain reads. Full terms and evidence remain
off-chain artifacts whose hashes are committed on-chain; availability and
semantic correctness are not proven by a hash alone.

## License

MIT. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
