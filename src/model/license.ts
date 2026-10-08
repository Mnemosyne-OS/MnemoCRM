/**
 * What a book may hold without an Engramm license (doc 124 §14).
 *
 * Decided by Tony on 2026-09-25: CSV and XLSX imports are free, the PDF
 * catalogue import needs a license, and a book without one holds 50 clients
 * and 30 products for sale.
 *
 * Three rules keep the limit from turning against the person:
 * - It bounds CREATION, never access. A book already past the limit (made on
 *   a licensed machine, typed by hand in the folder) opens whole.
 * - `unknown` is never a refusal. Nobody could check (no network, a timeout),
 *   so nothing is refused: a paying customer is not locked out by their wifi.
 * - Only products still FOR SALE count. A unique piece that sold stays in the
 *   book as a memory of it; counting it would make a ceramicist hit the wall
 *   after one good month.
 *
 * ⚠️ This is a commercial boundary, not a security one: the cartridge is
 * public and a fork removes it. Accepted, see the host side (cartridgeLicense).
 */
import type { Client, Product } from './types';

export type LicenseVerdict = 'active' | 'inactive' | 'unknown';

export const FREE_LIMITS = { clients: 50, products: 30 } as const;

export type Limited = keyof typeof FREE_LIMITS;

/** Products that are still for sale: every series, and unique pieces not sold. */
export function productsForSale(products: Product[]): number {
  return products.filter((p) => p.kind === 'series' || p.status !== 'sold').length;
}

function used(kind: Limited, clients: Client[], products: Product[]): number {
  return kind === 'clients' ? clients.length : productsForSale(products);
}

/** How many more can be created. Null = no limit applies (licensed, or nobody could check). */
export function roomLeft(kind: Limited, verdict: LicenseVerdict, clients: Client[], products: Product[]): number | null {
  if (verdict !== 'inactive') return null;
  return Math.max(0, FREE_LIMITS[kind] - used(kind, clients, products));
}

/** True when one more record of this kind may be created. */
export function mayCreate(kind: Limited, verdict: LicenseVerdict, clients: Client[], products: Product[]): boolean {
  const room = roomLeft(kind, verdict, clients, products);
  return room === null || room > 0;
}

/**
 * Whether saving this product is a CREATION the limit applies to. An edit is
 * never one, even one that puts a sold piece back on sale: the limit bounds
 * creation, and an edit is the person working on what they already have.
 */
export function productIsNewForSale(next: Product, before: Product | undefined): boolean {
  return !before && (next.kind === 'series' || next.status !== 'sold');
}

/** The PDF import: refused only on a CHECKED absence of license. */
export function pdfImportAllowed(verdict: LicenseVerdict): boolean {
  return verdict !== 'inactive';
}
