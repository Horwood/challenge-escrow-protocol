<p align="center">
  <img src="docs/assets/cover.svg" alt="Challenge Escrow Protocol: two wallets, committed terms, a defined end state" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/Horwood/challenge-escrow-protocol/actions/workflows/verify.yml"><img src="https://github.com/Horwood/challenge-escrow-protocol/actions/workflows/verify.yml/badge.svg" alt="Verification" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-77E5C0?style=flat-square" alt="MIT license" /></a>
  <a href="SECURITY.md"><img src="https://img.shields.io/badge/security-research%20only-FFB38A?style=flat-square" alt="Research-only security status" /></a>
</p>

# Challenge Escrow Protocol

> I am testing what happens when a financial challenge has to end, even when
> the people deciding the result disappear.

I designed this as a small, direct reference implementation for a two-wallet
challenge. I deliberately keep it separate from a product, an oracle, a
custody layer, a deployment kit, and any claim that real-value use is safe. I
am publishing the protocol work underneath that kind of product so the
interesting parts can stand on their own.

**Research status.** I publish unaudited code for local and testnet use with
valueless assets only. I keep the conditions that must precede any deployment
in [my security policy](SECURITY.md).

## How I navigate the research

| My question | Where I start |
| --- | --- |
| I want to understand what I designed in ten minutes | [Protocol semantics](docs/PROTOCOL.md) |
| I want to see why I ended up with this shape | [Research evolution](docs/EVOLUTION.md) |
| I want to review my assumptions, failures, and remaining gaps | [Threat model](docs/THREAT-MODEL.md) and [security review](docs/SECURITY-REVIEW.md) |
| I want to reproduce my commitments outside Solidity | [Public vectors](spec/vectors/commitments-v1.json) and [their verifier](tools/verify-vectors.mjs) |
| I want to inspect the portable terms and evidence boundary | [Portable semantics](docs/PORTABLE-SEMANTICS.md), [error catalog](docs/PORTABLE-ERROR-CATALOG.md), and [conformance artifacts](spec/README.md) |
| I want to reproduce an observer run and RPC quorum | [Observer receipts](docs/OBSERVER-RECEIPTS.md) and [observer implementation notes](tools/client/OBSERVER.md) |
| I want to inspect operational authority assumptions | [Authority policy](docs/AUTHORITY-POLICY.md) |
| I want to identify the exact reviewed source and runtime | [Release attestation](docs/RELEASE-ATTESTATION.md) |
| I want to follow the current research depth cycle | [Depth cycle 3](docs/DEPTH-CYCLE-3.md) |
| I want to read or change my code | [Reading guide](docs/READING-GUIDE.md) and [contribution notes](CONTRIBUTING.md) |

## The whole idea

I designed the protocol around two named wallets that lock the same exact
amount of one ERC-20 asset against a committed execution and a committed terms
artifact. I let the contract handle accounting, authorization, deadlines, and
finality. I give a resolver the right to propose an outcome from evidence and
keep an arbiter for disputes. If either authority goes silent, I let the
protocol reach `VOID` and create refunds. Funds do not wait forever for
somebody to answer a message.

```mermaid
flowchart LR
    A["Challenger"] -->|"funds exact stake"| E["Challenge Escrow"]
    B["Acceptor"] -->|"EIP-712 permit + exact stake"| E
    E -->|"commits"| C["Execution + terms"]
    R["Resolver"] -->|"proposal + evidence hash"| E
    A & B -->|"dispute if needed"| E
    U["Arbiter"] -->|"final outcome"| E
    E -->|"claim or refund"| A & B
    E -->|"missed deadline"| V["VOID"]
```

## Money, authority, and failure have separate jobs

| Part | What I let it do | What I refuse to let it do |
| --- | --- | --- |
| Contract | hold one configured token, create entitlements, enforce deadlines | interpret evidence, change its release, withdraw as an owner |
| Participants | fund, accept, dispute, claim, refund | redirect another wallet's entitlement |
| Resolver | propose `A`, `B`, or `VOID` with an evidence hash | move escrowed funds or resolve after its deadline |
| Arbiter | decide a disputed result inside a fixed window | participate financially or extend the window |
| Pauser | stop new exposure during an incident | block disputes, timeouts, claims, or refunds |

I made one opinionated choice here: I treat authority failure as a protocol
event, not an operational inconvenience. I make the financial answer to a
missed proposal or arbitration deadline deterministic.

