/**
 * Every key the code asks for exists in the three languages, and the three
 * files carry the same keys. A missing key renders its raw name on screen.
 */
import en from './en.json';
import fr from './fr.json';
import es from './es.json';

// Vite reads the sources as text: no Node types needed in the cartridge.
const SOURCES = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Keys built at runtime from a literal prefix, expanded to their real values. */
const DYNAMIC: Record<string, string[]> = {
  'kind.': ['person', 'company'],
  'consent.': ['unknown', 'yes', 'no'],
  'entry.': ['note', 'call', 'meeting', 'sale'],
  'stage.': ['request', 'quote', 'making', 'delivered', 'paid'],
  'stages.error.': ['STAGE_NOT_EMPTY', 'LAST_STAGE', 'TOO_MANY', 'EMPTY_LABEL'],
  'deal.outcome.': ['won', 'lost'],
  'product.kind.': ['unique', 'series'],
  'product.kindHint.': ['unique', 'series'],
  'product.status.': ['available', 'reserved', 'sold'],
  'product.to.': ['available', 'reserved', 'sold'],
  'catalog.filter.': ['forSale', 'sold', 'all'],
  'catalog.none.': ['forSale', 'sold', 'all'],
  'sale.place.': ['workshop', 'market', 'online', 'other'],
  'payment.': ['cash', 'card', 'transfer', 'other'],
  'journal.broken.': ['GAP', 'DUPLICATE', 'LINK', 'HASH'],
  'tax.notice.': ['vat', 'other'],
  'tax.choice.': ['franchise', 'vat', 'other'],
  'sales.view.': ['journal', 'markets'],
  'capture.dictation.': ['NO_ENGINE', 'MIC_BUSY', 'NO_SPEECH', 'PERMISSION_DENIED', 'other'],
  'settings.lang.': ['auto', 'fr', 'en', 'es'],
  'analytics.period.': ['30d', '90d', '12m', 'all'],
  'analytics.over.': ['day', 'week', 'month'],
  'license.title.': ['clients', 'products', 'pdf'],
  'license.body.': ['clients', 'products', 'pdf'],
  'import.target.': ['clients', 'products'],
  'import.room.': ['clients', 'products'],
  'import.kind.': ['series', 'unique'],
  'import.field.': ['skip', 'name', 'firstName', 'lastName', 'company', 'email', 'phone', 'address', 'city', 'zip', 'source', 'tags', 'note', 'price', 'stock', 'description'],
  'import.error.': ['NOT_TEXT', 'NOT_A_WORKBOOK', 'NOT_A_ZIP', 'BROKEN_ZIP', 'BROKEN_XML', 'EMPTY_FILE'],
};
const COUNTED = ['today.headline', 'clients.count', 'unreadable.notice', 'deal.closedCount', 'journal.intact', 'sales.count', 'market.uniques',
  'import.create.clients', 'import.create.products', 'import.duplicates', 'import.noName', 'import.unreadable', 'import.overLimit',
  'import.go.clients', 'import.go.products', 'import.written.clients', 'import.written.products', 'import.failed',
  'pdf.pages', 'pdf.cost', 'pdf.found', 'pdf.foundTotal', 'pdf.unread', 'pdf.skipped', 'pdf.photoFailed'];

function wanted(): Set<string> {
  const keys = new Set<string>();
  for (const code of Object.values(SOURCES)) {
    for (const m of code.matchAll(/\bt\(\s*'([^'`]+)'/g)) keys.add(m[1]);
  }
  for (const [prefix, values] of Object.entries(DYNAMIC)) values.forEach((v) => keys.add(prefix + v));
  for (const base of COUNTED) ['one', 'many'].forEach((n) => keys.add(`${base}.${n}`));
  return keys;
}

describe('locales', () => {
  const dicts = { en, fr, es } as Record<string, Record<string, string>>;

  it('finds the keys at all (the scan is not silently empty)', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(15);
    expect(wanted().size).toBeGreaterThan(100);
  });

  it.each(['en', 'fr', 'es'])('%s has every key the code uses', (lang) => {
    const missing = [...wanted()].filter((k) => !(k in dicts[lang]));
    expect(missing).toEqual([]);
  });

  it('the three files carry the same keys', () => {
    const base = Object.keys(en).sort();
    expect(Object.keys(fr).sort()).toEqual(base);
    expect(Object.keys(es).sort()).toEqual(base);
  });
});
