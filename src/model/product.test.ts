import { adjustStock, createProduct, filterCatalog, isOutOfStock, normalizeProduct, setUniqueStatus } from './product';
import { planDay } from './day';
import type { Client, Deal, Product } from './types';

const piece = (over: Partial<Product> & { id: string; name: string }): Product => ({
  schema: 1,
  kind: 'unique',
  status: 'available',
  tags: [],
  ...over,
});

describe('products', () => {
  it('a series with no stock typed is UNTRACKED, not out of stock', () => {
    const p = createProduct({ name: 'Mug', kind: 'series' })!;
    expect(p.stock).toBeUndefined();
    expect(isOutOfStock(p)).toBe(false);
    expect(adjustStock(p, -1)).toBe(p);
  });

  it('never goes below zero, and zero IS out of stock', () => {
    const p = createProduct({ name: 'Mug', kind: 'series', stock: 1 })!;
    const zero = adjustStock(p, -1);
    expect(zero.stock).toBe(0);
    expect(isOutOfStock(zero)).toBe(true);
    expect(adjustStock(zero, -1)).toBe(zero);
  });

  it('a unique piece has a status, never a stock', () => {
    const p = normalizeProduct({ id: 'p', name: 'Vase', kind: 'unique', stock: 4 })!;
    expect(p.stock).toBeUndefined();
    expect(p.status).toBe('available');
  });

  it('selling dates the piece; putting it back on sale removes the date', () => {
    const sold = setUniqueStatus(piece({ id: 'p', name: 'Vase' }), 'sold', new Date('2026-12-20T15:00:00Z'));
    expect(sold.soldAt).toBe('2026-12-20T15:00:00.000Z');
    const back = setUniqueStatus(sold, 'available');
    expect(back.soldAt).toBeUndefined();
  });

  it('keeps soldAt only on a sold piece', () => {
    expect(normalizeProduct({ id: 'p', name: 'V', kind: 'unique', status: 'available', soldAt: '2026-01-01T00:00:00Z' })!.soldAt).toBeUndefined();
  });

  it('"for sale" hides sold unique pieces, "sold" shows only them', () => {
    const list = [
      piece({ id: '1', name: 'B', status: 'sold' }),
      piece({ id: '2', name: 'A' }),
      { ...piece({ id: '3', name: 'C' }), kind: 'series' as const, status: undefined },
    ];
    expect(filterCatalog(list, 'forSale').map((p) => p.id)).toEqual(['2', '3']);
    expect(filterCatalog(list, 'sold').map((p) => p.id)).toEqual(['1']);
    expect(filterCatalog(list, 'all')).toHaveLength(3);
  });
});

describe('planDay mixes clients and deals', () => {
  const client = (id: string, name: string, date?: string): Client => ({
    schema: 1, id, name, kind: 'person', tags: [], timeline: [], ...(date ? { followUp: { date } } : {}),
  });
  const deal = (id: string, date: string, over: Partial<Deal> = {}): Deal => ({
    schema: 1, id, title: `deal ${id}`, stageId: 's', productIds: [], history: [], nextStep: { date }, ...over,
  });

  it('puts both kinds in one list, names the deal client, and skips closed deals', () => {
    const plan = planDay(
      [client('c1', 'Anna', '2026-09-24'), client('c2', 'Bob')],
      [deal('d1', '2026-09-24', { clientId: 'c2' }), deal('d2', '2026-09-24', { closed: { at: '2026-09-01T00:00:00Z', outcome: 'won' } })],
      '2026-09-24',
    );
    expect(plan.today.map((i) => `${i.kind}:${i.id}`)).toEqual(['client:c1', 'deal:d1']);
    expect(plan.today[1].sub).toBe('Bob');
  });
});
