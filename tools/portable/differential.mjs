import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url);
const vector = "spec/vectors/portable-v1.json";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    throw new Error(`${command} did not return JSON: ${error.message}\n${result.stdout}`);
  }
}

const implementations = {
  javascript: run("node", ["tools/portable/verify.mjs"]),
  python: run("python3", ["tools/portable/verify_portable.py"]),
  rust: run("cargo", [
    "run",
    "--quiet",
    "--locked",
    "--manifest-path",
    "rust/portable-verifier/Cargo.toml",
    "--",
    "verify",
    vector,
  ]),
};

const fields = ["termsHash", "evidenceHash", "conditionResult", "termsBytes", "evidenceBytes"];
for (const field of fields) {
  const values = Object.fromEntries(Object.entries(implementations).map(([name, report]) => [name, report[field]]));
  const [first] = Object.values(values);
  if (Object.values(values).some((value) => value !== first)) {
    throw new Error(`${field} diverged: ${JSON.stringify(values)}`);
  }
}

console.log(JSON.stringify({
  status: "ok",
  vector,
  implementations: Object.keys(implementations),
  comparedFields: fields,
  termsHash: implementations.javascript.termsHash,
  evidenceHash: implementations.javascript.evidenceHash,
  conditionResult: implementations.javascript.conditionResult,
}, null, 2));
