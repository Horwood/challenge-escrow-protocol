# Contributing

This is a research reference, so a useful contribution clarifies a property,
shrinks an assumption, or makes the protocol easier to verify. Feature volume
is not a goal.

## Before opening an issue or pull request

- Read [SECURITY.md](SECURITY.md). Do not place an exploit, credential, funded
  address, or personal data in a public issue.
- Read [the reading guide](docs/READING-GUIDE.md) and the current security
  review, then state the exact invariant or semantic rule your work concerns.
- Keep product integrations, deployment machinery, environment configuration,
  and user-data handling outside this repository.

## A useful change has evidence

Changes to protocol semantics should include all applicable parts:

1. a short explanation of the semantic change or newly discovered edge case;
2. a lifecycle, adversarial, or invariant test that would have caught it;
3. an update to the public specification or threat model;
4. a regenerated fixed vector whenever a commitment boundary changes.

Run the full local check before opening a pull request:

```sh
pnpm check
pnpm audit:dependencies
```

## Scope

Good first contributions include a reproducible bug report, a counterexample to
an assumption, a clearer vector, a test that proves a missing property, or an
independent implementation of a documented boundary. A new feature needs a
reason to exist in the protocol rather than in a particular product.

No contribution implies that this repository is ready for real funds.
