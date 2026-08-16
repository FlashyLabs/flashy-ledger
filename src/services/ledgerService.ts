import { prisma } from '../lib/prisma';
import { LedgerError } from '../lib/LedgerError';
import { assertNonZero, sum, type MinorUnits } from '../lib/money';
import type { Prisma } from '@prisma/client';

/**
 * The only way value moves.
 *
 * Everything else in this repository is a read. If a future change needs a
 * new way to change a balance, it goes through `transfer` or it is wrong —
 * the failure mode this service exists to prevent is exactly the one the
 * current implementation has, where 177 call sites increment a balance
 * directly and a ledger sits alongside describing what was supposed to have
 * happened.
 */

const UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

export interface TransferLeg {
  /** Party holding the account — resolved or created for this asset. */
  partyId: string;
  /** Signed minor units: negative leaves, positive arrives. */
  amount: MinorUnits;
}

export interface TransferInput {
  assetId: string;
  legs: TransferLeg[];
  /** Required. See the schema comment on why this is not optional. */
  idempotencyKey: string;
  reason: string;
  eventId?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface TransferResult {
  transferId: string;
  /** True when this call created the transfer, false when it replayed an existing one. */
  created: boolean;
  balances: { partyId: string; balance: MinorUnits }[];
}

/**
 * Move value between parties, atomically and exactly once.
 *
 * The three guarantees, and where each is enforced:
 *
 *   BALANCED — the legs must sum to zero, checked before anything is
 *     written. Double-entry is only worth having if it is never excepted, so
 *     there is no "internal" path that skips this.
 *
 *   ATOMIC — entries and the balance projection are written in one database
 *     transaction. The projection is updated in the SAME transaction as the
 *     entries it summarizes; if that ever drifts apart, the balance becomes
 *     an independent assertion and the invariant checker starts finding
 *     discrepancies nobody can explain.
 *
 *   EXACTLY ONCE — the unique idempotency key does the work, not a
 *     pre-flight existence check. A check-then-insert has a window between
 *     the two, and a retry storm is precisely a burst of concurrent attempts
 *     with the same key. We let the database reject the duplicate and return
 *     the original.
 */
export async function transfer(input: TransferInput): Promise<TransferResult> {
  const { assetId, legs, idempotencyKey, reason, eventId, metadata } = input;

  if (legs.length < 2) {
    throw new LedgerError('INVALID_TRANSFER', 400, 'A transfer needs at least two legs');
  }
  if (!idempotencyKey.trim()) {
    throw new LedgerError('MISSING_IDEMPOTENCY_KEY', 400, 'idempotencyKey is required');
  }
  for (const leg of legs) {
    try {
      assertNonZero(leg.amount);
    } catch {
      throw new LedgerError('ZERO_LEG', 400, 'A transfer leg must not be zero');
    }
  }

  const total = sum(legs.map((l) => l.amount));
  if (total !== 0n) {
    throw new LedgerError(
      'UNBALANCED_TRANSFER',
      400,
      `Transfer legs must sum to zero; got ${total.toString()} minor units`,
    );
  }

  // Two legs against the same account would let a transfer net to zero
  // against itself and produce entries that balance while moving nothing.
  const partyIds = legs.map((l) => l.partyId);
  if (new Set(partyIds).size !== partyIds.length) {
    throw new LedgerError('DUPLICATE_LEG', 400, 'Each party may appear at most once in a transfer');
  }

  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) {
    throw new LedgerError('ASSET_NOT_FOUND', 404, 'Asset not found');
  }
  if (!asset.isActive) {
    throw new LedgerError('ASSET_INACTIVE', 400, `Asset ${asset.slug} is not active`);
  }

  const accounts = await Promise.all(legs.map((leg) => resolveAccount(leg.partyId, assetId)));

  try {
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.transfer.create({
        data: { idempotencyKey, reason, eventId, metadata },
      });

      const balances: { partyId: string; balance: MinorUnits }[] = [];

      for (const [index, leg] of legs.entries()) {
        const account = accounts[index]!;

        await tx.entry.create({
          data: { transferId: created.id, accountId: account.id, assetId, amount: leg.amount },
        });

        const updated = await tx.account.update({
          where: { id: account.id },
          data: { balance: { increment: leg.amount } },
        });

        // Checked after the increment rather than before, so the decision is
        // made against the value the database actually holds — a
        // read-then-check would be evaluating a number another concurrent
        // transfer may already have changed.
        if (!account.allowNegative && updated.balance < 0n) {
          throw new LedgerError(
            'INSUFFICIENT_BALANCE',
            409,
            `Party ${leg.partyId} has insufficient ${asset.symbol}`,
          );
        }

        balances.push({ partyId: leg.partyId, balance: updated.balance });
      }

      return { transferId: created.id, created: true, balances };
    });

    return result;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === UNIQUE_CONSTRAINT_ERROR_CODE) {
      // Someone already performed this exact transfer. Returning the
      // original — rather than erroring — is what makes a retry safe, which
      // is the entire point of an idempotency key.
      return replayTransfer(idempotencyKey);
    }
    throw err;
  }
}

