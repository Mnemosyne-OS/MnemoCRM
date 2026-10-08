/**
 * A demonstration book: a ceramicist's week, built around TODAY so every
 * screen has something to show (a late follow-up, one due today, a market
 * that happened, one coming, sales, a cancelled sale, a cash box that does not
 * match). Written in the book's language at creation.
 *
 * ⚠️ Demo data goes into its OWN empty folder, never into a real book: its
 * sales journal is chained like a real one, and a chain cannot be pruned.
 * The book carries `settings.demo`, so every screen can say it is not real.
 */
import { buildSale, buildVoid, chainHead, saleTotal } from './journal';
import { starterSettings } from './deal';
import {
  CLIENT_SCHEMA,
  DEAL_SCHEMA,
  MARKET_SCHEMA,
  PRODUCT_SCHEMA,
  type BookSettings,
  type Client,
  type Deal,
  type JournalEntry,
  type Market,
  type Payment,
  type Product,
  type SaleEntry,
} from './types';

export type DemoLang = 'en' | 'fr' | 'es';

export interface DemoBook {
  settings: BookSettings;
  clients: Client[];
  products: Product[];
  deals: Deal[];
  markets: Market[];
  journal: JournalEntry[];
}

type L = Record<DemoLang, string>;

function dayOffset(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** A local-looking instant on a given day (the demo only needs a plausible hour). */
function at(day: string, hour: number, minute = 0): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).toISOString();
}

const P: { id: string; emoji: string; name: L; kind: 'series' | 'unique'; price: number; stock?: number; tags: string[] }[] = [
  { id: 'p-bowl', emoji: '🥣', name: { en: 'Blue bowl', fr: 'Bol bleu', es: 'Cuenco azul' }, kind: 'series', price: 24, stock: 12, tags: ['bleu'] },
  { id: 'p-cup', emoji: '☕', name: { en: 'Espresso cup', fr: 'Tasse à expresso', es: 'Taza de café' }, kind: 'series', price: 14, stock: 3, tags: [] },
  { id: 'p-teapot', emoji: '🫖', name: { en: 'Speckled teapot', fr: 'Théière mouchetée', es: 'Tetera moteada' }, kind: 'unique', price: 95, tags: [] },
  { id: 'p-vase', emoji: '🏺', name: { en: 'Tall celadon vase', fr: 'Grand vase céladon', es: 'Jarrón celadón alto' }, kind: 'unique', price: 140, tags: [] },
  { id: 'p-plate', emoji: '🍽️', name: { en: 'Dinner plate', fr: 'Assiette plate', es: 'Plato llano' }, kind: 'series', price: 28, tags: [] },
  { id: 'p-candle', emoji: '🕯️', name: { en: 'Candle holder', fr: 'Bougeoir', es: 'Candelabro' }, kind: 'unique', price: 45, tags: [] },
  { id: 'p-pot', emoji: '🪴', name: { en: 'Plant pot', fr: 'Pot à plantes', es: 'Maceta' }, kind: 'series', price: 32, stock: 0, tags: [] },
  { id: 'p-mug', emoji: '🍵', name: { en: 'Stoneware mug', fr: 'Mug en grès', es: 'Taza de gres' }, kind: 'series', price: 22, stock: 8, tags: [] },
  { id: 'p-salad', emoji: '🥗', name: { en: 'Salad bowl', fr: 'Saladier', es: 'Ensaladera' }, kind: 'unique', price: 85, tags: [] },
  { id: 'p-dish', emoji: '🧂', name: { en: 'Small dish', fr: 'Coupelle', es: 'Cuenco pequeño' }, kind: 'series', price: 9, stock: 20, tags: [] },
];

