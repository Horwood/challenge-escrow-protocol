# Local scenario simulator

I use the simulator to replay a named protocol path without a wallet, RPC
endpoint, token, or transaction. Each JSON scenario is a sequence of model
actions with expected states or rejection codes. The runner emits a compact
state trace after every action, so a failed boundary or a changed entitlement
can be inspected without reconstructing a fuzz seed by hand.

```text
pnpm run simulator:test
node tools/simulator/run.mjs tools/simulator/scenarios/lineage-replay.json --trace
```

The simulator is a debugging aid, not a production-chain emulator. It shares
the independent JavaScript model with the property tests and intentionally
keeps all side effects in memory.
