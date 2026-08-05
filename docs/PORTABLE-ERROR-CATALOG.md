# Portable verifier error catalog

I keep parser and evaluator failures machine-readable so an indexer can stop
before it turns malformed evidence into a resolution decision. The Rust
implementation is the reference catalog for this research stage; JavaScript
and Python retain human-readable messages while applying the same rejection
boundaries.

## Stable codes

| Code | Meaning | Safe caller action |
| --- | --- | --- |
| `io_error` | The input file could not be read. | Retry with an explicit local artifact. |
| `invalid_json` | The input is not one complete JSON value. | Reject the artifact and request a new export. |
| `duplicate_key` | An object repeats a key, including an escaped spelling of the same key. | Reject; never rely on the last-value-wins rule. |
| `json_number_forbidden` | A JSON number appeared outside a tagged schema value. | Re-encode the value as the bounded string form. |
| `json_size_exceeded` | The raw document is larger than the 1 MiB parser bound. | Reject before expensive work. |
| `json_depth_exceeded` | JSON or a condition tree exceeds its depth bound. | Reject; do not increase the limit for an untrusted document. |
| `nfc_collision` | Two object keys become equal after NFC normalization. | Reject; ask the producer to use one normalized key. |
| `missing_field` | A required envelope or node field is absent. | Reject as incomplete evidence. |
| `unknown_field` | A closed-world object contains an unsupported field. | Reject instead of silently ignoring extension data. |
| `invalid_schema` | A versioned schema identifier is wrong or drifted. | Route to a verifier that explicitly supports that version. |
| `invalid_value` | A field violates its type, enum, pattern, or size bound. | Reject and preserve the path for correction. |
| `invalid_operator` | A condition uses an operator outside the v1 language. | Reject; never execute an unknown operation. |
| `missing_observation` | A condition references an observation that is not present. | Mark the condition unresolved; do not coerce it to false. |
| `incompatible_types` | A comparison mixes incompatible typed values. | Mark the condition unresolved. |
| `reversed_bounds` | A `between` expression has a lower bound above its upper bound. | Reject the condition as malformed. |
| `expected_object` / `expected_array` / `expected_string` | A value has the wrong JSON shape. | Reject before schema interpretation. |
| `corpus_failure` | A negative conformance case was unexpectedly accepted or returned a different code. | Treat the implementation as failing its conformance gate. |

Every error carries a JSON-pointer-like `path` and a short `message`. The
CLI emits an object such as:

```json
{
  "status": "error",
  "code": "duplicate_key",
  "path": "$",
  "message": "duplicate object key: a"
}
```

These codes describe verifier input failures. They do not certify that an
external source is truthful, available, finalized, or safe to use for a
contract transition.

## Reproduction

```text
cargo run --locked --manifest-path rust/portable-verifier/Cargo.toml -- \
  negative spec/vectors/portable-negative-v1.json
```

The negative corpus currently contains twelve cases covering malformed JSON,
trailing data, duplicate keys, escaped duplicate keys, NFC collisions, JSON
numbers, unknown condition operators and fields, invalid tagged integers, a
missing root, and schema-version drift.
