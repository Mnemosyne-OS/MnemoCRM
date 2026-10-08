import { CLIENTS_DIR, isSafeId, joinPath, loadClients, readSettings, saveClient, StoreError, writeSettings, type FolderIO } from './folderStore';
import { starterSettings } from '../model/deal';
import type { Client } from '../model/types';

/** An in-memory disk with the host's answer shapes. */
function fakeDisk(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const dirs = new Set<string>();
  const calls = { mkdir: 0, writes: 0 };
  let failNext: keyof FolderIO | null = null;
  const io: FolderIO = {
    async mkdir(dirPath) {
      calls.mkdir++;
      if (failNext === 'mkdir') return { success: false, error: 'denied' };
      dirs.add(dirPath);
      return { success: true };
    },
    async readDir(dirPath) {
      if (failNext === 'readDir') return { success: false, error: 'EACCES' };
      const prefix = `${dirPath}/`;
      return {
        success: true,
        files: [...files.keys()]
          .filter((p) => p.startsWith(prefix))
          .map((p) => ({ name: p.slice(prefix.length), path: p, isDirectory: false })),
      };
    },
    async readFile(filePath) {
      const content = files.get(filePath);
      return content === undefined ? { success: false, error: 'ENOENT' } : { success: true, content };
    },
    async writeFile(filePath, content) {
      calls.writes++;
      if (failNext === 'writeFile') return { success: false, error: 'disk full' };
      files.set(filePath, content);
      return { success: true };
    },
  };
  return { io, files, dirs, calls, fail: (k: keyof FolderIO) => (failNext = k) };
}

const client = (id: string, name: string): Client => ({ schema: 1, id, kind: 'person', name, tags: [], timeline: [] });

describe('paths', () => {
  it('keeps the separator the folder already uses', () => {
    expect(joinPath('C:\\Users\\a\\CRM\\', 'clients', 'x.json')).toBe('C:\\Users\\a\\CRM\\clients\\x.json');
    expect(joinPath('/home/a/crm', 'clients')).toBe('/home/a/crm/clients');
  });

  it('refuses ids that could escape the folder', () => {
    expect(isSafeId('abc-123_X')).toBe(true);
    for (const bad of ['../x', 'a/b', 'a\\b', 'a.json', '', 'x'.repeat(81)]) expect(isSafeId(bad)).toBe(false);
  });
});

describe('loadClients', () => {
  const root = '/home/a/crm';
  const dir = `${root}/${CLIENTS_DIR}`;

  it('reads every client and NAMES the files it could not read', async () => {
    const disk = fakeDisk({
      [`${dir}/a.json`]: JSON.stringify(client('a', 'Anna')),
      [`${dir}/broken.json`]: '{"id": "b", "name": "Br',
      [`${dir}/not-a-client.json`]: JSON.stringify({ hello: 1 }),
      [`${dir}/notes.txt`]: 'ignored',
    });
    const res = await loadClients(disk.io, root);
    expect(res.clients.map((c) => c.name)).toEqual(['Anna']);
    expect(res.unreadable).toEqual(['clients/broken.json', 'clients/not-a-client.json']);
  });

  it('reports the second file claiming the same id instead of merging it', async () => {
    const disk = fakeDisk({
      [`${dir}/a.json`]: JSON.stringify(client('a', 'Anna')),
      [`${dir}/a-copy.json`]: JSON.stringify(client('a', 'Anna bis')),
    });
    const res = await loadClients(disk.io, root);
    expect(res.clients).toHaveLength(1);
    expect(res.unreadable).toHaveLength(1);
  });

  it('an empty folder is an empty book, not an error', async () => {
    const res = await loadClients(fakeDisk().io, root);
    expect(res).toEqual({ clients: [], unreadable: [] });
  });

  it('a folder that cannot be listed is an ERROR, never an empty book', async () => {
    const disk = fakeDisk();
    disk.fail('readDir');
    await expect(loadClients(disk.io, root)).rejects.toThrow(StoreError);
    await expect(loadClients(disk.io, root)).rejects.toThrow(/LIST_FAILED/);
  });
});

describe('saveClient', () => {
  const root = '/home/a/crm';

  it('writes one pretty JSON file named after the id', async () => {
    const disk = fakeDisk();
    await saveClient(disk.io, root, client('a1', 'Anna'));
    const written = disk.files.get(`${root}/${CLIENTS_DIR}/a1.json`)!;
    expect(JSON.parse(written).name).toBe('Anna');
    expect(written.endsWith('\n')).toBe(true);
  });

  it('throws when the host refuses the write, so the screen never shows an unsaved client', async () => {
    const disk = fakeDisk();
    disk.fail('writeFile');
    await expect(saveClient(disk.io, root, client('a1', 'Anna'))).rejects.toThrow(/WRITE_FAILED/);
  });

  it('never writes a file for an unsafe id', async () => {
    const disk = fakeDisk();
    await expect(saveClient(disk.io, root, client('../evil', 'X'))).rejects.toThrow(/BAD_ID/);
    expect(disk.calls.writes).toBe(0);
  });
});

describe('settings on disk: three states, never two', () => {
  const root = '/home/a/crm';

  it('no file is ABSENT (the starter flow will be written on first use)', async () => {
    expect(await readSettings(fakeDisk().io, root)).toEqual({ state: 'absent' });
  });

  it('a file that is not settings is UNREADABLE, and is not touched', async () => {
    const disk = fakeDisk({ [`${root}/settings.json`]: '{"theme":"dark"}' });
    expect(await readSettings(disk.io, root)).toEqual({ state: 'unreadable' });
    expect(disk.calls.writes).toBe(0);
    const broken = fakeDisk({ [`${root}/settings.json`]: '{"stages": [' });
    expect(await readSettings(broken.io, root)).toEqual({ state: 'unreadable' });
  });

  it('round-trips what it wrote', async () => {
    const disk = fakeDisk();
    const settings = starterSettings((id) => `S-${id}`, 'CHF');
    await writeSettings(disk.io, root, settings);
    expect(await readSettings(disk.io, root)).toEqual({ state: 'ok', settings });
  });

  it('a root that cannot be listed is an error, not "absent"', async () => {
    const disk = fakeDisk();
    disk.fail('readDir');
    await expect(readSettings(disk.io, root)).rejects.toThrow(/LIST_FAILED/);
  });
});
