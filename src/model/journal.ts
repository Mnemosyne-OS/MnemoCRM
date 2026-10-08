/**
 * The sales journal (doc 124 §7.1): append-only, chained, corrected by new
 * lines and never by rewriting.
 *
 * ⚠️ This is NOT a certified cash register and must never be called one. The
 * chain makes an edit made outside MnemoCRM DETECTABLE (the screen says at which
 * line); it does not make one impossible, and it is not an attestation. It is
 * what keeps the certification door open without rewriting anything later.
 */
import { isInstant, newId, text } from './client';
import { sha256Hex } from './sha256';
import {
  JOURNAL_SCHEMA,
  type JournalEntry,
  type Payment,
  type PlaceKind,
  type Product,
  type SaleEntry,
  type SaleLine,
  type VoidEntry,
} from './types';

export const GENESIS_HASH = '0'.repeat(64);
const PLACES: readonly PlaceKind[] = ['workshop', 'online', 'market', 'other'];
const PAYMENTS: readonly Payment[] = ['cash', 'card', 'transfer', 'other'];
const MAX_LINES = 200;

/** JSON with keys sorted at every depth: the same entry always hashes the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashOf(entry: Omit<JournalEntry, 'hash'> | JournalEntry): string {
  const { hash: _ignored, ...rest } = entry as JournalEntry;
  return sha256Hex(canonical(rest));
}

function readLines(value: unknown): SaleLine[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LINES) return null;
  const lines: SaleLine[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const label = text(r.label, 200);
    const qty = r.qty;
    const unitPrice = r.unitPrice;
    if (!label || typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 10_000) return null;
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) return null;
    const line: SaleLine = { label, qty, unitPrice };
    const productId = text(r.productId, 80);
    if (productId) line.productId = productId;
    lines.push(line);
  }
  return lines;
}

/**
 * Read a journal line back WITHOUT repairing it. A line is either kept as it
 * is on disk (so its hash can be checked) or refused as unreadable. Nothing is
 * trimmed or defaulted here: a repaired line would hash differently and hide
 * exactly the edit the chain exists to show.
 */
export function normalizeEntry(raw: unknown): JournalEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.schema !== JOURNAL_SCHEMA) return null;
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(r.id)) return null;
  if (typeof r.seq !== 'number' || !Number.isInteger(r.seq) || r.seq < 1) return null;
  if (!isInstant(r.recordedAt)) return null;
  if (typeof r.prevHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.prevHash)) return null;
  if (typeof r.hash !== 'string' || !/^[0-9a-f]{64}$/.test(r.hash)) return null;

  if (r.kind === 'sale') {
    if (!isInstant(r.at) || !PLACES.includes(r.place as PlaceKind) || !PAYMENTS.includes(r.payment as Payment)) return null;
    if (typeof r.currency !== 'string' || !/^[A-Z]{3}$/.test(r.currency)) return null;
    const lines = readLines(r.lines);
    if (!lines) return null;
    if (r.marketId !== undefined && typeof r.marketId !== 'string') return null;
    if (r.clientId !== undefined && typeof r.clientId !== 'string') return null;
    return raw as SaleEntry;
  }
  if (r.kind === 'void') {
    if (typeof r.voids !== 'string' || !r.voids) return null;
    if (r.reason !== undefined && typeof r.reason !== 'string') return null;
    return raw as VoidEntry;
  }
  return null;
}

export type ChainBreak = 'GAP' | 'DUPLICATE' | 'LINK' | 'HASH';

export interface ChainCheck {
  /** Sorted by seq. */
  entries: JournalEntry[];
  /** Null when every line checks out. Otherwise the FIRST line where it does not. */
  broken: { seq: number; reason: ChainBreak } | null;
}

export function verifyJournal(entries: JournalEntry[]): ChainCheck {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  let prev = GENESIS_HASH;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (i > 0 && e.seq === sorted[i - 1].seq) return { entries: sorted, broken: { seq: e.seq, reason: 'DUPLICATE' } };
    if (e.seq !== i + 1) return { entries: sorted, broken: { seq: i + 1, reason: 'GAP' } };
    if (e.prevHash !== prev) return { entries: sorted, broken: { seq: e.seq, reason: 'LINK' } };
    if (hashOf(e) !== e.hash) return { entries: sorted, broken: { seq: e.seq, reason: 'HASH' } };
    prev = e.hash;
  }
  return { entries: sorted, broken: null };
}