const C: { id: string; name: string; company?: L; kind: 'person' | 'company'; source: L; tags: string[]; consent?: boolean; follow?: { days: number; note: L } }[] = [
  { id: 'c-paul', name: 'Paul Martin', company: { en: 'Moon Café', fr: 'Café Lune', es: 'Café Luna' }, kind: 'person', source: { en: 'Christmas market', fr: 'Marché de Noël', es: 'Mercado navideño' }, tags: ['café'], consent: true, follow: { days: -2, note: { en: 'Quote for 12 bowls', fr: 'Devis 12 bols', es: 'Presupuesto 12 cuencos' } } },
  { id: 'c-helene', name: 'Hélène Roux', kind: 'person', source: { en: 'Instagram', fr: 'Instagram', es: 'Instagram' }, tags: ['bleu'], consent: true, follow: { days: 0, note: { en: 'Is the teapot still free?', fr: 'La théière est-elle libre ?', es: '¿La tetera sigue libre?' } } },
  { id: 'c-comptoir', name: 'Le Comptoir', kind: 'company', source: { en: 'A friend', fr: 'Un ami', es: 'Un amigo' }, tags: ['restaurant'], consent: true, follow: { days: 3, note: { en: 'Tasting of the plates', fr: 'Essai des assiettes', es: 'Prueba de los platos' } } },
  { id: 'c-sofia', name: 'Sofía García', kind: 'person', source: { en: 'Spring fair', fr: 'Salon de printemps', es: 'Feria de primavera' }, tags: [], consent: false },
  { id: 'c-marc', name: 'Marc Petit', kind: 'person', source: { en: 'Workshop visit', fr: "Visite de l'atelier", es: 'Visita al taller' }, tags: [], follow: { days: 10, note: { en: 'Wedding list', fr: 'Liste de mariage', es: 'Lista de boda' } } },
  { id: 'c-sens', name: 'Atelier des Sens', kind: 'company', source: { en: 'Website', fr: 'Site web', es: 'Sitio web' }, tags: ['boutique'], consent: true },
  { id: 'c-julie', name: 'Julie Bernard', kind: 'person', source: { en: 'Christmas market', fr: 'Marché de Noël', es: 'Mercado navideño' }, tags: [], consent: true },
  { id: 'c-tom', name: 'Tom Weber', kind: 'person', source: { en: 'Instagram', fr: 'Instagram', es: 'Instagram' }, tags: ['sur mesure'] },
];

const NOTES: { client: string; days: number; kind: 'note' | 'call' | 'meeting' | 'sale'; text: L }[] = [
  { client: 'c-paul', days: -12, kind: 'meeting', text: { en: 'Met at the market. Wants 12 blue bowls for the café, matte inside.', fr: 'Rencontré au marché. Veut 12 bols bleus pour le café, intérieur mat.', es: 'Conocido en el mercado. Quiere 12 cuencos azules para el café, interior mate.' } },
  { client: 'c-paul', days: -5, kind: 'call', text: { en: 'Asked for a quote before the end of the month. Budget around 280.', fr: 'Demande un devis avant la fin du mois. Budget autour de 280.', es: 'Pide un presupuesto antes de fin de mes. Presupuesto de unos 280.' } },
  { client: 'c-helene', days: -3, kind: 'note', text: { en: 'Liked the speckled teapot on Instagram. Collects blue pieces.', fr: 'A aimé la théière mouchetée sur Instagram. Collectionne les pièces bleues.', es: 'Le gustó la tetera moteada en Instagram. Colecciona piezas azules.' } },
  { client: 'c-comptoir', days: -20, kind: 'meeting', text: { en: 'Chef wants 40 plates for the new menu. Visit to taste on them.', fr: 'Le chef veut 40 assiettes pour la nouvelle carte. Visite pour goûter dessus.', es: 'El chef quiere 40 platos para la nueva carta. Visita para probarlos.' } },
  { client: 'c-sofia', days: -40, kind: 'sale', text: { en: 'Bought two mugs. Does not want newsletters.', fr: 'A acheté deux mugs. Ne veut pas de lettre d’information.', es: 'Compró dos tazas. No quiere boletines.' } },
  { client: 'c-marc', days: -8, kind: 'call', text: { en: 'Getting married in June. Thinking of a wedding list of tableware.', fr: 'Se marie en juin. Pense à une liste de mariage en vaisselle.', es: 'Se casa en junio. Piensa en una lista de boda de vajilla.' } },
  { client: 'c-sens', days: -60, kind: 'note', text: { en: 'Shop in town, deposit-sale of 10 pieces possible.', fr: 'Boutique en ville, dépôt-vente de 10 pièces possible.', es: 'Tienda en el centro, posible venta en depósito de 10 piezas.' } },
  { client: 'c-tom', days: -1, kind: 'note', text: { en: 'Custom vase with his dog painted on it. Sent a photo.', fr: 'Vase sur mesure avec son chien peint dessus. A envoyé une photo.', es: 'Jarrón a medida con su perro pintado. Envió una foto.' } },
];

