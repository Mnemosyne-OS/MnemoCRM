/**
 * From a grid of cells to clients or products (doc 124 §14).
 *
 * The columns are GUESSED from their headers, in English, French and Spanish,
 * then shown to the person, who can change every guess before anything is
 * written. A guess is a proposal; the import is the person's.
 *
 * Nothing already in the book is overwritten: a row that matches an existing
 * client (same e-mail, or same name) is set aside and counted, never merged.
 * A cell that cannot be read (a price of "on request") leaves the field
 * ABSENT and is counted, never turned into 0.
 */
import { createClient, addTimelineEntry } from './client';
import { createProduct } from './product';
import type { Client, Product, ProductKind } from './types';

export type ImportTarget = 'clients' | 'products';

export type ClientField =
  | 'name' | 'firstName' | 'lastName' | 'company' | 'email' | 'phone'
  | 'address' | 'city' | 'zip' | 'source' | 'tags' | 'note';
export type ProductField = 'name' | 'price' | 'stock' | 'description' | 'tags';
export type Field = ClientField | ProductField | 'skip';

export const CLIENT_FIELDS: readonly ClientField[] = [
  'name', 'firstName', 'lastName', 'company', 'email', 'phone', 'address', 'city', 'zip', 'source', 'tags', 'note',
];
export const PRODUCT_FIELDS: readonly ProductField[] = ['name', 'price', 'stock', 'description', 'tags'];

/** Lowercase, no accents, no punctuation: "Téléphone portable" → "telephone portable". */
export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CLIENT_SYNONYMS: Record<ClientField, string[]> = {
  name: ['name', 'full name', 'nom complet', 'nombre completo', 'client', 'cliente', 'contact', 'customer', 'nom du client', 'display name'],
  firstName: ['first name', 'firstname', 'prenom', 'given name', 'nombre'],
  lastName: ['last name', 'lastname', 'surname', 'family name', 'nom', 'nom de famille', 'apellido', 'apellidos'],
  company: ['company', 'societe', 'entreprise', 'organisation', 'organization', 'empresa', 'raison sociale', 'business'],
  email: ['email', 'e mail', 'mail', 'courriel', 'correo', 'correo electronico', 'adresse email', 'adresse mail'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'portable', 'telefono', 'movil', 'gsm', 'numero', 'phone number'],
  address: ['address', 'adresse', 'direccion', 'rue', 'street', 'calle', 'adresse postale'],
  city: ['city', 'ville', 'ciudad', 'town', 'localidad'],
  zip: ['zip', 'postcode', 'postal code', 'code postal', 'cp', 'codigo postal', 'zip code'],
  source: ['source', 'origine', 'origen', 'canal', 'channel', 'provenance'],
  tags: ['tags', 'tag', 'etiquettes', 'etiquette', 'etiquetas', 'groupe', 'group', 'segment', 'labels'],
  note: ['note', 'notes', 'commentaire', 'commentaires', 'remarque', 'remarques', 'notas', 'comentarios', 'comment', 'comments', 'memo'],
};

const PRODUCT_SYNONYMS: Record<ProductField, string[]> = {
  name: ['name', 'nom', 'produit', 'product', 'article', 'designation', 'titre', 'title', 'nombre', 'producto', 'piece', 'item', 'libelle'],
  price: ['price', 'prix', 'tarif', 'precio', 'pvp', 'prix ttc', 'prix de vente', 'sale price', 'unit price', 'prix unitaire', 'montant'],
  stock: ['stock', 'quantite', 'qty', 'quantity', 'cantidad', 'inventaire', 'inventory', 'en stock', 'existencias'],
  description: ['description', 'details', 'descriptif', 'descripcion', 'detail', 'caracteristiques', 'materiau', 'material', 'dimensions'],
  tags: ['tags', 'categorie', 'category', 'collection', 'categoria', 'famille', 'type', 'gamme'],
};

/** One field per column, one column per field; exact synonyms first, then a header that CONTAINS one. */
export function guessMapping(headers: string[], target: ImportTarget): Field[] {
  const synonyms: Record<string, string[]> = target === 'clients' ? CLIENT_SYNONYMS : PRODUCT_SYNONYMS;
  const fields = Object.keys(synonyms);
  const out: Field[] = headers.map(() => 'skip');
  const taken = new Set<string>();
  const norm = headers.map(normalizeHeader);
  for (const pass of ['exact', 'contains'] as const) {
    norm.forEach((h, i) => {
      if (out[i] !== 'skip' || !h) return;
      const hit = fields.find(
        (f) =>
          !taken.has(f) &&
          synonyms[f].some((s) => (pass === 'exact' ? h === s : s.length >= 4 && (` ${h} `).includes(` ${s} `))),
      );
      if (hit) {
        out[i] = hit as Field;
        taken.add(hit);
      }
    });
  }
  // "Nom" alone (or "Nombre" alone) holds the whole name, not half of it.
  if (target === 'clients' && !out.includes('name')) {
    const hasFirst = out.includes('firstName');
    const hasLast = out.includes('lastName');
    if (hasLast && !hasFirst) out[out.indexOf('lastName')] = 'name';
    else if (hasFirst && !hasLast) out[out.indexOf('firstName')] = 'name';
  }
  return out;
}

/** A grid's first row looks like headers when none of its cells is a number or an e-mail. */
export function looksLikeHeader(row: string[]): boolean {
  return row.length > 0 && row.every((c) => c === '' || (!/^[\d\s.,€$£+-]+$/.test(c) && !c.includes('@')));
}

function cell(row: string[], mapping: Field[], field: Field): string | undefined {
  const i = mapping.indexOf(field);
  if (i < 0) return undefined;
  const v = (row[i] ?? '').trim();
  return v || undefined;
}