/** Where the next line hooks on: after the highest seq, whatever the state of the chain. */
export function chainHead(entries: JournalEntry[]): { seq: number; hash: string } {
  const last = entries.reduce<JournalEntry | null>((acc, e) => (!acc || e.seq > acc.seq ? e : acc), null);
  return last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS_HASH };
}

export interface SaleDraft {
  at: string;
  place: PlaceKind;
  marketId?: string;
  lines: SaleLine[];
  payment: Payment;
  clientId?: string;
  currency: string;
}

export function buildSale(draft: SaleDraft, head: { seq: number; hash: string }, now: Date = new Date()): SaleEntry | null {
  const lines = readLines(draft.lines);
  if (!lines || !isInstant(draft.at)) return null;
  const entry: Omit<SaleEntry, 'hash'> = {
    schema: JOURNAL_SCHEMA,
    kind: 'sale',
    id: newId(),
    seq: head.seq + 1,
    recordedAt: now.toISOString(),
    prevHash: head.hash,
    at: draft.at,
    place: draft.place,
    ...(draft.place === 'market' && draft.marketId ? { marketId: draft.marketId } : {}),
    lines,
    payment: draft.payment,
    ...(draft.clientId ? { clientId: draft.clientId } : {}),
    currency: draft.currency,
  };
  return { ...entry, hash: hashOf(entry) } as SaleEntry;
}

export function buildVoid(saleId: string, reason: string, head: { seq: number; hash: string }, now: Date = new Date()): VoidEntry {
  const trimmed = reason.trim().slice(0, 300);
  const entry: Omit<VoidEntry, 'hash'> = {
    schema: JOURNAL_SCHEMA,
    kind: 'void',
    id: newId(),
    seq: head.seq + 1,
    recordedAt: now.toISOString(),
    prevHash: head.hash,
    voids: saleId,
    ...(trimmed ? { reason: trimmed } : {}),
  };
  return { ...entry, hash: hashOf(entry) } as VoidEntry;
}

export function saleTotal(sale: SaleEntry): number {
  return Math.round(sale.lines.reduce((acc, l) => acc + l.qty * l.unitPrice, 0) * 100) / 100;
}

/** Sale id → the void line that cancelled it. */
export function voidsBySale(entries: JournalEntry[]): Map<string, VoidEntry> {
  const map = new Map<string, VoidEntry>();
  for (const e of entries) if (e.kind === 'void' && !map.has(e.voids)) map.set(e.voids, e);
  return map;
}

export function activeSales(entries: JournalEntry[]): SaleEntry[] {
  const voided = voidsBySale(entries);
  return entries.filter((e): e is SaleEntry => e.kind === 'sale' && !voided.has(e.id));
}

export interface SalesSummary {
  count: number;
  total: number;
  byPayment: Record<Payment, number>;
}

export function summarize(sales: SaleEntry[]): SalesSummary {
  const byPayment: Record<Payment, number> = { cash: 0, card: 0, transfer: 0, other: 0 };
  let total = 0;
  for (const s of sales) {
    const t = saleTotal(s);
    total += t;
    byPayment[s.payment] = Math.round((byPayment[s.payment] + t) * 100) / 100;
  }
  return { count: sales.length, total: Math.round(total * 100) / 100, byPayment };
}

/**
 * What a sale (or its cancellation) does to the catalogue: series stock goes
 * down (up on a void), a unique piece becomes sold (available again on a
 * void). An untracked stock stays untracked. Returns only what changed.
 */
export function productEffects(products: Product[], sale: SaleEntry, direction: 'sell' | 'undo'): Product[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const changed = new Map<string, Product>();
  const now = new Date().toISOString();
  for (const line of sale.lines) {
    if (!line.productId) continue;
    const current = changed.get(line.productId) ?? byId.get(line.productId);
    if (!current) continue;
    if (current.kind === 'series') {
      if (current.stock === undefined) continue;
      const stock = direction === 'sell' ? Math.max(0, current.stock - line.qty) : current.stock + line.qty;
      if (stock !== current.stock) changed.set(current.id, { ...current, stock, updatedAt: now });
    } else if (direction === 'sell' && current.status !== 'sold') {
      changed.set(current.id, { ...current, status: 'sold', soldAt: sale.at, updatedAt: now });
    } else if (direction === 'undo' && current.status === 'sold') {
      const back: Product = { ...current, status: 'available', updatedAt: now };
      delete back.soldAt;
      changed.set(current.id, back);
    }
  }
  return [...changed.values()];
}