const D: { id: string; client: string; stage: number; amount?: number; title: L; step?: number; closed?: 'won' | 'lost'; products?: string[] }[] = [
  { id: 'd-cafe', client: 'c-paul', stage: 1, amount: 288, title: { en: '12 blue bowls for the café', fr: '12 bols bleus pour le café', es: '12 cuencos azules para el café' }, step: -2, products: ['p-bowl'] },
  { id: 'd-plates', client: 'c-comptoir', stage: 0, amount: 1120, title: { en: '40 plates, new menu', fr: '40 assiettes, nouvelle carte', es: '40 platos, nueva carta' }, step: 3, products: ['p-plate'] },
  { id: 'd-wedding', client: 'c-marc', stage: 0, title: { en: 'Wedding list', fr: 'Liste de mariage', es: 'Lista de boda' }, step: 10 },
  { id: 'd-dogvase', client: 'c-tom', stage: 2, amount: 180, title: { en: 'Custom vase, painted dog', fr: 'Vase sur mesure, chien peint', es: 'Jarrón a medida, perro pintado' } },
  { id: 'd-shop', client: 'c-sens', stage: 3, amount: 450, title: { en: 'Deposit-sale, 10 pieces', fr: 'Dépôt-vente, 10 pièces', es: 'Venta en depósito, 10 piezas' }, closed: 'won' },
  { id: 'd-lost', client: 'c-julie', stage: 1, amount: 60, title: { en: 'Set of 4 cups', fr: 'Lot de 4 tasses', es: 'Juego de 4 tazas' }, closed: 'lost' },
];

const M = {
  past: { en: 'Christmas market', fr: 'Marché de Noël', es: 'Mercado navideño' },
  pastPlace: { en: 'Town square', fr: 'Place de la mairie', es: 'Plaza del ayuntamiento' },
  next: { en: 'Spring craft fair', fr: 'Salon des métiers d’art', es: 'Feria de artesanía de primavera' },
  voidReason: { en: 'Typed twice', fr: 'Saisie en double', es: 'Anotada dos veces' },
};

const CURRENCY: Record<DemoLang, string> = { en: 'EUR', fr: 'EUR', es: 'EUR' };

