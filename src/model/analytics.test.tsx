import { render, screen } from '@testing-library/react';
import {
  headline,
  health,
  marketRows,
  niceCeiling,
  periodRange,
  pipeline,
  revenueSeries,
  salesBetween,
  topProducts,
} from './analytics';
import { buildSale, buildVoid, chainHead, type SaleDraft } from './journal';
import { buildDemoBook } from './demo';
import { starterSettings } from './deal';
import type { Deal, JournalEntry } from './types';
import { AnalyticsView } from '../components/AnalyticsView';

const TODAY = '2026-09-24';
const at = (day: string, hour = 12) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
};
function journalOf(sales: Partial<SaleDraft>[]): JournalEntry[] {
  const j: JournalEntry[] = [];
  for (const s of sales) {
    j.push(buildSale({ at: at(TODAY), place: 'workshop', lines: [{ label: 'x', qty: 1, unitPrice: 10 }], payment: 'cash', currency: 'EUR', ...s }, chainHead(j))!);
  }
  return j;
}

describe('periods', () => {
  it('30 days ends today, starts 29 days before, and compares with the 30 before', () => {
    const r = periodRange('30d', TODAY);
    expect(r).toMatchObject({ from: '2026-08-26', to: TODAY, previous: { from: '2026-07-27', to: '2026-08-25' }, bucket: 'day' });
  });

  it('"everything" starts at the first sale and has nothing before it', () => {
    const r = periodRange('all', TODAY, '2026-01-10');
    expect(r.from).toBe('2026-01-10');
    expect(r.previous).toBeNull();
    expect(r.bucket).toBe('month');
  });
});

describe('the series', () => {
  it('fills the days with no sale with a measured zero, over the whole range', () => {
    const j = journalOf([{ at: at('2026-09-20') }, { at: at('2026-09-20') }, { at: at('2026-09-24') }]);
    const r = periodRange('30d', TODAY);
    const s = revenueSeries(salesBetween(j, r.from, r.to), r);
    expect(s).toHaveLength(30);
    expect(s.find((p) => p.start === '2026-09-20')).toEqual({ start: '2026-09-20', total: 20, count: 2 });
    expect(s.find((p) => p.start === '2026-09-21')!.total).toBe(0);
  });

  it('weeks start on Monday', () => {
    const j = journalOf([{ at: at('2026-09-24') }]); // a Thursday
    const r = periodRange('90d', TODAY);
    const s = revenueSeries(salesBetween(j, r.from, r.to), r);
    expect(s[s.length - 1]).toMatchObject({ start: '2026-09-21', total: 10 });
  });
});

describe('the headline', () => {
  it('no sale before = no delta (never "infinite growth"), no sale = no average', () => {
    const r = periodRange('30d', TODAY);
    expect(headline(journalOf([{}]), r)).toMatchObject({ revenue: 10, delta: null, basket: 10 });
    expect(headline([], r)).toMatchObject({ revenue: 0, count: 0, basket: null });
  });

  it('compares with the period before', () => {
    const r = periodRange('30d', TODAY);
    const j = journalOf([{ at: at('2026-08-01'), lines: [{ label: 'a', qty: 1, unitPrice: 50 }] }, { lines: [{ label: 'b', qty: 1, unitPrice: 75 }] }]);
    expect(headline(j, r).delta).toBeCloseTo(0.5);
  });

  it('a cancelled sale counts nowhere', () => {
    const j = journalOf([{}]);
    j.push(buildVoid(j[0].id, '', chainHead(j)));
    expect(headline(j, periodRange('30d', TODAY)).count).toBe(0);
  });
});

describe('rankings and pipeline', () => {
  it('groups free lines by label and counts units', () => {
    const j = journalOf([{ lines: [{ label: 'Emballage', qty: 2, unitPrice: 1 }, { label: 'emballage', qty: 1, unitPrice: 1 }] }]);
    expect(topProducts(salesBetween(j, '2026-01-01', TODAY), [])).toEqual([{ id: 'free:emballage', label: 'Emballage', revenue: 3, count: 3 }]);
  });

  it('marks a stage value as a floor when an amount is missing, and has no win rate before a deal closes', () => {
    const settings = starterSettings((id) => id);
    const deal = (id: string, over: Partial<Deal>): Deal => ({ schema: 1, id, title: id, stageId: 'quote', productIds: [], history: [], ...over });
    const p = pipeline([deal('a', { amount: 100 }), deal('b', {})], settings, '?');
    const quote = p.stages.find((s) => s.id === 'quote')!;
    expect(quote).toMatchObject({ count: 2, value: 100, partial: true });
    expect(p.winRate).toBeNull();
    const closed = pipeline([deal('w', { closed: { at: at(TODAY), outcome: 'won' } }), deal('l', { closed: { at: at(TODAY), outcome: 'lost' } }), deal('l2', { closed: { at: at(TODAY), outcome: 'lost' } })], settings, '?');
    expect(closed.winRate).toBeCloseTo(1 / 3);
  });

  it('clean axis tops', () => {
    expect([0, 7, 10, 11, 180, 2600].map(niceCeiling)).toEqual([1, 10, 10, 20, 200, 5000]);
  });
});

describe('health', () => {
  it('the cancel rate counts cancelled sales of the period over all sales written in it', () => {
    const j = journalOf([{}, {}, {}, {}]);
    j.push(buildVoid(j[1].id, 'twice', chainHead(j)));
    const h = health(j, periodRange('30d', TODAY), [], [], [], [], TODAY, false);
    expect(h.cancelRate).toBe(0.25);
    expect(h.cancelled).toBe(1);
    expect(h.cashGapTotal).toBeNull();
    expect(health([], periodRange('30d', TODAY), [], [], [], [], TODAY, false).cancelRate).toBeNull();
  });
});

describe('the Analyses tab on the demo book', () => {
  it('renders every section with real numbers, no crash', () => {
    const book = buildDemoBook('fr', TODAY, (id) => id);
    render(
      <AnalyticsView
        journal={{ entries: book.journal, broken: null }}
        clients={book.clients}
        deals={book.deals}
        products={book.products}
        markets={book.markets}
        settings={book.settings}
        today={TODAY}
        onOpenClient={() => {}}
      />,
    );
    // The markets table shows the demo's 5-short cash box.
    const rows = marketRows(book.markets, book.journal, book.products);
    expect(rows[1].cashGap).toBe(-5);
    expect(screen.getAllByRole('img').length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('Le Comptoir');
  });
});
