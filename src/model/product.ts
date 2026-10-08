/**
 * The catalogue: pieces in series (a stock) and unique pieces (a status).
 * A unique piece that sold leaves the sale grid but stays in the book, with
 * its photo and the day it left (doc 124 §3).
 */
import { isInstant, newId, text } from './client';
import { PRODUCT_SCHEMA, type Product, type ProductKind, type UniqueStatus } from './types';

const STATUSES: readonly UniqueStatus[] = ['available', 'reserved', 'sold'];

function readPrice(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
}

function readStock(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function normalizeProduct(raw: unknown): Product | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 80);
  const name = text(r.name);
  if (!id || !name) return null;
  const kind: ProductKind = r.kind === 'unique' ? 'unique' : 'series';
  const product: Product = {
    schema: PRODUCT_SCHEMA,
    id,
    name,
    kind,
    tags: Array.isArray(r.tags)
      ? [...new Set(r.tags.map((t) => text(t, 40)).filter((t): t is string => !!t))].slice(0, 30)
      : [],
  };
  const price = readPrice(r.price);
  if (price !== undefined) product.price = price;
  if (kind === 'series') {
    const stock = readStock(r.stock);
    if (stock !== undefined) product.stock = stock;
  } else {
    // A unique piece with no readable status is available: it exists and nobody said otherwise.
    product.status = STATUSES.includes(r.status as UniqueStatus) ? (r.status as UniqueStatus) : 'available';
    if (product.status === 'sold' && isInstant(r.soldAt)) product.soldAt = r.soldAt;
  }
  const photo = text(r.photoPath, 1000);
  if (photo) product.photoPath = photo;
  if (isPictogram(r.emoji)) product.emoji = r.emoji;
  const description = text(r.description, 2000);
  if (description) product.description = description;
  if (isInstant(r.createdAt)) product.createdAt = r.createdAt;
  if (isInstant(r.updatedAt)) product.updatedAt = r.updatedAt;
  return product;
}

/**
 * A pictogram is a short run of pictographic characters (an emoji, possibly
 * with a skin tone or joiner). Anything else, a word or a long string, is
 * refused: this field is drawn at 64 px and must not carry text.
 */
export function isPictogram(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 16 && /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f]+$/u.test(value) && /\p{Extended_Pictographic}/u.test(value);
}

/** The pictograms offered in the product dialog: the trades MnemoCRM is built for. */
export const PICTOGRAMS = [
  '🏺', '🥣', '☕', '🫖', '🍵', '🍽️', '🕯️', '🪴', '💐', '🧺',
  '🧶', '🧵', '👜', '👗', '🧣', '💍', '📿', '🪵', '🪑', '🖼️',
  '🎨', '📚', '🧸', '🧼', '🍯', '🍞', '🥐', '🧁', '🍷', '🧀',
] as const;

export interface ProductDraft {
  name: string;
  kind: ProductKind;
  price?: number;
  stock?: number;
  photoPath?: string;
  emoji?: string;
  description?: string;
  tags?: string[];
}

export function createProduct(draft: ProductDraft, now: Date = new Date()): Product | null {
  const iso = now.toISOString();
  return normalizeProduct({ ...draft, id: newId(), createdAt: iso, updatedAt: iso });
}

/** +1 / -1 on a tracked stock, never below zero. An untracked stock stays untracked. */
export function adjustStock(product: Product, delta: number, now: Date = new Date()): Product {
  if (product.kind !== 'series' || product.stock === undefined) return product;
  const stock = Math.max(0, product.stock + delta);
  if (stock === product.stock) return product;
  return { ...product, stock, updatedAt: now.toISOString() };
}

export function setUniqueStatus(product: Product, status: UniqueStatus, now: Date = new Date()): Product {
  if (product.kind !== 'unique' || product.status === status) return product;
  const next: Product = { ...product, status, updatedAt: now.toISOString() };
  if (status === 'sold') next.soldAt = now.toISOString();
  else delete next.soldAt;
  return next;
}

export type CatalogFilter = 'all' | 'forSale' | 'sold';

/** "For sale" = series, and unique pieces not sold yet. */
export function filterCatalog(products: Product[], filter: CatalogFilter): Product[] {
  const shown =
    filter === 'all'
      ? products
      : filter === 'sold'
        ? products.filter((p) => p.kind === 'unique' && p.status === 'sold')
        : products.filter((p) => p.kind === 'series' || p.status !== 'sold');
  return [...shown].sort((a, b) => a.name.localeCompare(b.name));
}

export function isOutOfStock(product: Product): boolean {
  return product.kind === 'series' && product.stock === 0;
}

/**
 * The stock a sale of `qty` would overrun, or null. The sale is never refused
 * (the count on paper may be the wrong one), but recording it floors the stock
 * at 0, so the screen says so before the press. An untracked stock overruns nothing.
 */
export function stockOverrun(product: Product | undefined, qty: number): number | null {
  if (!product || product.kind !== 'series' || product.stock === undefined) return null;
  return qty > product.stock ? product.stock : null;
}
