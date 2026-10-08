/**
 * Deals and the person's own stages (doc 124 §3). Pure logic, no I/O.
 *
 * A stage label is the person's word, stored as data. The starter stages are
 * written ONCE in the language of the moment they are created; after that they
 * belong to the person and are never re-translated behind their back.
 */
import { isInstant, newId, readFollowUp, text } from './client';
import {
  DEAL_SCHEMA,
  SETTINGS_SCHEMA,
  type BookSettings,
  type Deal,
  type DealEvent,
  type FollowUp,
  type Stage,
} from './types';

export const STARTER_STAGE_IDS = ['request', 'quote', 'making', 'delivered', 'paid'] as const;
const MAX_STAGES = 12;
const MAX_HISTORY = 500;

/** The starter flow, labelled by the caller (translated at creation time). */
export function starterSettings(label: (id: string) => string, currency = 'EUR'): BookSettings {
  return {
    schema: SETTINGS_SCHEMA,
    stages: STARTER_STAGE_IDS.map((id) => ({ id, label: label(id) })),
    currency,
  };
}

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

/** Read settings back. Null when the file is not usable: the caller keeps it INTACT. */
export function normalizeSettings(raw: unknown): BookSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.stages)) return null;
  const seen = new Set<string>();
  const stages: Stage[] = [];
  for (const s of r.stages) {
    if (!s || typeof s !== 'object') continue;
    const id = text((s as Record<string, unknown>).id, 80);
    const label = text((s as Record<string, unknown>).label, 60);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    stages.push({ id, label });
  }
  if (stages.length === 0) return null;
  const settings: BookSettings = {
    schema: SETTINGS_SCHEMA,
    stages: stages.slice(0, MAX_STAGES),
    currency: isCurrencyCode(r.currency) ? r.currency : 'EUR',
  };
  if (r.taxStatus === 'franchise' || r.taxStatus === 'vat' || r.taxStatus === 'other') settings.taxStatus = r.taxStatus;
  if (r.memory === true) settings.memory = true;
  if (r.demo === true) settings.demo = true;
  return settings;
}

/**
 * Parse an amount typed by a person: "12,50", "1 200", "1200.5".
 * Empty = absent (undefined). Unreadable or negative = null, so the form can say so.
 */
export function parseAmount(input: string): number | undefined | null {
  const cleaned = input.replace(/[\s  ]/g, '').replace(/[€$£¥]/g, '');
  if (!cleaned) return undefined;
  const normalized = cleaned.includes(',') && !cleaned.includes('.') ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function readAmount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined;
}

function readHistory(value: unknown): DealEvent[] {
  if (!Array.isArray(value)) return [];
  const out: DealEvent[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = text(r.id, 80);
    const body = text(r.text, 2000);
    if (!id || !body || !isInstant(r.at)) continue;
    out.push({ id, at: r.at, text: body });
  }
  return out.slice(0, MAX_HISTORY);
}

/**
 * Read a deal back. A deal whose stage no longer exists keeps its stageId:
 * the board shows it under "unknown stage" instead of losing it.
 */
export function normalizeDeal(raw: unknown): Deal | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 80);
  const title = text(r.title);
  const stageId = text(r.stageId, 80);
  if (!id || !title || !stageId) return null;
  const deal: Deal = {
    schema: DEAL_SCHEMA,
    id,
    title,
    stageId,
    productIds: Array.isArray(r.productIds)
      ? [...new Set(r.productIds.map((p) => text(p, 80)).filter((p): p is string => !!p))]
      : [],
    history: readHistory(r.history),
  };
  const clientId = text(r.clientId, 80);
  if (clientId) deal.clientId = clientId;
  const amount = readAmount(r.amount);
  if (amount !== undefined) deal.amount = amount;
  const nextStep = readFollowUp(r.nextStep);
  if (nextStep) deal.nextStep = nextStep;
  if (r.closed && typeof r.closed === 'object') {
    const c = r.closed as Record<string, unknown>;
    if ((c.outcome === 'won' || c.outcome === 'lost') && isInstant(c.at)) deal.closed = { at: c.at, outcome: c.outcome };
  }
  if (isInstant(r.createdAt)) deal.createdAt = r.createdAt;
  if (isInstant(r.updatedAt)) deal.updatedAt = r.updatedAt;
  return deal;
}

export interface DealDraft {
  title: string;
  stageId: string;
  clientId?: string;
  amount?: number;
  productIds?: string[];
  nextStep?: FollowUp;
}

export function createDeal(draft: DealDraft, now: Date = new Date()): Deal | null {
  const iso = now.toISOString();
  return normalizeDeal({ ...draft, id: newId(), history: [], createdAt: iso, updatedAt: iso });
}

