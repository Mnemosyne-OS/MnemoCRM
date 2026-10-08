/**
 * Sales: the journal, the markets and their end-of-day report (doc 124 §6.3),
 * under the rule of §7.1 — the tax situation is DECLARED by the person, and the
 * screen says what MnemoCRM is not.
 */
import { useState } from 'react';
import { CalendarRange, Plus, Receipt, ShieldAlert, ShieldCheck, Store, Undo2 } from 'lucide-react';
import { useI18n } from '../i18n';
import { activeSales, saleTotal, summarize, voidsBySale, type ChainCheck } from '../model/journal';
import { marketReport } from '../model/market';
import { amountToInput, formatDay, formatInstant, formatMoney } from '../model/format';
import type { BookSettings, Client, Market, Payment, Product, SaleEntry, TaxStatus } from '../model/types';
import type { SaleOutcome } from '../data/useBook';
import { parseAmount } from '../model/deal';
import { ProductPhoto } from './ProductPhoto';

interface Props {
  journal: ChainCheck;
  markets: Market[];
  products: Product[];
  clients: Client[];
  settings: BookSettings;
  saving: boolean;
  onNewSale: (marketId?: string) => void;
  onNewMarket: () => void;
  onVoid: (sale: SaleEntry, reason: string) => Promise<SaleOutcome>;
  onSaveMarket: (market: Market) => Promise<boolean>;
  onDeclareTax: (status: TaxStatus) => void;
}

const PAYMENTS: readonly Payment[] = ['cash', 'card', 'transfer', 'other'];