## What I am testing here

I care about the edge conditions as much as the happy path:

- I use exact token deltas to reject fees, rebases, malformed returns, and
  deceptive token behavior that would break accounting;
- I bind wallets, asset, stake, deadlines, release, and terms bytes through
  typed commitments without putting documents on-chain;
- I bind acceptance permits to a wallet, nonce, and expiry so an acceptance
  cannot drift into another challenge;
- I use pull claims so one recipient cannot block everybody else;
- I exercise timeout exits, pause behavior, and role separation as protocol
  properties rather than leaving them in prose;
- I retain supporters, dissenters, outages, and parent-hash forks in an
  N-provider RPC quorum instead of silently trusting one endpoint;
- I reject non-canonical event payloads, impossible outcome/reason pairs, and
  observer inputs that exceed explicit local resource limits;
- I make authority epochs, thresholds, custody separation, and forbidden
  powers machine-readable without publishing keys, and I require every role
  threshold to be a strict majority; and
- I bind the reviewed sources, schemas, vectors, ABI, and deployed runtime in a
  deterministic release manifest verified by two implementations.

I record the local evidence in [the security review](docs/SECURITY-REVIEW.md):
52 tests, 13 invariant properties, ten bounded Halmos properties, 24
observer-receipt rejection cases in two implementations, 19 authority-policy
rejection cases, 512 differential quorum cases, a 12-for-12 mutation baseline, an exact
43-function compiled authority surface, static analysis, dependency inspection,
and secret scans. I also record what I still have not proved.

## Run my reference locally

<details>
<summary>Requirements and commands</summary>

I require Node.js 22.15.1 or newer, pnpm 10, Foundry, and Deno 2.7.3. The full
portable semantics gate also uses the pinned Rust toolchain in
`rust-toolchain.toml`.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm audit:dependencies
```

For the portable boundary, I run:

```sh
rustup toolchain install 1.97.1 --profile minimal --component rustfmt,clippy
pnpm run check:depth2
```

That gate runs the Solidity baseline, schema checks, JavaScript/Python/Rust
conformance implementations, the twelve-case negative corpus, and the
locked dependency audit.

For the complete current research boundary, I run:

```sh
pnpm run check:depth3
```

That adds the contract-coupled symbolic properties, N-provider observer and
receipt checks, a 512-case differential quorum corpus, the independent Python
receipt verifier, authority-policy and incident corpora, a block-hash-pinned
read-only testnet boundary, deterministic supply-chain checks, and
two-implementation release-manifest verification.

For the heavier local security review, `pnpm run audit:baseline` also runs
Medusa, Gitleaks, Semgrep, and the exact Slither finding gate. It records every
tool version and fails if the reviewed analyzer versions drift. I document the
remaining non-hermetic package and remote-rule inputs in the
[audit package](docs/AUDIT-PACKAGE.md).

For a read-only Sepolia or Base Sepolia inspection, I use the safety boundary
in [`tools/testnet/README.md`](tools/testnet/README.md). The local test suite
proves that it rejects credentials, write RPC methods, unsafe URLs, wrong
chains, credential-bearing URL paths, non-`TESTNET_NO_VALUE` release events,
code drift, and inconsistent immutable substitutions before I give it any
endpoint or address.

`pnpm check` verifies formatting, recomputes my public commitment boundary,
builds with the pinned compiler, and runs the security profile. I include no
deployment script, and the contract reports `TESTNET_NO_VALUE` as its only
value mode. `pnpm run size:check` enforces the EIP-170 deployed-bytecode limit.

</details>

## What I put here

I keep the protocol kernel, adversarial tests, fixed vectors, and the documents
needed to inspect their meaning. I deliberately leave interface code,
social-platform integration, deployment operations, user data, infrastructure
addresses, environment files, and private project history outside this
repository.

That boundary is part of my research. I find a protocol hard to discuss when I
leave half its work off-screen inside a product.

## Citation and license

I ask anyone using this work to cite my [citation record](CITATION.cff). I
publish the code and written research under the [MIT License](LICENSE). I list
the third-party notice for [OpenZeppelin Contracts](NOTICE.md).

## Contributors

I am Ivan Kalkaev, and I keep the research direction, protocol design, and
final responsibility. I did the implementation, security testing, research
documentation, and repository design with Codex (OpenAI).
