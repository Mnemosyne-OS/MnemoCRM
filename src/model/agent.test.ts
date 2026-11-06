/**
 * What an agent reads of the book and how its arguments become a client
 * (doc 149). Absent stays absent, the form's consent rule holds, and only the
 * fields passed change.
 */
import { applyClientArgs, boundedInt, clientCard, clientLine, clientsLimit, consentAfter, CARD_TIMELINE_MAX, dueSoonDays } from './agent';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addTimelineEntry, completeFollowUp, withFollowUp } from './client';
import { starterSettings } from './deal';
import type { Client, Deal } from './types';

const base = (over: Partial<Client> = {}): Client => ({ schema: 1, id: 'c1', kind: 'person', name: 'Hélène', tags: [], timeline: [], ...over });
const now = new Date('2026-10-12T10:00:00Z');

describe('clientLine and clientCard', () => {
  it('leave an absent field absent, never an empty string', () => {
    const line = clientLine(base());
    expect(line).toEqual({ id: 'c1', name: 'Hélène', kind: 'person', exchanges: 0 });
  });

  it('flag a refused contact, and the card says the three consent answers', () => {
    expect(clientLine(base({ contactConsent: { value: false, at: now.toISOString() } })).contactRefused).toBe(true);
    expect(clientLine(base({ contactConsent: { value: true, at: now.toISOString() } }))).not.toHaveProperty('contactRefused');
    const settings = starterSettings((id) => id);
    expect(clientCard(base(), [], settings).consent).toBe('unknown');
    expect(clientCard(base({ contactConsent: { value: false, at: now.toISOString() } }), [], settings).consent).toBe('no');
  });

  it('carry the newest history first, cap it and count the rest', () => {
    let c = base();
    for (let i = 0; i < CARD_TIMELINE_MAX + 3; i++) c = addTimelineEntry(c, 'note', `n${i}`, new Date(now.getTime() + i * 1000));
    const card = clientCard(c, [], starterSettings((id) => id));
    expect(card.history).toHaveLength(CARD_TIMELINE_MAX);
    expect(card.history[0].text).toBe(`n${CARD_TIMELINE_MAX + 2}`);
    expect(card.historyNotShown).toBe(3);
  });

  it("list only this client's deals, with the stage in the person's words", () => {
    const settings = starterSettings((id) => `label-${id}`);
    const deal = (id: string, clientId: string): Deal => ({ schema: 1, id, title: id, clientId, stageId: settings.stages[0].id, productIds: [], history: [] });
    const card = clientCard(base(), [deal('d1', 'c1'), deal('d2', 'other')], settings);
    expect(card.deals.map((d) => d.id)).toEqual(['d1']);
    expect(card.deals[0].stage).toBe(settings.stages[0].label);
    expect(card.deals[0]).not.toHaveProperty('amount');
  });
});

describe('consentAfter: the form rule', () => {
  it('keeps the original date when the answer did not change, dates a new one, removes on unknown', () => {
    const before = { value: true, at: '2026-01-01T00:00:00.000Z' };
    expect(consentAfter('yes', before, now)).toBe(before);
    expect(consentAfter('no', before, now)).toEqual({ value: false, at: now.toISOString() });
    expect(consentAfter('unknown', before, now)).toBeUndefined();
  });
});

describe('applyClientArgs', () => {
  it('changes only the fields passed and keeps the rest', () => {
    const c = base({ phone: '0601', email: 'a@b.c' });
    const next = applyClientArgs(c, { phone: '0702' }, now)!;
    expect(next.phone).toBe('0702');
    expect(next.email).toBe('a@b.c');
    expect(next.updatedAt).toBe(now.toISOString());
  });

  it('refuses an unknown kind or consent by name', () => {
    expect(() => applyClientArgs(base(), { kind: 'robot' }, now)).toThrow(/^BAD_ARG: kind/);
    expect(() => applyClientArgs(base(), { consent: 'maybe' }, now)).toThrow(/^BAD_ARG: consent/);
  });

  it('drops the company of a company, as the form does', () => {
    expect(applyClientArgs(base({ company: 'Acme' }), { kind: 'company' }, now)!).not.toHaveProperty('company');
  });

  it('replaces the tags and records a consent', () => {
    const next = applyClientArgs(base({ tags: ['old'] }), { tags: ['a', 'b', 3], consent: 'no' }, now)!;
    expect(next.tags).toEqual(['a', 'b']);
    expect(next.contactConsent).toEqual({ value: false, at: now.toISOString() });
  });

  it('returns null when the name trims to nothing', () => {
    expect(applyClientArgs(base(), { name: '   ' }, now)).toBeNull();
  });
});

describe('withFollowUp and completeFollowUp (the sheet and the agent share them)', () => {
  it('plans a follow-up with its note, an empty note absent', () => {
    expect(withFollowUp(base(), '2026-10-20', '  call back  ', now).followUp).toEqual({ date: '2026-10-20', note: 'call back' });
    expect(withFollowUp(base(), '2026-10-20', '   ', now).followUp).toEqual({ date: '2026-10-20' });
  });

  it('turns a done follow-up into a call carrying its note, and removes the follow-up key', () => {
    const done = completeFollowUp(base({ followUp: { date: '2026-10-12', note: 'quote' } }), 'Followed up', now);
    expect('followUp' in done).toBe(false);
    expect(done.timeline[0]).toMatchObject({ kind: 'call', text: 'Followed up: quote' });
    expect(completeFollowUp(base({ followUp: { date: '2026-10-12' } }), 'Followed up', now).timeline[0].text).toBe('Followed up');
  });
});

describe('numeric arguments stay inside the bounds the manifest declares', () => {
  // The bounds an agent is TOLD, read from the manifest: the clamp must say the same.
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'mnemo-plugin.json'), 'utf8')) as {
    agentActions: { id: string; params: Record<string, { minimum: number; maximum: number }> }[];
  };
  const declared = (action: string, arg: string) => manifest.agentActions.find((x) => x.id === action)!.params[arg]!;

  it('clients › limit: a negative or zero limit never drops clients from the end, a huge one is capped', () => {
    const { minimum, maximum } = declared('clients', 'limit');
    expect(clientsLimit(-3)).toBe(minimum);
    expect(clientsLimit(0)).toBe(minimum);
    expect(clientsLimit(10_000)).toBe(maximum);
    expect(clientsLimit(12.9)).toBe(12);
    expect(clientsLimit(undefined)).toBe(50);
    expect(clientsLimit('20')).toBe(50);
    expect(clientsLimit(Number.NaN)).toBe(50);
  });

  it('due › soonDays: never negative, never past a year', () => {
    const { minimum, maximum } = declared('due', 'soonDays');
    expect(dueSoonDays(-1)).toBe(minimum);
    expect(dueSoonDays(400)).toBe(maximum);
    expect(dueSoonDays(0)).toBe(0);
    expect(dueSoonDays(undefined)).toBe(7);
    expect(dueSoonDays(Number.POSITIVE_INFINITY)).toBe(7);
  });

  it('boundedInt clamps both ways', () => {
    expect(boundedInt(5, 1, 2, 4)).toBe(4);
    expect(boundedInt(1, 9, 2, 4)).toBe(2);
  });
});
