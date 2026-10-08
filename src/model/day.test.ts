import { describe, expect, it } from 'vitest';
import { planDay } from './day';
import type { Client, Deal } from './types';

const client = (c: Partial<Client> & { id: string; name: string }): Client => ({ schema: 1, kind: 'person', tags: [], timeline: [], ...c, } as Client);

describe('planDay', () => {
  const today = '2026-09-24';
  const clients = [
    client({ id: '1', name: 'Zoé', followUp: { date: '2026-09-20' } }),
    client({ id: '2', name: 'Anna', followUp: { date: '2026-09-24' } }),
    client({ id: '3', name: 'Bruno', followUp: { date: '2026-09-30' } }),
    client({ id: '4', name: 'Chloé', followUp: { date: '2026-10-20' } }),
    client({ id: '5', name: 'Denis' }),
    client({ id: '6', name: 'Adam', followUp: { date: '2026-09-20' } }),
  ];

  it('sorts late, today and this week, and leaves the rest out', () => {
    const plan = planDay(clients, [], today);
    expect(plan.overdue.map((i) => i.title)).toEqual(['Adam', 'Zoé']);
    expect(plan.today.map((i) => i.title)).toEqual(['Anna']);
    expect(plan.soon.map((i) => i.title)).toEqual(['Bruno']);
  });

  it('puts the 7th day in, the 8th out', () => {
    const edge = [client({ id: 'a', name: 'A', followUp: { date: '2026-10-01' } }), client({ id: 'b', name: 'B', followUp: { date: '2026-10-02' } })];
    expect(planDay(edge, [], today).soon.map((i) => i.title)).toEqual(['A']);
  });

  it('mixes a deal step in the same list, under its client, and skips a closed deal', () => {
    const deals = [
      { id: 'd1', title: 'Vaisselle', stageId: 's', clientId: '2', nextStep: { date: '2026-09-24' }, events: [] },
      { id: 'd2', title: 'Fermée', stageId: 's', closed: { outcome: 'lost', at: '2026-09-01T00:00:00Z' }, nextStep: { date: '2026-09-24' }, events: [] },
    ] as unknown as Deal[];
    const plan = planDay(clients, deals, today);
    expect(plan.today.map((i) => `${i.kind}:${i.title}:${i.sub ?? ''}`)).toEqual(['client:Anna:', 'deal:Vaisselle:Anna']);
  });
});
