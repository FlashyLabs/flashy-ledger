import { prisma } from '../lib/prisma';
import { LedgerError } from '../lib/LedgerError';
import type { PartyKind } from '@prisma/client';

/**
 * Parties — who is allowed to hold value.
 *
 * This service is deliberately thin and deliberately ignorant. The ledger
 * knows a party has a kind and an external id; it does not know how identity
 * is established, what a FlashyID is, or how someone proves they are one.
 * That belongs to the identity service.
 *
 * Keeping the ledger ignorant of identity is what lets identity change —
 * and identity is currently a copy-pasted session and a shared secret, so it
 * is going to change.
 */

const UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

/**
 * Idempotent by (kind, externalId). Registering a party twice is a normal
 * consequence of a retry, not an error worth surfacing.
 */
export async function ensureParty(kind: PartyKind, externalId: string, displayName = '') {
  if (!externalId.trim()) {
    throw new LedgerError('INVALID_PARTY', 400, 'externalId is required');
  }

  const existing = await prisma.party.findUnique({ where: { kind_externalId: { kind, externalId } } });
  if (existing) return existing;

  try {
    return await prisma.party.create({ data: { kind, externalId, displayName } });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === UNIQUE_CONSTRAINT_ERROR_CODE) {
      return prisma.party.findUniqueOrThrow({ where: { kind_externalId: { kind, externalId } } });
    }
    throw err;
  }
}

/** A gold hunter. externalId is their FlashyID. */
export async function ensurePerson(flashyId: string, displayName = '') {
  return ensureParty('PERSON', flashyId, displayName);
}

/**
 * An organization — an AIO holding value in its own right.
 *
 * This is the call that makes agent spending auditable: an agent draws on
 * its org's account, never on the personal account of whoever founded it.
 */
export async function ensureOrg(orgId: string, displayName = '') {
  return ensureParty('ORG', orgId, displayName);
}

export async function getParty(kind: PartyKind, externalId: string) {
  return prisma.party.findUnique({ where: { kind_externalId: { kind, externalId } } });
}

/** Every asset a party holds, with balances. Zero-balance accounts included — "you have none" is an answer. */
export async function listHoldings(partyId: string) {
  return prisma.account.findMany({
    where: { partyId },
    include: { asset: true },
    orderBy: { createdAt: 'asc' },
  });
}
