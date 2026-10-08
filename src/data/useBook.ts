/**
 * The whole book as React state: clients, deals, products and settings.
 *
 * The folder is the truth. A list on screen changes only after the host
 * REPORTED the write, so a refused save never shows a record that is not on
 * disk (rule 11: loading, error and data are three separate states).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CLIENTS_DIR,
  DEALS_DIR,
  JOURNAL_DIR,
  MARKETS_DIR,
  PRODUCTS_DIR,
  loadRecords,
  readSettings,
  saveRecord,
  writeSettings,
  type SettingsRead,
} from './folderStore';
import {
  hostIO,
  pickFolder,
  readMirroredFolder,
  readPreviousFolder,
  readRememberedFolder,
  rememberFolder,
  rememberLine,
  rememberPreviousFolder,
  readLicense,
  type LicenseWord,
} from './host';
import { mayCreate, productIsNewForSale, type Limited } from '../model/license';
import { isEmptyBookFolder, writeDemoBook } from './folderStore';
import type { DemoBook } from '../model/demo';
import { memoryLine, newEntries } from '../model/memory';
import { normalizeClient } from '../model/client';
import { normalizeDeal, starterSettings } from '../model/deal';
import { normalizeProduct } from '../model/product';
import { buildSale, buildVoid, chainHead, normalizeEntry, productEffects, verifyJournal, type ChainCheck, type SaleDraft } from '../model/journal';
import { normalizeMarket } from '../model/market';
import type { BookSettings, Client, Deal, JournalEntry, Market, Product, SaleEntry } from '../model/types';
import { translate } from '../i18n';

export type BookStatus =
  | { kind: 'booting' }
  | { kind: 'noFolder'; bridgeError?: string }
  | { kind: 'loading'; folder: string }
  | { kind: 'error'; folder: string; message: string }
  | { kind: 'ready'; folder: string };

type Collection = 'clients' | 'deals' | 'products' | 'markets';
const DIRS: Record<Collection, string> = { clients: CLIENTS_DIR, deals: DEALS_DIR, products: PRODUCTS_DIR, markets: MARKETS_DIR };

/** Where the memory stands. `off` = the person has not turned it on. */
export type MemoryState =
  | { kind: 'off' }
  | { kind: 'idle' }
  | { kind: 'sending'; done: number; total: number }
  | { kind: 'sent'; count: number; at: string }
  | { kind: 'failed'; error: string };