export function withEvent(deal: Deal, body: string, now: Date = new Date()): Deal {
  const trimmed = body.trim();
  if (!trimmed) return deal;
  const event: DealEvent = { id: newId(), at: now.toISOString(), text: trimmed.slice(0, 2000) };
  return { ...deal, history: [event, ...deal.history].slice(0, MAX_HISTORY), updatedAt: now.toISOString() };
}

/** Move to another stage, and write it in the history with the stage's label. */
export function moveDeal(deal: Deal, stage: Stage, line: string, now: Date = new Date()): Deal {
  if (deal.stageId === stage.id) return deal;
  return withEvent({ ...deal, stageId: stage.id }, line, now);
}

export function closeDeal(deal: Deal, outcome: 'won' | 'lost', line: string, now: Date = new Date()): Deal {
  return withEvent({ ...deal, closed: { at: now.toISOString(), outcome } }, line, now);
}

export function reopenDeal(deal: Deal, line: string, now: Date = new Date()): Deal {
  const next = withEvent({ ...deal }, line, now);
  delete next.closed;
  return next;
}

export interface Column {
  /** null = deals whose stage no longer exists. */
  stage: Stage | null;
  deals: Deal[];
}

/** Open deals per stage, in the stages' order; an orphan column only when needed. */
export function boardColumns(deals: Deal[], stages: Stage[]): Column[] {
  const open = deals.filter((d) => !d.closed);
  const known = new Set(stages.map((s) => s.id));
  const byUpdate = (a: Deal, b: Deal) =>
    (b.updatedAt ? Date.parse(b.updatedAt) : 0) - (a.updatedAt ? Date.parse(a.updatedAt) : 0) || a.title.localeCompare(b.title);
  const cols: Column[] = stages.map((stage) => ({
    stage,
    deals: open.filter((d) => d.stageId === stage.id).sort(byUpdate),
  }));
  const orphans = open.filter((d) => !known.has(d.stageId)).sort(byUpdate);
  if (orphans.length > 0) cols.push({ stage: null, deals: orphans });
  return cols;
}

export interface Total {
  /** Sum of the amounts that were typed. */
  sum: number;
  /** How many deals HAVE an amount. */
  counted: number;
  /** True when some deals have no amount: the sum is a floor, shown with ≥. */
  partial: boolean;
}

/** Null when no deal has an amount: the screen shows a dash, never 0. */
export function totalOf(deals: Deal[]): Total | null {
  const known = deals.filter((d) => d.amount !== undefined);
  if (known.length === 0) return null;
  const sum = Math.round(known.reduce((acc, d) => acc + d.amount!, 0) * 100) / 100;
  return { sum, counted: known.length, partial: known.length < deals.length };
}

export type StageEditError = 'STAGE_NOT_EMPTY' | 'LAST_STAGE' | 'TOO_MANY' | 'EMPTY_LABEL';

/** Removing a stage that still holds deals is REFUSED, with the count: choosing where they go is the person's call. */
export function removeStage(settings: BookSettings, stageId: string, deals: Deal[]): BookSettings | { error: StageEditError; count?: number } {
  const count = deals.filter((d) => !d.closed && d.stageId === stageId).length;
  if (count > 0) return { error: 'STAGE_NOT_EMPTY', count };
  if (settings.stages.length <= 1) return { error: 'LAST_STAGE' };
  return { ...settings, stages: settings.stages.filter((s) => s.id !== stageId) };
}

export function addStage(settings: BookSettings, label: string): BookSettings | { error: StageEditError } {
  const trimmed = label.trim().slice(0, 60);
  if (!trimmed) return { error: 'EMPTY_LABEL' };
  if (settings.stages.length >= MAX_STAGES) return { error: 'TOO_MANY' };
  return { ...settings, stages: [...settings.stages, { id: newId(), label: trimmed }] };
}

export function renameStage(settings: BookSettings, stageId: string, label: string): BookSettings | { error: StageEditError } {
  const trimmed = label.trim().slice(0, 60);
  if (!trimmed) return { error: 'EMPTY_LABEL' };
  return { ...settings, stages: settings.stages.map((s) => (s.id === stageId ? { ...s, label: trimmed } : s)) };
}

export function moveStage(settings: BookSettings, stageId: string, delta: -1 | 1): BookSettings {
  const i = settings.stages.findIndex((s) => s.id === stageId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= settings.stages.length) return settings;
  const stages = settings.stages.slice();
  [stages[i], stages[j]] = [stages[j], stages[i]];
  return { ...settings, stages };
}
