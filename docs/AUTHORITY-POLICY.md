# Authority and key-policy boundary

The contract has three narrow operational roles: resolver, arbiter, and
pauser. I use `challenge-escrow.authority-policy/v1` to describe how those
roles would be operated without publishing keys, endpoints, wallet addresses,
or vendor-specific infrastructure.

This is a policy and incident model. It is not a key ceremony, a signer, a
multisig deployment, or evidence that any live operators follow it.

## Policy rules

I require every policy to carry:

- a stable policy ID and a domain-separated policy hash;
- a monotonic epoch, predecessor hash, announcement time, and bounded
  activation window;
- exactly the `arbiter`, `pauser`, and `resolver` roles in canonical order;
- two to seven endpoint-neutral SHA-256 member fingerprints per role;
- a threshold of at least two, no higher than role membership, and strictly
  greater than half of that membership;
- at least two custody classes inside every role;
- no duplicate member inside a role and no member shared across roles;
- a review delay and a maximum epoch duration; and
- an exact denial set for `delegatecall`, owner withdrawal, payout
  redirection, proxy upgrades, and token rescue.

The hash covers the complete policy body except the `policyHash` field itself.
The verifier rejects an epoch if its expected predecessor, activation time, or
recomputed hash does not match the accepted context. It also verifies that the
hashed announcement time precedes activation by at least the declared review
delay. A structurally valid old policy is therefore still a rejected replay,
and an instant rotation cannot claim that it passed the review window.

## Incident matrix

The public vector derives five decisions from the policy:

| Scenario | Decision | Contract-level fallback |
| --- | --- | --- |
| one resolver member is lost | continue only if the threshold still exists, then rotate | no authority expansion |
| one arbiter signer is suspected compromised | fail closed and replace the epoch | disputed challenges retain their timeout path |
| resolver quorum is lost | stop proposals | proposal timeout reaches `VOID` |
| the pauser quorum is lost | no new pause transition | disputes, claims, refunds, and timeouts remain available |
| an earlier policy is replayed | reject epoch and lineage | keep the accepted policy |

The policy never grants an operator a withdrawal, payout-redirection, upgrade,
or rescue path. Losing operational availability can delay an authority action,
but it cannot create a new financial power.

I also gate the compiled contract surface separately from this declaration:

```sh
pnpm run authority-surface:check
```

That gate permits exactly 43 public selectors and 14 nonpayable entry points,
rejects payable, fallback, and receive paths, and binds every selector to its
mutability in one fixed digest. A future owner, withdrawal, rescue, proxy,
upgrade, fee, rotation, or payout-redirection function cannot enter the
reviewed release without an explicit security-boundary change.

## Reproduce it

The schema and public corpora are:

- [`spec/schemas/authority-policy-v1.json`](../spec/schemas/authority-policy-v1.json)
- [`spec/vectors/authority-policy-v1.json`](../spec/vectors/authority-policy-v1.json)
- [`spec/vectors/authority-policy-negative-v1.json`](../spec/vectors/authority-policy-negative-v1.json)

```sh
pnpm run authority:check
```

The current reference policy has three roles, eight synthetic controller
fingerprints, and five derived incident decisions. The verifier accepts its
hash and rejects all 19 negative policies with their declared codes.

I regenerate the golden policy hash and incident matrix only when the format
or reference policy changes:

```sh
pnpm run authority:vector
```

The negative corpus covers duplicate and cross-role members, single-signer,
minority, and impossible thresholds, decimal overflow, non-canonical ordering,
an incomplete capability denial set, broken lineage, an insufficient review
delay, stale epochs, expiry, and policy-hash drift. Time fields must fit
`uint64`, and a policy epoch cannot outlive one year or its own declared
maximum.

## Remaining operational gap

This artifact creates reviewable conditions for a future ceremony and incident
exercise. It does not create real independent signers, distribute hardware,
measure response time, revoke a compromised credential, or test a live
multisig. Those steps need named operators and an isolated valueless testnet
exercise before they can become evidence.
