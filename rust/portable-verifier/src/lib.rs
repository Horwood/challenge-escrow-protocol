//! Independent implementation of the portable terms/evidence boundary.
//!
//! The Solidity contracts do not parse these documents. This crate is kept
//! deliberately outside `contracts/src` so its parser, canonicalizer, and
//! evaluator can disagree with the JavaScript and Python implementations.

use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

use serde::Serialize;
use serde::de::{DeserializeSeed, Error as DeError, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};
use tiny_keccak::{Hasher, Keccak};
use unicode_normalization::UnicodeNormalization;

pub const TERMS_SCHEMA: &str = "challenge-escrow.terms/v1";
pub const CONDITION_SCHEMA: &str = "challenge-escrow.condition-language/v1";
pub const EVIDENCE_SCHEMA: &str = "challenge-escrow.evidence/v1";
pub const MAX_JSON_BYTES: usize = 1_048_576;
pub const MAX_JSON_DEPTH: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    Io,
    InvalidJson,
    DuplicateKey,
    JsonNumberForbidden,
    JsonSizeExceeded,
    JsonDepthExceeded,
    NfcCollision,
    MissingField,
    UnknownField,
    InvalidSchema,
    InvalidValue,
    InvalidOperator,
    MissingObservation,
    IncompatibleTypes,
    ReversedBounds,
    ExpectedObject,
    ExpectedArray,
    ExpectedString,
    CorpusFailure,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Io => "io_error",
            Self::InvalidJson => "invalid_json",
            Self::DuplicateKey => "duplicate_key",
            Self::JsonNumberForbidden => "json_number_forbidden",
            Self::JsonSizeExceeded => "json_size_exceeded",
            Self::JsonDepthExceeded => "json_depth_exceeded",
            Self::NfcCollision => "nfc_collision",
            Self::MissingField => "missing_field",
            Self::UnknownField => "unknown_field",
            Self::InvalidSchema => "invalid_schema",
            Self::InvalidValue => "invalid_value",
            Self::InvalidOperator => "invalid_operator",
            Self::MissingObservation => "missing_observation",
            Self::IncompatibleTypes => "incompatible_types",
            Self::ReversedBounds => "reversed_bounds",
            Self::ExpectedObject => "expected_object",
            Self::ExpectedArray => "expected_array",
            Self::ExpectedString => "expected_string",
            Self::CorpusFailure => "corpus_failure",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortableError {
    pub code: ErrorCode,
    pub path: String,
    pub message: String,
}

impl PortableError {
    fn new(code: ErrorCode, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code,
            path: path.into(),
            message: message.into(),
        }
    }

    pub fn io(path: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Io, path, message)
    }
}

impl Display for PortableError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{} at {}: {}",
            self.code.as_str(),
            self.path,
            self.message
        )
    }
}

impl std::error::Error for PortableError {}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct VerifyReport {
    pub status: &'static str,
    pub implementation: &'static str,
    #[serde(rename = "termsHash")]
    pub terms_hash: String,
    #[serde(rename = "evidenceHash")]
    pub evidence_hash: String,
    #[serde(rename = "conditionResult")]
    pub condition_result: bool,
    #[serde(rename = "termsBytes")]
    pub terms_bytes: usize,
    #[serde(rename = "evidenceBytes")]
    pub evidence_bytes: usize,
    #[serde(rename = "negativeCases")]
    pub negative_cases: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct NegativeReport {
    pub status: &'static str,
    pub implementation: &'static str,
    pub cases: usize,
}

fn error(code: ErrorCode, path: impl Into<String>, message: impl Into<String>) -> PortableError {
    PortableError::new(code, path, message)
}

fn require(
    condition: bool,
    code: ErrorCode,
    path: impl Into<String>,
    message: impl Into<String>,
) -> Result<(), PortableError> {
    if condition {
        Ok(())
    } else {
        Err(error(code, path, message))
    }
}

struct ValueSeed {
    depth: usize,
}

struct JsonVisitor {
    depth: usize,
}

impl<'de> DeserializeSeed<'de> for ValueSeed {
    type Value = Value;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        deserializer.deserialize_any(JsonVisitor { depth: self.depth })
    }
}

impl<'de> Visitor<'de> for JsonVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a JSON value")
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        Ok(Value::Null)
    }

    fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        Ok(Value::Bool(value))
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        Ok(Value::String(value.to_owned()))
    }

    fn visit_borrowed_str<E>(self, value: &'de str) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        Ok(Value::String(value.to_owned()))
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        Ok(Value::String(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        Ok(Value::Number(value.into()))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        Ok(Value::Number(value.into()))
    }

    fn visit_i128<E>(self, value: i128) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        let _ = value;
        Err(E::custom("JSON number is forbidden"))
    }

    fn visit_u128<E>(self, value: u128) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        let _ = value;
        Err(E::custom("JSON number is forbidden"))
    }

    fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        serde_json::Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("non-finite JSON number"))
    }

    fn visit_none<E>(self) -> Result<Self::Value, E>
    where
        E: DeError,
    {
        Ok(Value::Null)
    }

    fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        ValueSeed { depth: self.depth }.deserialize(deserializer)
    }

    fn visit_seq<A>(self, mut access: A) -> Result<Self::Value, A::Error>
    where
        A: SeqAccess<'de>,
    {
        check_parse_depth::<A::Error>(self.depth)?;
        let mut values = Vec::new();
        while let Some(value) = access.next_element_seed(ValueSeed {
            depth: self.depth + 1,
        })? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }

    fn visit_map<A>(self, mut access: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        check_parse_depth::<A::Error>(self.depth)?;
        let mut object = Map::new();
        while let Some(key) = access.next_key::<String>()? {
            if object.contains_key(&key) {
                return Err(A::Error::custom(format!("duplicate object key: {key}")));
            }
            let value = access.next_value_seed(ValueSeed {
                depth: self.depth + 1,
            })?;
            object.insert(key, value);
        }
        Ok(Value::Object(object))
    }
}

fn check_parse_depth<E: DeError>(depth: usize) -> Result<(), E> {
    if depth <= MAX_JSON_DEPTH {
        Ok(())
    } else {
        Err(E::custom("JSON nesting exceeds the portable depth limit"))
    }
}

fn parse_error(message: String) -> PortableError {
    let code = if message.contains("duplicate object key") {
        ErrorCode::DuplicateKey
    } else if message.contains("JSON number is forbidden") {
        ErrorCode::JsonNumberForbidden
    } else if message.contains("nesting exceeds") {
        ErrorCode::JsonDepthExceeded
    } else {
        ErrorCode::InvalidJson
    };
    error(code, "$", message)
}

