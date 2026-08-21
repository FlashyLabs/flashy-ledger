import { createHash } from 'node:crypto'
import { LedgerError } from './errors.js'

/**
 * What may be used as an identity in a published, append-only record.
 *
 * The identity decision for this ledger is that it keys on an opaque,
 * tenant-scoped identifier and never resolves who a person is. Linking two
 * identifiers across tenants is a separate concern, owned by an identity layer,
 * consented to, and revocable. A link recorded inside an entry is not revocable
 * at all: the entry is immutable and every subsequent hash depends on it, so a
 * consent withdrawn later has nothing to act on.
 *
 * That decision is worth very little on its own. The failure that actually
 * happens is not architectural. It is a service somewhere passing
 * `user@example.com`, a phone number, or a wallet address as the identity,
 * because it was the value to hand. A natural key correlates across tenants
 * even with no shared namespace at all, which makes the careful scoping above
 * moot in practice, and does so silently, years before anyone notices.
 *
 * So the rule is enforced here, at the one place every entry passes through,
 * rather than written down and hoped for.
 *
 * ON BEING NARROW
 *
 * A guard that refuses legitimate identifiers is worse than no guard: it gets
 * disabled, and then nothing is checked at all. Every pattern below is one with
 * no plausible innocent reading. Deliberately NOT rejected:
 *
 *   - UUIDs, ULIDs, nanoid, and any other opaque token
 *   - MongoDB ObjectIds, 24 hex characters, which ClaimYour.Gold uses today
 *   - bare integers, the most common surrogate key in existence
 *   - base58 strings, which cannot be told from opaque tokens with any
 *     confidence, so attempting it would produce exactly the false positives
 *     that get guards switched off
 *
 * The list is therefore not exhaustive and does not pretend to be. It catches
 * the values a developer reaches for by accident, which is the whole population
 * of this failure.
 */

export class NaturalKeyError extends LedgerError {
  constructor(
    readonly kind: string,
    readonly hint: string,
  ) {
    super(
      'NATURAL_KEY_IDENTITY',
      `identityId looks like ${kind}, which must never enter a published append-only ` +
        `record: it identifies a person, it correlates across tenants without any shared ` +
        `namespace, and it cannot be removed once hashed into a chain. ${hint}`,
    )
    this.name = 'NaturalKeyError'
  }
}

interface Pattern {
  readonly kind: string
  readonly test: (value: string) => boolean
}

const HINT =
  'Use a surrogate: surrogateIdentity(value, tenantSalt) derives a stable, opaque ' +
  'identifier that differs per tenant.'

const PATTERNS: readonly Pattern[] = [
  {
    // Nothing legitimate carries an @ with a dotted domain after it.
    kind: 'an email address',
    test: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v),
  },
  {
    // E.164 only: a leading + and 8 to 15 digits. A bare run of digits is the
    // most common surrogate key there is and is not touched.
    kind: 'a phone number',
    test: (v) => /^\+\d{8,15}$/.test(v.replace(/[\s()-]/g, '')),
  },
  {
    // EVM account. A 24-hex ObjectId and a 32-hex digest are different lengths
    // and carry no 0x, so neither is caught here.
    kind: 'an EVM wallet address',
    test: (v) => /^0x[0-9a-fA-F]{40}$/.test(v),
  },
  {
    kind: 'a public key or raw digest',
    test: (v) => /^0x[0-9a-fA-F]{64}$/.test(v),
  },
  {
    // TON: a 48-character base64url form beginning with a known workchain tag.
    kind: 'a TON wallet address',
    test: (v) => /^[EUkO0]Q[A-Za-z0-9_-]{46}$/.test(v),
  },
]

/** The matched pattern's name, or null when the value is opaque. */
export function looksLikeNaturalKey(identityId: string): string | null {
  for (const pattern of PATTERNS) {
    if (pattern.test(identityId)) return pattern.kind
  }
  return null
}

/**
 * Refuse an identity that names a person, and refuse an empty one.
 *
 * Called from `post()`, so there is no path into an entry that skips it.
 */
export function assertOpaqueIdentity(identityId: string): void {
  if (identityId.trim() === '') {
    throw new LedgerError(
      'NATURAL_KEY_IDENTITY',
      'identityId is empty. An entry with no identity belongs to nobody and cannot be read back.',
    )
  }

  const kind = looksLikeNaturalKey(identityId)
  if (kind) throw new NaturalKeyError(kind, HINT)
}

/**
 * Derive an opaque identity from a natural one.
 *
 * The salt is per tenant, and that is the point rather than a detail. The same
 * person at two issuers yields two unrelated identifiers, so neither the two
 * issuers comparing notes nor a reader of the public record can correlate them.
 * That is the pairwise property, obtained without any coordination between
 * tenants.
 *
 * The salt is a secret. A guessable one turns this into a lookup table: anyone
 * holding it recovers every identity in the record from a list of candidates.
 */
export function surrogateIdentity(value: string, tenantSalt: string): string {
  if (tenantSalt.length < 16) {
    throw new LedgerError(
      'NATURAL_KEY_IDENTITY',
      'The tenant salt must be at least 16 characters. A short salt makes this a lookup ' +
        'table rather than a surrogate: anyone holding it can recover every identity in ' +
        'the record from a list of candidate values.',
    )
  }

  return createHash('sha256').update(`${tenantSalt} ${value}`).digest('hex')
}
