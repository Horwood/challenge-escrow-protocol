# Portable verifier

This crate is an independent implementation of the portable terms, condition,
and evidence boundary. It deliberately does not import Solidity
code and it does not contact a chain or fetch a source.

## Commands

From the repository root:

```text
cargo fmt --manifest-path rust/portable-verifier/Cargo.toml -- --check
cargo clippy --locked --manifest-path rust/portable-verifier/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path rust/portable-verifier/Cargo.toml
cargo run --locked --manifest-path rust/portable-verifier/Cargo.toml -- \
  verify spec/vectors/portable-v1.json
cargo run --locked --manifest-path rust/portable-verifier/Cargo.toml -- \
  negative spec/vectors/portable-negative-v1.json
```

The library exposes parsing with duplicate-key rejection, NFC canonicalization,
domain-separated Keccak-256 hashing, closed-world schema validation, exact
numeric comparison, and stable error codes. The CLI emits JSON so a CI job or
indexer can consume the result without scraping prose.

The pinned toolchain is in the repository root. `Cargo.lock` is committed so a
reviewer can reproduce the dependency graph used for this research revision.
