# Contributing

This is a research reference. Useful contributions clarify a property, shrink
an assumption, or make the protocol easier to verify. Feature volume is not a
goal.

## Before opening an issue or pull request

Read [SECURITY.md](SECURITY.md) before reporting a problem. Keep exploits,
credentials, funded addresses, and personal data out of public issues. Then
read [the reading guide](docs/READING-GUIDE.md) and the current security review,
and name the exact invariant or semantic rule the contribution concerns.

Product integrations, deployment machinery, environment configuration, and
user-data handling remain outside this repository.

## A useful change has evidence

For a semantic change, include the applicable parts of this trail:

1. a short explanation of the semantic change or newly discovered edge case;
2. a lifecycle, adversarial, or invariant test that would have caught it;
3. an update to the public specification or threat model;
4. a regenerated fixed vector whenever a commitment boundary changes.

Run the full local check before opening a pull request:

```sh
pnpm check
pnpm run portable:rust
pnpm run portable:differential
pnpm run client:check
pnpm run testnet:check
pnpm audit:dependencies
```

## Scope

Good contributions include a reproducible bug report, a counterexample to an
assumption, a clearer vector, a test that proves a missing property, or an
independent implementation of a documented boundary. A new feature needs a
reason to exist in the protocol rather than in a particular product.

No contribution by itself is evidence that this repository is ready for real
funds.