/// Parse JSON with duplicate-key rejection and a bounded recursive depth.
pub fn parse_json(text: &str) -> Result<Value, PortableError> {
    require(
        text.len() <= MAX_JSON_BYTES,
        ErrorCode::JsonSizeExceeded,
        "$",
        "JSON input exceeds 1 MiB",
    )?;
    let mut deserializer = serde_json::Deserializer::from_str(text);
    let value = ValueSeed { depth: 0 }
        .deserialize(&mut deserializer)
        .map_err(|parse| parse_error(parse.to_string()))?;
    deserializer
        .end()
        .map_err(|parse| parse_error(parse.to_string()))?;
    reject_numbers(&value, "$", 0)?;
    Ok(value)
}

fn reject_numbers(value: &Value, path: &str, depth: usize) -> Result<(), PortableError> {
    require(
        depth <= MAX_JSON_DEPTH,
        ErrorCode::JsonDepthExceeded,
        path,
        "JSON nesting exceeds the portable depth limit",
    )?;
    match value {
        Value::Number(_) => Err(error(
            ErrorCode::JsonNumberForbidden,
            path,
            "JSON numbers are forbidden; use tagged strings",
        )),
        Value::Array(values) => {
            for (index, child) in values.iter().enumerate() {
                reject_numbers(child, &format!("{path}/{index}"), depth + 1)?;
            }
            Ok(())
        }
        Value::Object(object) => {
            for (key, child) in object {
                reject_numbers(child, &format!("{path}/{}", escape_pointer(key)), depth + 1)?;
            }
            Ok(())
        }
        Value::Null | Value::Bool(_) | Value::String(_) => Ok(()),
    }
}

fn escape_pointer(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

fn normalized(value: &str, path: &str) -> Result<String, PortableError> {
    // Rust strings contain Unicode scalar values, so a lone UTF-16 surrogate
    // cannot reach this function from serde_json. NFC is still explicit here
    // because it is part of the wire contract rather than a parser accident.
    require(
        value.chars().count() <= MAX_JSON_BYTES,
        ErrorCode::InvalidValue,
        path,
        "string is too large",
    )?;
    Ok(value.nfc().collect())
}

fn quote(value: &str, path: &str) -> Result<String, PortableError> {
    let normalized = normalized(value, path)?;
    serde_json::to_string(&normalized)
        .map_err(|json_error| error(ErrorCode::InvalidValue, path, json_error.to_string()))
}

fn codepoint_cmp(left: &str, right: &str) -> Ordering {
    left.chars()
        .map(u32::from)
        .cmp(right.chars().map(u32::from))
}

/// Produce the deterministic UTF-8 JSON representation used by the domains.
pub fn canonicalize_value(value: &Value) -> Result<String, PortableError> {
    canonicalize_inner(value, "$", 0)
}

fn canonicalize_inner(value: &Value, path: &str, depth: usize) -> Result<String, PortableError> {
    require(
        depth <= MAX_JSON_DEPTH,
        ErrorCode::JsonDepthExceeded,
        path,
        "JSON nesting exceeds the portable depth limit",
    )?;
    match value {
        Value::Null => Ok("null".to_owned()),
        Value::Bool(true) => Ok("true".to_owned()),
        Value::Bool(false) => Ok("false".to_owned()),
        Value::Number(_) => Err(error(
            ErrorCode::JsonNumberForbidden,
            path,
            "JSON numbers are forbidden; use tagged strings",
        )),
        Value::String(text) => quote(text, path),
        Value::Array(values) => {
            let mut output = String::from("[");
            for (index, child) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                output.push_str(&canonicalize_inner(
                    child,
                    &format!("{path}/{index}"),
                    depth + 1,
                )?);
            }
            output.push(']');
            Ok(output)
        }
        Value::Object(object) => {
            let mut entries = Vec::with_capacity(object.len());
            for (key, child) in object {
                let normalized_key = normalized(key, &format!("{path}/<key>"))?;
                if entries
                    .iter()
                    .any(|(known, _): &(String, &Value)| known == &normalized_key)
                {
                    return Err(error(
                        ErrorCode::NfcCollision,
                        path,
                        format!("object keys collide after NFC normalization: {normalized_key}"),
                    ));
                }
                entries.push((normalized_key, child));
            }
            entries.sort_by(|(left, _), (right, _)| codepoint_cmp(left, right));
            let mut output = String::from("{");
            for (index, (key, child)) in entries.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                output.push_str(&quote(key, &format!("{path}/<key>"))?);
                output.push(':');
                output.push_str(&canonicalize_inner(
                    child,
                    &format!("{path}/{}", escape_pointer(key)),
                    depth + 1,
                )?);
            }
            output.push('}');
            Ok(output)
        }
    }
}

pub fn canonicalize_json(text: &str) -> Result<String, PortableError> {
    canonicalize_value(&parse_json(text)?)
}

pub fn domain_hash(domain: &str, value: &Value) -> Result<String, PortableError> {
    let canonical = canonicalize_value(value)?;
    let mut hasher = Keccak::v256();
    hasher.update(domain.as_bytes());
    hasher.update(&[0]);
    hasher.update(canonical.as_bytes());
    let mut digest = [0_u8; 32];
    hasher.finalize(&mut digest);
    Ok(format!(
        "0x{}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

fn as_object<'a>(value: &'a Value, path: &str) -> Result<&'a Map<String, Value>, PortableError> {
    value
        .as_object()
        .ok_or_else(|| error(ErrorCode::ExpectedObject, path, "expected an object"))
}

fn as_array<'a>(value: &'a Value, path: &str) -> Result<&'a [Value], PortableError> {
    value
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(|| error(ErrorCode::ExpectedArray, path, "expected an array"))
}

fn as_string<'a>(value: &'a Value, path: &str) -> Result<&'a str, PortableError> {
    value
        .as_str()
        .ok_or_else(|| error(ErrorCode::ExpectedString, path, "expected a string"))
}

fn assert_keys<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
    path: &str,
) -> Result<&'a Map<String, Value>, PortableError> {
    let object = as_object(value, path)?;
    for key in required {
        require(
            object.contains_key(*key),
            ErrorCode::MissingField,
            format!("{path}/{key}"),
            "required field is missing",
        )?;
    }
    for key in object.keys() {
        require(
            required.contains(&key.as_str()) || optional.contains(&key.as_str()),
            ErrorCode::UnknownField,
            format!("{path}/{}", escape_pointer(key)),
            "unknown field",
        )?;
    }
    Ok(object)
}

