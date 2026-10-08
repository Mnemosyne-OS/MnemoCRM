import { buildDemoBook, type DemoLang } from './demo';
import { normalizeClient } from './client';
import { normalizeDeal, normalizeSettings } from './deal';
import { isPictogram, normalizeProduct } from './product';
import { normalizeMarket, marketReport } from './market';
import { normalizeEntry, verifyJournal } from './journal';
import { planDay } from './day';
import { isEmptyBookFolder, loadRecords, readSettings, writeDemoBook, type FolderIO, JOURNAL_DIR } from '../data/folderStore';

const TODAY = '2026-09-24';
/** A record as it comes back from a file. */
const disk = (x: unknown): unknown => JSON.parse(JSON.stringify(x));

describe.each(['fr', 'en', 'es'] as DemoLang[])('the demo book in %s', (lang) => {
  const book = buildDemoBook(lang, TODAY, (id) => `stage-${id}`);

  it('is marked as a demo, with the starter stages and a declared VAT situation', () => {
    const s = normalizeSettings(disk(book.settings))!;
    expect(s.demo).toBe(true);
    expect(s.taxStatus).toBe('franchise');
    expect(s.stages.map((x) => x.label)).toContain('stage-quote');
  });

  it('every record survives the trip through a file and the same checks as a real one', () => {
    expect(book.clients.map((c) => normalizeClient(disk(c))).every(Boolean)).toBe(true);
    expect(book.products.map((p) => normalizeProduct(disk(p))).every(Boolean)).toBe(true);
    expect(book.deals.map((d) => normalizeDeal(disk(d))).every(Boolean)).toBe(true);
    expect(book.markets.map((m) => normalizeMarket(disk(m))).every(Boolean)).toBe(true);
    const entries = book.journal.map((e) => normalizeEntry(disk(e)));
    expect(entries.every(Boolean)).toBe(true);
    expect(verifyJournal(entries as NonNullable<(typeof entries)[number]>[]).broken).toBeNull();
  });

  it('has something on every screen: late, today, this week', () => {
    const plan = planDay(book.clients, book.deals, TODAY);
    expect(plan.overdue.length).toBeGreaterThan(0);
    expect(plan.today.length).toBeGreaterThan(0);
    expect(plan.soon.length).toBeGreaterThan(0);
  });

  it('shows a cancelled sale, sold unique pieces with their day, and a cash box 5 short', () => {
    expect(book.journal.filter((e) => e.kind === 'void')).toHaveLength(1);
    const sold = book.products.filter((p) => p.status === 'sold');
    expect(sold.length).toBeGreaterThan(0);
    expect(sold.every((p) => typeof p.soldAt === 'string')).toBe(true);
    const report = marketReport(book.markets[0], book.journal, book.products);
    expect(report.cashGap).toBe(-5);
    expect(report.net).not.toBeNull();
  });

  it('draws every product with a real pictogram, and no text is empty', () => {
    expect(book.products.every((p) => isPictogram(p.emoji))).toBe(true);
    const texts = [...book.products.map((p) => p.name), ...book.deals.map((d) => d.title), ...book.clients.flatMap((c) => c.timeline.map((e) => e.text))];
    expect(texts.every((x) => x.trim().length > 0)).toBe(true);
  });
});

describe('pictograms', () => {
  it('accepts an emoji, with a variation selector or a joiner', () => {
    for (const ok of ['🏺', '🍽️', '🕯️', '👩‍🎨']) expect(isPictogram(ok)).toBe(true);
  });

  it('refuses text, digits alone, and long strings', () => {
    for (const bad of ['a', 'vase', '1', '🏺 vase', '', '🏺'.repeat(9)]) expect(isPictogram(bad)).toBe(false);
  });
});

describe('writing a demo book', () => {
  function fakeDisk(initial: string[] = []) {
    const files = new Map<string, string>();
    const io: FolderIO = {
      async mkdir() {
        return { success: true };
      },
      async readDir(dirPath) {
        const prefix = `${dirPath}/`;
        const names = new Set<string>(initial);
        for (const p of files.keys()) if (p.startsWith(prefix)) names.add(p.slice(prefix.length).split('/')[0]);
        return {
          success: true,
          files: [...names].map((n) => ({ name: n, path: `${dirPath}/${n}`, isDirectory: !n.endsWith('.json') || [...files.keys()].some((k) => k.startsWith(`${dirPath}/${n}/`)) })),
        };
      },
      async readFile(p) {
        const c = files.get(p);
        return c === undefined ? { success: false } : { success: true, content: c };
      },
      async writeFile(p, c) {
        files.set(p, c);
        return { success: true };
      },
    };
    return { io, files };
  }

  it('refuses a folder that already holds a book', async () => {
    expect(await isEmptyBookFolder(fakeDisk(['clients']).io, '/home/a/crm')).toBe(false);
    expect(await isEmptyBookFolder(fakeDisk(['settings.json']).io, '/home/a/crm')).toBe(false);
    expect(await isEmptyBookFolder(fakeDisk(['photos', 'notes.txt']).io, '/home/a/crm')).toBe(true);
  });

  it('writes a book that loads back whole, chain intact', async () => {
    const { io } = fakeDisk();
    const book = buildDemoBook('fr', TODAY, (id) => id);
    await writeDemoBook(io, '/home/a/demo', book);
    const settings = await readSettings(io, '/home/a/demo');
    expect(settings.state).toBe('ok');
    const journal = await loadRecords(io, '/home/a/demo', JOURNAL_DIR, normalizeEntry);
    expect(journal.unreadable).toEqual([]);
    expect(verifyJournal(journal.records).broken).toBeNull();
    expect(journal.records).toHaveLength(book.journal.length);
  });
});
