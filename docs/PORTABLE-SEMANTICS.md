# Portable semantics

I keep terms and evidence outside the contract so another implementation can
reconstruct the same meaning without importing Solidity types. The contract
stores their hashes and enforces their lifecycle links; it does not fetch a
document, execute a condition, or decide whether a source is truthful.

## Versioned envelopes

I use three explicit identifiers:

| Identifier | Role |
| --- | --- |
| `challenge-escrow.terms/v1` | A bounded terms document with sources and an allowed resolution policy |
| `challenge-escrow.condition-language/v1` | A closed declarative expression tree |
| `challenge-escrow.evidence/v1` | A role-bound observation and artifact envelope |

The machine-readable forms live in `spec/schemas/`. Every document carries its
own identifier, and every reference to a condition language is versioned. A
change to an operator, enum meaning, field type, or hash preimage requires a
new identifier and a new conformance vector.

## Canonical bytes and domains

Before hashing, I serialize a document as deterministic UTF-8 JSON:

1. I reject duplicate object keys, non-finite values, unpaired Unicode
   surrogates, and numbers that are not explicitly represented by a schema
   value type.
2. I normalize strings to Unicode NFC, sort object keys by their Unicode code
   points, preserve array order, and emit no insignificant whitespace.
3. I represent integers, decimals, timestamps, reason codes, byte lengths, and
   hashes as tagged or explicitly bounded strings. This keeps JavaScript,
   Python, and Solidity clients from silently choosing different numeric
   precision.
4. I cap recursive condition depth at 32, expression fan-out at 32, and each
   envelope's observation and artifact counts at 64. A verifier must reject
   work that exceeds those limits before evaluating it.

The resulting hashes are domain-separated from one another:

```text
termsHash    = keccak256(UTF8("challenge-escrow.terms/v1")    || 0x00 || termsBytes)
evidenceHash = keccak256(UTF8("challenge-escrow.evidence/v1") || 0x00 || evidenceBytes)
```

The current Solidity release accepts `termsHash` and evidence hashes as
already-computed commitments. It does not yet recompute these JSON envelopes
on-chain, so clients must not confuse a valid hash with available or truthful
content.

## Condition language boundary

The language has only `all`, `any`, `not`, six comparisons, and `between`.
Values are either a bounded observation reference or a tagged literal. There
is no script, function call, network request, clock lookup, implicit type
coercion, or user-defined operator. A resolver or arbiter may interpret an
observation, but a verifier can reject a document before any external lookup.

For evaluation, `all` and `any` use boolean short-circuit semantics, `not`
negates one child, and `between` applies either inclusive or exclusive bounds.
Integer and decimal literals compare as exact rational numbers; timestamps
compare as bounded unsigned integers; text and hashes compare only with the
same type; booleans support equality and inequality. Any missing observation,
mixed incompatible type, reversed bound, or unsupported operator is a rejected
condition rather than a false result.

## Evidence lineage

Every evidence envelope binds `challengeId` and `specHash`. A dispute evidence
envelope also carries the immediately preceding proposal evidence hash; an
arbitration envelope carries the dispute evidence hash. The contract checks the
parent hash supplied to its transition, while the envelope makes the same link
portable to indexers and independent clients.

I store artifact hashes and media types, not credentials or an authority to
download a source. Retrieval, availability, and truth remain explicit external
assumptions. An indexer must reconcile evidence hashes with direct contract
state after a reorganization instead of granting rights from an event alone.

## Security posture

The schemas are intentionally closed-world: unknown fields, unknown operators,
unknown outcomes, invalid reason ranges, malformed hashes, excessive depth, and
unbounded arrays are rejected. The schema check is only a structural guard; the
next research stage adds independent canonicalization, validation, and vectors
in more than one language.
