/**
 * The book on disk: one JSON file per record, in a folder the person chose
 * (doc 124 §4). The folder is the source of truth; nothing lives only in the
 * iframe's localStorage (the Archipel lesson, doc 124 §12).
 *
 * Layout:
 *   <root>/clients/<id>.json
 *   <root>/deals/<id>.json
 *   <root>/products/<id>.json
 *   <root>/journal/<id>.json   (append-only sales journal, chained by hash)
 *   <root>/markets/<id>.json
 *   <root>/settings.json
 *
 * ⚠️ The host's writeFile is a plain overwrite, not an atomic rename. A crash in
 * the middle of a save can leave a truncated file. Such a file is reported by
 * name on the next load (`unreadable`), never silently dropped.
 */
import { normalizeClient } from '../model/client';
import { normalizeSettings } from '../model/deal';
import type { BookSettings, Client } from '../model/types';

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/** The four host calls this store needs. Injected so tests run without a host. */
export interface FolderIO {
  mkdir(dirPath: string): Promise<{ success: boolean; error?: string }>;
  readDir(dirPath: string): Promise<{ success: boolean; files?: DirEntry[]; error?: string }>;
  readFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }>;
  writeFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }>;
}

export const CLIENTS_DIR = 'clients';
export const DEALS_DIR = 'deals';
export const PRODUCTS_DIR = 'products';
export const JOURNAL_DIR = 'journal';
export const MARKETS_DIR = 'markets';
export const SETTINGS_FILE = 'settings.json';

/** Join with the separator the root already uses, so a Windows path stays one. */
export function joinPath(root: string, ...parts: string[]): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const trimmed = root.replace(/[\\/]+$/, '');
  return [trimmed, ...parts].join(sep);
}

/** Only a plain id may become a file name: no separators, no dots, no traversal. */
export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(id);
}

export class StoreError extends Error {
  constructor(
    public readonly code: 'MKDIR_FAILED' | 'LIST_FAILED' | 'WRITE_FAILED' | 'BAD_ID' | 'SETTINGS_UNREADABLE',
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'StoreError';
  }
}

export interface LoadResult<T> {
  records: T[];
  /** File names that exist but could not be read as a record. Shown to the person. */
  unreadable: string[];
}

/** Read every `<dir>/*.json` through `normalize`. A listing failure is an ERROR, never an empty result. */
export async function loadRecords<T extends { id: string }>(
  io: FolderIO,
  root: string,
  dir: string,
  normalize: (raw: unknown) => T | null,
): Promise<LoadResult<T>> {
  const path = joinPath(root, dir);
  const made = await io.mkdir(path);
  if (!made.success) throw new StoreError('MKDIR_FAILED', made.error);

  const listed = await io.readDir(path);
  if (!listed.success) throw new StoreError('LIST_FAILED', listed.error);

  const files = (listed.files ?? []).filter((f) => !f.isDirectory && f.name.toLowerCase().endsWith('.json'));
  const results = await Promise.all(
    files.map(async (file) => {
      try {
        const read = await io.readFile(file.path);
        if (!read.success || typeof read.content !== 'string') return { file, record: null };
        return { file, record: normalize(JSON.parse(read.content)) };
      } catch (err) {
        console.warn(`[mnemo-crm] could not read ${dir}/${file.name}:`, err);
        return { file, record: null };
      }
    }),
  );

  const records: T[] = [];
  const unreadable: string[] = [];
  const seen = new Set<string>();
  for (const { file, record } of results) {
    // Two files claiming the same id would make edits land in one and vanish
    // from the other; the second is reported instead of merged.
    if (!record || seen.has(record.id)) {
      unreadable.push(`${dir}/${file.name}`);
      continue;
    }
    seen.add(record.id);
    records.push(record);
  }
  unreadable.sort();
  return { records, unreadable };
}

