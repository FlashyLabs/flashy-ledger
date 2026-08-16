import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkInvariants, rebuildBalances } from './invariantService';
import { prisma } from '../lib/prisma';

vi.mock('../lib/prisma', () => ({
  prisma: {
    entry: { groupBy: vi.fn(), count: vi.fn() },
    account: { findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    asset: { count: vi.fn() },
    transfer: { count: vi.fn() },
  },
}));

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

/**
 * groupBy is called three times with different `by` clauses; the mock
 * dispatches on that so each test can describe one specific corruption.
 */
function givenLedger(opts: {
  byAsset?: { assetId: string; sum: bigint }[];
  byTransfer?: { transferId: string; sum: bigint }[];
  byAccount?: { accountId: string; sum: bigint }[];
  accounts?: { id: string; balance: bigint; assetId: string; allowNegative?: boolean }[];
  negatives?: { id: string; assetId: string; balance: bigint }[];
} = {}) {
  mock(prisma.entry.groupBy).mockImplementation(async ({ by }: { by: string[] }) => {
    if (by.includes('assetId')) {
      return (opts.byAsset ?? []).map((r) => ({ assetId: r.assetId, _sum: { amount: r.sum } }));
    }
    if (by.includes('transferId')) {
      return (opts.byTransfer ?? []).map((r) => ({ transferId: r.transferId, _sum: { amount: r.sum } }));
    }
    return (opts.byAccount ?? []).map((r) => ({ accountId: r.accountId, _sum: { amount: r.sum } }));
  });
  mock(prisma.account.findMany).mockImplementation(async (args: { where?: Record<string, unknown> }) =>
    args?.where?.allowNegative === false ? (opts.negatives ?? []) : (opts.accounts ?? []),
  );
  mock(prisma.asset.count).mockResolvedValue(1);
  mock(prisma.account.count).mockResolvedValue((opts.accounts ?? []).length);
  mock(prisma.transfer.count).mockResolvedValue(0);
  mock(prisma.entry.count).mockResolvedValue(0);
}

describe('invariantService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    givenLedger();
  });

  it('reports ok on a clean ledger', async () => {
    givenLedger({
      byAsset: [{ assetId: 'gold', sum: 0n }],
      byTransfer: [{ transferId: 'tr-1', sum: 0n }],
      accounts: [{ id: 'a1', balance: 500n, assetId: 'gold' }],
      byAccount: [{ accountId: 'a1', sum: 500n }],
    });

    const report = await checkInvariants();

    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });

  // The check that makes double-entry worth the extra row: a single-sided
  // write anywhere in history shows up here no matter how well it was hidden.
  it('catches an asset whose entries do not sum to zero', async () => {
    givenLedger({ byAsset: [{ assetId: 'gold', sum: 500n }] });

    const report = await checkInvariants();

    expect(report.ok).toBe(false);
    expect(report.violations).toContainEqual(
      expect.objectContaining({ invariant: 'global_zero_sum', assetId: 'gold', expected: '0', actual: '500' }),
    );
  });

  // Narrower than the global check and worth running alongside it: this one
  // names the transfer that broke the book.
  it('names the specific transfer that does not balance', async () => {
    givenLedger({ byTransfer: [{ transferId: 'tr-bad', sum: -25n }] });

    const report = await checkInvariants();

    expect(report.violations).toContainEqual(
      expect.objectContaining({ invariant: 'transfer_balances', actual: '-25' }),
    );
    expect(report.violations[0]?.detail).toMatch(/tr-bad/);
  });

  // The check most likely to earn its keep, given the current implementation
  // has 177 sites that write a balance outside any transfer path.
  it('catches a cached balance that has drifted from its entries', async () => {
    givenLedger({
      accounts: [{ id: 'a1', balance: 999n, assetId: 'gold' }],
      byAccount: [{ accountId: 'a1', sum: 500n }],
    });

    const report = await checkInvariants();

    expect(report.violations).toContainEqual(
      expect.objectContaining({
        invariant: 'balance_matches_entries',
        accountId: 'a1',
        expected: '500',
        actual: '999',
      }),
    );
  });

  it('treats an account with no entries as zero, not as drift', async () => {
    givenLedger({ accounts: [{ id: 'a1', balance: 0n, assetId: 'gold' }], byAccount: [] });

    const report = await checkInvariants();

    expect(report.violations).toEqual([]);
  });

  // A negative user balance means value was spent that never existed.
  it('catches an unauthorized negative balance', async () => {
    givenLedger({ negatives: [{ id: 'a1', assetId: 'gold', balance: -50n }] });

    const report = await checkInvariants();

    expect(report.violations).toContainEqual(
      expect.objectContaining({ invariant: 'no_unauthorized_negative', accountId: 'a1', actual: '-50' }),
    );
  });

  it('only inspects accounts that are not allowed to go negative', async () => {
    await checkInvariants();

    const negativeQuery = mock(prisma.account.findMany).mock.calls.find(
      (call) => call[0]?.where?.allowNegative === false,
    );
    expect(negativeQuery?.[0].where).toEqual({ allowNegative: false, balance: { lt: 0n } });
  });

  it('reports the stats a scheduled run should log', async () => {
    const report = await checkInvariants();

    expect(report.stats).toEqual({ assets: 1, accounts: 0, transfers: 0, entries: 0 });
    expect(report.checkedAt).toBeInstanceOf(Date);
  });

  describe('rebuildBalances', () => {
    // The proof that balances are genuinely a projection: running this on a
    // healthy ledger must change nothing.
    it('changes nothing when every projection already agrees', async () => {
      givenLedger({
        accounts: [{ id: 'a1', balance: 500n, assetId: 'gold' }],
        byAccount: [{ accountId: 'a1', sum: 500n }],
      });

      const result = await rebuildBalances();

      expect(result).toEqual({ accountsChecked: 1, accountsCorrected: 0 });
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('corrects a drifted projection from the entries', async () => {
      givenLedger({
        accounts: [{ id: 'a1', balance: 999n, assetId: 'gold' }],
        byAccount: [{ accountId: 'a1', sum: 500n }],
      });

      const result = await rebuildBalances();

      expect(result).toEqual({ accountsChecked: 1, accountsCorrected: 1 });
      expect(prisma.account.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { balance: 500n } });
    });

    // Detection and correction are two decisions on purpose — correcting on
    // detection destroys the evidence of how the discrepancy arose.
    it('is a separate call from checking, and checking never corrects', async () => {
      givenLedger({
        accounts: [{ id: 'a1', balance: 999n, assetId: 'gold' }],
        byAccount: [{ accountId: 'a1', sum: 500n }],
      });

      await checkInvariants();

      expect(prisma.account.update).not.toHaveBeenCalled();
    });
  });
});
