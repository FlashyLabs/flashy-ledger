# @flashylabs/ledger

A double-entry ledger and proof layer, published to npm. Consumed by
ClaimYour.Gold and others.

## Commands
```bash
npm run typecheck && npm test    # must pass
npm run check                    # the full gate
npm run build                    # dist/ — consumers resolve this
```

## Rules

**This is a published package with real consumers.** A change to an exported
signature is a breaking change for someone. Version deliberately.

**Hashing rules are frozen.** `leafHash`, `merkleRoot`, `inclusionProof` and the
canonicalisation around them determine whether previously issued proofs still
verify. Changing how any of them serialise invalidates history. If a change
seems to require it, that is a new version of the format, not an edit.

**Amounts are minor units, integers.** Never floats.

## Known state
There is unmerged work on `claude/live-hq-org-display-njs2qo` that implements a
*second, incompatible* Merkle surface (`leafHash(string): string` versus main's
`leafHash(SnapshotEntry): Buffer`). It is deliberately not merged: reconciling
the two is a design decision about which hashing is canonical, and picking wrong
makes issued proofs disagree.