export async function saveRecord(io: FolderIO, root: string, dir: string, record: { id: string }): Promise<void> {
  if (!isSafeId(record.id)) throw new StoreError('BAD_ID', record.id);
  const path = joinPath(root, dir);
  const made = await io.mkdir(path);
  if (!made.success) throw new StoreError('MKDIR_FAILED', made.error);
  const written = await io.writeFile(joinPath(path, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  if (!written.success) throw new StoreError('WRITE_FAILED', written.error);
}

// ── Clients (kept as named helpers: lot 0 callers and tests) ──────────────

export async function loadClients(io: FolderIO, root: string): Promise<{ clients: Client[]; unreadable: string[] }> {
  const { records, unreadable } = await loadRecords(io, root, CLIENTS_DIR, normalizeClient);
  return { clients: records, unreadable };
}

export function saveClient(io: FolderIO, root: string, client: Client): Promise<void> {
  return saveRecord(io, root, CLIENTS_DIR, client);
}

// ── Settings: three states, never two ─────────────────────────────────────

export type SettingsRead =
  | { state: 'absent' }
  | { state: 'ok'; settings: BookSettings }
  /** The file exists and is not settings. It is LEFT INTACT: never overwritten by defaults. */
  | { state: 'unreadable' };

export async function readSettings(io: FolderIO, root: string): Promise<SettingsRead> {
  const path = joinPath(root, SETTINGS_FILE);
  const listed = await io.readDir(root.replace(/[\\/]+$/, ''));
  if (!listed.success) throw new StoreError('LIST_FAILED', listed.error);
  const exists = (listed.files ?? []).some((f) => !f.isDirectory && f.name === SETTINGS_FILE);
  if (!exists) return { state: 'absent' };
  const read = await io.readFile(path);
  if (!read.success || typeof read.content !== 'string') return { state: 'unreadable' };
  try {
    const settings = normalizeSettings(JSON.parse(read.content));
    return settings ? { state: 'ok', settings } : { state: 'unreadable' };
  } catch (err) {
    console.warn('[mnemo-crm] settings.json is not valid JSON:', err);
    return { state: 'unreadable' };
  }
}

export async function writeSettings(io: FolderIO, root: string, settings: BookSettings): Promise<void> {
  const written = await io.writeFile(joinPath(root, SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`);
  if (!written.success) throw new StoreError('WRITE_FAILED', written.error);
}

// ── Demo book ─────────────────────────────────────────────────────────────

const BOOK_NAMES = new Set([SETTINGS_FILE, CLIENTS_DIR, DEALS_DIR, PRODUCTS_DIR, JOURNAL_DIR, MARKETS_DIR]);

/** True when the folder holds no book at all. A folder that cannot be listed is an ERROR, never "empty". */
export async function isEmptyBookFolder(io: FolderIO, root: string): Promise<boolean> {
  const listed = await io.readDir(root.replace(/[\\/]+$/, ''));
  if (!listed.success) throw new StoreError('LIST_FAILED', listed.error);
  return !(listed.files ?? []).some((f) => BOOK_NAMES.has(f.name));
}

export interface DemoRecords {
  settings: BookSettings;
  clients: { id: string }[];
  products: { id: string }[];
  deals: { id: string }[];
  markets: { id: string }[];
  journal: { id: string }[];
}

/** Writes a whole demo book. Journal lines first-to-last, so a crash leaves a shorter chain, never a holed one. */
export async function writeDemoBook(io: FolderIO, root: string, book: DemoRecords, onProgress?: (done: number, total: number) => void): Promise<void> {
  const jobs: [string, { id: string }][] = [
    ...book.clients.map((r) => [CLIENTS_DIR, r] as [string, { id: string }]),
    ...book.products.map((r) => [PRODUCTS_DIR, r] as [string, { id: string }]),
    ...book.deals.map((r) => [DEALS_DIR, r] as [string, { id: string }]),
    ...book.markets.map((r) => [MARKETS_DIR, r] as [string, { id: string }]),
    ...book.journal.map((r) => [JOURNAL_DIR, r] as [string, { id: string }]),
  ];
  const total = jobs.length + 1;
  await writeSettings(io, root, book.settings);
  onProgress?.(1, total);
  for (let i = 0; i < jobs.length; i++) {
    await saveRecord(io, root, jobs[i][0], jobs[i][1]);
    onProgress?.(i + 2, total);
  }
}