/** mulberry32: a tiny seeded generator, so the demo is the same book every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildDemoBook(lang: DemoLang, today: string, stageLabel: (id: string) => string): DemoBook {
  const settings: BookSettings = { ...starterSettings(stageLabel, CURRENCY[lang]), taxStatus: 'franchise', demo: true };
  const stage = (i: number) => settings.stages[i].id;
  const created = at(dayOffset(today, -90), 9);

  const products: Product[] = P.map((p) => ({
    schema: PRODUCT_SCHEMA,
    id: p.id,
    name: p.name[lang],
    kind: p.kind,
    price: p.price,
    emoji: p.emoji,
    tags: [],
    ...(p.kind === 'series' ? (p.stock !== undefined ? { stock: p.stock } : {}) : { status: 'available' as const }),
    createdAt: created,
    updatedAt: created,
  }));
  const byId = new Map(products.map((p) => [p.id, p]));
  // The salad bowl is promised to someone: reserved, not sold.
  byId.get('p-salad')!.status = 'reserved';

  const clients: Client[] = C.map((c) => ({
    schema: CLIENT_SCHEMA,
    id: c.id,
    kind: c.kind,
    name: c.name,
    ...(c.company ? { company: c.company[lang] } : {}),
    source: c.source[lang],
    tags: [],
    ...(c.consent !== undefined ? { contactConsent: { value: c.consent, at: created } } : {}),
    ...(c.follow ? { followUp: { date: dayOffset(today, c.follow.days), note: c.follow.note[lang] } } : {}),
    timeline: NOTES.filter((n) => n.client === c.id).map((n, i) => ({
      id: `${c.id}-n${i}`,
      at: at(dayOffset(today, n.days), 10 + i),
      kind: n.kind,
      text: n.text[lang],
    })),
    createdAt: created,
    updatedAt: at(dayOffset(today, -1), 18),
  }));

  const deals: Deal[] = D.map((d) => ({
    schema: DEAL_SCHEMA,
    id: d.id,
    title: d.title[lang],
    clientId: d.client,
    stageId: stage(d.stage),
    ...(d.amount !== undefined ? { amount: d.amount } : {}),
    ...(d.step !== undefined ? { nextStep: { date: dayOffset(today, d.step) } } : {}),
    productIds: d.products ?? [],
    history: [],
    ...(d.closed ? { closed: { at: at(dayOffset(today, -15), 17), outcome: d.closed } } : {}),
    createdAt: created,
    updatedAt: at(dayOffset(today, -2), 12),
  }));

  const pastDay = dayOffset(today, -30);
  const markets: Market[] = [
    {
      schema: MARKET_SCHEMA,
      id: 'm-christmas',
      name: M.past[lang],
      place: M.pastPlace[lang],
      startDate: pastDay,
      endDate: dayOffset(today, -29),
      standFee: 60,
      createdAt: created,
      updatedAt: created,
    },
    {
      schema: MARKET_SCHEMA,
      id: 'm-spring',
      name: M.next[lang],
      startDate: dayOffset(today, 20),
      endDate: dayOffset(today, 22),
      standFee: 120,
      createdAt: created,
      updatedAt: created,
    },
  ];

  // The journal. Every sale is drafted first, then written through the real
  // chain in the order it happened, so the numbering reads like a real year.
  const line = (id: string, qty = 1) => ({ productId: id, label: byId.get(id)!.name, qty, unitPrice: byId.get(id)!.price! });
  type Draft = { when: string; place: 'market' | 'workshop' | 'online'; payment: Payment; lines: ReturnType<typeof line>[]; clientId?: string; twice?: boolean };
  const drafts: Draft[] = [
    { when: at(pastDay, 10), place: 'market', payment: 'cash', lines: [line('p-bowl', 2)] },
    { when: at(pastDay, 11), place: 'market', payment: 'card', lines: [line('p-vase')] },
    { when: at(pastDay, 11, 30), place: 'market', payment: 'cash', lines: [line('p-cup', 2), line('p-dish', 3)] },
    { when: at(pastDay, 14), place: 'market', payment: 'cash', lines: [line('p-mug')], twice: true },
    { when: at(pastDay, 15), place: 'market', payment: 'transfer', lines: [line('p-candle')], clientId: 'c-julie' },
    { when: at(dayOffset(today, -29), 10), place: 'market', payment: 'cash', lines: [line('p-bowl', 3)] },
    { when: at(dayOffset(today, -29), 16), place: 'market', payment: 'card', lines: [line('p-mug', 2), line('p-dish', 2)] },
    { when: at(dayOffset(today, -6), 15), place: 'workshop', payment: 'card', lines: [line('p-plate', 4)], clientId: 'c-comptoir' },
    { when: at(dayOffset(today, -2), 11), place: 'workshop', payment: 'cash', lines: [line('p-bowl')] },
  ];
  // A year of ordinary sales at the workshop and online, drawn from a SEEDED
  // generator: the same book every time, so a screenshot or a test can rely on it.
  const random = seeded(20260924);
  const everyday = ['p-bowl', 'p-cup', 'p-plate', 'p-mug', 'p-dish'];
  const regulars = ['c-paul', 'c-helene', 'c-comptoir', 'c-sens', 'c-marc', 'c-tom'];
  for (let back = 360; back >= 8; back -= 1 + Math.floor(random() * 6)) {
    const season = 1 + 0.6 * Math.sin(((360 - back) / 365) * Math.PI * 2);
    const n = Math.max(1, Math.round(random() * 2 * season));
    const lines = Array.from({ length: n }, () => line(everyday[Math.floor(random() * everyday.length)], 1 + Math.floor(random() * 3)));
    const online = random() < 0.35;
    drafts.push({
      when: at(dayOffset(today, -back), 9 + Math.floor(random() * 9)),
      place: online ? 'online' : 'workshop',
      payment: online ? 'card' : (['cash', 'card', 'transfer'] as const)[Math.floor(random() * 3)],
      lines,
      ...(random() < 0.55 ? { clientId: regulars[Math.floor(random() * regulars.length)] } : {}),
    });
  }
  drafts.sort((a, b) => a.when.localeCompare(b.when));

  const journal: JournalEntry[] = [];
  let twice: SaleEntry | null = null;
  for (const d of drafts) {
    const entry = buildSale(
      { at: d.when, place: d.place, ...(d.place === 'market' ? { marketId: 'm-christmas' } : {}), lines: d.lines, payment: d.payment, ...(d.clientId ? { clientId: d.clientId } : {}), currency: settings.currency },
      chainHead(journal),
      new Date(Date.parse(d.when) + 60_000),
    )!;
    journal.push(entry);
    if (d.twice) {
      // One sale typed twice, cancelled at once: the journal keeps both lines and says so.
      twice = entry;
      journal.push(buildVoid(entry.id, M.voidReason[lang], chainHead(journal), new Date(Date.parse(d.when) + 120_000)));
    }
  }

  // Unique pieces that left carry the day they left.
  for (const e of journal) {
    if (e.kind !== 'sale' || journal.some((v) => v.kind === 'void' && v.voids === e.id)) continue;
    for (const l of e.lines) {
      const p = l.productId ? byId.get(l.productId) : undefined;
      if (p?.kind === 'unique') {
        p.status = 'sold';
        p.soldAt = e.at;
      }
    }
  }

  // The cash box of the market was counted 5 short: the report shows a gap to explain.
  const cashAtMarket = journal
    .filter((e): e is SaleEntry => e.kind === 'sale' && e.place === 'market' && e.payment === 'cash' && e.id !== twice?.id)
    .reduce((acc, s) => acc + saleTotal(s), 0);
  markets[0].cashCount = { amount: Math.round((cashAtMarket - 5) * 100) / 100, at: at(dayOffset(today, -29), 19) };

  return { settings, clients, products, deals, markets, journal };
}