function splitTags(v: string | undefined): string[] {
  return v ? [...new Set(v.split(/[,;|]/).map((t) => t.trim()).filter(Boolean))].slice(0, 30) : [];
}

/**
 * A price from a cell. Spreadsheets hand back floats ("12.300000000000001")
 * and people type "12,50 €" or "1 200". Returns undefined for an empty cell
 * and null for one that is not a price.
 */
export function readPrice(raw: string | undefined): number | undefined | null {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[\s  €$£¥]/g, '').replace(/(eur|usd|ttc|ht)$/i, '');
  if (!cleaned) return undefined;
  let n: number;
  if (/^\d+(\.\d+)?$/.test(cleaned)) n = Number(cleaned);
  else if (/^\d+,\d{1,2}$/.test(cleaned)) n = Number(cleaned.replace(',', '.'));
  else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(cleaned)) n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(cleaned)) n = Number(cleaned.replace(/,/g, ''));
  else return null;
  if (!Number.isFinite(n) || n < 0) return null;
  const rounded = Math.round(n * 100) / 100;
  return Math.abs(rounded - n) < 1e-6 ? rounded : null;
}

function readStock(raw: string | undefined): number | undefined | null {
  if (!raw) return undefined;
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

const emailKey = (e?: string) => e?.trim().toLowerCase() || undefined;
const nameKey = (n?: string) => (n ? normalizeHeader(n) : undefined);

export interface ImportPlan<T> {
  /** What will be written, in file order. */
  create: T[];
  /** Rows set aside because the book (or an earlier row) already has them. */
  duplicates: number;
  /** Rows with no name: a record without a name cannot be found again. */
  noName: number;
  /** Rows beyond the free limit, not written. Zero when no limit applies. */
  overLimit: number;
  /** Cells that were not readable (a price of "on request"): the field was left absent. */
  unreadable: number;
}

export function planClients(
  rows: string[][],
  mapping: Field[],
  existing: Client[],
  room: number | null,
  sourceLabel: string,
  now: Date = new Date(),
): ImportPlan<Client> {
  const seenEmails = new Set(existing.map((c) => emailKey(c.email)).filter(Boolean));
  const seenNames = new Set(existing.map((c) => nameKey(c.name)));
  const plan: ImportPlan<Client> = { create: [], duplicates: 0, noName: 0, overLimit: 0, unreadable: 0 };
  for (const row of rows) {
    const first = cell(row, mapping, 'firstName');
    const last = cell(row, mapping, 'lastName');
    const company = cell(row, mapping, 'company');
    const person = cell(row, mapping, 'name') ?? ([first, last].filter(Boolean).join(' ') || undefined);
    const name = person ?? company;
    if (!name) {
      plan.noName++;
      continue;
    }
    const email = cell(row, mapping, 'email');
    const eKey = emailKey(email);
    const nKey = nameKey(name);
    if ((eKey && seenEmails.has(eKey)) || seenNames.has(nKey)) {
      plan.duplicates++;
      continue;
    }
    if (room !== null && plan.create.length >= room) {
      plan.overLimit++;
      continue;
    }
    const address = [cell(row, mapping, 'address'), [cell(row, mapping, 'zip'), cell(row, mapping, 'city')].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
    let client = createClient(
      {
        kind: person ? 'person' : 'company',
        name,
        ...(person && company ? { company } : {}),
        ...(email ? { email } : {}),
        ...(cell(row, mapping, 'phone') ? { phone: cell(row, mapping, 'phone') } : {}),
        ...(address ? { address } : {}),
        ...(cell(row, mapping, 'source') ? { source: cell(row, mapping, 'source') } : {}),
        tags: splitTags(cell(row, mapping, 'tags')),
      },
      now,
    );
    if (!client) {
      plan.noName++;
      continue;
    }
    const note = cell(row, mapping, 'note');
    if (note) client = addTimelineEntry(client, 'note', note, now, sourceLabel);
    if (eKey) seenEmails.add(eKey);
    seenNames.add(nKey);
    plan.create.push(client);
  }
  return plan;
}

/** Products carry their description as a free text field; kind is DECLARED for the whole file. */
export function planProducts(
  rows: string[][],
  mapping: Field[],
  existing: Product[],
  room: number | null,
  kind: ProductKind,
  now: Date = new Date(),
): ImportPlan<Product> {
  const seenNames = new Set(existing.map((p) => nameKey(p.name)));
  const plan: ImportPlan<Product> = { create: [], duplicates: 0, noName: 0, overLimit: 0, unreadable: 0 };
  for (const row of rows) {
    const name = cell(row, mapping, 'name');
    if (!name) {
      plan.noName++;
      continue;
    }
    const key = nameKey(name);
    if (seenNames.has(key)) {
      plan.duplicates++;
      continue;
    }
    if (room !== null && plan.create.length >= room) {
      plan.overLimit++;
      continue;
    }
    const price = readPrice(cell(row, mapping, 'price'));
    const stock = kind === 'series' ? readStock(cell(row, mapping, 'stock')) : undefined;
    if (price === null) plan.unreadable++;
    if (stock === null) plan.unreadable++;
    const description = cell(row, mapping, 'description');
    const product = createProduct(
      {
        name,
        kind,
        ...(typeof price === 'number' ? { price } : {}),
        ...(typeof stock === 'number' ? { stock } : {}),
        ...(description ? { description } : {}),
        tags: splitTags(cell(row, mapping, 'tags')),
      },
      now,
    );
    if (!product) {
      plan.noName++;
      continue;
    }
    seenNames.add(key);
    plan.create.push(product);
  }
  return plan;
}
