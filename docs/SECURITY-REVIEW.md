# Security review

I completed this local research review on 2026-08-02. I am recording executed
evidence here, not presenting an independent security audit.

## Scope

I reviewed:

- Solidity contracts under `contracts/src`;
- adversarial-token and lifecycle tests under `contracts/test`;
- the dependency lock and package metadata;
- secret, credential, dangerous-operation, and product-data exposure;
- the claims made by the public documentation.

## Current release boundary

I publish no deployment script, private-key loader, environment template,
remote procedure call endpoint, production address, browser session, database,
user record, or social-platform integration. I declare `TESTNET_NO_VALUE` as my
only value mode.

## Findings

### Resolved: I let the pauser overlap with a participant

I originally excluded resolver and arbiter addresses from financial
participation but did not exclude the pauser. An interested pauser could block
acceptance or a resolver proposal and influence the route toward a refund. I now
reject the pauser as challenger or accepting wallet, and I added regression
tests for both paths.

### Resolved: I accepted a canonical token with no contract code

I found that the constructor accepted an address with no code, creating a
permanently unusable release. I now reject a canonical token whose address has
no code. I still require runtime exact-delta checks because this does not
certify token behavior.

### Resolved: I discarded signature recovery detail

I found that the acceptance path rejected invalid signatures but discarded the
structured ECDSA recovery error and its argument. I now preserve both in the
protocol error, improving diagnosis without weakening rejection behavior.

### Resolved: I had no independent oracle for renamed commitments

Product-neutral domains and namespaces changed every protocol hash. I
regenerated a fixed public vector and check it independently with Foundry's
`cast`, rather than checking only against the Solidity implementation under
test.

## Assurance gaps I still carry

- I have not received an independent third-party audit.
- My core branch coverage remains materially lower than line coverage,
  especially in the validation kernel; I still need more negative-path and
  differential tests.
- My deployed runtime is 23,270 bytes, leaving 1,306 bytes below the EIP-170
  limit with the pinned compiler and optimizer settings. I need to recheck this
  margin after every code change.
- I publish a conformance vector only for the commitment boundary. I still need
  independent implementations for terms, evidence, and condition schemas.
- I have not run live-chain, wallet, key-management, monitoring, or
  incident-response tests.
- I make no legal or regulatory clearance claim.

## Checks I ran

- I built the release with the pinned Solidity compiler and kept formatting
  checks clean.
- I passed forty-one tests with zero failures, including adversarial incoming
  and outgoing token behavior, reentry attempts, lifecycle boundaries, and
  role-overlap regressions.
- I ran thirteen invariant properties for 256 sequences and 32,768 calls per
  property. I covered solvency, conservation, terminal immutability, one-time
  claims, role exclusion, pause exits, permit replay, exact incoming deltas,
  and unexpected token balance changes.
- I measured core line coverage at 86.36% for `ChallengeEscrow.sol`, 83.42% for
  `ChallengeEscrowKernel.sol`, and 100% for `ExactTokenDelta.sol`.
- I found no confirmed exploitable finding after manually classifying Slither's
  output. I classify the remaining warnings as guarded token callbacks,
  deadline timestamps, deliberate low-level ERC-20 handling, assembly used for
  exact return decoding and event emission, validation complexity, and an enum
  comparison.
- I ran 64 Semgrep security and secret-detection rules across 26 files with
  zero findings. Gitleaks found zero secrets. My locked dependency audit found
  no known vulnerabilities at high severity or above.
- I found no original product name, endpoint, address, local path, seed phrase,
  mnemonic, or credential pattern in my public extraction.
- I reproduced every fixed identifier and hash in the public commitment vector.

## How I interpret the static-analysis warnings

I wrap external token calls with `nonReentrant`; any false return, malformed
return, callback manipulation, fee, or unexpected balance delta reverts the
whole transition. I use timestamp comparisons for explicit participant
deadlines, so bounded block-time influence remains an accepted chain property.
I use low-level calls deliberately because ERC-20 contracts differ in
return-value behavior, and my adversarial suite covers the supported and
rejected cases.
