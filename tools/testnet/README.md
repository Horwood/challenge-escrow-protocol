# Read-only testnet preflight

I keep the Sepolia and Base Sepolia check deliberately narrower than a deploy
script. It accepts an explicit network, RPC URL, escrow address, and deployment
block, then calls only `eth_chainId`, `eth_getCode`, `eth_call`, and
`eth_getLogs`. It never accepts a signer, a private key, a mnemonic, a value,
or a transaction method.

The preflight rejects plain HTTP except for an explicitly enabled local test,
rejects RPC credentials and query strings, bounds response bodies, verifies the
chain id, checks that both the escrow and canonical token have code, reconciles
the `ReleaseDeclared` event with the public getters, and requires the event's
`TESTNET_NO_VALUE` mode. It
does not publish the RPC URL in its report.

I run the memory-only safety suite with:

```sh
pnpm run testnet:check
```

I run a real read-only preflight only after supplying all four inputs explicitly
in the shell. The command has no deployment or transaction path:

```sh
TESTNET_NETWORK=sepolia \
TESTNET_RPC_URL=https://example.invalid/rpc \
TESTNET_ESCROW_ADDRESS=0x... \
TESTNET_DEPLOYMENT_BLOCK=0 \
pnpm run testnet:preflight
```

The successful report follows
`spec/schemas/testnet-preflight-v1.json`. A green report proves only that this
particular read-only endpoint exposed the expected release tuple at the time of
inspection; it is not a deployment approval, a liveness guarantee, or an audit.
