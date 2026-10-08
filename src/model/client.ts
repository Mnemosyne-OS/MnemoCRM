/**
 * Pure client logic: reading a file back, the day's follow-ups, search.
 *
 * No I/O here. Everything that touches the bridge lives in `data/`, so these
 * rules are testable without a host.
 */
import {
  CLIENT_SCHEMA,
  type Client,
  type ClientKind,
  type ContactConsent,
  type FollowUp,
  type TimelineEntry,
  type TimelineKind,
} from './types';

const KINDS: readonly ClientKind[] = ['person', 'company'];
const TIMELINE_KINDS: readonly TimelineKind[] = ['note', 'call', 'meeting', 'sale'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Upper bounds that keep a hand-edited file from flooding the screen. */
const MAX_TEXT = 5000;
const MAX_FIELD = 300;
const MAX_TAGS = 30;

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback for runtimes without randomUUID: time + randomness, still unique enough
  // for one person's files, and never used as a security token.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Local calendar day of `now`, YYYY-MM-DD (never UTC: a follow-up is a local promise). */
export function localDay(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86_400_000);
}

export function isValidDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isInstant(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

/** A trimmed, bounded string, or undefined. An empty string is an absence, not a value. */
export function text(value: unknown, max = MAX_FIELD): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function readTimeline(value: unknown): TimelineEntry[] {
  if (!Array.isArray(value)) return [];
  const out: TimelineEntry[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = text(r.id, 80);
    const body = text(r.text, MAX_TEXT);
    if (!id || !body || !isInstant(r.at)) continue;
    const kind = TIMELINE_KINDS.includes(r.kind as TimelineKind) ? (r.kind as TimelineKind) : 'note';
    const entry: TimelineEntry = { id, at: r.at, kind, text: body };
    const source = text(r.source, 1000);
    if (source) entry.source = source;
    out.push(entry);
  }
  return out;
}

export function readFollowUp(value: unknown): FollowUp | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>;
  if (!isValidDay(r.date)) return undefined;
  const followUp: FollowUp = { date: r.date };
  const note = text(r.note, MAX_FIELD);
  if (note) followUp.note = note;
  if (r.inAgenda === true) followUp.inAgenda = true;
  return followUp;
}

function readConsent(value: unknown): ContactConsent | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const r = value as Record<string, unknown>;
  if (typeof r.value !== 'boolean' || !isInstant(r.at)) return undefined;
  return { value: r.value, at: r.at };
}

/**
 * Read one client file back. Returns null when the file is not a client
 * (no id or no name): the caller reports it by name instead of dropping it.
 * An unreadable OPTIONAL field is removed, never replaced by a default.
 */
export function normalizeClient(raw: unknown): Client | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 80);
  const name = text(r.name);
  if (!id || !name) return null;

  const client: Client = {
    schema: CLIENT_SCHEMA,
    id,
    kind: KINDS.includes(r.kind as ClientKind) ? (r.kind as ClientKind) : 'person',
    name,
    tags: Array.isArray(r.tags)
      ? [...new Set(r.tags.map((tag) => text(tag, 40)).filter((tag): tag is string => !!tag))].slice(0, MAX_TAGS)
      : [],
    timeline: readTimeline(r.timeline),
  };
  if (isInstant(r.createdAt)) client.createdAt = r.createdAt;
  if (isInstant(r.updatedAt)) client.updatedAt = r.updatedAt;
  for (const key of ['company', 'email', 'phone', 'address', 'source'] as const) {
    const value = text(r[key]);
    if (value) client[key] = value;
  }
  const followUp = readFollowUp(r.followUp);
  if (followUp) client.followUp = followUp;
  const consent = readConsent(r.contactConsent);
  if (consent) client.contactConsent = consent;
  return client;
}

export interface ClientDraft {
  kind: ClientKind;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  address?: string;
  source?: string;
  tags?: string[];
}

export function createClient(draft: ClientDraft, now: Date = new Date()): Client | null {
  const iso = now.toISOString();
  return normalizeClient({ ...draft, id: newId(), timeline: [], createdAt: iso, updatedAt: iso });
}

export function addTimelineEntry(client: Client, kind: TimelineKind, body: string, now: Date = new Date(), source?: string): Client {
  const trimmed = body.trim();
  if (!trimmed) return client;
  const entry: TimelineEntry = { id: newId(), at: now.toISOString(), kind, text: trimmed.slice(0, MAX_TEXT) };
  if (source?.trim()) entry.source = source.trim().slice(0, 1000);
  return { ...client, timeline: [entry, ...client.timeline], updatedAt: now.toISOString() };
}

/** Newest first, whatever order the file kept them in. */
export function sortedTimeline(client: Client): TimelineEntry[] {
  return [...client.timeline].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Lower-case and strip accents so "Hélène" matches "helene". */
export function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Every query word must appear somewhere in the client's text. Empty query = everyone. */
export function searchClients(clients: Client[], query: string): Client[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return clients;
  return clients.filter((client) => {
    const haystack = fold(
      [
        client.name,
        client.company,
        client.email,
        client.phone,
        client.source,
        client.address,
        ...client.tags,
        ...client.timeline.map((entry) => entry.text),
      ]
        .filter(Boolean)
        .join(' '),
    );
    return words.every((word) => haystack.includes(word));
  });
}

/** Most recently touched first; a client with no readable date goes last, by name. */
export function byRecent(clients: Client[]): Client[] {
  const stamp = (c: Client) => (c.updatedAt ? Date.parse(c.updatedAt) : -Infinity);
  return [...clients].sort((a, b) => stamp(b) - stamp(a) || a.name.localeCompare(b.name));
}

/** A follow-up refused by the person is flagged, never silently kept (doc 124 §8). */
export function followUpAgainstConsent(client: Client): boolean {
  return !!client.followUp && contactRefused(client);
}

/**
 * The person said NO to being contacted again. Only an explicit refusal
 * counts: a consent never asked is not a no (doc 124 §8). Every door that
 * would put a follow-up in the host agenda reads this BEFORE it rings.
 */
export function contactRefused(client: Client): boolean {
  return client.contactConsent?.value === false;
}