export function SalesView(props: Props) {
  const { journal, markets, products, clients, settings, saving, onNewSale, onNewMarket, onVoid, onSaveMarket, onDeclareTax } = props;
  const { t, tc, lang } = useI18n();
  const [view, setView] = useState<'journal' | 'markets'>('journal');
  const [openMarket, setOpenMarket] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<SaleEntry | null>(null);
  const [reason, setReason] = useState('');
  const money = (n: number) => formatMoney(lang, settings.currency, n);
  const marketName = new Map(markets.map((m) => [m.id, m.name]));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const voided = voidsBySale(journal.entries);
  const sales = journal.entries.filter((e): e is SaleEntry => e.kind === 'sale').sort((a, b) => b.seq - a.seq);
  // Local calendar month, not the UTC one: a sale at 23:30 on the 31st belongs to that month.
  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const month = monthKey(new Date());
  const monthSummary = summarize(activeSales(journal.entries).filter((s) => monthKey(new Date(s.at)) === month));
  const market = markets.find((m) => m.id === openMarket);

  return (
    <div>
      <header className="crm-board-head">
        <h1>{t('nav.sales')}</h1>
        <div className="crm-board-tools">
          <div className="crm-seg" role="group">
            {(['journal', 'markets'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => { setView(v); setOpenMarket(null); }}>
                {t(`sales.view.${v}`)}
              </button>
            ))}
          </div>
          <button className="crm-btn" onClick={onNewMarket}>
            <Store size={14} aria-hidden="true" /> {t('market.new')}
          </button>
          <button className="crm-btn crm-btn-primary" onClick={() => onNewSale(openMarket ?? undefined)}>
            <Plus size={14} aria-hidden="true" /> {t('sale.new')}
          </button>
        </div>
      </header>

      <TaxLine status={settings.taxStatus} onDeclare={onDeclareTax} />

      {journal.broken ? (
        <div className="crm-notice crm-notice-danger" role="alert">
          <ShieldAlert size={16} aria-hidden="true" />
          <span>{t(`journal.broken.${journal.broken.reason}`, { seq: journal.broken.seq })}</span>
        </div>
      ) : (
        journal.entries.length > 0 && (
          <div className="crm-status-line crm-status-ok crm-journal-ok">
            <ShieldCheck size={14} aria-hidden="true" /> {tc('journal.intact', journal.entries.length)}
          </div>
        )
      )}

      {view === 'journal' && (
        <>
          <div className="crm-kpis">
            <div className="crm-kpi">
              <span>{t('sales.thisMonth')}</span>
              <b>{monthSummary.count === 0 ? '—' : money(monthSummary.total)}</b>
              <small>{tc('sales.count', monthSummary.count)}</small>
            </div>
            {PAYMENTS.filter((p) => monthSummary.byPayment[p] > 0).map((p) => (
              <div className="crm-kpi crm-kpi-small" key={p}>
                <span>{t(`payment.${p}`)}</span>
                <b>{money(monthSummary.byPayment[p])}</b>
              </div>
            ))}
          </div>

          {sales.length === 0 ? (
            <div className="crm-welcome">
              <h2>{t('sales.empty.title')}</h2>
              <p>{t('sales.empty.body')}</p>
              <button className="crm-btn crm-btn-primary crm-btn-lg" onClick={() => onNewSale()}>
                <Receipt size={18} aria-hidden="true" /> {t('sale.new')}
              </button>
            </div>
          ) : (
            <ol className="crm-journal">
              {sales.map((s) => {
                const v = voided.get(s.id);
                return (
                  <li key={s.id} className={`crm-journal-row${v ? ' crm-journal-voided' : ''}`}>
                    <span className="crm-journal-seq">#{s.seq}</span>
                    <div className="crm-journal-main">
                      <div className="crm-journal-lines">
                        {s.lines.map((l) => (l.qty > 1 ? `${l.qty} × ${l.label}` : l.label)).join(' · ')}
                      </div>
                      <div className="crm-journal-meta">
                        {formatInstant(lang, s.at)} · {s.place === 'market' ? marketName.get(s.marketId ?? '') ?? t('sale.place.market') : t(`sale.place.${s.place}`)} · {t(`payment.${s.payment}`)}
                        {s.clientId && <> · {clientName.get(s.clientId) ?? '—'}</>}
                      </div>
                      {v && <div className="crm-journal-void">{t('journal.voidedOn', { date: formatInstant(lang, v.recordedAt) })}{v.reason ? ` · ${v.reason}` : ''}</div>}
                    </div>
                    <span className="crm-journal-total">{formatMoney(lang, s.currency, saleTotal(s))}</span>
                    {!v && (
                      <button className="crm-icon-btn" aria-label={t('journal.void')} title={t('journal.void')} onClick={() => { setVoiding(s); setReason(''); }}>
                        <Undo2 size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}

      {view === 'markets' && !market && (
        markets.length === 0 ? (
          <div className="crm-welcome">
            <h2>{t('market.empty.title')}</h2>
            <p>{t('market.empty.body')}</p>
            <button className="crm-btn crm-btn-primary crm-btn-lg" onClick={onNewMarket}>
              <Store size={18} aria-hidden="true" /> {t('market.new')}
            </button>
          </div>
        ) : (
          <div className="crm-market-list">
            {[...markets].sort((a, b) => b.startDate.localeCompare(a.startDate)).map((m) => {
              const r = marketReport(m, journal.entries, products);
              return (
                <button key={m.id} className="crm-market-card" onClick={() => setOpenMarket(m.id)}>
                  <span className="crm-market-name"><Store size={16} aria-hidden="true" /> {m.name}</span>
                  <span className="crm-card-sub"><CalendarRange size={12} aria-hidden="true" /> {formatDay(lang, m.startDate, true)}{m.endDate && m.endDate !== m.startDate ? ` → ${formatDay(lang, m.endDate, true)}` : ''}</span>
                  <span className="crm-market-figures">
                    <b>{r.summary.count === 0 ? '—' : money(r.summary.total)}</b>
                    <small>{tc('sales.count', r.summary.count)}</small>
                  </span>
                </button>
              );
            })}
          </div>
        )
      )}

      {view === 'markets' && market && (
        <MarketReportView
          market={market}
          journal={journal}
          products={products}
          currency={settings.currency}
          saving={saving}
          onBack={() => setOpenMarket(null)}
          onNewSale={() => onNewSale(market.id)}
          onSaveMarket={onSaveMarket}
        />
      )}

      {voiding && (
        <div className="crm-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setVoiding(null)}>
          <form
            className="crm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm-void-title"
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await onVoid(voiding, reason);
              if (res.ok) setVoiding(null);
            }}
          >
            <h2 id="crm-void-title">{t('journal.voidTitle', { seq: voiding.seq })}</h2>
            <p className="crm-card-sub">{t('journal.voidBody')}</p>
            <label className="crm-field">
              <span>{t('journal.voidReason')}</span>
              <input className="crm-input" value={reason} autoFocus onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="crm-dialog-actions">
              <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setVoiding(null)}>{t('form.cancel')}</button>
              <button type="submit" className="crm-btn crm-btn-primary" disabled={saving}>{t('journal.voidConfirm')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/** The tax situation, declared once. Nothing is inferred from the country or the currency. */
function TaxLine({ status, onDeclare }: { status?: TaxStatus; onDeclare: (s: TaxStatus) => void }) {
  const { t } = useI18n();
  if (status === 'franchise') return null;
  if (status === 'vat' || status === 'other') {
    return (
      <div className="crm-notice" role="note">
        <ShieldAlert size={16} aria-hidden="true" />
        <span>{t(`tax.notice.${status}`)}</span>
      </div>
    );
  }
  return (
    <div className="crm-notice crm-tax-ask" role="note">
      <span>
        <b>{t('tax.ask.title')}</b>
        <br />
        {t('tax.ask.body')}
      </span>
      <div className="crm-tax-choices">
        {(['franchise', 'vat', 'other'] as const).map((s) => (
          <button key={s} className="crm-btn crm-btn-sm" onClick={() => onDeclare(s)}>{t(`tax.choice.${s}`)}</button>
        ))}
      </div>
    </div>
  );
}

function MarketReportView(props: {
  market: Market;
  journal: ChainCheck;
  products: Product[];
  currency: string;
  saving: boolean;
  onBack: () => void;
  onNewSale: () => void;
  onSaveMarket: (m: Market) => Promise<boolean>;
}) {
  const { market, journal, products, currency, saving, onBack, onNewSale, onSaveMarket } = props;
  const { t, tc, lang } = useI18n();
  const [counted, setCounted] = useState(amountToInput(lang, market.cashCount?.amount));
  const [countError, setCountError] = useState(false);
  const r = marketReport(market, journal.entries, products);
  const money = (n: number) => formatMoney(lang, currency, n);

  const saveCount = async () => {
    const amount = parseAmount(counted);
    if (amount === null || amount === undefined) return setCountError(true);
    setCountError(false);
    await onSaveMarket({ ...market, cashCount: { amount, at: new Date().toISOString() }, updatedAt: new Date().toISOString() });
  };

  return (
    <div className="crm-report">
      <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={onBack}>← {t('sales.view.markets')}</button>
      <header className="crm-report-head">
        <div>
          <h2>{market.name}</h2>
          <p className="crm-card-sub">
            {formatDay(lang, market.startDate, true)}
            {market.endDate && market.endDate !== market.startDate ? ` → ${formatDay(lang, market.endDate, true)}` : ''}
            {market.place ? ` · ${market.place}` : ''}
          </p>
        </div>
        <button className="crm-btn crm-btn-primary" onClick={onNewSale}>
          <Plus size={14} aria-hidden="true" /> {t('market.addSales')}
        </button>
      </header>

      <div className="crm-kpis">
        <div className="crm-kpi">
          <span>{t('market.total')}</span>
          <b>{r.summary.count === 0 ? '—' : money(r.summary.total)}</b>
          <small>{tc('sales.count', r.summary.count)}</small>
        </div>
        {PAYMENTS.map((p) => (
          <div className="crm-kpi crm-kpi-small" key={p}>
            <span>{t(`payment.${p}`)}</span>
            <b>{r.summary.byPayment[p] > 0 ? money(r.summary.byPayment[p]) : '—'}</b>
          </div>
        ))}
        <div className="crm-kpi crm-kpi-small">
          <span>{t('market.fee')}</span>
          <b>{market.standFee === undefined ? '—' : money(market.standFee)}</b>
        </div>
        <div className="crm-kpi crm-kpi-small">
          <span>{t('market.net')}</span>
          <b title={r.net === null ? t('market.netUnknown') : undefined}>{r.net === null ? '—' : money(r.net)}</b>
        </div>
      </div>

      <section className="crm-panel">
        <h2>{t('market.cash.title')}</h2>
        <p className="crm-card-sub">{t('market.cash.body', { amount: money(r.summary.byPayment.cash) })}</p>
        <div className="crm-followup-row">
          <label className="crm-field">
            <span>{t('market.cash.counted', { currency })}</span>
            <input className="crm-input" inputMode="decimal" value={counted} aria-invalid={countError} onChange={(e) => setCounted(e.target.value)} />
            {countError && <small className="crm-error-text">{t('deal.amountInvalid')}</small>}
          </label>
          <button className="crm-btn" disabled={saving || !counted.trim()} onClick={() => void saveCount()}>{t('market.cash.save')}</button>
        </div>
        {r.cashGap !== null && (
          <div className={`crm-status-line ${r.cashGap === 0 ? 'crm-status-ok' : 'crm-status-bad'}`} role="status">
            {r.cashGap === 0
              ? t('market.cash.match')
              : t(r.cashGap > 0 ? 'market.cash.more' : 'market.cash.less', { amount: money(Math.abs(r.cashGap)) })}
          </div>
        )}
      </section>

      {r.uniquesSold.length > 0 && (
        <section className="crm-panel">
          <h2>{tc('market.uniques', r.uniquesSold.length)}</h2>
          <div className="crm-report-pieces">
            {r.uniquesSold.map((p) => (
              <figure key={p.id} className="crm-report-piece">
                <ProductPhoto path={p.photoPath} emoji={p.emoji} name={p.name} sold />
                <figcaption>{p.name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
