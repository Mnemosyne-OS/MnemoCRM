/**
 * The book hook on an in-memory host (doc 124, verification pass of 30/09).
 * The free limit at the hook, the unreadable settings guard, the chain across
 * two sales written in a row, the memory opt-in and the stock effects are held
 * here: before this file nothing drove `useBook`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const fs = new Map<string, string>();
let licenseWord: 'active' | 'inactive' | 'unknown' = 'unknown';
const rememberLine = vi.fn(async () => undefined);

vi.mock('./host', () => ({
  hostIO: {
    mkdir: async () => ({ success: true }),
    readDir: async (dir: string) => {
      const prefix = `${dir.replace(/\/+$/, '')}/`;
      const files = [...fs.keys()]
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => ({ name: p.slice(prefix.length), path: p, isDirectory: false }));
      const dirs = new Set([...fs.keys()].filter((p) => p.startsWith(prefix) && p.slice(prefix.length).includes('/')).map((p) => p.slice(prefix.length).split('/')[0]));
      return { success: true, files: [...files, ...[...dirs].map((d) => ({ name: d, path: `${prefix}${d}`, isDirectory: true }))] };
    },
    readFile: async (p: string) => (fs.has(p) ? { success: true, content: fs.get(p) } : { success: false, error: 'ENOENT' }),
    writeFile: async (p: string, content: string) => {
      fs.set(p, content);
      return { success: true };
    },
  },
  pickFolder: vi.fn(async () => null),
  readRememberedFolder: () => 'C:/book',
  readMirroredFolder: async () => null,
  rememberFolder: async () => undefined,
  readPreviousFolder: () => null,
  rememberPreviousFolder: () => undefined,
  rememberLine: (...a: unknown[]) => rememberLine(...(a as [])),
  readLicense: async () => licenseWord,
}));

import { useBook } from '../data/useBook';
import { createClient, addTimelineEntry } from '../model/client';
import { sha256Hex } from '../model/sha256';
import type { Product } from '../model/types';

function seedClients(n: number) {
  for (let i = 0; i < n; i++) {
    const c = createClient({ kind: 'person', name: `Client ${i}` })!;
    fs.set(`C:/book/clients/${c.id}.json`, JSON.stringify(c));
  }
}

async function ready() {
  const hook = renderHook(() => useBook());
  await waitFor(() => expect(hook.result.current.status.kind).toBe('ready'));
  return hook;
}

beforeEach(() => {
  fs.clear();
  rememberLine.mockClear();
  licenseWord = 'unknown';
  localStorage.setItem('mnemo_crm_lang_mode', 'fr');
});

describe('the free limit at the hook', () => {
  it('inactive + 50 clients: the 51st is REFUSED and no file is written; unknown: it is written', async () => {
    licenseWord = 'inactive';
    seedClients(50);
    const { result } = await ready();
    await waitFor(() => expect(result.current.license).toBe('inactive'));
    const c = createClient({ kind: 'person', name: 'Un de trop' })!;
    let ok = true;
    await act(async () => {
      ok = await result.current.upsertClient(c);
    });
    expect(ok).toBe(false);
    expect(result.current.limitHit).toBe('clients');
    expect(fs.has(`C:/book/clients/${c.id}.json`)).toBe(false);
    // Editing one of the 50 is never refused.
    const existing = result.current.clients[0];
    await act(async () => {
      ok = await result.current.upsertClient({ ...existing, phone: '06' });
    });
    expect(ok).toBe(true);
  });

  it('unknown verdict + 50 clients: the 51st is written', async () => {
    seedClients(50);
    const { result } = await ready();
    const c = createClient({ kind: 'person', name: 'Bienvenu' })!;
    let ok = false;
    await act(async () => {
      ok = await result.current.upsertClient(c);
    });
    expect(ok).toBe(true);
    expect(fs.has(`C:/book/clients/${c.id}.json`)).toBe(true);
  });
});

describe('settings on disk', () => {
  it('an unreadable settings.json is reported, and saving settings REFUSES to write over it', async () => {
    fs.set('C:/book/settings.json', 'this is not json');
    const { result } = await ready();
    expect(result.current.settingsState).toBe('unreadable');
    let ok = true;
    await act(async () => {
      ok = await result.current.saveSettings({ ...result.current.settings, currency: 'USD' });
    });
    expect(ok).toBe(false);
    expect(result.current.saveError).toBe('SETTINGS_UNREADABLE');
    expect(fs.get('C:/book/settings.json')).toBe('this is not json');
  });

  it('a client file that is not a client is NAMED, not dropped in silence', async () => {
    fs.set('C:/book/clients/bad.json', '{"schema":1}');
    const { result } = await ready();
    expect(result.current.unreadable).toEqual(['clients/bad.json']);
  });
});

describe('two sales in a row', () => {
  it('chain on each other (seq 1 then 2, prevHash = hash of the first), and a unique piece sold then voided comes back', async () => {
    const piece: Product = { schema: 1, id: 'p1', name: 'Vase', kind: 'unique', status: 'available', price: 40, tags: [] };
    fs.set('C:/book/products/p1.json', JSON.stringify(piece));
    const { result } = await ready();
    const draft = (label: string, productId?: string) => ({ at: '2026-09-30T10:00:00.000Z', place: 'workshop' as const, lines: [{ label, qty: 1, unitPrice: 40, ...(productId ? { productId } : {}) }], payment: 'cash' as const, currency: 'EUR' });
    let a: Awaited<ReturnType<typeof result.current.recordSale>> | undefined;
    let b: typeof a;
    await act(async () => {
      a = await result.current.recordSale(draft('Vase', 'p1'));
      b = await result.current.recordSale(draft('Autre'));
    });
    expect(a?.ok && b?.ok).toBe(true);
    const [e1, e2] = result.current.journal.entries;
    expect([e1.seq, e2.seq]).toEqual([1, 2]);
    expect(e2.prevHash).toBe(e1.hash);
    expect(result.current.journal.broken).toBeNull();
    expect(JSON.parse(fs.get('C:/book/products/p1.json')!).status).toBe('sold');
    await act(async () => {
      await result.current.voidSale(e1 as never, 'erreur');
    });
    expect(result.current.journal.entries.length).toBe(3);
    expect(JSON.parse(fs.get('C:/book/products/p1.json')!).status).toBe('available');
  });
});

describe('memory opt-in', () => {
  it('OFF by default: a new note is written to the file and NOT sent; ON: sent with the text fingerprint as checksum', async () => {
    const { result } = await ready();
    const c = createClient({ kind: 'person', name: 'Anna' })!;
    await act(async () => {
      await result.current.upsertClient(c);
      await result.current.upsertClient(addTimelineEntry(c, 'note', 'veut deux bols'));
    });
    expect(result.current.memory.kind).toBe('off');
    expect(rememberLine).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.saveSettings({ ...result.current.settings, memory: true });
    });
    await act(async () => {
      await result.current.syncMemory((k) => k);
    });
    await waitFor(() => expect(rememberLine).toHaveBeenCalledTimes(1));
    const [content, sourceRef, checksum] = rememberLine.mock.calls[0] as unknown as [string, string, string];
    expect(content).toContain('veut deux bols');
    expect(sourceRef.startsWith(`mnemo-crm/client/${c.id}/`)).toBe(true);
    expect(checksum).toBe(sha256Hex(content));
  });
});
