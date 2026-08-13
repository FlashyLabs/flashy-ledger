/**
 * @flashy/ledger — an append-only, multi-asset settlement ledger.
 *
 * The domain is pure and knows nothing about storage. Everything that touches a
 * database sits behind `LedgerStore`, which is the only thing that has to change
 * if the ledger ever moves onto a chain.
 *
 * ```ts
 * const store = new InMemoryLedgerStore()
 * const gold: Asset = { id: 'fg', slug: 'flashy-gold', symbol: 'FG',
 *                       decimals: 2, class: 'REWARD_CURRENCY', tenantId: 'flashy' }
 *
 * const state = await store.readState('identity_1', gold.id)
 * const entry = post(state, {
 *   tenantId: 'flashy', identityId: 'identity_1', asset: gold,
 *   amount: fromDecimal(25, gold.decimals), kind: 'EARN',
 *   source: { type: 'quest', id: 'q_9' },
 *   idempotencyKey: 'quest:q_9:identity_1', occurredAt: new Date(),
 * })
 * await store.append(entry)
 * ```
 */

export type { Asset, AssetClass } from './domain/asset.js'
export { assetRegistry } from './domain/asset.js'

export type { Minor } from './domain/money.js'
export {
  ZERO,
  add,
  fromDecimal,
  isNegative,
  isZero,
  minor,
  negate,
  toDecimal,
  PrecisionError,
} from './domain/money.js'

export type { ChainVerdict, Entry, EntryKind, EntrySource, HashableEntry } from './domain/entry.js'
export { hashEntry, verifyChain, verifyEntry } from './domain/entry.js'

export type {
  LedgerState,
  PostCommand,
  ProposedEntry,
  TransferCommand,
  TransferParty,
} from './domain/post.js'
export { post, postTransfer, reverse } from './domain/post.js'

export { balanceOf, balancesByAsset, stateFrom } from './domain/fold.js'

export { LedgerError } from './domain/errors.js'
export type { LedgerErrorCode } from './domain/errors.js'

export type { AppendResult, LedgerStore, TransactionalLedgerStore } from './ports/store.js'
export { isTransactional } from './ports/store.js'

export { InMemoryLedgerStore } from './adapters/memory.js'
export { MongoLedgerStore } from './adapters/mongo.js'
export type { MongoLedgerStoreOptions } from './adapters/mongo.js'
