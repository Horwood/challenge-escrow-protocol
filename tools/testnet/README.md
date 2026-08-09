# Read-only testnet preflight

The Sepolia and Base Sepolia check is deliberately narrower than a deploy
script. It accepts an explicit network, RPC URL, escrow address, and exact
deployment block, then calls only `eth_chainId`, `eth_blockNumber`,
`eth_getBlockByNumber`, `eth_getCode`, `eth_call`, and `eth_getLogs`. It binds
code and getter reads to the snapshot block hash with the canonical-block
selector, anchors the release log to its block header, and reads the snapshot
header again at the end. It never accepts a signer, a private key, a mnemonic,
a value, or a transaction method.

The preflight rejects plain HTTP except for an explicitly enabled local test,
rejects RPC credentials, query strings, and non-root URL paths, bounds response
bodies, verifies the chain id, checks that both the escrow and canonical token
have code, reconciles the `ReleaseDeclared` event with the public getters, and
requires the event's
`TESTNET_NO_VALUE` mode. It rejects redirects, duplicate JSON keys,
non-canonical ABI tails, a release event outside the configured deployment
block, and a snapshot before that block. It does not publish the RPC URL in its
report.

The report records `snapshotBlock`, `snapshotBlockHash`, and
`snapshotParentHash`. If the numbered block changes while the inspection is in
progress, the run fails instead of combining data from both branches.

The preflight also compares the live runtime with the reviewed release after
normalizing only the compiler-declared immutable slots. It preserves the six
immutable groups, requires all repeated substitutions inside each group to
agree, and compares their 32-byte words with the public getters. A byte change
outside those slots, an inconsistent role substitution, or a getter that
presents another value fails the preflight.

Run the memory-only safety suite with:

```sh
pnpm run testnet:check
```

Run a real read-only preflight only after supplying all four inputs explicitly
in the shell. The command has no deployment or transaction path:

```sh
TESTNET_NETWORK=sepolia \
TESTNET_RPC_URL=https://example.invalid/ \
TESTNET_ESCROW_ADDRESS=0x... \
TESTNET_DEPLOYMENT_BLOCK=0 \
pnpm run testnet:preflight
```

The successful report follows
`spec/schemas/testnet-preflight-v1.json`. A green report proves only that this
particular read-only endpoint exposed the reviewed runtime template and release
tuple at the recorded `snapshotBlock`; it is not proof of endpoint independence,
compiler provenance, deployment approval, liveness, DNS resolution to a public
network, or an audit.

The root path is required because hosted RPC services often encode project
credentials in a URL path. This safety boundary therefore works only with a
credential-free root endpoint; it intentionally rejects keyed provider URLs.
