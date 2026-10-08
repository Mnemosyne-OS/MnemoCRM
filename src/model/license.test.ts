import { describe, it, expect } from 'vitest';
import { FREE_LIMITS, mayCreate, pdfImportAllowed, productIsNewForSale, productsForSale, roomLeft } from './license';
import type { Client, Product } from './types';

const client = (id: string): Client => ({ schema: 1, id, kind: 'person', name: id, tags: [], timeline: [] });
const product = (id: string, over: Partial<Product> = {}): Product => ({ schema: 1, id, name: id, kind: 'series', tags: [], ...over });
const many = <T,>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));

describe('the free limit', () => {
  it('is 50 clients and 30 products for sale', () => {
    expect(FREE_LIMITS).toEqual({ clients: 50, products: 30 });
  });

  it('refuses the 51st client only on a CHECKED absence of license', () => {
    const full = many(50, (i) => client(`c${i}`));
    expect(mayCreate('clients', 'inactive', full, [])).toBe(false);
    expect(mayCreate('clients', 'inactive', full.slice(1), [])).toBe(true);
    expect(mayCreate('clients', 'active', full, [])).toBe(true);
    // Nobody could check: never a refusal.
    expect(mayCreate('clients', 'unknown', full, [])).toBe(true);
  });

  it('counts products still for sale, never sold unique pieces', () => {
    const sold = many(40, (i) => product(`s${i}`, { kind: 'unique', status: 'sold' }));
    const onSale = many(29, (i) => product(`p${i}`));
    expect(productsForSale([...sold, ...onSale])).toBe(29);
    expect(mayCreate('products', 'inactive', [], [...sold, ...onSale])).toBe(true);
    const reserved = product('r', { kind: 'unique', status: 'reserved' });
    expect(mayCreate('products', 'inactive', [], [...sold, ...onSale, reserved])).toBe(false);
  });

  it('room is null when no limit applies, and never negative', () => {
    expect(roomLeft('clients', 'active', [], [])).toBeNull();
    expect(roomLeft('clients', 'unknown', [], [])).toBeNull();
    expect(roomLeft('clients', 'inactive', many(10, (i) => client(`c${i}`)), [])).toBe(40);
    expect(roomLeft('clients', 'inactive', many(70, (i) => client(`c${i}`)), [])).toBe(0);
  });

  it('only a creation counts: an edit, even back on sale, is never refused', () => {
    const p = product('a', { kind: 'unique', status: 'available' });
    expect(productIsNewForSale(p, undefined)).toBe(true);
    expect(productIsNewForSale(p, { ...p, status: 'sold' })).toBe(false);
    expect(productIsNewForSale({ ...p, status: 'sold' }, undefined)).toBe(false);
  });

  it('the PDF import is refused only on a checked absence', () => {
    expect(pdfImportAllowed('inactive')).toBe(false);
    expect(pdfImportAllowed('unknown')).toBe(true);
    expect(pdfImportAllowed('active')).toBe(true);
  });
});
