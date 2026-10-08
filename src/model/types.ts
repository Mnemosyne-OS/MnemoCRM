/**
 * MnemoCRM record shapes (doc 124 §3).
 *
 * Every optional field is ABSENT when nobody typed it: never `0`, never `''`.
 * A client with no phone has no `phone` key, and the screen shows a dash.
 * `schema` travels in every file so a later version can read an older one.
 */

export const CLIENT_SCHEMA = 1 as const;

export type ClientKind = 'person' | 'company';

export type TimelineKind = 'note' | 'call' | 'meeting' | 'sale';

export interface TimelineEntry {
  id: string;
  /** ISO date-time of the exchange, as the person dated it. */
  at: string;
  kind: TimelineKind;
  text: string;
  /** Where it came from when it was not typed: a transcript file, a dictation. */
  source?: string;
}

export interface FollowUp {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  note?: string;
  /** True only once the host agenda REPORTED the event as added. */
  inAgenda?: boolean;
}

export interface ContactConsent {
  value: boolean;
  /** ISO date-time the person recorded the answer. */
  at: string;
}

export interface Client {
  schema: typeof CLIENT_SCHEMA;
  id: string;
  kind: ClientKind;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  address?: string;
  /** Where this client came from: "Christmas market Lyon 2025", "Instagram". */
  source?: string;
  tags: string[];
  contactConsent?: ContactConsent;
  followUp?: FollowUp;
  timeline: TimelineEntry[];
  /** Absent when the file carries no readable date: never replaced by "now". */
  createdAt?: string;
  updatedAt?: string;
}

// ── Lot 1: deals, stages, catalogue (doc 124 §3) ──────────────────────────

export const DEAL_SCHEMA = 1 as const;
export const PRODUCT_SCHEMA = 1 as const;
export const SETTINGS_SCHEMA = 1 as const;

/** A step of the person's own flow. The label is THEIR word, stored as data. */
export interface Stage {
  id: string;
  label: string;
}

/**
 * DECLARED by the person, never deduced (doc 124 §7.1). It decides what the
 * sales screen must say about cash-register rules; absent = not declared yet.
 */
export type TaxStatus = 'franchise' | 'vat' | 'other';

export interface BookSettings {
  schema: typeof SETTINGS_SCHEMA;
  stages: Stage[];
  /** ISO 4217 code, e.g. EUR. */
  currency: string;
  taxStatus?: TaxStatus;
  /** Set on a book created by "demo book": the screen says it is not real. */
  demo?: boolean;
  /** True only once the person turned it on: client notes are also written to the memory. */
  memory?: boolean;
}

export interface DealEvent {
  id: string;
  at: string;
  text: string;
}

export interface Deal {
  schema: typeof DEAL_SCHEMA;
  id: string;
  title: string;
  clientId?: string;
  stageId: string;
  /** In currency units. Absent when nobody typed an amount: never 0. */
  amount?: number;
  nextStep?: FollowUp;
  productIds: string[];
  history: DealEvent[];
  closed?: { at: string; outcome: 'won' | 'lost' };
  createdAt?: string;
  updatedAt?: string;
}

export type ProductKind = 'series' | 'unique';
export type UniqueStatus = 'available' | 'reserved' | 'sold';

export interface Product {
  schema: typeof PRODUCT_SCHEMA;
  id: string;
  name: string;
  kind: ProductKind;
  price?: number;
  /** Series only. Absent = stock not tracked, which is not "out of stock". */
  stock?: number;
  /** Unique pieces only. */
  status?: UniqueStatus;
  soldAt?: string;
  /** Absolute path of a picture the person chose. Never copied, never uploaded. */
  photoPath?: string;
  /** A pictogram shown large when there is no photo (or the photo cannot be read). */
  emoji?: string;
  /** Material, size, what makes it this piece. Free text; absent when nobody wrote any. */
  description?: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
}

// ── Lot 2: the sales journal and markets (doc 124 §6.3, §7.1) ─────────────

export const JOURNAL_SCHEMA = 1 as const;
export const MARKET_SCHEMA = 1 as const;

export type PlaceKind = 'workshop' | 'online' | 'market' | 'other';
export type Payment = 'cash' | 'card' | 'transfer' | 'other';

export interface SaleLine {
  /** Absent for a free line typed by hand. */
  productId?: string;
  label: string;
  qty: number;
  /** Required: a sale without a price is not a sale. */
  unitPrice: number;
}

/**
 * One line of the append-only journal. `hash` covers every other field and
 * `prevHash` is the previous line's hash, so any edit made outside MnemoCRM
 * breaks the chain where it happened, and the screen says where.
 */
interface EntryBase {
  schema: typeof JOURNAL_SCHEMA;
  id: string;
  /** 1, 2, 3… in the order lines were WRITTEN. */
  seq: number;
  /** When the line was written. */
  recordedAt: string;
  prevHash: string;
  hash: string;
}

export interface SaleEntry extends EntryBase {
  kind: 'sale';
  /** When the sale happened, as the person dated it (can be earlier than recordedAt). */
  at: string;
  place: PlaceKind;
  marketId?: string;
  lines: SaleLine[];
  payment: Payment;
  clientId?: string;
  currency: string;
}

/** A correction. The sale it cancels stays in the journal, struck through. */
export interface VoidEntry extends EntryBase {
  kind: 'void';
  voids: string;
  reason?: string;
}

export type JournalEntry = SaleEntry | VoidEntry;

export interface Market {
  schema: typeof MARKET_SCHEMA;
  id: string;
  name: string;
  place?: string;
  /** YYYY-MM-DD */
  startDate: string;
  endDate?: string;
  standFee?: number;
  /** The cash the person COUNTED in the box. Compared, never corrected. */
  cashCount?: { amount: number; at: string };
  createdAt?: string;
  updatedAt?: string;
}
