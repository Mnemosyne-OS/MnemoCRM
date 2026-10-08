import {
  addTimelineEntry,
  byRecent,
  createClient,
  daysBetween,
  followUpAgainstConsent,
  isValidDay,
  localDay,
  normalizeClient,
  searchClients,
  sortedTimeline,
} from './client';
import type { Client } from './types';

const base = (over: Partial<Client> & { name: string; id: string }): Client => ({
  schema: 1,
  kind: 'person',
  tags: [],
  timeline: [],
  ...over,
});

describe('normalizeClient: reading a file back', () => {
  it('refuses a file without an id or a name, so the caller can name it', () => {
    expect(normalizeClient({ name: 'Paul' })).toBeNull();
    expect(normalizeClient({ id: 'a1', name: '   ' })).toBeNull();
    expect(normalizeClient('not an object')).toBeNull();
  });

  it('keeps an absent optional field absent: no empty string, no zero, no fake date', () => {
    const c = normalizeClient({ id: 'a1', name: 'Paul', phone: '', email: 42, createdAt: 'yesterday-ish' })!;
    expect('phone' in c).toBe(false);
    expect('email' in c).toBe(false);
    expect('createdAt' in c).toBe(false);
    expect('updatedAt' in c).toBe(false);
  });

  it('drops an unreadable follow-up date instead of guessing one', () => {
    expect(normalizeClient({ id: 'a1', name: 'Paul', followUp: { date: '2026-02-30' } })!.followUp).toBeUndefined();
    expect(normalizeClient({ id: 'a1', name: 'Paul', followUp: { date: '2026-10-01' } })!.followUp).toEqual({ date: '2026-10-01' });
  });

  it('keeps inAgenda only when it is literally true', () => {
    const c = normalizeClient({ id: 'a1', name: 'Paul', followUp: { date: '2026-10-01', inAgenda: 'yes' } })!;
    expect(c.followUp).toEqual({ date: '2026-10-01' });
  });

  it('drops timeline entries without a readable date and falls back to note for an unknown kind', () => {
    const c = normalizeClient({
      id: 'a1',
      name: 'Paul',
      timeline: [
        { id: 'e1', at: '2026-09-01T10:00:00.000Z', kind: 'telepathy', text: 'hello' },
        { id: 'e2', at: 'soon', kind: 'call', text: 'lost' },
      ],
    })!;
    expect(c.timeline).toEqual([{ id: 'e1', at: '2026-09-01T10:00:00.000Z', kind: 'note', text: 'hello' }]);
  });

  it('dedupes tags', () => {
    expect(normalizeClient({ id: 'a1', name: 'P', tags: ['bleu', 'bleu', ' ', 'noël'] })!.tags).toEqual(['bleu', 'noël']);
  });

  it('keeps a consent answer only with its date', () => {
    expect(normalizeClient({ id: 'a1', name: 'P', contactConsent: { value: false } })!.contactConsent).toBeUndefined();
    const at = '2026-09-01T10:00:00.000Z';
    expect(normalizeClient({ id: 'a1', name: 'P', contactConsent: { value: false, at } })!.contactConsent).toEqual({ value: false, at });
  });
});

describe('days', () => {
  it('validates real calendar days only', () => {
    expect(isValidDay('2026-02-28')).toBe(true);
    expect(isValidDay('2026-02-29')).toBe(false);
    expect(isValidDay('2026-9-1')).toBe(false);
  });

  it('counts days across a month and a DST change', () => {
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(daysBetween('2026-10-01', '2026-09-30')).toBe(-1);
  });

  it('uses the local day, not the UTC one', () => {
    expect(localDay(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31');
  });
});

describe('search', () => {
  const clients = [
    base({ id: '1', name: 'Hélène Roux', source: 'Marché de Noël Lyon', timeline: [{ id: 'e', at: '2026-01-01T00:00:00Z', kind: 'note', text: 'veut des bols bleus' }] }),
    base({ id: '2', name: 'Marc Petit', company: 'Café Lune' }),
  ];

  it('ignores accents and case, and needs every word', () => {
    expect(searchClients(clients, 'helene').map((c) => c.id)).toEqual(['1']);
    expect(searchClients(clients, 'noel bleus').map((c) => c.id)).toEqual(['1']);
    expect(searchClients(clients, 'noel cafe')).toEqual([]);
    expect(searchClients(clients, '  ')).toHaveLength(2);
  });
});

describe('history and order', () => {
  it('adds a trimmed entry, newest first, and ignores a blank one', () => {
    const c = base({ id: '1', name: 'P' });
    const once = addTimelineEntry(c, 'call', '  appel  ', new Date('2026-09-01T10:00:00Z'));
    const twice = addTimelineEntry(once, 'note', 'note', new Date('2026-09-02T10:00:00Z'));
    expect(sortedTimeline(twice).map((e) => e.text)).toEqual(['note', 'appel']);
    expect(addTimelineEntry(twice, 'note', '   ')).toBe(twice);
  });

  it('puts a client with no readable date last instead of treating it as new', () => {
    const list = [base({ id: '1', name: 'Nodate' }), base({ id: '2', name: 'Dated', updatedAt: '2020-01-01T00:00:00Z' })];
    expect(byRecent(list).map((c) => c.name)).toEqual(['Dated', 'Nodate']);
  });

  it('creates a client with dates and a safe id', () => {
    const c = createClient({ kind: 'company', name: 'Atelier Terre', email: '' }, new Date('2026-09-24T08:00:00Z'))!;
    expect(c.createdAt).toBe('2026-09-24T08:00:00.000Z');
    expect(c.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect('email' in c).toBe(false);
  });

  it('flags a follow-up planned for someone who said no', () => {
    const at = '2026-09-01T00:00:00Z';
    expect(followUpAgainstConsent(base({ id: '1', name: 'P', followUp: { date: '2026-10-01' }, contactConsent: { value: false, at } }))).toBe(true);
    expect(followUpAgainstConsent(base({ id: '1', name: 'P', followUp: { date: '2026-10-01' } }))).toBe(false);
  });
});
