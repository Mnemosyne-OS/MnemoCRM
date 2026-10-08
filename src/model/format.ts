/**
 * Display helpers: dates in the reader's language, initials, avatar hue.
 * Pure, so they are testable without a DOM.
 */
import { daysBetween, isValidDay } from './client';

function dayToDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "mardi 24 septembre" in the reader's language. An unreadable day renders a dash. */
export function formatDay(lang: string, day: string, withYear = false): string {
  if (!isValidDay(day)) return '—';
  return new Intl.DateTimeFormat(lang, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(dayToDate(day));
}

/** "today", "tomorrow", "3 days ago", "in 5 days". */
export function relativeDay(lang: string, today: string, day: string): string {
  if (!isValidDay(day) || !isValidDay(today)) return '—';
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  return rtf.format(daysBetween(today, day), 'day');
}

/** Date and time of a history entry. An unreadable instant renders a dash. */
export function formatInstant(lang: string, iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/**
 * A stable hue per name, so a client keeps the same colour on every screen and
 * every machine. Derived, never stored: renaming changes it, on purpose.
 */
export function avatarHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 360;
}

/** "1 200,50 €" in the reader's language. */
export function formatMoney(lang: string, currency: string, amount: number): string {
  try {
    // Whole amounts drop the decimals; min AND max are both set, or Intl throws (min 2 > max 0).
    const digits = amount % 1 === 0 ? 0 : 2;
    return new Intl.NumberFormat(lang, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
  } catch (err) {
    // An unknown currency code must not blank the board.
    console.warn('[mnemo-crm] currency not formattable:', currency, err);
    return `${amount} ${currency}`;
  }
}

/** A total that is only a floor (some amounts missing) says so with ≥. No total at all is a dash. */
export function formatTotal(lang: string, currency: string, total: { sum: number; partial: boolean } | null): string {
  if (!total) return '—';
  return `${total.partial ? '≥ ' : ''}${formatMoney(lang, currency, total.sum)}`;
}

/** An amount as typed back into a field: "12,5" in French, "12.5" in English. */
export function amountToInput(lang: string, amount: number | undefined): string {
  if (amount === undefined) return '';
  return new Intl.NumberFormat(lang, { useGrouping: false, maximumFractionDigits: 2 }).format(amount);
}
