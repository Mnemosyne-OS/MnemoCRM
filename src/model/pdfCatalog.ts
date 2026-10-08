/**
 * A catalogue PDF into products (doc 124 §14), with the host's engines:
 * the PDF renderer draws each page, a model that can SEE reads it and says
 * where each product's picture sits, and the picture is cut out of the page.
 * The pictures land in MnemoCRM's own vault, where the image memory (Theia)
 * indexes them.
 *
 * What the model says is a PROPOSAL, checked here before the person sees it:
 * - a name is required, and is kept as printed;
 * - a price the page does not print stays ABSENT, never 0;
 * - a picture box outside the page, or too small to be a picture, is dropped
 *   (the product stays, without a photo) — a wrong crop is worse than none.
 * Nothing is written until the person ticks what to keep and presses one button.
 */
import { extractJson } from './proposal';

/** One inference per page: a long brochure is refused past this, and the screen says how many pages were left. */
export const MAX_PDF_PAGES = 30;

/** A box as fractions of the page: left, top, right, bottom, each in [0, 1]. */
export type Box = [number, number, number, number];

export interface CatalogItem {
  name: string;
  price?: number;
  description?: string;
  box?: Box;
  /** 1-based page the item was read on. */
  page: number;
}

export function pagePrompt(page: number, pages: number, currency: string): string {
  return [
    `This image is page ${page} of ${pages} of a product catalogue.`,
    'List every product shown on this page. Answer with JSON only, no prose:',
    '{"products":[{"name":"…","price":12.5,"description":"…","box":[0.1,0.2,0.45,0.6]}]}',
    'Rules:',
    '- name: exactly as printed. Skip anything that is not a product (titles, contact details, prices lists without a product).',
    `- price: a number in ${currency} units if the page prints one for this product, otherwise null. Never guess a price.`,
    '- description: material, size, colour or any detail printed for this product, in the language of the page; null if none.',
    '- box: the region of THIS product\'s photo, as fractions of the page width and height [left, top, right, bottom]; null if the product has no photo.',
    'If the page shows no product, answer {"products":[]}.',
  ].join('\n');
}

/** When the model cannot see images: names, prices and details from the text only, no photos. */
export function textPrompt(text: string, currency: string): string {
  return [
    'Below is the text of a product catalogue. List every product it describes. Answer with JSON only, no prose:',
    '{"products":[{"name":"…","price":12.5,"description":"…"}]}',
    `- price: a number in ${currency} units if printed for this product, otherwise null. Never guess.`,
    '- description: material, size or details printed for it; null if none.',
    '---',
    text.slice(0, 24_000),
  ].join('\n');
}

const MIN_SIDE = 0.03;

export function readBox(value: unknown): Box | undefined {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  const [l, t, r, b] = value as number[];
  // A little slack for a model that rounds to the edge; anything further out is not on the page.
  if ([l, t, r, b].some((n) => n < -0.02 || n > 1.02)) return undefined;
  const box: Box = [Math.max(0, l), Math.max(0, t), Math.min(1, r), Math.min(1, b)];
  if (box[2] - box[0] < MIN_SIDE || box[3] - box[1] < MIN_SIDE) return undefined;
  return box;
}

export interface PageRead {
  items: CatalogItem[];
  /** Entries the model returned that were not products we could keep (no name). */
  dropped: number;
  /** False when the answer was not the JSON we asked for. */
  readable: boolean;
}

export function parseCatalogAnswer(raw: string, page: number): PageRead {
  const json = extractJson(raw) as { products?: unknown } | null;
  if (!json || !Array.isArray(json.products)) return { items: [], dropped: 0, readable: false };
  const items: CatalogItem[] = [];
  let dropped = 0;
  for (const p of json.products) {
    const r = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 200) : '';
    if (!name) {
      dropped++;
      continue;
    }
    const item: CatalogItem = { name, page };
    if (typeof r.price === 'number' && Number.isFinite(r.price) && r.price >= 0) item.price = Math.round(r.price * 100) / 100;
    if (typeof r.description === 'string' && r.description.trim()) item.description = r.description.trim().slice(0, 2000);
    const box = readBox(r.box);
    if (box) item.box = box;
    items.push(item);
  }
  return { items, dropped, readable: true };
}

/** The same product read twice (a page repeated, a price list after the photos): keep the first, fill its gaps. */
export function mergeItems(items: CatalogItem[]): CatalogItem[] {
  const byName = new Map<string, CatalogItem>();
  for (const it of items) {
    const key = it.name.toLowerCase().replace(/\s+/g, ' ');
    const seen = byName.get(key);
    if (!seen) byName.set(key, { ...it });
    else {
      if (seen.price === undefined && it.price !== undefined) seen.price = it.price;
      if (!seen.description && it.description) seen.description = it.description;
      if (!seen.box && it.box) {
        seen.box = it.box;
        seen.page = it.page;
      }
    }
  }
  return [...byName.values()];
}

/** A file name for a cut-out picture: readable, short, never a path. */
export function photoName(name: string, id: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'piece'}-${id.slice(0, 8)}.jpg`;
}
