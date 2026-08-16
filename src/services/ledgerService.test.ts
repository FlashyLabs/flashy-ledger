import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transfer, mint, burn, getBalance, recomputeBalance } from './ledgerService';
import { prisma } from '../lib/prisma';
import { LedgerError } from '../lib/LedgerError';

vi.mock('../lib/prisma', () => ({
  prisma: {
    asset: { findUnique: vi.fn() },
    party: { findUnique: vi.fn() },
    account: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
    transfer: { create: vi.fn(), findUnique: vi.fn() },
    entry: { create: vi.fn(), aggregate: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const CONFLICT = { code: 'P2002' };

/**
 * The mocked $transaction just runs the callback against the same client, so
 * these tests exercise the real ordering and guards. Atomicity itself is a
 * database property and is not what's under test here.
 */
function givenWorld(opts: { balances?: Record<string, bigint>; allowNegative?: Record<string, boolean> } = {}) {
  mock(prisma.asset.findUnique).mockResolvedValue({ id: 'gold', slug: 'flashy-gold', symbol: 'FG', isActive: true });
  mock(prisma.party.findUnique).mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    if (where.kind_externalId) return { id: 'system', kind: 'SYSTEM' };
    return { id: where.id, kind: where.id === 'system' ? 'SYSTEM' : 'PERSON' };
  });
  mock(prisma.account.findUnique).mockImplementation(async ({ where }: { where: { partyId_assetId: { partyId: string } } }) => {
    const partyId = where.partyId_assetId.partyId;
    return {
      id: `acct-${partyId}`,
      partyId,
      assetId: 'gold',
      balance: opts.balances?.[partyId] ?? 0n,
      allowNegative: opts.allowNegative?.[partyId] ?? partyId === 'system',
    };
  });
  mock(prisma.transfer.create).mockResolvedValue({ id: 'tr-1' });
  mock(prisma.entry.create).mockResolvedValue({ id: 'e-1' });
  mock(prisma.account.update).mockImplementation(
    async ({ where, data }: { where: { id: string }; data: { balance: { increment: bigint } } }) => {
      const partyId = where.id.replace('acct-', '');
      return { id: where.id, partyId, balance: (opts.balances?.[partyId] ?? 0n) + data.balance.increment };
    },
  );
  mock(prisma.$transaction).mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma));
}

describe('ledgerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    givenWorld();
  });

  describe('transfer', () => {
    it('records a balanced two-leg movement', async () => {
      givenWorld({ balances: { alice: 1000n } });

      const result = await transfer({
        assetId: 'gold',
        legs: [
          { partyId: 'alice', amount: -500n },
          { partyId: 'bob', amount: 500n },
        ],
        idempotencyKey: 'k-1',
        reason: 'test',
      });

      expect(result.created).toBe(true);
      expect(prisma.entry.create).toHaveBeenCalledTimes(2);
    });

    // The property that makes "is the ledger correct?" a single query.
    it('refuses legs that do not sum to zero', async () => {
      await expect(
        transfer({
          assetId: 'gold',
          legs: [
            { partyId: 'alice', amount: -500n },
            { partyId: 'bob', amount: 499n },
          ],
          idempotencyKey: 'k-1',
          reason: 'test',
        }),
      ).rejects.toMatchObject({ code: 'UNBALANCED_TRANSFER' });
      expect(prisma.transfer.create).not.toHaveBeenCalled();
    });

    it('refuses a single-leg transfer', async () => {
      await expect(
        transfer({ assetId: 'gold', legs: [{ partyId: 'alice', amount: 0n }], idempotencyKey: 'k', reason: 'r' }),
      ).rejects.toMatchObject({ code: 'INVALID_TRANSFER' });
    });

    it('refuses a zero leg — it moves nothing and only ever balances a bug', async () => {
      await expect(
        transfer({
          assetId: 'gold',
          legs: [
            { partyId: 'alice', amount: 0n },
            { partyId: 'bob', amount: 0n },
          ],
          idempotencyKey: 'k',
          reason: 'r',
        }),
      ).rejects.toMatchObject({ code: 'ZERO_LEG' });
    });

    // Two legs on one account would net against itself and balance while
    // moving nothing.
    it('refuses the same party appearing twice', async () => {
      await expect(
        transfer({
          assetId: 'gold',
          legs: [
            { partyId: 'alice', amount: -500n },
            { partyId: 'alice', amount: 500n },
          ],
          idempotencyKey: 'k',
          reason: 'r',
        }),
      ).rejects.toMatchObject({ code: 'DUPLICATE_LEG' });
    });

    it('requires an idempotency key', async () => {
      await expect(
        transfer({
          assetId: 'gold',
          legs: [
            { partyId: 'a', amount: -1n },
            { partyId: 'b', amount: 1n },
          ],
          idempotencyKey: '   ',
          reason: 'r',
        }),
      ).rejects.toMatchObject({ code: 'MISSING_IDEMPOTENCY_KEY' });
    });

    // The whole point of an idempotency key: a retry must be safe, and a
    // retry storm is a burst of concurrent attempts with the same key.
    it('replays the original transfer instead of double-crediting on a duplicate key', async () => {
      mock(prisma.transfer.create).mockRejectedValue(CONFLICT);
      mock(prisma.transfer.findUnique).mockResolvedValue({
        id: 'tr-original',
        entries: [
          { account: { partyId: 'alice', balance: -500n } },
          { account: { partyId: 'bob', balance: 500n } },
        ],
      });

      const result = await transfer({
        assetId: 'gold',
        legs: [
          { partyId: 'alice', amount: -500n },
          { partyId: 'bob', amount: 500n },
        ],
        idempotencyKey: 'k-1',
        reason: 'test',
      });

      expect(result).toEqual({
        transferId: 'tr-original',
        created: false,
        balances: [
          { partyId: 'alice', balance: -500n },
          { partyId: 'bob', balance: 500n },
        ],
      });
    });

    it('surfaces a conflict that was not the idempotency key', async () => {
      mock(prisma.transfer.create).mockRejectedValue(CONFLICT);
      mock(prisma.transfer.findUnique).mockResolvedValue(null);

      await expect(
        transfer({
          assetId: 'gold',
          legs: [
            { partyId: 'a', amount: -1n },
            { partyId: 'b', amount: 1n },
          ],
          idempotencyKey: 'k',
          reason: 'r',
        }),
      ).rejects.toMatchObject({ code: 'TRANSFER_CONFLICT' });
    });

    // Spending value that was never issued is the failure a ledger exists
    // to make impossible.
    it('refuses to overdraw an account that may not go negative', async () => {
      givenWorld({ balances: { alice: 100n } });

      await expect(
        transfer({
          assetId: 'gold',
          legs: [
            { partyId: 'alice', amount: -500n },
            { partyId: 'bob', amount: 500n },
          ],
          idempotencyKey: 'k',
          reason: 'r',
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', httpStatus: 409 });
    });

    it('allows the system party to go negative — its negative is the amount issued', async () => {
      givenWorld({ balances: { system: 0n }, allowNegative: { system: true } });

      await expect(
        transfer({
          assetId: 'gold',
          legs: [
            { partyId: 'system', amount: -500n },
            { partyId: 'bob', amount: 500n },
          ],
          idempotencyKey: 'k',
          reason: 'r',
        }),
      ).resolves.toMatchObject({ created: true });
    });

    it('refuses an unknown asset', async () => {
      mock(prisma.asset.findUnique).mockResolvedValue(null);
      await expect(
        transfer({
          assetId: 'nope',
          legs: [
            { partyId: 'a', amount: -1n },
            { partyId: 'b', amount: 1n },
          ],
          idempotencyKey: 'k',
          reason: 'r',
        }),
      ).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    });

    it('refuses a retired asset', async () => {
      mock(prisma.asset.findUnique).mockResolvedValue({ id: 'gold', slug: 'g', symbol: 'FG', isActive: false });
      await expect(
        transfer({
          assetId: 'gold',
          legs: [
            { partyId: 'a', amount: -1n },
            { partyId: 'b', amount: 1n },
          ],
          idempotencyKey: 'k',
          reason: 'r',
        }),
      ).rejects.toMatchObject({ code: 'ASSET_INACTIVE' });
    });

    it('supports multi-leg transfers such as a split payout', async () => {
      givenWorld({ balances: { treasury: 5000n } });

      const result = await transfer({
        assetId: 'gold',
        legs: [
          { partyId: 'treasury', amount: -1000n },
          { partyId: 'alice', amount: 700n },
          { partyId: 'bob', amount: 300n },
        ],
        idempotencyKey: 'k',
        reason: 'split',
      });

      expect(result.created).toBe(true);
      expect(prisma.entry.create).toHaveBeenCalledTimes(3);
    });

    it('creates an account on first use rather than requiring provisioning', async () => {
      mock(prisma.account.findUnique).mockResolvedValue(null);
      // Honours the allowNegative the service derives from party kind —
      // hardcoding false here would mean the issuer could never mint.
      mock(prisma.account.create).mockImplementation(
        async ({ data }: { data: { partyId: string; allowNegative: boolean } }) => ({
          id: `acct-${data.partyId}`,
          partyId: data.partyId,
          balance: 0n,
          allowNegative: data.allowNegative,
        }),
      );

      await expect(
        transfer({
          assetId: 'gold',
          legs: [
            { partyId: 'system', amount: -1n },
            { partyId: 'newcomer', amount: 1n },
          ],
          idempotencyKey: 'k',
          reason: 'r',
        }),
      ).resolves.toBeDefined();
      expect(prisma.account.create).toHaveBeenCalled();
    });
  });

  describe('mint and burn', () => {
    // Minting as an ordinary transfer against a SYSTEM party keeps the
    // global zero-sum invariant true with no carve-out.
    it('mints by moving from the system party, keeping the transfer balanced', async () => {
      await mint('gold', 'alice', 500n, 'mint-1', 'academy.track_completed');

      const legs = mock(prisma.entry.create).mock.calls.map((c) => c[0].data.amount);
      expect(legs).toEqual([-500n, 500n]);
      expect(legs.reduce((a: bigint, b: bigint) => a + b, 0n)).toBe(0n);
    });

    it('burns by moving back to the system party', async () => {
      givenWorld({ balances: { alice: 1000n } });

      await burn('gold', 'alice', 500n, 'burn-1', 'redemption.fulfilled');

      const legs = mock(prisma.entry.create).mock.calls.map((c) => c[0].data.amount);
      expect(legs).toEqual([-500n, 500n]);
    });

    it.each([0n, -1n])('refuses a mint of %s', async (amount) => {
      await expect(mint('gold', 'alice', amount, 'k', 'r')).rejects.toMatchObject({ code: 'INVALID_MINT' });
    });

    it.each([0n, -1n])('refuses a burn of %s', async (amount) => {
      await expect(burn('gold', 'alice', amount, 'k', 'r')).rejects.toMatchObject({ code: 'INVALID_BURN' });
    });

    it('fails clearly when the issuer party has not been provisioned', async () => {
      mock(prisma.party.findUnique).mockResolvedValue(null);
      await expect(mint('gold', 'alice', 1n, 'k', 'r')).rejects.toMatchObject({ code: 'SYSTEM_PARTY_MISSING' });
    });
  });

  describe('balances', () => {
    it('reads the projection', async () => {
      givenWorld({ balances: { alice: 4200n } });
      await expect(getBalance('alice', 'gold')).resolves.toBe(4200n);
    });

    it('reports zero for a party that has never held the asset', async () => {
      mock(prisma.account.findUnique).mockResolvedValue(null);
      await expect(getBalance('nobody', 'gold')).resolves.toBe(0n);
    });

    // The escape hatch that makes trusting the projection safe: the
    // authoritative number is always recomputable from entries alone.
    it('recomputes the authoritative balance from entries', async () => {
      mock(prisma.entry.aggregate).mockResolvedValue({ _sum: { amount: 4200n } });
      await expect(recomputeBalance('alice', 'gold')).resolves.toBe(4200n);
    });

    it('recomputes zero when an account has no entries', async () => {
      mock(prisma.entry.aggregate).mockResolvedValue({ _sum: { amount: null } });
      await expect(recomputeBalance('alice', 'gold')).resolves.toBe(0n);
    });
  });

  it('throws LedgerError, so a route can map code and status directly', async () => {
    await expect(
      transfer({ assetId: 'gold', legs: [{ partyId: 'a', amount: 1n }], idempotencyKey: 'k', reason: 'r' }),
    ).rejects.toBeInstanceOf(LedgerError);
  });
});
