/**
 * Markets (a Christmas market, a craft fair) and their end-of-day report
 * (doc 124 §6.3). The cash box is COUNTED by the person and compared with the
 * cash sales written down; the gap is shown, never resolved by the machine.
 */
import { isInstant, isValidDay, newId, text } from './client';
import { activeSales, summarize, type SalesSummary } from './journal';
import { MARKET_SCHEMA, type JournalEntry, type Market, type Product, type SaleEntry } from './types';

function readMoney(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
}

export function normalizeMarket(raw: unknown): Market | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 80);
  const name = text(r.name);
  if (!id || !name || !isValidDay(r.startDate)) return null;
  const market: Market = { schema: MARKET_SCHEMA, id, name, startDate: r.startDate };
  const place = text(r.place);
  if (place) market.place = place;
  if (isValidDay(r.endDate) && r.endDate >= r.startDate) market.endDate = r.endDate;
  const fee = readMoney(r.standFee);
  if (fee !== undefined) market.standFee = fee;
  if (r.cashCount && typeof r.cashCount === 'object') {
    const c = r.cashCount as Record<string, unknown>;
    const amount = readMoney(c.amount);
    if (amount !== undefined && isInstant(c.at)) market.cashCount = { amount, at: c.at };
  }
  if (isInstant(r.createdAt)) market.createdAt = r.createdAt;
  if (isInstant(r.updatedAt)) market.updatedAt = r.updatedAt;
  return market;
}

export interface MarketDraft {
  name: string;
  place?: string;
  startDate: string;
  endDate?: string;
  standFee?: number;
}

export function createMarket(draft: MarketDraft, now: Date = new Date()): Market | null {
  const iso = now.toISOString();
  return normalizeMarket({ ...draft, id: newId(), createdAt: iso, updatedAt: iso });
}

/** The market whose dates cover `day`, most recent first. Used to preselect it in a new sale. */
export function marketOn(markets: Market[], day: string): Market | undefined {
  return [...markets]
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .find((m) => day >= m.startDate && day <= (m.endDate ?? m.startDate));
}

export interface MarketReport {
  sales: SaleEntry[];
  summary: SalesSummary;
  /** Unique pieces that left at this market. */
  uniquesSold: Product[];
  /** Total minus stand fee; null when the fee was never typed (never assumed 0). */
  net: number | null;
  /** Counted cash minus cash sales; null until the person counts. Positive = more in the box than written. */
  cashGap: number | null;
}

export function marketReport(market: Market, entries: JournalEntry[], products: Product[]): MarketReport {
  const sales = activeSales(entries).filter((s) => s.place === 'market' && s.marketId === market.id);
  const summary = summarize(sales);
  const productById = new Map(products.map((p) => [p.id, p]));
  const uniqueIds = new Set(
    sales.flatMap((s) => s.lines.map((l) => l.productId)).filter((id): id is string => !!id && productById.get(id)?.kind === 'unique'),
  );
  return {
    sales,
    summary,
    uniquesSold: [...uniqueIds].map((id) => productById.get(id)!),
    net: market.standFee === undefined ? null : Math.round((summary.total - market.standFee) * 100) / 100,
    cashGap: market.cashCount ? Math.round((market.cashCount.amount - summary.byPayment.cash) * 100) / 100 : null,
  };
}