async function replayTransfer(idempotencyKey: string): Promise<TransferResult> {
  const existing = await prisma.transfer.findUnique({
    where: { idempotencyKey },
    include: { entries: { include: { account: true } } },
  });
  if (!existing) {
    // The unique violation came from something other than the transfer key.
    throw new LedgerError('TRANSFER_CONFLICT', 409, 'Conflicting write while recording this transfer');
  }

  return {
    transferId: existing.id,
    created: false,
    balances: existing.entries.map((entry) => ({
      partyId: entry.account.partyId,
      balance: entry.account.balance,
    })),
  };
}

/**
 * Accounts are created on first use rather than provisioned up front.
 *
 * A party that has never held an asset and a party holding zero of it are
 * the same thing, and requiring explicit account creation would mean every
 * caller has to remember a step whose only failure mode is silent.
 */
async function resolveAccount(partyId: string, assetId: string) {
  const existing = await prisma.account.findUnique({ where: { partyId_assetId: { partyId, assetId } } });
  if (existing) return existing;

  const party = await prisma.party.findUnique({ where: { id: partyId } });
  if (!party) {
    throw new LedgerError('PARTY_NOT_FOUND', 404, `Party ${partyId} not found`);
  }

  try {
    return await prisma.account.create({
      data: {
        partyId,
        assetId,
        // Only the system party may go negative — its negative balance IS
        // the total ever issued, which is what makes minting expressible
        // without an exception to double-entry.
        allowNegative: party.kind === 'SYSTEM',
      },
    });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === UNIQUE_CONSTRAINT_ERROR_CODE) {
      return prisma.account.findUniqueOrThrow({ where: { partyId_assetId: { partyId, assetId } } });
    }
    throw err;
  }
}

/**
 * Issue new value into circulation.
 *
 * Not a special case in the schema: minting is an ordinary transfer whose
 * other leg lands on a SYSTEM party. That keeps the global invariant
 * (every entry sums to zero) true without carve-outs, and makes "how much
 * has ever been issued?" answerable as the system account's negative
 * balance rather than a number someone has to maintain.
 */
export async function mint(
  assetId: string,
  toPartyId: string,
  amount: MinorUnits,
  idempotencyKey: string,
  reason: string,
  eventId?: string,
): Promise<TransferResult> {
  if (amount <= 0n) {
    throw new LedgerError('INVALID_MINT', 400, 'Mint amount must be greater than zero');
  }
  const issuer = await getSystemParty();
  return transfer({
    assetId,
    legs: [
      { partyId: issuer.id, amount: -amount },
      { partyId: toPartyId, amount },
    ],
    idempotencyKey,
    reason,
    eventId,
  });
}

/** Take value out of circulation — redemption, expiry, clawback. */
export async function burn(
  assetId: string,
  fromPartyId: string,
  amount: MinorUnits,
  idempotencyKey: string,
  reason: string,
  eventId?: string,
): Promise<TransferResult> {
  if (amount <= 0n) {
    throw new LedgerError('INVALID_BURN', 400, 'Burn amount must be greater than zero');
  }
  const issuer = await getSystemParty();
  return transfer({
    assetId,
    legs: [
      { partyId: fromPartyId, amount: -amount },
      { partyId: issuer.id, amount },
    ],
    idempotencyKey,
    reason,
    eventId,
  });
}

export const SYSTEM_PARTY_EXTERNAL_ID = 'flashy:issuer';

export async function getSystemParty() {
  const party = await prisma.party.findUnique({
    where: { kind_externalId: { kind: 'SYSTEM', externalId: SYSTEM_PARTY_EXTERNAL_ID } },
  });
  if (!party) {
    throw new LedgerError('SYSTEM_PARTY_MISSING', 500, 'The issuer party has not been provisioned');
  }
  return party;
}

/**
 * A party's balance for one asset.
 *
 * Reads the projection, which is the point of maintaining one — but see
 * `recomputeBalance` for the escape hatch that makes trusting it safe.
 */
export async function getBalance(partyId: string, assetId: string): Promise<MinorUnits> {
  const account = await prisma.account.findUnique({ where: { partyId_assetId: { partyId, assetId } } });
  return account?.balance ?? 0n;
}

/**
 * The authoritative balance, summed from entries.
 *
 * Exists so the projection is never the only answer available. Every
 * balance in this system must be reconstructible from the entries alone —
 * that is the test of whether it is really a projection or has quietly
 * become an independent number.
 */
export async function recomputeBalance(partyId: string, assetId: string): Promise<MinorUnits> {
  const account = await prisma.account.findUnique({ where: { partyId_assetId: { partyId, assetId } } });
  if (!account) return 0n;

  const result = await prisma.entry.aggregate({
    where: { accountId: account.id },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0n;
}

export async function getTransferHistory(partyId: string, assetId: string, limit = 50) {
  const account = await prisma.account.findUnique({ where: { partyId_assetId: { partyId, assetId } } });
  if (!account) return [];

  return prisma.entry.findMany({
    where: { accountId: account.id },
    include: { transfer: true },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
}
