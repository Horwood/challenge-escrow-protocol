# Read-only client kit

I keep this TypeScript kit deliberately transport-neutral. An integrator gives
it an object with one `readContract` method, and the kit only calls public view
functions: it never accepts a signer, creates a transaction, estimates gas, or
handles a private key.

`index.ts` decodes the full `Challenge` tuple, normalizes enum and address
values, reads the immutable release tuple, loads participant entitlements, and
returns a local conservation summary. It rejects JavaScript numbers for ABI
integers so a caller cannot silently truncate a stake, liability, or timestamp.
When several reads form one inspection, I pass the same `blockTag` to every
call so a reorganization cannot mix two different snapshots.

`test.ts` uses a memory-only provider and asserts that the inspector makes
read-only calls, decodes the nested structs, and preserves the accounting
equation. I run it with `deno check tools/client/index.ts tools/client/test.ts`
and `deno run tools/client/test.ts` when I have Deno available.
