import {
  GENESIS_HASH,
  activeSales,
  buildSale,
  buildVoid,
  canonical,
  chainHead,
  hashOf,
  normalizeEntry,
  productEffects,
  saleTotal,
  summarize,
  verifyJournal,
  type SaleDraft,
} from './journal';
import { createMarket, marketOn, marketReport } from './market';
import type { JournalEntry, Market, Product, SaleEntry } from './types';

const draft = (over: Partial<SaleDraft> = {}): SaleDraft => ({
  at: '2026-12-20T15:00:00.000Z',
  place: 'workshop',
  lines: [{ label: 'Bol bleu', qty: 2, unitPrice: 15 }],
  payment: 'cash',
  currency: 'EUR',
  ...over,
});

/** Write n sales in a row, the way the app does. */
function journalOf(n: number): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (let i = 0; i < n; i++) out.push(buildSale(draft({ lines: [{ label: `L${i}`, qty: 1, unitPrice: 10 + i }] }), chainHead(out))!);
  return out;
}

/** What a line looks like after a trip through the disk. */
const roundTrip = (e: JournalEntry) => normalizeEntry(JSON.parse(JSON.stringify(e)))!;

describe('the chain', () => {
  it('starts from the genesis hash, numbers lines 1, 2, 3, and links each to the previous', () => {
    const j = journalOf(3);
    expect(j.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(j[0].prevHash).toBe(GENESIS_HASH);
    expect(j[1].prevHash).toBe(j[0].hash);
    expect(verifyJournal(j).broken).toBeNull();
  });

  it('survives the trip through a file byte for byte', () => {
    expect(verifyJournal(journalOf(4).map(roundTrip)).broken).toBeNull();
  });

  it('hashes the same whatever the key order on disk', () => {
    expect(canonical({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(canonical({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }));
  });

  it('names the line whose CONTENT was edited outside the app', () => {
    const j = journalOf(3).map(roundTrip);
    (j[1] as SaleEntry).lines[0].unitPrice = 1;
    expect(verifyJournal(j).broken).toEqual({ seq: 2, reason: 'HASH' });
  });

  it('names a deleted line as a gap', () => {
    const j = journalOf(3);
    expect(verifyJournal([j[0], j[2]]).broken).toEqual({ seq: 2, reason: 'GAP' });
  });

  it('catches an edit whose own fingerprint was recomputed to hide it, at the NEXT line', () => {
    const j = journalOf(3).map(roundTrip);
    const forged = { ...(j[1] as SaleEntry), lines: [{ label: 'L1', qty: 1, unitPrice: 1 }] };
    forged.hash = hashOf(forged);
    j[1] = forged;
    expect(verifyJournal(j).broken).toEqual({ seq: 3, reason: 'LINK' });
  });

  it('names a duplicated line', () => {
    const j = journalOf(2);
    expect(verifyJournal([j[0], j[1], { ...j[1], id: 'copy' }]).broken).toEqual({ seq: 2, reason: 'DUPLICATE' });
  });

  it('keeps appending after the highest line even when the chain is broken', () => {
    const j = journalOf(3);
    expect(chainHead([j[0], j[2]])).toEqual({ seq: 3, hash: j[2].hash });
    expect(chainHead([])).toEqual({ seq: 0, hash: GENESIS_HASH });
  });
});

describe('reading a line back', () => {
  it('refuses a line it would have to repair (the repair would hide the edit)', () => {
    const ok = JSON.parse(JSON.stringify(journalOf(1)[0]));
    expect(normalizeEntry(ok)).not.toBeNull();
    expect(normalizeEntry({ ...ok, lines: [{ label: 'x', qty: 0, unitPrice: 1 }] })).toBeNull();
    expect(normalizeEntry({ ...ok, lines: [{ label: 'x', qty: 1 }] })).toBeNull();
    expect(normalizeEntry({ ...ok, hash: 'nothex' })).toBeNull();
    expect(normalizeEntry({ ...ok, payment: 'barter' })).toBeNull();
  });

  it('refuses a sale without a price', () => {
    expect(buildSale(draft({ lines: [{ label: 'x', qty: 1, unitPrice: Number.NaN }] }), chainHead([]))).toBeNull();
    expect(buildSale(draft({ lines: [] }), chainHead([]))).toBeNull();
  });
});

describe('cancelling', () => {
  it('a void is a new chained line; the sale stays and drops out of the totals', () => {
    const j = journalOf(2);
    const v = buildVoid(j[0].id, 'erreur', chainHead(j));
    const all = [...j, v];
    expect(v.seq).toBe(3);
    expect(verifyJournal(all).broken).toBeNull();
    expect(activeSales(all).map((s) => s.id)).toEqual([j[1].id]);
  });
});

describe('totals', () => {
  it('adds qty × price and splits by payment without float dust', () => {
    const a = buildSale(draft({ lines: [{ label: 'a', qty: 3, unitPrice: 0.1 }], payment: 'card' }), chainHead([]))!;
    const b = buildSale(draft({ lines: [{ label: 'b', qty: 1, unitPrice: 0.2 }] }), chainHead([a]))!;
    expect(saleTotal(a)).toBe(0.3);
    expect(summarize([a, b])).toEqual({ count: 2, total: 0.5, byPayment: { cash: 0.2, card: 0.3, transfer: 0, other: 0 } });
  });
});

describe('what a sale does to the catalogue', () => {
  const products: Product[] = [
    { schema: 1, id: 'mug', name: 'Mug', kind: 'series', stock: 5, tags: [] },
    { schema: 1, id: 'free', name: 'Carte', kind: 'series', tags: [] },
    { schema: 1, id: 'vase', name: 'Vase', kind: 'unique', status: 'available', tags: [] },
  ];
  const sale = buildSale(
    draft({
      lines: [
        { productId: 'mug', label: 'Mug', qty: 2, unitPrice: 12 },
        { productId: 'free', label: 'Carte', qty: 3, unitPrice: 2 },
        { productId: 'vase', label: 'Vase', qty: 1, unitPrice: 80 },
      ],
    }),
    chainHead([]),
  )!;

  it('lowers a tracked stock, leaves an untracked one alone, sells the unique piece on the SALE date', () => {
    const changed = productEffects(products, sale, 'sell');
    const byId = new Map(changed.map((p) => [p.id, p]));
    expect(byId.get('mug')!.stock).toBe(3);
    expect(byId.has('free')).toBe(false);
    expect(byId.get('vase')!.status).toBe('sold');
    expect(byId.get('vase')!.soldAt).toBe(sale.at);
  });

  it('a cancellation puts things back', () => {
    const after = productEffects(products, sale, 'sell');
    const merged = products.map((p) => after.find((a) => a.id === p.id) ?? p);
    const undone = new Map(productEffects(merged, sale, 'undo').map((p) => [p.id, p]));
    expect(undone.get('mug')!.stock).toBe(5);
    expect(undone.get('vase')!.status).toBe('available');
    expect(undone.get('vase')!.soldAt).toBeUndefined();
  });
});

describe('markets', () => {
  const market = createMarket({ name: 'Noël', startDate: '2026-12-19', endDate: '2026-12-21' })!;
  const other = createMarket({ name: 'Printemps', startDate: '2027-04-01' })!;

  it('finds the market of a day', () => {
    expect(marketOn([market, other], '2026-12-20')?.id).toBe(market.id);
    expect(marketOn([market, other], '2026-12-22')).toBeUndefined();
  });

  it('no stand fee = no net (never net = total); no count = no gap', () => {
    const j = [buildSale(draft({ place: 'market', marketId: market.id }), chainHead([]))!];
    const r = marketReport(market, j, []);
    expect(r.summary.total).toBe(30);
    expect(r.net).toBeNull();
    expect(r.cashGap).toBeNull();
  });

  it('shows the gap between the counted box and the cash sales, with its sign', () => {
    const counted: Market = { ...market, standFee: 40, cashCount: { amount: 25, at: '2026-12-21T19:00:00Z' } };
    const j: JournalEntry[] = [];
    j.push(buildSale(draft({ place: 'market', marketId: market.id }), chainHead(j))!);
    j.push(buildSale(draft({ place: 'market', marketId: market.id, payment: 'card' }), chainHead(j))!);
    j.push(buildSale(draft({ place: 'market', marketId: other.id }), chainHead(j))!);
    const r = marketReport(counted, j, []);
    expect(r.summary.count).toBe(2);
    expect(r.net).toBe(20);
    expect(r.cashGap).toBe(-5);
  });

  it('a market that ends before it starts keeps no end date', () => {
    expect(createMarket({ name: 'x', startDate: '2026-12-19', endDate: '2026-12-01' })!.endDate).toBeUndefined();
  });
});
