# Contributing

I treat this as a research reference, so I value a contribution that clarifies
a property, shrinks an assumption, or makes the protocol easier to verify. I
do not use feature volume as a goal.

## Before opening an issue or pull request

I ask contributors to read [SECURITY.md](SECURITY.md) and keep exploits,
credentials, funded addresses, and personal data out of public issues. I also
ask them to read [the reading guide](docs/READING-GUIDE.md) and the current
security review, then name the exact invariant or semantic rule their work
concerns.

I keep product integrations, deployment machinery, environment configuration,
and user-data handling outside my repository.

## A useful change has evidence

For a semantic change, I expect the applicable parts of this trail:

1. a short explanation of the semantic change or newly discovered edge case;
2. a lifecycle, adversarial, or invariant test that would have caught it;
3. an update to the public specification or threat model;
4. a regenerated fixed vector whenever a commitment boundary changes.

I run the full local check before I open a pull request:

```sh
pnpm check
pnpm audit:dependencies
```

## Scope

I welcome a reproducible bug report, a counterexample to an assumption, a
clearer vector, a test that proves a missing property, or an independent
implementation of a documented boundary. I expect a new feature to have a
reason to exist in my protocol rather than in a particular product.

I do not treat any contribution as evidence that my repository is ready for
real funds.
