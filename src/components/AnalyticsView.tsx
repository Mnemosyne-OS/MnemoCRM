/**
 * Analyses: what the book says when you step back. One headline figure (the
 * revenue of the period against the one before), then the shape of the sales,
 * who buys, what sells, where and how people pay, how the markets went, the
 * deals pipeline, and the book's health (cancellations, cash gaps, what is
 * late). Every number comes from model/analytics.ts; every chart has a table.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react';
import { useI18n } from '../i18n';
import {
  PAYMENTS,
  PLACES,
  firstSaleDay,
  headline,
  health,
  marketRows,
  periodRange,
  pipeline,
  revenueSeries,
  salesBetween,
  splitBy,
  topClients,
  topProducts,
  type Period,
} from '../model/analytics';
import { formatMoney } from '../model/format';
import type { ChainCheck } from '../model/journal';
import type { BookSettings, Client, Deal, Market, Product } from '../model/types';
import { AreaChart, DataTable, HBars, Sparkline } from './charts';

interface Props {
  journal: ChainCheck;
  clients: Client[];
  deals: Deal[];
  products: Product[];
  markets: Market[];
  settings: BookSettings;
  today: string;
  onOpenClient: (id: string) => void;
}

const PERIODS: readonly Period[] = ['30d', '90d', '12m', 'all'];

export function AnalyticsView({ journal, clients, deals, products, markets, settings, today, onOpenClient }: Props) {
  const { t, tc, lang } = useI18n();
  const [period, setPeriod] = useState<Period>('90d');
  const money = (n: number) => formatMoney(lang, settings.currency, n);
  const pct = (r: number) => new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: r < 0.1 ? 1 : 0 }).format(r);

  const data = useMemo(() => {
    const range = periodRange(period, today, firstSaleDay(journal.entries));
    const sales = salesBetween(journal.entries, range.from, range.to);
    const rows = marketRows(markets, journal.entries, products);
    return {
      range,
      sales,
      head: headline(journal.entries, range),
      series: revenueSeries(sales, range),
      clients: topClients(sales, clients),
      products: topProducts(sales, products),
      places: splitBy(sales, (s) => s.place, PLACES),
      payments: splitBy(sales, (s) => s.payment, PAYMENTS),
      markets: rows.filter((r) => r.market.startDate <= range.to && (r.market.endDate ?? r.market.startDate) >= range.from),
      pipe: pipeline(deals, settings, t('stages.unknown')),
      health: health(journal.entries, range, clients, deals, products, rows, today, !!journal.broken),
    };
  }, [period, today, journal, clients, deals, products, markets, settings, t]);

  const dayFmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
  const monthFmt = new Intl.DateTimeFormat(lang, { month: 'short', year: '2-digit' });
  const labelOf = (start: string) => {
    const [y, m, d] = start.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return data.range.bucket === 'month' ? monthFmt.format(date) : dayFmt.format(date);
  };
  const tipTitle = (start: string) => (data.range.bucket === 'week' ? t('analytics.weekOf', { date: labelOf(start) }) : labelOf(start));

  const h = data.head;
  const hasSales = data.sales.length > 0;

  return (
    <div className="crm-analytics">
      <header className="crm-board-head">
        <h1>{t('nav.analytics')}</h1>
        <div className="crm-seg" role="radiogroup" aria-label={t('analytics.period')}>
          {PERIODS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={period === p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {t(`analytics.period.${p}`)}
            </button>
          ))}
        </div>
      </header>

      {/* ── The headline ────────────────────────────────── */}
      <section className="crm-hero">
        <div className="crm-hero-main">
          <span className="crm-hero-label">{t('analytics.revenue')}</span>
          <span className="crm-hero-value">{hasSales ? money(h.revenue) : '—'}</span>
          {h.delta !== null ? (
            <span className={`crm-hero-delta ${h.delta >= 0 ? 'crm-status-ok' : 'crm-status-bad'}`}>
              {h.delta >= 0 ? <TrendingUp size={16} aria-hidden="true" /> : <TrendingDown size={16} aria-hidden="true" />}
              {h.delta >= 0 ? '+' : ''}
              {pct(h.delta)} {t('analytics.vsPrevious', { amount: money(h.previousRevenue ?? 0) })}
            </span>
          ) : (
            <span className="crm-card-sub">{data.range.previous ? t('analytics.noPrevious') : t('analytics.allTime')}</span>
          )}
        </div>
        <Sparkline values={data.series.map((p) => p.total)} />
        <div className="crm-hero-tiles">
          <div className="crm-kpi crm-kpi-small">
            <span>{t('analytics.sales')}</span>
            <b>{h.count}</b>
          </div>
          <div className="crm-kpi crm-kpi-small">
            <span>{t('analytics.basket')}</span>
            <b>{h.basket === null ? '—' : money(h.basket)}</b>
          </div>
          <div className="crm-kpi crm-kpi-small">
            <span>{t('analytics.winRate')}</span>
            <b>{data.pipe.winRate === null ? '—' : pct(data.pipe.winRate)}</b>
          </div>
        </div>
      </section>

      {!hasSales && <div className="crm-col-empty">{t('analytics.empty')}</div>}

      {/* ── Sales over time ─────────────────────────────── */}
      {hasSales && (
        <section className="crm-panel">
          <h2>{t(`analytics.over.${data.range.bucket}`)}</h2>
          <AreaChart
            ariaLabel={t(`analytics.over.${data.range.bucket}`)}
            format={(v) => money(v)}
            points={data.series.map((p) => ({
              key: p.start,
              value: p.total,
              label: labelOf(p.start),
              tip: [tipTitle(p.start), money(p.total), tc('sales.count', p.count)],
            }))}
          />
          <DataTable
            summary={t('analytics.table')}
            head={[t('analytics.col.period'), t('analytics.col.revenue'), t('analytics.col.sales')]}
            rows={data.series.map((p) => [tipTitle(p.start), money(p.total), p.count])}
          />
        </section>
      )}

      {hasSales && (
        <div className="crm-analytics-grid">
          {/* ── Best clients ─────────────────────────────── */}
          <section className="crm-panel">
            <h2>{t('analytics.topClients')}</h2>
            {data.clients.length === 0 ? (
              <p className="crm-card-sub">{t('analytics.noKnownClient')}</p>
            ) : (
              <HBars
                ariaLabel={t('analytics.topClients')}
                rows={data.clients.map((c) => ({
                  id: c.id,
                  label: (
                    <button className="crm-link" onClick={() => onOpenClient(c.id)}>
                      {c.label}
                    </button>
                  ),
                  value: c.revenue,
                  display: money(c.revenue),
                  tip: [c.label, money(c.revenue), tc('sales.count', c.count)],
                }))}
              />
            )}
            {data.health.knownClientShare !== null && (
              <p className="crm-card-sub">{t('analytics.knownShare', { share: pct(data.health.knownClientShare) })}</p>
            )}
          </section>

          {/* ── Best pieces ──────────────────────────────── */}
          <section className="crm-panel">
            <h2>{t('analytics.topProducts')}</h2>
            <HBars
              ariaLabel={t('analytics.topProducts')}
              rows={data.products.map((p) => ({
                id: p.id,
                label: (
                  <span className="crm-hbar-product">
                    {p.emoji && <span className="crm-hbar-emoji" aria-hidden="true">{p.emoji}</span>}
                    {p.label}
                  </span>
                ),
                value: p.revenue,
                display: money(p.revenue),
                tip: [p.label, money(p.revenue), t('analytics.units', { count: p.count })],
              }))}
            />
          </section>

          {/* ── Where and how ────────────────────────────── */}
          <section className="crm-panel">
            <h2>{t('analytics.byPlace')}</h2>
            <HBars
              ariaLabel={t('analytics.byPlace')}
              rows={data.places.map((r) => ({
                id: r.key,
                label: t(`sale.place.${r.key}`),
                value: r.revenue,
                display: r.revenue > 0 ? money(r.revenue) : money(0),
                tip: [t(`sale.place.${r.key}`), money(r.revenue), tc('sales.count', r.count)],
              }))}
            />
          </section>

          <section className="crm-panel">
            <h2>{t('analytics.byPayment')}</h2>
            <HBars
              ariaLabel={t('analytics.byPayment')}
              rows={data.payments.map((r) => ({
                id: r.key,
                label: t(`payment.${r.key}`),
                value: r.revenue,
                display: money(r.revenue),
                tip: [t(`payment.${r.key}`), money(r.revenue), h.revenue > 0 ? pct(r.revenue / h.revenue) : '—'],
              }))}
            />
          </section>
        </div>
      )}

      {/* ── Markets ─────────────────────────────────────── */}
      {data.markets.length > 0 && (
        <section className="crm-panel">
          <h2>{t('analytics.markets')}</h2>
          <table className="crm-market-table">
            <thead>
              <tr>
                <th>{t('market.one')}</th>
                <th>{t('market.total')}</th>
                <th>{t('analytics.sales')}</th>
                <th>{t('market.net')}</th>
                <th>{t('analytics.cashGap')}</th>
              </tr>
            </thead>
            <tbody>
              {data.markets.map((m) => (
                <tr key={m.market.id}>
                  <td>{m.market.name}</td>
                  <td>{m.count === 0 ? '—' : money(m.revenue)}</td>
                  <td>{m.count}</td>
                  <td>{m.net === null ? '—' : money(m.net)}</td>
                  <td>
                    {m.cashGap === null ? (
                      <span className="crm-card-sub">{t('analytics.notCounted')}</span>
                    ) : m.cashGap === 0 ? (
                      <span className="crm-status-ok"><CheckCircle2 size={14} aria-hidden="true" /> {t('analytics.gapNone')}</span>
                    ) : (
                      <span className="crm-status-bad"><AlertTriangle size={14} aria-hidden="true" /> {m.cashGap > 0 ? '+' : '−'}{money(Math.abs(m.cashGap))}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Pipeline ────────────────────────────────────── */}
      <section className="crm-panel">
        <h2>{t('analytics.pipeline')}</h2>
        <HBars
          ariaLabel={t('analytics.pipeline')}
          rows={data.pipe.stages.map((s) => ({
            id: s.id ?? '__orphan',
            label: s.label,
            value: s.count,
            display: `${s.count} · ${s.partial ? '≥ ' : ''}${money(s.value)}`,
            tip: [s.label, t('analytics.dealsCount', { count: s.count }), `${s.partial ? '≥ ' : ''}${money(s.value)}`],
          }))}
        />
        <p className="crm-card-sub">
          {t('analytics.closed', { won: data.pipe.won, lost: data.pipe.lost })}
          {data.pipe.winRate !== null && ` · ${t('analytics.winRate')} ${pct(data.pipe.winRate)}`}
        </p>
      </section>

      {/* ── Health ──────────────────────────────────────── */}
      <section className="crm-panel">
        <h2>{t('analytics.health')}</h2>
        <ul className="crm-health">
          <HealthRow
            ok={!data.health.journalBroken}
            icon={data.health.journalBroken ? <ShieldAlert size={16} /> : <ShieldCheck size={16} />}
            label={t('analytics.h.journal')}
            value={data.health.journalBroken ? t('analytics.h.journalBroken') : t('analytics.h.journalOk')}
          />
          <HealthRow
            ok={(data.health.cancelRate ?? 0) <= 0.05}
            label={t('analytics.h.cancel')}
            value={data.health.cancelRate === null ? '—' : `${pct(data.health.cancelRate)} (${data.health.cancelled})`}
          />
          <HealthRow
            ok={(data.health.cashGapTotal ?? 0) === 0}
            label={t('analytics.h.cash')}
            value={data.health.cashGapTotal === null ? t('analytics.h.cashNone') : `${money(data.health.cashGapTotal)} · ${t('analytics.h.cashMarkets', { count: data.health.countedMarkets })}`}
          />
          <HealthRow ok={data.health.overdueFollowUps === 0} label={t('analytics.h.overdue')} value={String(data.health.overdueFollowUps)} />
          <HealthRow ok={data.health.openDealsWithoutStep === 0} label={t('analytics.h.noStep')} value={String(data.health.openDealsWithoutStep)} />
          <HealthRow ok={data.health.outOfStock === 0} label={t('analytics.h.outOfStock')} value={String(data.health.outOfStock)} />
        </ul>
      </section>
    </div>
  );
}

/** A health line: an icon AND a word, never colour alone. */
function HealthRow({ ok, label, value, icon }: { ok: boolean; label: string; value: string; icon?: JSX.Element }) {
  const { t } = useI18n();
  return (
    <li className="crm-health-row">
      <span className={ok ? 'crm-status-ok' : 'crm-status-bad'} aria-hidden="true">
        {icon ?? (ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />)}
      </span>
      <span className="crm-health-label">{label}</span>
      <span className="crm-health-value">{value}</span>
      <span className="crm-visually-hidden">{ok ? t('analytics.h.good') : t('analytics.h.attention')}</span>
    </li>
  );
}
