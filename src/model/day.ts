/**
 * The day's list mixes the two things that can be due: a client to call back
 * and a deal's next step. One list, one order, so "Today" never splits what
 * the person has to do into two screens.
 */
import { daysBetween } from './client';
import type { Client, Deal } from './types';

export interface DueItem {
  kind: 'client' | 'deal';
  id: string;
  title: string;
  /** Company for a client, client name for a deal. */
  sub?: string;
  note?: string;
  date: string;
}

export interface DayPlanMixed {
  overdue: DueItem[];
  today: DueItem[];
  soon: DueItem[];
}

export function planDay(clients: Client[], deals: Deal[], today: string, soonDays = 7): DayPlanMixed {
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const items: DueItem[] = [];
  for (const c of clients) {
    if (c.followUp) items.push({ kind: 'client', id: c.id, title: c.name, sub: c.company, note: c.followUp.note, date: c.followUp.date });
  }
  for (const d of deals) {
    if (d.closed || !d.nextStep) continue;
    items.push({
      kind: 'deal',
      id: d.id,
      title: d.title,
      sub: d.clientId ? names.get(d.clientId) : undefined,
      note: d.nextStep.note,
      date: d.nextStep.date,
    });
  }
  const plan: DayPlanMixed = { overdue: [], today: [], soon: [] };
  for (const item of items) {
    const delta = daysBetween(today, item.date);
    if (delta < 0) plan.overdue.push(item);
    else if (delta === 0) plan.today.push(item);
    else if (delta <= soonDays) plan.soon.push(item);
  }
  const order = (a: DueItem, b: DueItem) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
  plan.overdue.sort(order);
  plan.today.sort(order);
  plan.soon.sort(order);
  return plan;
}
