/**
 * What an agent reads of the book, and how its arguments become a client
 * (doc 149). Pure: the handlers in CrmAgentActions call these, then the SAME
 * save the person's own buttons use.
 *
 * An absent field stays ABSENT in every answer (never `''`, never `0`), so an
 * agent can tell « nobody typed a phone » from « the phone is empty ».
 */
import { normalizeClient, sortedTimeline } from './client';
import type { DueItem } from './day';
import type { BookSettings, Client, ClientKind, ContactConsent, Deal, TimelineKind } from './types';

export const CLIENT_KINDS: readonly ClientKind[] = ['person', 'company'];
export const ENTRY_KINDS: readonly TimelineKind[] = ['note', 'call', 'meeting', 'sale'];
export const CONSENT_ANSWERS = ['yes', 'no', 'unknown'] as const;
/** The screens of the rail, in its order (App's Tab), as `showTab` takes them. */
export const CRM_TABS = ['today', 'clients', 'deals', 'catalog', 'sales', 'analytics', 'settings'] as const;
export type CrmTab = typeof CRM_TABS[number];
/** A unique piece's states, as the catalogue's buttons set them. */
export const UNIQUE_STATUSES = ['available', 'reserved', 'sold'] as const;
export type ConsentAnswer = typeof CONSENT_ANSWERS[number];

/** The fields an agent may set on a client (the form's fields). */
const TEXT_FIELDS = ['name', 'company', 'email', 'phone', 'address', 'source'] as const;

/** How many history lines one client card carries; the rest is counted. */
export const CARD_TIMELINE_MAX = 50;

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * A whole number inside the manifest's bounds, or the default when the agent
 * passed none (or no number at all). Clamped, never trusted: a negative
 * `limit` made `slice(0, -n)` drop the LAST clients in silence.
 */
export function boundedInt(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

/** `clients` › limit: 1..500, default 50 (mnemo-plugin.json). */
export const clientsLimit = (v: unknown): number => boundedInt(v, 50, 1, 500);
/** `due` › soonDays: 0..365, default 7 (mnemo-plugin.json). */
export const dueSoonDays = (v: unknown): number => boundedInt(v, 7, 0, 365);

export function consentWord(client: Client): ConsentAnswer {
  if (client.contactConsent === undefined) return 'unknown';
  return client.contactConsent.value ? 'yes' : 'no';
}

/**
 * The consent after an answer, with the form's rule: an answer that did not
 * change keeps its original date; « unknown » removes it.
 */
export function consentAfter(answer: ConsentAnswer, previous: ContactConsent | undefined, now: Date): ContactConsent | undefined {
  if (answer === 'unknown') return undefined;
  const value = answer === 'yes';
  return previous && previous.value === value ? previous : { value, at: now.toISOString() };
}

/** One line of the client list: who, how to reach them, the next follow-up. Never the history. */
export function clientLine(c: Client) {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    ...(c.company ? { company: c.company } : {}),
    ...(c.email ? { email: c.email } : {}),
    ...(c.phone ? { phone: c.phone } : {}),
    ...(c.tags.length ? { tags: c.tags } : {}),
    ...(c.followUp ? { followUp: c.followUp.date } : {}),
    ...(c.contactConsent?.value === false ? { contactRefused: true } : {}),
    exchanges: c.timeline.length,
  };
}

export function dealLine(d: Deal, settings: BookSettings, clientName?: string) {
  return {
    id: d.id,
    title: d.title,
    ...(d.clientId ? { clientId: d.clientId } : {}),
    ...(clientName ? { client: clientName } : {}),
    stage: d.closed ? d.closed.outcome : settings.stages.find((s) => s.id === d.stageId)?.label ?? null,
    ...(d.amount !== undefined ? { amount: d.amount, currency: settings.currency } : {}),
    ...(d.nextStep ? { nextStep: d.nextStep.date, ...(d.nextStep.note ? { nextStepNote: d.nextStep.note } : {}) } : {}),
    open: !d.closed,
  };
}

/** One client in full: every fact, the consent, the follow-up, the history newest first, the deals. */
export function clientCard(c: Client, deals: Deal[], settings: BookSettings) {
  const timeline = sortedTimeline(c);
  return {
    ...clientLine(c),
    ...(c.address ? { address: c.address } : {}),
    ...(c.source ? { source: c.source } : {}),
    consent: consentWord(c),
    ...(c.followUp ? { followUp: c.followUp.date, ...(c.followUp.note ? { followUpNote: c.followUp.note } : {}), inAgenda: !!c.followUp.inAgenda } : {}),
    ...(c.createdAt ? { createdAt: c.createdAt } : {}),
    ...(c.updatedAt ? { updatedAt: c.updatedAt } : {}),
    history: timeline.slice(0, CARD_TIMELINE_MAX).map((e) => ({ at: e.at, kind: e.kind, text: e.text, ...(e.source ? { source: e.source } : {}) })),
    ...(timeline.length > CARD_TIMELINE_MAX ? { historyNotShown: timeline.length - CARD_TIMELINE_MAX } : {}),
    deals: deals.filter((d) => d.clientId === c.id).map((d) => dealLine(d, settings)),
  };
}

export function dueLine(item: DueItem) {
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    date: item.date,
    ...(item.sub ? { sub: item.sub } : {}),
    ...(item.note ? { note: item.note } : {}),
  };
}

/**
 * The client's fields after an agent's arguments, through the same reading as
 * a file (normalizeClient). Only the arguments passed change; an argument the
 * host already dropped as empty cannot clear a field. Null when the result is
 * not a client (a name that trims to nothing).
 */
export function applyClientArgs(base: Client, args: Record<string, unknown>, now: Date): Client | null {
  const next: Record<string, unknown> = { ...base, updatedAt: now.toISOString() };
  for (const key of TEXT_FIELDS) {
    if (typeof args[key] === 'string') next[key] = args[key];
  }
  const kind = str(args.kind);
  if (kind) {
    if (!(CLIENT_KINDS as readonly string[]).includes(kind)) throw new Error(`BAD_ARG: kind is one of ${CLIENT_KINDS.join(', ')}`);
    next.kind = kind;
  }
  if (Array.isArray(args.tags)) next.tags = args.tags.filter((tag): tag is string => typeof tag === 'string');
  const consent = str(args.consent);
  if (consent) {
    if (!(CONSENT_ANSWERS as readonly string[]).includes(consent)) throw new Error(`BAD_ARG: consent is one of ${CONSENT_ANSWERS.join(', ')}`);
    next.contactConsent = consentAfter(consent as ConsentAnswer, base.contactConsent, now);
  }
  // The form keeps « company » for a person only: a company is not « at » another company.
  if (next.kind === 'company') delete next.company;
  return normalizeClient(next);
}
