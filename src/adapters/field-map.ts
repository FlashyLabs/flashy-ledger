import type { EntrySource } from '../domain/entry.js'

/**
 * Reading and writing a collection this package did not design.
 *
 * The default document shape is this package's own. But the ledger a network
 * already runs has its own column names, chosen before anyone had heard of this
 * library, and holds live money — so "adopt the ledger" cannot mean "copy every
 * row into a new collection and hope". A field map lets the adapter address the
 * existing collection in place: same rows, same indexes, same reads from the
 * application that has always owned them, with this package's rules on top.
 *
 * That is the difference between a migration and a swap. A migration against a
 * live money table is a project with a rollback plan. A swap is a config line.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 *
 * It maps *names*, and it maps *representations* (a string column versus a
 * numeric one). It does not convert scale, and it never will.
 *
 * ClaimYour.Gold's `gold_ledger.amount` is a float holding whole gold — 12.5
 * meaning twelve and a half gold — while this package holds a signed integer
 * count of minor units, 125000 at four decimals. A field map that multiplied by
 * 10^decimals on the way in would look like the last piece of the puzzle and
 * would be the bug this entire library exists to prevent: float arithmetic
 * deciding what someone is owed, applied silently, at the boundary where nobody
 * looks. 0.1 + 0.2 is not 0.3, and no amount of care at this layer fixes that.
 *
 * So a non-integer amount throws. Loudly, naming the migration that has to
 * happen first. The sequence is a property of the code rather than a line in a
 * document somebody may not read.
 */

/** Where each field of an Entry lives in the target collection. */
export interface FieldMap {
  readonly tenantId?: string
  readonly identityId?: string
  readonly assetId?: string
  readonly amount?: string
  readonly balanceBefore?: string
  readonly balanceAfter?: string
  readonly kind?: string
  readonly idempotencyKey?: string
  readonly occurredAt?: string
  readonly previousHash?: string
  readonly hash?: string
  readonly metadata?: string

  /**
   * How the source is stored: one embedded document (the default), or separate
   * scalar fields, which is how most schemas that predate this package do it.
   */
  readonly source?: string | SplitSource

  /**
   * The field the chain is read in order of. Defaults to `_id`, whose ObjectId
   * is monotonic enough for the purpose and always indexed.
   *
   * A collection that orders by a timestamp needs it named here, because
   * timestamps tie: two entries in the same millisecond have no order at all,
   * and a chain with no order is not a chain. `_id` is therefore always applied
   * as the tiebreak, never replaced.
   */
  readonly order?: string

  /**
   * How amounts are encoded. This package writes strings, because minor units
   * outgrow a double over a long-lived ledger and BSON has no unbounded
   * integer. A collection whose column is numeric needs 'number' so writes stay
   * the type its existing readers expect.
   */
  readonly amountEncoding?: 'string' | 'number'
}

export interface SplitSource {
  readonly type: string
  readonly id?: string
  readonly description?: string
}

export interface ResolvedFieldMap {
  readonly tenantId: string
  readonly identityId: string
  readonly assetId: string
  readonly amount: string
  readonly balanceBefore: string
  readonly balanceAfter: string
  readonly kind: string
  readonly idempotencyKey: string
  readonly occurredAt: string
  readonly previousHash: string
  readonly hash: string
  readonly metadata: string
  readonly source: string | SplitSource
  readonly order: string
  readonly amountEncoding: 'string' | 'number'
}

/** This package's own shape, and the default for every unmapped field. */
export const DEFAULT_FIELDS: ResolvedFieldMap = {
  tenantId: 'tenantId',
  identityId: 'identityId',
  assetId: 'assetId',
  amount: 'amount',
  balanceBefore: 'balanceBefore',
  balanceAfter: 'balanceAfter',
  kind: 'kind',
  idempotencyKey: 'idempotencyKey',
  occurredAt: 'occurredAt',
  previousHash: 'previousHash',
  hash: 'hash',
  metadata: 'metadata',
  source: 'source',
  order: '_id',
  amountEncoding: 'string',
}

/**
 * ClaimYour.Gold's `gold_ledger`, the first collection this package was asked
 * to adopt rather than create.
 *
 * Published here rather than left in the consumer so the mapping is reviewable
 * next to the code that honours it, and so the second network to arrive has a
 * worked example instead of a paragraph.
 */
export const GOLD_LEDGER_FIELDS: FieldMap = {
  identityId: 'customerId',
  kind: 'entryType',
  occurredAt: 'createdAt',
  source: { type: 'sourceType', id: 'sourceId', description: 'description' },
  order: 'createdAt',
  amountEncoding: 'number',
}

export function resolveFields(map: FieldMap = {}): ResolvedFieldMap {
  const resolved: ResolvedFieldMap = { ...DEFAULT_FIELDS, ...stripUndefined(map) }

  // Two fields sharing one key is not a mapping, it is data loss — the second
  // write overwrites the first and the entry that comes back is not the entry
  // that went in. Caught here, once, rather than as a corrupted row later.
  const names = [
    resolved.tenantId,
    resolved.identityId,
    resolved.assetId,
    resolved.amount,
    resolved.balanceBefore,
    resolved.balanceAfter,
    resolved.kind,
    resolved.idempotencyKey,
    resolved.occurredAt,
    resolved.previousHash,
    resolved.hash,
    resolved.metadata,
    ...(typeof resolved.source === 'string'
      ? [resolved.source]
      : [resolved.source.type, resolved.source.id, resolved.source.description].filter(
          (n): n is string => typeof n === 'string',
        )),
  ]

  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(
        `Field map assigns "${name}" to more than one field. Two fields sharing a key ` +
          'means the second write overwrites the first, so the entry read back is not ' +
          'the entry written.',
      )
    }
    seen.add(name)
  }

  return resolved
}

function stripUndefined(map: FieldMap): Partial<ResolvedFieldMap> {
  // An explicit `undefined` in the caller's object would otherwise beat the
  // default it spreads over, mapping a field to nothing.
  return Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined))
}

/**
 * A scalar, as text.
 *
 * Throws on anything structured rather than stringifying it. A source type that
 * arrives as an object becomes "[object Object]" under String(), which is a
 * value that looks like data, sorts, indexes, and means nothing.
 */
function asText(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  throw new Error(
    `Field "${field}" holds ${typeof value}, which has no meaningful text form. ` +
      'A source field must be a scalar.',
  )
}

/** Read the source back, whether it was stored embedded or split across fields. */
export function readSource(doc: Record<string, unknown>, fields: ResolvedFieldMap): EntrySource {
  if (typeof fields.source === 'string') {
    const embedded = doc[fields.source]
    if (embedded === null || embedded === undefined) return { type: '' }
    return embedded as EntrySource
  }

  const { type, id, description } = fields.source
  const sourceId = id ? asText(doc[id], id) : undefined
  const sourceDescription = description ? asText(doc[description], description) : undefined

  return {
    type: asText(doc[type], type) ?? '',
    ...(sourceId !== undefined ? { id: sourceId } : {}),
    ...(sourceDescription !== undefined ? { description: sourceDescription } : {}),
  }
}

/** Write the source, embedded or split. */
export function writeSource(
  source: EntrySource,
  fields: ResolvedFieldMap,
): Record<string, unknown> {
  if (typeof fields.source === 'string') {
    return { [fields.source]: source }
  }

  const { type, id, description } = fields.source
  return {
    [type]: source.type,
    ...(id ? { [id]: source.id ?? null } : {}),
    ...(description ? { [description]: source.description ?? null } : {}),
  }
}
