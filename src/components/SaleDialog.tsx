/**
 * Write one sale (doc 124 §6.1-6.3). Built for the evening after a market:
 * "save and next" keeps the place, the market and the day, so a notebook of
 * twenty sales goes in without re-choosing anything.
 */
import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n';
import { parseAmount } from '../model/deal';
import { amountToInput, formatMoney } from '../model/format';
import { isOutOfStock, stockOverrun } from '../model/product';
import { marketOn } from '../model/market';
import type { Client, Market, Payment, PlaceKind, Product, SaleLine } from '../model/types';
import type { SaleOutcome } from '../data/useBook';
import type { SaleDraft } from '../model/journal';
import { ProductPhoto } from './ProductPhoto';

interface Props {
  products: Product[];
  clients: Client[];
  markets: Market[];
  currency: string;
  today: string;
  saving: boolean;
  presetMarketId?: string;
  onRecord: (draft: SaleDraft) => Promise<SaleOutcome>;
  onClose: () => void;
}

interface DraftLine {
  key: string;
  productId?: string;
  label: string;
  qty: number;
  /** As typed, so "12," is not rewritten under the person's fingers. */
  price: string;
}

const PLACES: readonly PlaceKind[] = ['workshop', 'market', 'online', 'other'];
const PAYMENTS: readonly Payment[] = ['cash', 'card', 'transfer', 'other'];

function localDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SaleDialog({ products, clients, markets, currency, today, saving, presetMarketId, onRecord, onClose }: Props) {
  const { t, lang } = useI18n();
  const preset = markets.find((m) => m.id === presetMarketId) ?? marketOn(markets, today);
  const [place, setPlace] = useState<PlaceKind>(presetMarketId || marketOn(markets, today) ? 'market' : 'workshop');
  const [marketId, setMarketId] = useState(preset?.id ?? '');
  const [when, setWhen] = useState(() =>
    // A market already over: the sale happened on its day, not now.
    preset && preset.startDate < today ? `${preset.endDate ?? preset.startDate}T12:00` : localDateTime(new Date()),
  );
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [payment, setPayment] = useState<Payment>('cash');
  const [clientId, setClientId] = useState('');
  const [freeLabel, setFreeLabel] = useState('');
  const [freePrice, setFreePrice] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ seq: number; stockProblem?: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sellable = useMemo(
    () =>
      products
        .filter((p) => p.kind === 'series' || p.status !== 'sold')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

  const addProduct = (p: Product) => {
    setProblem(null);
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        if (p.kind === 'unique') return prev; // one of a kind: it cannot be sold twice
        return prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { key: `${p.id}-${Date.now()}`, productId: p.id, label: p.name, qty: 1, price: amountToInput(lang, p.price) }];
    });
  };

  const addFree = () => {
    if (!freeLabel.trim()) return;
    setLines((prev) => [...prev, { key: `free-${Date.now()}`, label: freeLabel.trim(), qty: 1, price: freePrice }]);
    setFreeLabel('');
    setFreePrice('');
  };

  const parsed = lines.map((l) => ({ ...l, unitPrice: parseAmount(l.price) }));
  const total = parsed.every((l) => typeof l.unitPrice === 'number')
    ? Math.round(parsed.reduce((acc, l) => acc + l.qty * (l.unitPrice as number), 0) * 100) / 100
    : null;

  const record = async (next: boolean) => {
    if (lines.length === 0) return setProblem(t('sale.noLine'));
    if (parsed.some((l) => typeof l.unitPrice !== 'number')) return setProblem(t('sale.priceMissing'));
    if (place === 'market' && !marketId) return setProblem(t('sale.marketMissing'));
    const at = new Date(when);
    if (!Number.isFinite(at.getTime())) return setProblem(t('sale.dateInvalid'));
    const saleLines: SaleLine[] = parsed.map((l) => ({
      ...(l.productId ? { productId: l.productId } : {}),
      label: l.label,
      qty: l.qty,
      unitPrice: l.unitPrice as number,
    }));
    const outcome = await onRecord({
      at: at.toISOString(),
      place,
      ...(place === 'market' ? { marketId } : {}),
      lines: saleLines,
      payment,
      ...(clientId ? { clientId } : {}),
      currency,
    });
    if (!outcome.ok) return setProblem(t('error.save', { error: outcome.error }));
    setDone({ seq: outcome.entry.seq, stockProblem: outcome.stockProblem });
    if (next) {
      setLines([]);
      setClientId('');
      setProblem(null);
    } else if (!outcome.stockProblem) onClose();
  };

  return (
    <div className="crm-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="crm-dialog crm-dialog-wide crm-sale" role="dialog" aria-modal="true" aria-labelledby="crm-sale-title">
        <h2 id="crm-sale-title">{t('sale.newTitle')}</h2>

        <div className="crm-sale-where">
          <div className="crm-seg" role="group" aria-label={t('sale.place')}>
            {PLACES.map((p) => (
              <button key={p} type="button" aria-pressed={place === p} onClick={() => setPlace(p)}>
                {t(`sale.place.${p}`)}
              </button>
            ))}
          </div>
          {place === 'market' &&
            (markets.length === 0 ? (
              <span className="crm-error-text">{t('sale.noMarketYet')}</span>
            ) : (
              <select className="crm-input crm-sale-market" value={marketId} onChange={(e) => setMarketId(e.target.value)} aria-label={t('market.one')}>
                <option value="">{t('sale.pickMarket')}</option>
                {[...markets].sort((a, b) => b.startDate.localeCompare(a.startDate)).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            ))}
          <input className="crm-input crm-sale-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label={t('sale.when')} />
        </div>

        {sellable.length > 0 && (
          <div className="crm-sale-grid" role="group" aria-label={t('nav.catalog')}>
            {sellable.map((p) => {
              const inCart = lines.some((l) => l.productId === p.id);
              return (
                <button key={p.id} type="button" className={`crm-sale-tile${inCart ? ' crm-sale-tile-in' : ''}`} onClick={() => addProduct(p)}>
                  <ProductPhoto path={p.photoPath} emoji={p.emoji} name={p.name} />
                  <span className="crm-sale-tile-name">{p.name}</span>
                  <span className="crm-sale-tile-price">
                    {p.price !== undefined ? formatMoney(lang, currency, p.price) : '—'}
                    {isOutOfStock(p) && <em className="crm-status-bad"> · {t('product.outOfStock')}</em>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="crm-sale-free">
          <input className="crm-input" value={freeLabel} placeholder={t('sale.freeLabel')} onChange={(e) => setFreeLabel(e.target.value)} />
          <input className="crm-input crm-sale-price" inputMode="decimal" value={freePrice} placeholder={currency} onChange={(e) => setFreePrice(e.target.value)} />
          <button type="button" className="crm-btn" onClick={addFree} disabled={!freeLabel.trim()}>
            <Plus size={14} aria-hidden="true" /> {t('sale.addLine')}
          </button>
        </div>

        {lines.length > 0 && (
          <ul className="crm-sale-lines">
            {parsed.map((l) => {
              const product = products.find((p) => p.id === l.productId);
              const overrun = stockOverrun(product, l.qty);
              return (
                <li key={l.key} className="crm-sale-line">
                  <span className="crm-sale-line-label">
                    {l.label}
                    {overrun !== null && (
                      <em className="crm-status-bad" role="status"> · {t('sale.overStock', { stock: overrun })}</em>
                    )}
                  </span>
                  <span className="crm-sale-qty">
                    <button type="button" className="crm-icon-btn" aria-label={t('product.stockMinus')} disabled={l.qty <= 1}
                      onClick={() => setLines((prev) => prev.map((x) => (x.key === l.key ? { ...x, qty: x.qty - 1 } : x)))}>
                      <Minus size={14} />
                    </button>
                    <b>{l.qty}</b>
                    <button type="button" className="crm-icon-btn" aria-label={t('product.stockPlus')} disabled={product?.kind === 'unique'}
                      onClick={() => setLines((prev) => prev.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))}>
                      <Plus size={14} />
                    </button>
                  </span>
                  <input
                    className="crm-input crm-sale-price"
                    inputMode="decimal"
                    value={l.price}
                    aria-invalid={typeof l.unitPrice !== 'number'}
                    aria-label={t('product.price', { currency })}
                    onChange={(e) => setLines((prev) => prev.map((x) => (x.key === l.key ? { ...x, price: e.target.value } : x)))}
                  />
                  <button type="button" className="crm-icon-btn" aria-label={t('stages.remove')} onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}>
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="crm-sale-bottom">
          <div className="crm-seg" role="group" aria-label={t('sale.payment')}>
            {PAYMENTS.map((p) => (
              <button key={p} type="button" aria-pressed={payment === p} onClick={() => setPayment(p)}>
                {t(`payment.${p}`)}
              </button>
            ))}
          </div>
          <select className="crm-input crm-sale-client" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label={t('deal.client')}>
            <option value="">{t('sale.anonymous')}</option>
            {[...clients].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="crm-sale-total" aria-live="polite">{total === null ? '—' : formatMoney(lang, currency, total)}</div>
        </div>

        {problem && <p className="crm-error-text" role="alert">{problem}</p>}
        {done && (
          <div className={`crm-status-line ${done.stockProblem ? 'crm-status-bad' : 'crm-status-ok'}`} role="status">
            {done.stockProblem ? t('sale.stockNotUpdated', { names: done.stockProblem }) : t('sale.recorded', { seq: done.seq })}
          </div>
        )}

        <div className="crm-dialog-actions">
          <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>{done ? t('error.dismiss') : t('form.cancel')}</button>
          <button type="button" className="crm-btn" disabled={saving} onClick={() => void record(true)}>{t('sale.saveNext')}</button>
          <button type="button" className="crm-btn crm-btn-primary" disabled={saving} onClick={() => void record(false)}>
            {saving ? t('saving') : t('sale.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