export type SaleOutcome =
  | { ok: true; entry: JournalEntry; stockProblem?: string }
  | { ok: false; error: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function upsertIn<T extends { id: string }>(list: T[], record: T): T[] {
  const i = list.findIndex((r) => r.id === record.id);
  if (i === -1) return [...list, record];
  const next = list.slice();
  next[i] = record;
  return next;
}

export function useBook() {
  const [status, setStatus] = useState<BookStatus>({ kind: 'booting' });
  const [clients, setClients] = useState<Client[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [journal, setJournal] = useState<ChainCheck>({ entries: [], broken: null });
  const [settingsRead, setSettingsRead] = useState<SettingsRead>({ state: 'absent' });
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [memory, setMemory] = useState<MemoryState>({ kind: 'idle' });
  const [saveError, setSaveError] = useState<string | null>(null);
  // Unknown until the host answers, and unknown never refuses (doc 124 §14).
  const [license, setLicense] = useState<LicenseWord>('unknown');
  const licenseRef = useRef<LicenseWord>('unknown');
  licenseRef.current = license;
  /** Set when a creation was refused by the free limit: the screen offers the license. */
  const [limitHit, setLimitHit] = useState<Limited | null>(null);
  const folderRef = useRef<string | null>(null);
  // Re-armed on every mount: a cleanup also runs when React hides then shows
  // a subtree, so a ref set to false once would drop every later result.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const open = useCallback(async (folder: string) => {
    folderRef.current = folder;
    setStatus({ kind: 'loading', folder });
    try {
      const [c, d, p, m, j, s] = await Promise.all([
        loadRecords(hostIO, folder, CLIENTS_DIR, normalizeClient),
        loadRecords(hostIO, folder, DEALS_DIR, normalizeDeal),
        loadRecords(hostIO, folder, PRODUCTS_DIR, normalizeProduct),
        loadRecords(hostIO, folder, MARKETS_DIR, normalizeMarket),
        loadRecords(hostIO, folder, JOURNAL_DIR, normalizeEntry),
        readSettings(hostIO, folder),
      ]);
      if (!aliveRef.current || folderRef.current !== folder) return;
      setClients(c.records);
      setDeals(d.records);
      setProducts(p.records);
      setMarkets(m.records);
      // An unreadable journal line is BOTH listed and a hole in the chain: the check says where.
      setJournal(verifyJournal(j.records));
      setSettingsRead(s);
      setUnreadable([...c.unreadable, ...d.unreadable, ...p.unreadable, ...m.unreadable, ...j.unreadable]);
      setStatus({ kind: 'ready', folder });
    } catch (err) {
      console.warn('[mnemo-crm] could not open the book:', err);
      if (!aliveRef.current || folderRef.current !== folder) return;
      setStatus({ kind: 'error', folder, message: message(err) });
    }
  }, []);

  // Boot: the folder remembered here, else the one mirrored by the host.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = readRememberedFolder();
      if (local) {
        if (!cancelled) void open(local);
        return;
      }
      try {
        const mirrored = await readMirroredFolder();
        if (cancelled) return;
        if (mirrored) void open(mirrored);
        else setStatus({ kind: 'noFolder' });
      } catch (err) {
        console.warn('[mnemo-crm] host mirror unreadable:', err);
        if (!cancelled) setStatus({ kind: 'noFolder', bridgeError: message(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const chooseFolder = useCallback(async () => {
    try {
      const folder = await pickFolder();
      if (!folder) return; // cancelled: nothing changes, nothing to say
      try {
        await rememberFolder(folder);
      } catch (err) {
        // The folder still opens; only the reopening after an origin change is at risk.
        console.warn('[mnemo-crm] folder not mirrored on the host:', err);
      }
      await open(folder);
    } catch (err) {
      console.warn('[mnemo-crm] folder picker failed:', err);
      setStatus((prev) =>
        prev.kind === 'ready' || prev.kind === 'error' || prev.kind === 'loading'
          ? { kind: 'error', folder: prev.folder, message: message(err) }
          : { kind: 'noFolder', bridgeError: message(err) },
      );
    }
  }, [open]);

  /** Switch to a folder, remembered here and on the host (doc 73). */
  const switchTo = useCallback(
    async (folder: string) => {
      try {
        await rememberFolder(folder);
      } catch (err) {
        console.warn('[mnemo-crm] folder not mirrored on the host:', err);
      }
      await open(folder);
    },
    [open],
  );

  const [demo, setDemo] = useState<{ kind: 'idle' } | { kind: 'writing'; done: number; total: number } | { kind: 'failed'; error: string }>({ kind: 'idle' });

  /**
   * Create a demo book in a folder the person picks, which must hold NO book.
   * The real book is never touched: it is remembered, and one button comes back to it.
   */
  const createDemoBook = useCallback(
    async (build: () => DemoBook) => {
      try {
        const folder = await pickFolder();
        if (!folder) return;
        if (!(await isEmptyBookFolder(hostIO, folder))) {
          setDemo({ kind: 'failed', error: 'FOLDER_NOT_EMPTY' });
          return;
        }
        const book = build();
        setDemo({ kind: 'writing', done: 0, total: 1 });
        await writeDemoBook(hostIO, folder, book, (done, total) => aliveRef.current && setDemo({ kind: 'writing', done, total }));
        if (folderRef.current && folderRef.current !== folder) rememberPreviousFolder(folderRef.current);
        setDemo({ kind: 'idle' });
        await switchTo(folder);
      } catch (err) {
        console.warn('[mnemo-crm] demo book not written:', err);
        if (aliveRef.current) setDemo({ kind: 'failed', error: message(err) });
      }
    },
    [switchTo],
  );

  const backToPrevious = useCallback(async () => {
    const previous = readPreviousFolder();
    if (!previous) return;
    rememberPreviousFolder(null);
    await switchTo(previous);
  }, [switchTo]);

  const reload = useCallback(() => {
    if (folderRef.current) void open(folderRef.current);
  }, [open]);

  /** Runs one write. Resolves true only when the host reported it. */
  const write = useCallback(async (run: (folder: string) => Promise<void>, onDone: () => void): Promise<boolean> => {
    const folder = folderRef.current;
    if (!folder) return false;
    setSaving(true);
    setSaveError(null);
    try {
      await run(folder);
      if (aliveRef.current) onDone();
      return true;
    } catch (err) {
      console.warn('[mnemo-crm] save failed:', err);
      if (aliveRef.current) setSaveError(message(err));
      return false;
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  }, []);

  const saveIn = useCallback(
    <T extends { id: string }>(collection: Collection, record: T, set: (fn: (prev: T[]) => T[]) => void) =>
      write(
        (folder) => saveRecord(hostIO, folder, DIRS[collection], record),
        () => set((prev) => upsertIn(prev, record)),
      ),
    [write],
  );

  const clientsRef = useRef(clients);
  clientsRef.current = clients;
  const memoryOn = settingsRead.state === 'ok' && settingsRead.settings.memory === true;
  const memoryOnRef = useRef(memoryOn);
  memoryOnRef.current = memoryOn;

  /**
   * Send lines to the memory, one by one. Never blocks the file: a line that
   * could not be sent is SAID, and "send the book again" retries it (the
   * checksum lets the host drop what it already has).
   */
  const sendToMemory = useCallback(async (items: { client: Client; entries: Client['timeline'] }[], kindLabel: (k: string) => string) => {
    const lines = items.flatMap(({ client, entries }) => entries.map((e) => memoryLine(client, e, kindLabel(e.kind))));
    if (lines.length === 0) return;
    setMemory({ kind: 'sending', done: 0, total: lines.length });
    try {
      for (let i = 0; i < lines.length; i++) {
        await rememberLine(lines[i].content, lines[i].sourceRef, lines[i].checksum);
        if (aliveRef.current) setMemory({ kind: 'sending', done: i + 1, total: lines.length });
      }
      if (aliveRef.current) setMemory({ kind: 'sent', count: lines.length, at: new Date().toISOString() });
    } catch (err) {
      console.warn('[mnemo-crm] memory write failed:', err);
      if (aliveRef.current) setMemory({ kind: 'failed', error: message(err) });
    }
  }, []);

  const kindLabelRef = useRef<(k: string) => string>((k) => k);

  const refreshLicense = useCallback(async () => {
    const word = await readLicense();
    if (aliveRef.current) setLicense(word);
    return word;
  }, []);
  useEffect(() => {
    void refreshLicense();
  }, [refreshLicense]);

  const productsRef = useRef(products);
  productsRef.current = products;

  const upsertClient = useCallback(
    async (c: Client) => {
      const before = clientsRef.current.find((x) => x.id === c.id);
      if (!before && !mayCreate('clients', licenseRef.current, clientsRef.current, productsRef.current)) {
        setLimitHit('clients');
        return false;
      }
      const ok = await saveIn('clients', c, setClients);
      if (ok && memoryOnRef.current) {
        const added = newEntries(before, c);
        if (added.length > 0) void sendToMemory([{ client: c, entries: added }], kindLabelRef.current);
      }
      return ok;
    },
    [saveIn, sendToMemory],
  );

  /** "Send the whole book": every note of every client. Safe to repeat. */
  const syncMemory = useCallback(
    (kindLabel: (k: string) => string) =>
      sendToMemory(clientsRef.current.map((client) => ({ client, entries: client.timeline })), kindLabel),
    [sendToMemory],
  );
  const upsertDeal = useCallback((d: Deal) => saveIn('deals', d, setDeals), [saveIn]);
  const upsertProduct = useCallback(
    async (p: Product) => {
      const before = productsRef.current.find((x) => x.id === p.id);
      if (productIsNewForSale(p, before) && !mayCreate('products', licenseRef.current, clientsRef.current, productsRef.current)) {
        setLimitHit('products');
        return false;
      }
      return saveIn('products', p, setProducts);
    },
    [saveIn],
  );

  /**
   * Write imported records one file at a time. The caller already capped the
   * list to the free room; each file shows on screen only once the host
   * REPORTED it, and a refused file is named, not skipped in silence.
   */
  const importRecords = useCallback(
    async (target: 'clients' | 'products', records: (Client | Product)[], onProgress?: (done: number) => void) => {
      const folder = folderRef.current;
      const failed: { name: string; error: string }[] = [];
      let written = 0;
      if (!folder) return { written, failed: records.map((r) => ({ name: r.name, error: 'NO_FOLDER' })) };
      setSaving(true);
      try {
        for (const r of records) {
          try {
            await saveRecord(hostIO, folder, DIRS[target], r);
            written++;
            if (!aliveRef.current) break;
            if (target === 'clients') setClients((prev) => upsertIn(prev, r as Client));
            else setProducts((prev) => upsertIn(prev, r as Product));
          } catch (err) {
            console.warn('[mnemo-crm] import write refused:', err);
            failed.push({ name: r.name, error: message(err) });
          }
          onProgress?.(written + failed.length);
        }
      } finally {
        if (aliveRef.current) setSaving(false);
      }
      return { written, failed };
    },
    [],
  );
  const upsertMarket = useCallback((m: Market) => saveIn('markets', m, setMarkets), [saveIn]);

  // The journal head and products are read through refs, so two lines written
  // in a row (the "save and next" flow) never hook onto the same predecessor.
  const journalRef = useRef(journal);
  journalRef.current = journal;

  /** Writes a line, then applies its effect on the catalogue. The line is the truth; a stock that could not follow is SAID. */
  const appendLine = useCallback(
    async (entry: JournalEntry, sale: SaleEntry | undefined, direction: 'sell' | 'undo'): Promise<SaleOutcome> => {
      const folder = folderRef.current;
      if (!folder) return { ok: false, error: 'NO_FOLDER' };
      setSaving(true);
      setSaveError(null);
      try {
        await saveRecord(hostIO, folder, JOURNAL_DIR, entry);
        const next: ChainCheck = { entries: [...journalRef.current.entries, entry], broken: journalRef.current.broken };
        journalRef.current = next;
        if (aliveRef.current) setJournal(next);
        if (!sale) return { ok: true, entry };
        const changed = productEffects(productsRef.current, sale, direction);
        const failed: string[] = [];
        for (const product of changed) {
          try {
            await saveRecord(hostIO, folder, PRODUCTS_DIR, product);
            productsRef.current = upsertIn(productsRef.current, product);
          } catch (err) {
            console.warn('[mnemo-crm] stock not updated for', product.name, err);
            failed.push(product.name);
          }
        }
        if (aliveRef.current) setProducts(productsRef.current);
        return failed.length > 0 ? { ok: true, entry, stockProblem: failed.join(', ') } : { ok: true, entry };
      } catch (err) {
        console.warn('[mnemo-crm] journal line not written:', err);
        const error = message(err);
        if (aliveRef.current) setSaveError(error);
        return { ok: false, error };
      } finally {
        if (aliveRef.current) setSaving(false);
      }
    },
    [],
  );

  const recordSale = useCallback(
    async (draft: SaleDraft): Promise<SaleOutcome> => {
      const entry = buildSale(draft, chainHead(journalRef.current.entries));
      if (!entry) return { ok: false, error: 'INVALID_SALE' };
      return appendLine(entry, entry, 'sell');
    },
    [appendLine],
  );

  const voidSale = useCallback(
    async (sale: SaleEntry, reason: string): Promise<SaleOutcome> =>
      appendLine(buildVoid(sale.id, reason, chainHead(journalRef.current.entries)), sale, 'undo'),
    [appendLine],
  );

  /**
   * The settings in force. Absent file = the starter flow, in the language of
   * today, written on the first change. An unreadable file keeps the starter
   * flow on screen and REFUSES to write over it.
   */
  const settings: BookSettings =
    settingsRead.state === 'ok' ? settingsRead.settings : starterSettings((id) => translate(`stage.${id}`));

  const saveSettings = useCallback(
    (next: BookSettings) => {
      if (settingsRead.state === 'unreadable') {
        setSaveError('SETTINGS_UNREADABLE');
        return Promise.resolve(false);
      }
      return write(
        (folder) => writeSettings(hostIO, folder, next),
        () => setSettingsRead({ state: 'ok', settings: next }),
      );
    },
    [settingsRead.state, write],
  );

  /** A deal needs its stages on disk, so the first deal writes the starter flow. */
  const ensureSettingsWritten = useCallback(async (): Promise<boolean> => {
    if (settingsRead.state === 'ok') return true;
    if (settingsRead.state === 'unreadable') return true; // the deal still saves; the stages stay the starter ones on screen
    return saveSettings(settings);
  }, [settingsRead.state, saveSettings, settings]);

  return {
    status,
    clients,
    deals,
    products,
    markets,
    journal,
    settings,
    settingsState: settingsRead.state,
    unreadable,
    memory: memoryOn ? memory : ({ kind: 'off' } as MemoryState),
    syncMemory,
    setKindLabel: (fn: (k: string) => string) => {
      kindLabelRef.current = fn;
    },
    saving,
    saveError,
    clearSaveError: () => setSaveError(null),
    chooseFolder,
    reload,
    demo,
    createDemoBook,
    backToPrevious,
    previousFolder: readPreviousFolder(),
    upsertClient,
    upsertDeal,
    upsertProduct,
    upsertMarket,
    recordSale,
    voidSale,
    license,
    refreshLicense,
    limitHit,
    clearLimitHit: () => setLimitHit(null),
    importRecords,
    saveSettings,
    ensureSettingsWritten,
  };
}
