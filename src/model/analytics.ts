/**
 * The numbers behind the Analyses tab. Pure: every figure on that screen is
 * computed here, from the same records the other screens read, so a chart can
 * never say something the journal does not.
 *
 * Absent is not zero, with one deliberate exception: a day inside the period
 * with no sale IS a measured zero, because the sales journal is the complete
 * record of sales. A ratio whose denominator is zero is null (shown as a dash),
 * never 0 % and never "infinite growth".
 */
import { daysBetween, localDay } from './client';
import { activeSales, saleTotal, voidsBySale } from './journal';
import { marketReport } from './market';
import type { BookSettings, Client, Deal, JournalEntry, Market, Payment, PlaceKind, Product, SaleEntry } from './types';

export type Period = '30d' | '90d' | '12m' | 'all';
export type Bucket = 'day' | 'week' | 'month';

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface Range {
  from: string;
  to: string;
  /** The period just before, same length. Null for "all": there is nothing before everything. */
  previous: { from: string; to: string } | null;
  bucket: Bucket;
}

export function periodRange(period: Period, today: string, firstSaleDay?: string): Range {
  if (period === 'all') {
    const from = firstSaleDay && firstSaleDay < today ? firstSaleDay : today;
    const span = daysBetween(from, today);
    return { from, to: today, previous: null, bucket: span > 120 ? 'month' : span > 31 ? 'week' : 'day' };
  }
  const days = period === '30d' ? 30 : period === '90d' ? 90 : 365;
  const from = addDays(today, -(days - 1));
  return {
    from,
    to: today,
    previous: { from: addDays(from, -days), to: addDays(from, -1) },
    bucket: period === '30d' ? 'day' : period === '90d' ? 'week' : 'month',
  };
}

/** The local calendar day a sale happened. */
export function saleDay(sale: SaleEntry): string {
  return localDay(new Date(sale.at));
}

export function salesBetween(entries: JournalEntry[], from: string, to: string): SaleEntry[] {
  return activeSales(entries).filter((s) => {
    const d = saleDay(s);
    return d >= from && d <= to;
  });
}

/** Monday of the day's ISO week. */
function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

function bucketKey(day: string, bucket: Bucket): string {
  if (bucket === 'day') return day;
  if (bucket === 'week') return weekStart(day);
  return `${day.slice(0, 7)}-01`;
}

function nextBucket(key: string, bucket: Bucket): string {
  if (bucket === 'day') return addDays(key, 1);
  if (bucket === 'week') return addDays(key, 7);
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

export interface Point {
  /** First day of the bucket. */
  start: string;
  total: number;
  count: number;
}

/** Revenue per bucket across the WHOLE range, empty buckets included (a measured zero). */
export function revenueSeries(sales: SaleEntry[], range: Range): Point[] {
  const sums = new Map<string, Point>();
  for (const s of sales) {
    const key = bucketKey(saleDay(s), range.bucket);
    const p = sums.get(key) ?? { start: key, total: 0, count: 0 };
    p.total = Math.round((p.total + saleTotal(s)) * 100) / 100;
    p.count += 1;
    sums.set(key, p);
  }
  const out: Point[] = [];
  const last = bucketKey(range.to, range.bucket);
  for (let key = bucketKey(range.from, range.bucket), guard = 0; key <= last && guard < 800; key = nextBucket(key, range.bucket), guard++) {
    out.push(sums.get(key) ?? { start: key, total: 0, count: 0 });
  }
  return out;
}

export interface Headline {
  revenue: number;
  count: number;
  /** Null when there is no sale: an average of nothing is not 0. */
  basket: number | null;
  /** Relative change vs the previous period; null when there is no previous period or it had no revenue. */
  delta: number | null;
  previousRevenue: number | null;
}

export function headline(entries: JournalEntry[], range: Range): Headline {
  const cur = salesBetween(entries, range.from, range.to);
  const revenue = Math.round(cur.reduce((a, s) => a + saleTotal(s), 0) * 100) / 100;
  const prevSales = range.previous ? salesBetween(entries, range.previous.from, range.previous.to) : null;
  const previousRevenue = prevSales ? Math.round(prevSales.reduce((a, s) => a + saleTotal(s), 0) * 100) / 100 : null;
  return {
    revenue,
    count: cur.length,
    basket: cur.length > 0 ? Math.round((revenue / cur.length) * 100) / 100 : null,
    delta: previousRevenue ? (revenue - previousRevenue) / previousRevenue : null,
    previousRevenue,
  };
}

export interface Ranked {
  id: string;
  label: string;
  emoji?: string;
  revenue: number;
  /** Sales for a client, units for a product. */
  count: number;
}

export function topClients(sales: SaleEntry[], clients: Client[], n = 5): Ranked[] {
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const acc = new Map<string, Ranked>();
  for (const s of sales) {
    if (!s.clientId) continue;
    const r = acc.get(s.clientId) ?? { id: s.clientId, label: names.get(s.clientId) ?? '—', revenue: 0, count: 0 };
    r.revenue = Math.round((r.revenue + saleTotal(s)) * 100) / 100;
    r.count += 1;
    acc.set(s.clientId, r);
  }
  return [...acc.values()].sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label)).slice(0, n);
}

