# Read-only client kit

This TypeScript kit is deliberately transport-neutral. An integrator gives
it an object with one `readContract` method, and the kit only calls public view
functions: it never accepts a signer, creates a transaction, estimates gas, or
handles a private key.

`index.ts` decodes the full `Challenge` tuple, normalizes enum and address
values, reads the immutable release tuple, loads participant entitlements, and
returns a local conservation summary. It rejects JavaScript numbers for ABI
integers and negative `bigint` values for ABI `uint` fields, so a caller cannot
silently truncate or misclassify a stake, liability, or timestamp.
It also rejects non-canonical absent tuples, impossible evidence lineage,
participants that overlap release roles, an arbitrated result from another
address, a challenge liability larger than the release aggregate, or a decoded
entitlement set that does not conserve deposits. `inspectChallenge` requires an
explicit `uint64` `blockTag` and passes it to every call, so a compound read
cannot silently drift with `latest`. A numeric tag alone is not a hash
anchor; when reorganization resistance matters, run the inspection through
the observer reconciliation callback and require its final header recheck.
The supplied transport adapter remains a trust boundary: it must honor the
requested block tag. The client also caps release strings and the entitlement
set at the protocol's two-participant boundary so malformed adapter output
cannot turn one inspection into an unbounded local traversal.

`test.ts` uses a memory-only provider and asserts that the inspector makes
read-only calls, decodes the nested structs, and preserves the accounting
equation. Run the complete boundary with Deno 2.7.3 through:

```sh
pnpm run client:check
```

The client gate also checks the local Ethereum Keccak-256 implementation against
fixed public vectors and 128 deterministic `cast keccak` cases. Its only Deno
subprocess permission is restricted to the `cast` executable. The projector
uses that implementation to reject a payout event whose entitlement ID is not
derived from its challenge ID and wallet.

`observer.ts`, `events.ts`, `projector.ts`, and `rpc.ts` form a separate
read-only observation boundary. They anchor logs to block hashes, decode every
published protocol event, project a fail-closed lifecycle record, and compare
an explicit provider quorum without accepting a signer or a credential. The
projector rejects mixed contract addresses, duplicate block-global log
positions, non-canonical transaction/log ordering, same-height forks, a late
release declaration, nonzero initial acceptance
nonces, exact proposal/dispute schedule drift, and mismatched resolution or
payout fields, including deterministic entitlement IDs. It also rejects
release-boundary participant overlap, non-canonical absent nested state, and a
non-exempt early `VOID` proposal. Each provider snapshot rereads its latest
block and is discarded if the hash changes while finality tags are being
collected. The deep and 512-case differential tests keep all fixtures in memory.
