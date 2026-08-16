import { prisma } from '../lib/prisma';
import type { MinorUnits } from '../lib/money';

/**
 * The checks that make "is the ledger correct?" answerable.
 *
 * A ledger nobody verifies is a ledger nobody should trust, and the failure
 * mode is silent by nature: a discrepancy does not throw, it just sits there
 * getting larger. So these run on a schedule and in CI, and the board's gate
 * for putting real value on this book should be *these green for 30
 * consecutive days* — not "the migration merged."
 *
 * Everything here REPORTS. Nothing here corrects. A checker that quietly
 * fixes what it finds destroys the evidence of how the discrepancy arose,
 * and the discrepancy is never the real problem — the bug that produced it
 * is, and it is still there.
 */

export interface InvariantViolation {
  invariant: string;
  detail: string;
  assetId?: string;
  accountId?: string;
  expected?: string;
  actual?: string;
}

export interface InvariantReport {
  checkedAt: Date;
  ok: boolean;
  violations: InvariantViolation[];
  stats: {
    assets: number;
    accounts: number;
    transfers: number;
    entries: number;
  };
}

/**
 * Invariant 1 — every asset's entries sum to exactly zero.
 *
 * This is the one that makes double-entry worth the extra row. Any
 * single-sided write anywhere in the system's history shows up here as a
 * non-zero total, no matter how long ago it happened or how well it was
 * hidden by a compensating balance update.
 */
async function checkGlobalZeroSum(): Promise<InvariantViolation[]> {
  const totals = await prisma.entry.groupBy({ by: ['assetId'], _sum: { amount: true } });

  return totals
    .filter((row) => (row._sum.amount ?? 0n) !== 0n)
    .map((row) => ({
      invariant: 'global_zero_sum',
      assetId: row.assetId,
      expected: '0',
      actual: (row._sum.amount ?? 0n).toString(),
      detail: `Entries for asset ${row.assetId} sum to ${(row._sum.amount ?? 0n).toString()} instead of zero — a single-sided write exists somewhere in this asset's history`,
    }));
}

/**
 * Invariant 2 — every account's cached balance equals the sum of its entries.
 *
 * Catches the projection drifting from the entries it summarizes, which is
 * what happens the first time someone writes a balance outside `transfer`.
 * Given the current implementation has 177 such call sites, this is the
 * check most likely to earn its keep.
 */
async function checkBalanceProjections(): Promise<InvariantViolation[]> {
  const accounts = await prisma.account.findMany({ select: { id: true, balance: true, assetId: true } });
  const sums = await prisma.entry.groupBy({ by: ['accountId'], _sum: { amount: true } });
  const sumByAccount = new Map(sums.map((row) => [row.accountId, row._sum.amount ?? 0n]));

  const violations: InvariantViolation[] = [];
  for (const account of accounts) {
    const derived = sumByAccount.get(account.id) ?? 0n;
    if (account.balance !== derived) {
      violations.push({
        invariant: 'balance_matches_entries',
        accountId: account.id,
        assetId: account.assetId,
        expected: derived.toString(),
        actual: account.balance.toString(),
        detail: `Account ${account.id} holds a cached balance of ${account.balance.toString()} but its entries sum to ${derived.toString()}`,
      });
    }
  }
  return violations;
}

/**
 * Invariant 3 — no account is negative unless it is explicitly allowed to be.
 *
 * A negative user balance means value was spent that never existed. Checked
 * separately from the transfer-time guard because the guard only protects
 * writes that went through `transfer`, and the purpose of an invariant is to
 * catch what didn't.
 */
async function checkNoUnauthorizedNegatives(): Promise<InvariantViolation[]> {
  const negatives = await prisma.account.findMany({
    where: { allowNegative: false, balance: { lt: 0n } },
    select: { id: true, assetId: true, balance: true },
  });

  return negatives.map((account) => ({
    invariant: 'no_unauthorized_negative',
    accountId: account.id,
    assetId: account.assetId,
    expected: '>= 0',
    actual: account.balance.toString(),
    detail: `Account ${account.id} is negative (${account.balance.toString()}) without permission — value was spent that was never issued`,
  }));
}

/**
 * Invariant 4 — every transfer's own entries sum to zero.
 *
 * Narrower than invariant 1 and worth running alongside it: the global check
 * tells you the book is broken, this one tells you which transfer broke it.
 * Two offsetting bugs could also cancel out globally and still be caught here.
 */
async function checkPerTransferBalance(): Promise<InvariantViolation[]> {
  const totals = await prisma.entry.groupBy({ by: ['transferId'], _sum: { amount: true } });

  return totals
    .filter((row) => (row._sum.amount ?? 0n) !== 0n)
    .map((row) => ({
      invariant: 'transfer_balances',
      expected: '0',
      actual: (row._sum.amount ?? 0n).toString(),
      detail: `Transfer ${row.transferId} does not balance — its entries sum to ${(row._sum.amount ?? 0n).toString()}`,
    }));
}

/** Run everything. Cheap enough to schedule nightly and to gate CI on. */
export async function checkInvariants(): Promise<InvariantReport> {
  const [zeroSum, projections, negatives, perTransfer, assets, accounts, transfers, entries] = await Promise.all([
    checkGlobalZeroSum(),
    checkBalanceProjections(),
    checkNoUnauthorizedNegatives(),
    checkPerTransferBalance(),
    prisma.asset.count(),
    prisma.account.count(),
    prisma.transfer.count(),
    prisma.entry.count(),
  ]);

  const violations = [...zeroSum, ...perTransfer, ...projections, ...negatives];

  return {
    checkedAt: new Date(),
    ok: violations.length === 0,
    violations,
    stats: { assets, accounts, transfers, entries },
  };
}

/**
 * Rebuild every cached balance from the entries.
 *
 * The proof that balances are genuinely a projection: this must be safe to
 * run at any moment and change nothing. If running it moves a balance, the
 * invariant checker was already reporting that account — and the number the
 * product was showing was wrong.
 *
 * Kept separate from `checkInvariants` on purpose. Detection and correction
 * must be two decisions, because correcting on detection is how you lose the
 * evidence of what went wrong.
 */
export async function rebuildBalances(): Promise<{ accountsChecked: number; accountsCorrected: number }> {
  const accounts = await prisma.account.findMany({ select: { id: true, balance: true } });
  const sums = await prisma.entry.groupBy({ by: ['accountId'], _sum: { amount: true } });
  const sumByAccount = new Map(sums.map((row) => [row.accountId, row._sum.amount ?? 0n]));

  let corrected = 0;
  for (const account of accounts) {
    const derived: MinorUnits = sumByAccount.get(account.id) ?? 0n;
    if (account.balance !== derived) {
      await prisma.account.update({ where: { id: account.id }, data: { balance: derived } });
      corrected += 1;
    }
  }

  return { accountsChecked: accounts.length, accountsCorrected: corrected };
}