/** Free lines (no product) are grouped under their label, so "Gift wrapping" still counts. */
export function topProducts(sales: SaleEntry[], products: Product[], n = 6): Ranked[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const acc = new Map<string, Ranked>();
  for (const s of sales) {
    for (const l of s.lines) {
      const key = l.productId ?? `free:${l.label.toLowerCase()}`;
      const p = l.productId ? byId.get(l.productId) : undefined;
      const r = acc.get(key) ?? { id: key, label: p?.name ?? l.label, ...(p?.emoji ? { emoji: p.emoji } : {}), revenue: 0, count: 0 };
      r.revenue = Math.round((r.revenue + l.qty * l.unitPrice) * 100) / 100;
      r.count += l.qty;
      acc.set(key, r);
    }
  }
  return [...acc.values()].sort((a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label)).slice(0, n);
}

export function splitBy<K extends string>(sales: SaleEntry[], keyOf: (s: SaleEntry) => K, keys: readonly K[]): { key: K; revenue: number; count: number }[] {
  return keys.map((key) => {
    const mine = sales.filter((s) => keyOf(s) === key);
    return { key, revenue: Math.round(mine.reduce((a, s) => a + saleTotal(s), 0) * 100) / 100, count: mine.length };
  });
}

export const PLACES: readonly PlaceKind[] = ['workshop', 'market', 'online', 'other'];
export const PAYMENTS: readonly Payment[] = ['cash', 'card', 'transfer', 'other'];

export interface MarketRow {
  market: Market;
  revenue: number;
  count: number;
  net: number | null;
  cashGap: number | null;
}

export function marketRows(markets: Market[], entries: JournalEntry[], products: Product[]): MarketRow[] {
  return [...markets]
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .map((market) => {
      const r = marketReport(market, entries, products);
      return { market, revenue: r.summary.total, count: r.summary.count, net: r.net, cashGap: r.cashGap };
    });
}

export interface PipelineStage {
  id: string | null;
  label: string;
  count: number;
  value: number;
  /** Deals in this stage with no amount typed: the value is a floor. */
  partial: boolean;
}

export interface Pipeline {
  stages: PipelineStage[];
  won: number;
  lost: number;
  /** won / (won + lost); null when nothing was ever closed. */
  winRate: number | null;
}

export function pipeline(deals: Deal[], settings: BookSettings, unknownLabel: string): Pipeline {
  const open = deals.filter((d) => !d.closed);
  const known = new Set(settings.stages.map((s) => s.id));
  const stage = (id: string | null, label: string, list: Deal[]): PipelineStage => ({
    id,
    label,
    count: list.length,
    value: Math.round(list.reduce((a, d) => a + (d.amount ?? 0), 0) * 100) / 100,
    partial: list.some((d) => d.amount === undefined),
  });
  const stages = settings.stages.map((s) => stage(s.id, s.label, open.filter((d) => d.stageId === s.id)));
  const orphans = open.filter((d) => !known.has(d.stageId));
  if (orphans.length > 0) stages.push(stage(null, unknownLabel, orphans));
  const won = deals.filter((d) => d.closed?.outcome === 'won').length;
  const lost = deals.filter((d) => d.closed?.outcome === 'lost').length;
  return { stages, won, lost, winRate: won + lost > 0 ? won / (won + lost) : null };
}

export interface Health {
  /** Cancellation lines / sales written in the period. Null when no sale. */
  cancelRate: number | null;
  cancelled: number;
  /** Sum of |gap| over the markets whose box was counted. Null when none was. */
  cashGapTotal: number | null;
  countedMarkets: number;
  overdueFollowUps: number;
  openDealsWithoutStep: number;
  outOfStock: number;
  /** Share of sales with a known client. Null when no sale. */
  knownClientShare: number | null;
  journalBroken: boolean;
}

export function health(
  entries: JournalEntry[],
  range: Range,
  clients: Client[],
  deals: Deal[],
  products: Product[],
  markets: MarketRow[],
  today: string,
  journalBroken: boolean,
): Health {
  const inRange = entries.filter((e): e is SaleEntry => e.kind === 'sale' && saleDay(e) >= range.from && saleDay(e) <= range.to);
  const voided = voidsBySale(entries);
  const cancelled = inRange.filter((s) => voided.has(s.id)).length;
  const active = inRange.filter((s) => !voided.has(s.id));
  const counted = markets.filter((m) => m.cashGap !== null);
  return {
    cancelRate: inRange.length > 0 ? cancelled / inRange.length : null,
    cancelled,
    cashGapTotal: counted.length > 0 ? Math.round(counted.reduce((a, m) => a + Math.abs(m.cashGap!), 0) * 100) / 100 : null,
    countedMarkets: counted.length,
    overdueFollowUps: clients.filter((c) => c.followUp && c.followUp.date < today).length,
    openDealsWithoutStep: deals.filter((d) => !d.closed && !d.nextStep).length,
    outOfStock: products.filter((p) => p.kind === 'series' && p.stock === 0).length,
    knownClientShare: active.length > 0 ? active.filter((s) => s.clientId).length / active.length : null,
    journalBroken,
  };
}

/** A clean axis top above `max`: 1, 2, 2.5 or 5 times a power of ten. */
export function niceCeiling(max: number): number {
  if (!(max > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const f of [1, 2, 2.5, 5, 10]) if (f * pow >= max) return f * pow;
  return 10 * pow;
}

/** The first day anything was sold, for the "all" period. */
export function firstSaleDay(entries: JournalEntry[]): string | undefined {
  const days = activeSales(entries).map(saleDay).sort();
  return days[0];
}
