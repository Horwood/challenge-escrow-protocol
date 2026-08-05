use std::env;
use std::fs;
use std::process::ExitCode;

use portable_verifier::{PortableError, run_negative_corpus, verify_vector_text};

fn usage() -> &'static str {
    "usage: portable-verifier <verify|negative> <path>"
}

fn print_error(error: PortableError) -> ExitCode {
    let value = serde_json::json!({
        "status": "error",
        "code": error.code.as_str(),
        "path": error.path,
        "message": error.message,
    });
    eprintln!(
        "{}",
        serde_json::to_string(&value).expect("error JSON is serializable")
    );
    ExitCode::from(1)
}

fn main() -> ExitCode {
    let mut args = env::args().skip(1);
    let Some(command) = args.next() else {
        eprintln!("{}", usage());
        return ExitCode::from(2);
    };
    let Some(path) = args.next() else {
        eprintln!("{}", usage());
        return ExitCode::from(2);
    };
    if args.next().is_some() {
        eprintln!("{}", usage());
        return ExitCode::from(2);
    }

    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) => {
            return print_error(PortableError::io(path, error.to_string()));
        }
    };

    match command.as_str() {
        "verify" => match verify_vector_text(&raw) {
            Ok(report) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&report).expect("report is serializable")
                );
                ExitCode::SUCCESS
            }
            Err(error) => print_error(error),
        },
        "negative" => match run_negative_corpus(&raw) {
            Ok(report) => {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&report).expect("report is serializable")
                );
                ExitCode::SUCCESS
            }
            Err(error) => print_error(error),
        },
        _ => {
            eprintln!("{}", usage());
            ExitCode::from(2)
        }
    }
}