fn get<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<&'a Value, PortableError> {
    object.get(key).ok_or_else(|| {
        error(
            ErrorCode::MissingField,
            format!("{path}/{key}"),
            "required field is missing",
        )
    })
}

fn value_string<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<&'a str, PortableError> {
    as_string(get(object, key, path)?, &format!("{path}/{key}"))
}

fn char_len(value: &str) -> usize {
    value.chars().count()
}

fn is_ascii_hex(value: &str) -> bool {
    value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn is_hash(value: &str) -> bool {
    value.len() == 66 && value.starts_with("0x") && is_ascii_hex(&value[2..])
}

fn is_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._~-".contains(&byte))
}

fn is_ref(value: &str) -> bool {
    value
        .strip_prefix("/observations/")
        .and_then(|rest| rest.strip_suffix("/value"))
        .is_some_and(is_id)
}

fn is_timestamp(value: &str) -> bool {
    !value.is_empty() && value.len() <= 20 && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_integer(value: &str) -> bool {
    if value.len() > 78 || value.is_empty() {
        return false;
    }
    let digits = value.strip_prefix('-').unwrap_or(value);
    is_unsigned_integer(digits)
}

fn is_unsigned_integer(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
}

fn is_decimal(value: &str) -> bool {
    if value.len() > 128 || value.is_empty() {
        return false;
    }
    let unsigned = value.strip_prefix('-').unwrap_or(value);
    let Some((whole, fraction)) = unsigned.split_once('.') else {
        return false;
    };
    is_unsigned_integer(whole)
        && !fraction.is_empty()
        && fraction.bytes().all(|byte| byte.is_ascii_digit())
}

fn is_media_type(value: &str) -> bool {
    if value.is_empty() || value.len() > 127 {
        return false;
    }
    let Some((left, right)) = value.split_once('/') else {
        return false;
    };
    !left.is_empty()
        && !right.is_empty()
        && value.matches('/').count() == 1
        && value
            .bytes()
            .all(|byte| b"abcdefghijklmnopqrstuvwxyz0123456789!#$&^_.+-/".contains(&byte))
}

fn is_path(value: &str) -> bool {
    let mut pieces = value.split('/');
    pieces.next() == Some("")
        && pieces
            .next()
            .is_some_and(|first| is_id(first) && pieces.all(is_id))
}

fn is_locale(value: &str) -> bool {
    let mut pieces = value.split('-');
    let Some(primary) = pieces.next() else {
        return false;
    };
    (2..=3).contains(&primary.len())
        && primary.bytes().all(|byte| byte.is_ascii_alphabetic())
        && pieces.all(|piece| {
            (2..=8).contains(&piece.len()) && piece.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
}

fn is_terms_version(value: &str) -> bool {
    is_id(value) && value.len() <= 32
}

fn validate_value(value: &Value, path: &str) -> Result<(), PortableError> {
    let object = as_object(value, path)?;
    if let Some(reference) = object.get("ref") {
        assert_keys(value, &["ref"], &[], path)?;
        let reference = as_string(reference, &format!("{path}/ref"))?;
        return require(
            is_ref(reference),
            ErrorCode::InvalidValue,
            format!("{path}/ref"),
            "reference is outside the observation namespace",
        );
    }
    let object = assert_keys(value, &["kind", "value"], &[], path)?;
    let kind = value_string(object, "kind", path)?;
    let item = get(object, "value", path)?;
    match kind {
        "integer" => require(
            as_string(item, &format!("{path}/value")).is_ok_and(is_integer),
            ErrorCode::InvalidValue,
            format!("{path}/value"),
            "integer is not canonical or bounded",
        ),
        "decimal" => require(
            as_string(item, &format!("{path}/value")).is_ok_and(is_decimal),
            ErrorCode::InvalidValue,
            format!("{path}/value"),
            "decimal is not canonical or bounded",
        ),
        "text" => require(
            as_string(item, &format!("{path}/value")).is_ok_and(|text| char_len(text) <= 4096),
            ErrorCode::InvalidValue,
            format!("{path}/value"),
            "text is not bounded",
        ),
        "boolean" => require(
            item.is_boolean(),
            ErrorCode::InvalidValue,
            format!("{path}/value"),
            "value is not boolean",
        ),
        "timestamp" => require(
            as_string(item, &format!("{path}/value")).is_ok_and(is_timestamp),
            ErrorCode::InvalidValue,
            format!("{path}/value"),
            "timestamp is not canonical or bounded",
        ),
        "hash" => require(
            as_string(item, &format!("{path}/value")).is_ok_and(is_hash),
            ErrorCode::InvalidValue,
            format!("{path}/value"),
            "hash is invalid",
        ),
        _ => Err(error(
            ErrorCode::InvalidValue,
            format!("{path}/kind"),
            "unknown value kind",
        )),
    }
}

pub fn validate_condition(condition: &Value) -> Result<(), PortableError> {
    validate_condition_at(condition, "condition")
}

fn validate_condition_at(condition: &Value, path: &str) -> Result<(), PortableError> {
    let object = assert_keys(condition, &["schema", "root"], &[], path)?;
    require(
        value_string(object, "schema", path)? == CONDITION_SCHEMA,
        ErrorCode::InvalidSchema,
        format!("{path}/schema"),
        "condition schema drifted",
    )?;
    validate_node(get(object, "root", path)?, &format!("{path}/root"), 0)
}

fn validate_node(node: &Value, path: &str, depth: usize) -> Result<(), PortableError> {
    require(
        depth <= 32,
        ErrorCode::JsonDepthExceeded,
        path,
        "condition exceeds maximum depth",
    )?;
    let object = as_object(node, path)?;
    let operation = as_string(get(object, "op", path)?, &format!("{path}/op"))?;
    match operation {
        "all" | "any" => {
            let object = assert_keys(node, &["op", "args"], &[], path)?;
            let args = as_array(get(object, "args", path)?, &format!("{path}/args"))?;
            require(
                (1..=32).contains(&args.len()),
                ErrorCode::InvalidValue,
                format!("{path}/args"),
                "args length is outside the bound",
            )?;
            for (index, child) in args.iter().enumerate() {
                validate_node(child, &format!("{path}/args/{index}"), depth + 1)?;
            }
        }
        "not" => {
            let object = assert_keys(node, &["op", "arg"], &[], path)?;
            validate_node(get(object, "arg", path)?, &format!("{path}/arg"), depth + 1)?;
        }
        "eq" | "neq" | "lt" | "lte" | "gt" | "gte" => {
            let object = assert_keys(node, &["op", "left", "right"], &[], path)?;
            validate_value(get(object, "left", path)?, &format!("{path}/left"))?;
            validate_value(get(object, "right", path)?, &format!("{path}/right"))?;
        }
        "between" => {
            let object = assert_keys(
                node,
                &["op", "value", "lower", "upper", "inclusive"],
                &[],
                path,
            )?;
            validate_value(get(object, "value", path)?, &format!("{path}/value"))?;
            validate_value(get(object, "lower", path)?, &format!("{path}/lower"))?;
            validate_value(get(object, "upper", path)?, &format!("{path}/upper"))?;
            require(
                get(object, "inclusive", path)?.is_boolean(),
                ErrorCode::InvalidValue,
                format!("{path}/inclusive"),
                "inclusive must be boolean",
            )?;
        }
        _ => {
            return Err(error(
                ErrorCode::InvalidOperator,
                format!("{path}/op"),
                "unknown condition operator",
            ));
        }
    }
    Ok(())
}

pub fn validate_terms(terms: &Value) -> Result<(), PortableError> {
    let object = assert_keys(
        terms,
        &["schema", "condition", "sources", "resolutionPolicy"],
        &["title", "statement", "metadata"],
        "terms",
    )?;
    require(
        value_string(object, "schema", "terms")? == TERMS_SCHEMA,
        ErrorCode::InvalidSchema,
        "terms/schema",
        "terms schema drifted",
    )?;
    validate_condition_at(get(object, "condition", "terms")?, "terms/condition")?;
    let sources = as_array(get(object, "sources", "terms")?, "terms/sources")?;
    require(
        (1..=16).contains(&sources.len()),
        ErrorCode::InvalidValue,
        "terms/sources",
        "sources length is outside the bound",
    )?;
    let mut source_ids = Vec::new();
    for (index, source) in sources.iter().enumerate() {
        let path = format!("terms/sources/{index}");
        let object = assert_keys(source, &["id", "kind", "locator"], &["trust"], &path)?;
        let id = value_string(object, "id", &path)?;
        require(
            is_id(id),
            ErrorCode::InvalidValue,
            format!("{path}/id"),
            "source id is invalid",
        )?;
        require(
            !source_ids.iter().any(|known| known == id),
            ErrorCode::InvalidValue,
            format!("{path}/id"),
            "source id is duplicated",
        )?;
        source_ids.push(id.to_owned());
        require(
            ["chain-log", "api", "document", "manual"]
                .contains(&value_string(object, "kind", &path)?),
            ErrorCode::InvalidValue,
            format!("{path}/kind"),
            "source kind is invalid",
        )?;
        require(
            (1..=2048).contains(&char_len(value_string(object, "locator", &path)?)),
            ErrorCode::InvalidValue,
            format!("{path}/locator"),
            "source locator is invalid",
        )?;
        if let Some(trust) = object.get("trust") {
            require(
                ["untrusted", "authenticated"]
                    .contains(&as_string(trust, &format!("{path}/trust"))?),
                ErrorCode::InvalidValue,
                format!("{path}/trust"),
                "source trust is invalid",
            )?;
        }
    }
    let policy = assert_keys(
        get(object, "resolutionPolicy", "terms")?,
        &["conditionLanguage", "allowedOutcomes", "voidReasons"],
        &[],
        "terms/resolutionPolicy",
    )?;
    require(
        value_string(policy, "conditionLanguage", "terms/resolutionPolicy")? == CONDITION_SCHEMA,
        ErrorCode::InvalidSchema,
        "terms/resolutionPolicy/conditionLanguage",
        "condition language drifted",
    )?;
    let outcomes = as_array(
        get(policy, "allowedOutcomes", "terms/resolutionPolicy")?,
        "terms/resolutionPolicy/allowedOutcomes",
    )?;
    require(
        (1..=3).contains(&outcomes.len()),
        ErrorCode::InvalidValue,
        "terms/resolutionPolicy/allowedOutcomes",
        "allowed outcomes length is outside the bound",
    )?;
    let mut outcome_ids = Vec::new();
    for (index, outcome) in outcomes.iter().enumerate() {
        let outcome = as_string(
            outcome,
            &format!("terms/resolutionPolicy/allowedOutcomes/{index}"),
        )?;
        require(
            ["A", "B", "VOID"].contains(&outcome),
            ErrorCode::InvalidValue,
            format!("terms/resolutionPolicy/allowedOutcomes/{index}"),
            "allowed outcome is invalid",
        )?;
        require(
            !outcome_ids.iter().any(|known| known == outcome),
            ErrorCode::InvalidValue,
            "terms/resolutionPolicy/allowedOutcomes",
            "allowed outcomes are duplicated",
        )?;
        outcome_ids.push(outcome.to_owned());
    }
    let void_reasons = as_array(
        get(policy, "voidReasons", "terms/resolutionPolicy")?,
        "terms/resolutionPolicy/voidReasons",
    )?;
    require(
        (1..=6).contains(&void_reasons.len()),
        ErrorCode::InvalidValue,
        "terms/resolutionPolicy/voidReasons",
        "void reasons length is outside the bound",
    )?;
    let allowed_reasons = [
        "SOURCE_UNAVAILABLE",
        "INSUFFICIENT_DATA",
        "INVALID_OBSERVATION",
        "AMBIGUOUS_SOURCE_RECORD",
        "EVIDENCE_UNAVAILABLE",
        "TERMS_UNRESOLVABLE",
    ];
    let mut reasons = Vec::new();
    for (index, reason) in void_reasons.iter().enumerate() {
        let reason = as_string(
            reason,
            &format!("terms/resolutionPolicy/voidReasons/{index}"),
        )?;
        require(
            allowed_reasons.contains(&reason),
            ErrorCode::InvalidValue,
            format!("terms/resolutionPolicy/voidReasons/{index}"),
            "void reason is invalid",
        )?;
        require(
            !reasons.iter().any(|known| known == reason),
            ErrorCode::InvalidValue,
            "terms/resolutionPolicy/voidReasons",
            "void reasons are duplicated",
        )?;
        reasons.push(reason.to_owned());
    }
    if let Some(title) = object.get("title") {
        require(
            (1..=256).contains(&char_len(as_string(title, "terms/title")?)),
            ErrorCode::InvalidValue,
            "terms/title",
            "title is invalid",
        )?;
    }
    if let Some(statement) = object.get("statement") {
        require(
            (1..=4096).contains(&char_len(as_string(statement, "terms/statement")?)),
            ErrorCode::InvalidValue,
            "terms/statement",
            "statement is invalid",
        )?;
    }
    if let Some(metadata) = object.get("metadata") {
        let metadata = assert_keys(metadata, &[], &["locale", "termsVersion"], "terms/metadata")?;
        if let Some(locale) = metadata.get("locale") {
            require(
                is_locale(as_string(locale, "terms/metadata/locale")?),
                ErrorCode::InvalidValue,
                "terms/metadata/locale",
                "locale is invalid",
            )?;
        }
        if let Some(version) = metadata.get("termsVersion") {
            require(
                is_terms_version(as_string(version, "terms/metadata/termsVersion")?),
                ErrorCode::InvalidValue,
                "terms/metadata/termsVersion",
                "terms version is invalid",
            )?;
        }
    }
    Ok(())
}

pub fn validate_evidence(evidence: &Value) -> Result<(), PortableError> {
    let object = assert_keys(
        evidence,
        &[
            "schema",
            "challengeId",
            "specHash",
            "role",
            "outcome",
            "reasonCode",
            "capturedAt",
            "conditionLanguage",
            "observations",
            "artifacts",
        ],
        &["parentEvidenceHash", "evaluations"],
        "evidence",
    )?;
    require(
        value_string(object, "schema", "evidence")? == EVIDENCE_SCHEMA,
        ErrorCode::InvalidSchema,
        "evidence/schema",
        "evidence schema drifted",
    )?;
    for field in ["challengeId", "specHash"] {
        require(
            is_hash(value_string(object, field, "evidence")?),
            ErrorCode::InvalidValue,
            format!("evidence/{field}"),
            "hash is invalid",
        )?;
    }
    if let Some(parent) = object.get("parentEvidenceHash") {
        require(
            is_hash(as_string(parent, "evidence/parentEvidenceHash")?),
            ErrorCode::InvalidValue,
            "evidence/parentEvidenceHash",
            "parent hash is invalid",
        )?;
    }
    require(
        ["resolver", "challenger", "acceptor", "arbiter", "timeout"]
            .contains(&value_string(object, "role", "evidence")?),
        ErrorCode::InvalidValue,
        "evidence/role",
        "role is invalid",
    )?;
    let outcome = value_string(object, "outcome", "evidence")?;
    require(
        ["A", "B", "VOID"].contains(&outcome),
        ErrorCode::InvalidValue,
        "evidence/outcome",
        "outcome is invalid",
    )?;
    let reason = value_string(object, "reasonCode", "evidence")?;
    let max_reason = if outcome == "VOID" { 5 } else { 3 };
    require(
        reason.len() == 1
            && reason.bytes().all(|byte| byte.is_ascii_digit())
            && reason
                .bytes()
                .next()
                .is_some_and(|byte| byte - b'0' <= max_reason),
        ErrorCode::InvalidValue,
        "evidence/reasonCode",
        "reason code is invalid",
    )?;
    require(
        is_timestamp(value_string(object, "capturedAt", "evidence")?),
        ErrorCode::InvalidValue,
        "evidence/capturedAt",
        "capturedAt is invalid",
    )?;
    require(
        value_string(object, "conditionLanguage", "evidence")? == CONDITION_SCHEMA,
        ErrorCode::InvalidSchema,
        "evidence/conditionLanguage",
        "condition language drifted",
    )?;
    let observations = as_array(
        get(object, "observations", "evidence")?,
        "evidence/observations",
    )?;
    require(
        (1..=64).contains(&observations.len()),
        ErrorCode::InvalidValue,
        "evidence/observations",
        "observations length is outside the bound",
    )?;
    let mut observation_ids = Vec::new();
    for (index, observation) in observations.iter().enumerate() {
        let path = format!("evidence/observations/{index}");
        let observation = assert_keys(
            observation,
            &["id", "sourceId", "observedAt", "value"],
            &[],
            &path,
        )?;
        let id = value_string(observation, "id", &path)?;
        require(
            is_id(id),
            ErrorCode::InvalidValue,
            format!("{path}/id"),
            "observation id is invalid",
        )?;
        require(
            !observation_ids.iter().any(|known| known == id),
            ErrorCode::InvalidValue,
            format!("{path}/id"),
            "observation id is duplicated",
        )?;
        observation_ids.push(id.to_owned());
        require(
            is_id(value_string(observation, "sourceId", &path)?),
            ErrorCode::InvalidValue,
            format!("{path}/sourceId"),
            "source id is invalid",
        )?;
        require(
            is_timestamp(value_string(observation, "observedAt", &path)?),
            ErrorCode::InvalidValue,
            format!("{path}/observedAt"),
            "observedAt is invalid",
        )?;
        validate_value(get(observation, "value", &path)?, &format!("{path}/value"))?;
    }
    if let Some(evaluations) = object.get("evaluations") {
        let evaluations = as_array(evaluations, "evidence/evaluations")?;
        require(
            evaluations.len() <= 64,
            ErrorCode::InvalidValue,
            "evidence/evaluations",
            "evaluations length is outside the bound",
        )?;
        for (index, evaluation) in evaluations.iter().enumerate() {
            let path = format!("evidence/evaluations/{index}");
            let evaluation = assert_keys(
                evaluation,
                &["path", "result", "observationIds"],
                &[],
                &path,
            )?;
            require(
                is_path(value_string(evaluation, "path", &path)?),
                ErrorCode::InvalidValue,
                format!("{path}/path"),
                "evaluation path is invalid",
            )?;
            require(
                get(evaluation, "result", &path)?.is_boolean(),
                ErrorCode::InvalidValue,
                format!("{path}/result"),
                "evaluation result is invalid",
            )?;
            let ids = as_array(
                get(evaluation, "observationIds", &path)?,
                &format!("{path}/observationIds"),
            )?;
            require(
                (1..=32).contains(&ids.len()),
                ErrorCode::InvalidValue,
                format!("{path}/observationIds"),
                "observationIds length is outside the bound",
            )?;
            let mut seen = Vec::new();
            for (id_index, id) in ids.iter().enumerate() {
                let id = as_string(id, &format!("{path}/observationIds/{id_index}"))?;
                require(
                    is_id(id) && observation_ids.iter().any(|known| known == id),
                    ErrorCode::InvalidValue,
                    format!("{path}/observationIds/{id_index}"),
                    "observationIds contains an unknown id",
                )?;
                require(
                    !seen.iter().any(|known| known == id),
                    ErrorCode::InvalidValue,
                    format!("{path}/observationIds"),
                    "observationIds are duplicated",
                )?;
                seen.push(id.to_owned());
            }
        }
    }
    let artifacts = as_array(get(object, "artifacts", "evidence")?, "evidence/artifacts")?;
    require(
        artifacts.len() <= 64,
        ErrorCode::InvalidValue,
        "evidence/artifacts",
        "artifacts length is outside the bound",
    )?;
    for (index, artifact) in artifacts.iter().enumerate() {
        let path = format!("evidence/artifacts/{index}");
        let artifact = assert_keys(artifact, &["hash", "mediaType"], &["sizeBytes"], &path)?;
        require(
            is_hash(value_string(artifact, "hash", &path)?),
            ErrorCode::InvalidValue,
            format!("{path}/hash"),
            "artifact hash is invalid",
        )?;
        require(
            is_media_type(value_string(artifact, "mediaType", &path)?),
            ErrorCode::InvalidValue,
            format!("{path}/mediaType"),
            "media type is invalid",
        )?;
        if let Some(size) = artifact.get("sizeBytes") {
            let size = as_string(size, &format!("{path}/sizeBytes"))?;
            require(
                size.len() <= 20
                    && (size == "0"
                        || (!size.starts_with('0')
                            && size.bytes().all(|byte| byte.is_ascii_digit()))),
                ErrorCode::InvalidValue,
                format!("{path}/sizeBytes"),
                "sizeBytes is invalid",
            )?;
        }
    }
    Ok(())
}

fn rational_parts(value: &str) -> (bool, String, String) {
    let negative = value.starts_with('-');
    let value = value.strip_prefix('-').unwrap_or(value);
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    let whole = whole.trim_start_matches('0');
    let whole = if whole.is_empty() { "0" } else { whole };
    let fraction = fraction.trim_end_matches('0');
    let zero = whole == "0" && fraction.is_empty();
    (negative && !zero, whole.to_owned(), fraction.to_owned())
}

fn compare_unsigned_decimal(left: &str, right: &str) -> Ordering {
    let left = left.trim_start_matches('0');
    let right = right.trim_start_matches('0');
    let left = if left.is_empty() { "0" } else { left };
    let right = if right.is_empty() { "0" } else { right };
    left.len().cmp(&right.len()).then_with(|| left.cmp(right))
}

fn compare_numeric(left: &str, right: &str) -> Ordering {
    let (left_negative, left_whole, left_fraction) = rational_parts(left);
    let (right_negative, right_whole, right_fraction) = rational_parts(right);
    match left_negative.cmp(&right_negative) {
        Ordering::Equal => {
            let absolute = compare_unsigned_decimal(&left_whole, &right_whole).then_with(|| {
                let length = left_fraction.len().max(right_fraction.len());
                let left = format!("{left_fraction:0<length$}");
                let right = format!("{right_fraction:0<length$}");
                left.cmp(&right)
            });
            if left_negative {
                absolute.reverse()
            } else {
                absolute
            }
        }
        Ordering::Less => Ordering::Greater,
        Ordering::Greater => Ordering::Less,
    }
}

fn compare_text(left: &str, right: &str) -> Ordering {
    codepoint_cmp(left, right)
}

fn compare_values(left: &Value, right: &Value) -> Result<Ordering, PortableError> {
    let left = as_object(left, "condition/value")?;
    let right = as_object(right, "condition/value")?;
    let left_kind = value_string(left, "kind", "condition/value")?;
    let right_kind = value_string(right, "kind", "condition/value")?;
    let left_numeric = ["integer", "decimal"].contains(&left_kind);
    let right_numeric = ["integer", "decimal"].contains(&right_kind);
    if left_numeric || right_numeric {
        require(
            left_numeric && right_numeric,
            ErrorCode::IncompatibleTypes,
            "condition/value",
            "numeric and non-numeric values are incompatible",
        )?;
        return Ok(compare_numeric(
            value_string(left, "value", "condition/value")?,
            value_string(right, "value", "condition/value")?,
        ));
    }
    require(
        left_kind == right_kind,
        ErrorCode::IncompatibleTypes,
        "condition/value",
        format!("incompatible value kinds: {left_kind} and {right_kind}"),
    )?;
    match left_kind {
        "boolean" => {
            let left = get(left, "value", "condition/value")?
                .as_bool()
                .ok_or_else(|| {
                    error(
                        ErrorCode::InvalidValue,
                        "condition/value",
                        "boolean value is invalid",
                    )
                })?;
            let right = get(right, "value", "condition/value")?
                .as_bool()
                .ok_or_else(|| {
                    error(
                        ErrorCode::InvalidValue,
                        "condition/value",
                        "boolean value is invalid",
                    )
                })?;
            Ok(left.cmp(&right))
        }
        "timestamp" => Ok(compare_unsigned_decimal(
            value_string(left, "value", "condition/value")?,
            value_string(right, "value", "condition/value")?,
        )),
        "text" | "hash" => {
            let left = value_string(left, "value", "condition/value")?;
            let right = value_string(right, "value", "condition/value")?;
            if left_kind == "hash" {
                Ok(left.to_ascii_lowercase().cmp(&right.to_ascii_lowercase()))
            } else {
                Ok(compare_text(left, right))
            }
        }
        _ => Err(error(
            ErrorCode::InvalidValue,
            "condition/value",
            "unknown value kind",
        )),
    }
}

fn resolve_value<'a>(
    value: &'a Value,
    observations: &'a BTreeMap<String, Value>,
) -> Result<&'a Value, PortableError> {
    let object = as_object(value, "condition/value")?;
    if let Some(reference) = object.get("ref") {
        let reference = as_string(reference, "condition/value/ref")?;
        let id = reference
            .strip_prefix("/observations/")
            .and_then(|rest| rest.strip_suffix("/value"))
            .ok_or_else(|| {
                error(
                    ErrorCode::InvalidValue,
                    "condition/value/ref",
                    "reference is invalid",
                )
            })?;
        observations.get(id).ok_or_else(|| {
            error(
                ErrorCode::MissingObservation,
                "condition/value/ref",
                format!("missing observation: {reference}"),
            )
        })
    } else {
        Ok(value)
    }
}

pub fn evaluate_condition(condition: &Value, observations: &Value) -> Result<bool, PortableError> {
    validate_condition(condition)?;
    let observations = as_array(observations, "evidence/observations")?;
    let mut values = BTreeMap::new();
    for (index, observation) in observations.iter().enumerate() {
        let path = format!("evidence/observations/{index}");
        let object = as_object(observation, &path)?;
        let id = value_string(object, "id", &path)?.to_owned();
        require(
            !values.contains_key(&id),
            ErrorCode::InvalidValue,
            format!("{path}/id"),
            "observation id is duplicated",
        )?;
        validate_value(get(object, "value", &path)?, &format!("{path}/value"))?;
        values.insert(id, get(object, "value", &path)?.clone());
    }
    evaluate_node(condition_root(condition)?, &values)
}

fn condition_root(condition: &Value) -> Result<&Value, PortableError> {
    as_object(condition, "condition")?
        .get("root")
        .ok_or_else(|| {
            error(
                ErrorCode::MissingField,
                "condition/root",
                "required field is missing",
            )
        })
}

fn evaluate_node(
    node: &Value,
    observations: &BTreeMap<String, Value>,
) -> Result<bool, PortableError> {
    let object = as_object(node, "condition/root")?;
    let operation = value_string(object, "op", "condition/root")?;
    match operation {
        "all" => {
            for child in as_array(
                get(object, "args", "condition/root")?,
                "condition/root/args",
            )? {
                if !evaluate_node(child, observations)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        "any" => {
            for child in as_array(
                get(object, "args", "condition/root")?,
                "condition/root/args",
            )? {
                if evaluate_node(child, observations)? {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        "not" => Ok(!evaluate_node(
            get(object, "arg", "condition/root")?,
            observations,
        )?),
        "between" => {
            let actual = resolve_value(get(object, "value", "condition/root")?, observations)?;
            let lower = resolve_value(get(object, "lower", "condition/root")?, observations)?;
            let upper = resolve_value(get(object, "upper", "condition/root")?, observations)?;
            require(
                compare_values(lower, upper)? != Ordering::Greater,
                ErrorCode::ReversedBounds,
                "condition/root",
                "between bounds are reversed",
            )?;
            let lower_cmp = compare_values(actual, lower)?;
            let upper_cmp = compare_values(actual, upper)?;
            let inclusive = get(object, "inclusive", "condition/root")?
                .as_bool()
                .ok_or_else(|| {
                    error(
                        ErrorCode::InvalidValue,
                        "condition/root/inclusive",
                        "inclusive must be boolean",
                    )
                })?;
            Ok(if inclusive {
                lower_cmp != Ordering::Less && upper_cmp != Ordering::Greater
            } else {
                lower_cmp == Ordering::Greater && upper_cmp == Ordering::Less
            })
        }
        "eq" | "neq" | "lt" | "lte" | "gt" | "gte" => {
            let comparison = compare_values(
                resolve_value(get(object, "left", "condition/root")?, observations)?,
                resolve_value(get(object, "right", "condition/root")?, observations)?,
            )?;
            Ok(match operation {
                "eq" => comparison == Ordering::Equal,
                "neq" => comparison != Ordering::Equal,
                "lt" => comparison == Ordering::Less,
                "lte" => comparison != Ordering::Greater,
                "gt" => comparison == Ordering::Greater,
                "gte" => comparison != Ordering::Less,
                _ => unreachable!(),
            })
        }
        _ => Err(error(
            ErrorCode::InvalidOperator,
            "condition/root/op",
            "unknown condition operator",
        )),
    }
}

fn object_field<'a>(
    object: &'a Map<String, Value>,
    key: &str,
    path: &str,
) -> Result<&'a Value, PortableError> {
    object.get(key).ok_or_else(|| {
        error(
            ErrorCode::MissingField,
            format!("{path}/{key}"),
            "required field is missing",
        )
    })
}

pub fn verify_vector_text(text: &str) -> Result<VerifyReport, PortableError> {
    let vector = parse_json(text)?;
    let vector_object = assert_keys(
        &vector,
        &["version", "terms", "evidence", "expected"],
        &[],
        "vector",
    )?;
    require(
        value_string(vector_object, "version", "vector")? == "portable-v1",
        ErrorCode::InvalidSchema,
        "vector/version",
        "portable vector version drifted",
    )?;
    let terms = object_field(vector_object, "terms", "vector")?;
    let evidence = object_field(vector_object, "evidence", "vector")?;
    let expected = as_object(
        object_field(vector_object, "expected", "vector")?,
        "vector/expected",
    )?;
    validate_terms(terms)?;
    validate_evidence(evidence)?;
    let terms_canonical = canonicalize_value(terms)?;
    let evidence_canonical = canonicalize_value(evidence)?;
    let terms_hash = domain_hash(TERMS_SCHEMA, terms)?;
    let evidence_hash = domain_hash(EVIDENCE_SCHEMA, evidence)?;
    require(
        value_string(expected, "termsCanonical", "vector/expected")? == terms_canonical,
        ErrorCode::InvalidValue,
        "vector/expected/termsCanonical",
        "terms canonical bytes drifted",
    )?;
    require(
        value_string(expected, "termsHash", "vector/expected")? == terms_hash,
        ErrorCode::InvalidValue,
        "vector/expected/termsHash",
        "terms hash drifted",
    )?;
    require(
        value_string(expected, "evidenceCanonical", "vector/expected")? == evidence_canonical,
        ErrorCode::InvalidValue,
        "vector/expected/evidenceCanonical",
        "evidence canonical bytes drifted",
    )?;
    require(
        value_string(expected, "evidenceHash", "vector/expected")? == evidence_hash,
        ErrorCode::InvalidValue,
        "vector/expected/evidenceHash",
        "evidence hash drifted",
    )?;
    let condition_result = evaluate_condition(
        as_object(terms, "vector/terms")?
            .get("condition")
            .ok_or_else(|| {
                error(
                    ErrorCode::MissingField,
                    "vector/terms/condition",
                    "required field is missing",
                )
            })?,
        as_object(evidence, "vector/evidence")?
            .get("observations")
            .ok_or_else(|| {
                error(
                    ErrorCode::MissingField,
                    "vector/evidence/observations",
                    "required field is missing",
                )
            })?,
    )?;
    let expected_result = expected
        .get("conditionResult")
        .and_then(Value::as_bool)
        .ok_or_else(|| {
            error(
                ErrorCode::InvalidValue,
                "vector/expected/conditionResult",
                "condition result is invalid",
            )
        })?;
    require(
        condition_result == expected_result,
        ErrorCode::InvalidValue,
        "vector/expected/conditionResult",
        "condition result drifted",
    )?;
    Ok(VerifyReport {
        status: "ok",
        implementation: "rust",
        terms_hash,
        evidence_hash,
        condition_result,
        terms_bytes: terms_canonical.len(),
        evidence_bytes: evidence_canonical.len(),
        negative_cases: 0,
    })
}

pub fn run_negative_corpus(text: &str) -> Result<NegativeReport, PortableError> {
    let corpus = parse_json(text)?;
    let object = assert_keys(&corpus, &["version", "cases"], &[], "corpus")?;
    require(
        value_string(object, "version", "corpus")? == "portable-negative-v1",
        ErrorCode::InvalidSchema,
        "corpus/version",
        "negative corpus version drifted",
    )?;
    let cases = as_array(get(object, "cases", "corpus")?, "corpus/cases")?;
    for (index, case) in cases.iter().enumerate() {
        let path = format!("corpus/cases/{index}");
        let case_object =
            assert_keys(case, &["id", "operation", "input", "errorCode"], &[], &path)?;
        let id = value_string(case_object, "id", &path)?;
        let operation = value_string(case_object, "operation", &path)?;
        let input = value_string(case_object, "input", &path)?;
        let expected = value_string(case_object, "errorCode", &path)?;
        let result = match operation {
            "canonical-json" => canonicalize_json(input).map(|_| ()),
            "condition" => parse_and_validate_condition(input),
            _ => Err(error(
                ErrorCode::CorpusFailure,
                format!("{path}/operation"),
                "unknown negative corpus operation",
            )),
        };
        let actual = result.err().ok_or_else(|| {
            error(
                ErrorCode::CorpusFailure,
                &path,
                format!("negative case accepted: {id}"),
            )
        })?;
        require(
            actual.code.as_str() == expected,
            ErrorCode::CorpusFailure,
            &path,
            format!(
                "negative case {id} returned {}, expected {expected}",
                actual.code.as_str()
            ),
        )?;
    }
    Ok(NegativeReport {
        status: "ok",
        implementation: "rust",
        cases: cases.len(),
    })
}

fn parse_and_validate_condition(input: &str) -> Result<(), PortableError> {
    let value = parse_json(input)?;
    validate_condition(&value)
}

#[cfg(test)]
mod tests {
    use super::*;

    const VECTOR: &str = include_str!("../../../spec/vectors/portable-v1.json");

    #[test]
    fn vector_matches_golden_bytes_and_hashes() {
        let report = verify_vector_text(VECTOR).expect("portable vector should verify");
        assert_eq!(
            report.terms_hash,
            "0xed1f9b94f827c1cbf195dc1ccb4f1812840818f9cc6fdbabfaf952ecc90a5746"
        );
        assert_eq!(
            report.evidence_hash,
            "0x9e11d784f36cc1675d7957a91016377a583df6425a1419f90cf0af31f6fe4d29"
        );
        assert!(report.condition_result);
    }

    #[test]
    fn duplicate_keys_and_numbers_are_rejected_before_canonicalization() {
        assert_eq!(
            canonicalize_json(r#"{"a":"one","a":"two"}"#)
                .unwrap_err()
                .code,
            ErrorCode::DuplicateKey
        );
        assert_eq!(
            canonicalize_json(r#"{"a":1}"#).unwrap_err().code,
            ErrorCode::JsonNumberForbidden
        );
        assert_eq!(
            canonicalize_json(r#"{"e\u0301":"one","é":"two"}"#)
                .unwrap_err()
                .code,
            ErrorCode::NfcCollision
        );
    }

    #[test]
    fn numeric_comparison_is_exact_and_cross_kind() {
        let condition = serde_json::json!({"schema": CONDITION_SCHEMA, "root": {"op": "eq", "left": {"kind": "decimal", "value": "1.50"}, "right": {"kind": "decimal", "value": "1.5"}}});
        assert!(
            evaluate_condition(&condition, &serde_json::json!([]))
                .expect("condition should evaluate")
        );
        let negative = serde_json::json!({"schema": CONDITION_SCHEMA, "root": {"op": "lt", "left": {"kind": "decimal", "value": "-0.01"}, "right": {"kind": "integer", "value": "0"}}});
        assert!(
            evaluate_condition(&negative, &serde_json::json!([]))
                .expect("condition should evaluate")
        );
    }

    #[test]
    fn schema_rejects_unknown_fields_and_reason_padding() {
        let vector: Value = parse_json(VECTOR).expect("vector JSON");
        let mut terms = vector["terms"].clone();
        terms
            .as_object_mut()
            .expect("terms object")
            .insert("rogue".into(), Value::Bool(true));
        assert_eq!(
            validate_terms(&terms).unwrap_err().code,
            ErrorCode::UnknownField
        );
        let mut evidence = vector["evidence"].clone();
        evidence
            .as_object_mut()
            .expect("evidence object")
            .insert("reasonCode".into(), Value::String("00".into()));
        assert_eq!(
            validate_evidence(&evidence).unwrap_err().code,
            ErrorCode::InvalidValue
        );
    }

    #[test]
    fn parser_bounds_and_unicode_rejections_are_explicit() {
        let deep = format!(
            "{}\"x\"{}",
            "[".repeat(MAX_JSON_DEPTH + 1),
            "]".repeat(MAX_JSON_DEPTH + 1)
        );
        assert_eq!(
            canonicalize_json(&deep).unwrap_err().code,
            ErrorCode::JsonDepthExceeded
        );
        let large = format!("\"{}\"", "x".repeat(MAX_JSON_BYTES));
        assert_eq!(
            canonicalize_json(&large).unwrap_err().code,
            ErrorCode::JsonSizeExceeded
        );
        assert_eq!(
            canonicalize_json(r#"{"text":"\ud800"}"#).unwrap_err().code,
            ErrorCode::InvalidJson
        );
        let long_decimal = "1".repeat(100);
        let condition = serde_json::json!({"schema": CONDITION_SCHEMA, "root": {"op": "eq", "left": {"kind": "decimal", "value": format!("{long_decimal}.1")}, "right": {"kind": "decimal", "value": format!("{long_decimal}.1")}}});
        validate_condition(&condition).expect("schema permits bounded 128-character decimals");
    }

    #[test]
    fn negative_corpus_is_replayable() {
        let corpus = include_str!("../../../spec/vectors/portable-negative-v1.json");
        let report = run_negative_corpus(corpus).expect("negative corpus should remain rejecting");
        assert!(report.cases >= 10);
    }
}
