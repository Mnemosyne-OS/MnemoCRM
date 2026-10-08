/**
 * DEV ONLY — render MnemoCRM's screens on the demo book without a host, so a
 * layout can be LOOKED at (overlaps, clipped labels) before a person opens it.
 * Loaded by preview.html, which the production build does not include.
 * `?tab=analytics|catalog|today|sales` picks the screen; `?lang=` the language.
 */
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '../styles.css';
import { buildDemoBook } from '../model/demo';
import { localDay } from '../model/client';
import { getLanguage, translate } from '../i18n';
import { AnalyticsView } from '../components/AnalyticsView';
import { CatalogView } from '../components/CatalogView';
import { TodayView } from '../components/TodayView';
import { SalesView } from '../components/SalesView';
import { ImportDialog } from '../components/ImportDialog';
import { LicenseDialog } from '../components/LicenseDialog';

const today = localDay();
const book = buildDemoBook(getLanguage(), today, (id) => translate(`stage.${id}`));
const journal = { entries: book.journal, broken: null };
const noop = () => {};
const reject = async () => ({ ok: false as const, error: 'PREVIEW' });

function Preview() {
  const params = new URLSearchParams(location.search);
  const [tab, setTab] = useState(params.get('tab') ?? 'analytics');
  // ?scroll=N lands the page at a position, so a screenshot can show any section.
  useEffect(() => {
    const y = Number(params.get('scroll'));
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div style={{ padding: 32, maxWidth: 1400, margin: '0 auto' }}>
      <nav style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {['analytics', 'today', 'catalog', 'sales', 'import', 'license'].map((t) => (
          <button key={t} className="crm-btn" aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>
      {tab === 'analytics' && (
        <AnalyticsView journal={journal} clients={book.clients} deals={book.deals} products={book.products} markets={book.markets} settings={book.settings} today={today} onOpenClient={noop} />
      )}
      {tab === 'today' && <TodayView clients={book.clients} deals={book.deals} today={today} onOpenClient={noop} onOpenDeal={noop} onNew={noop} />}
      {tab === 'catalog' && <CatalogView products={book.products} currency="EUR" saving={false} onOpen={noop} onNew={noop} onSave={async () => false} />}
      {tab === 'import' && (
        <ImportDialog clients={book.clients} products={book.products} license="inactive" initialTarget="products"
          onImport={async () => ({ written: 0, failed: [] })} onPdf={noop} onLicense={noop} onClose={noop} />
      )}
      {tab === 'license' && <LicenseDialog reason="pdf" onRecheck={async () => 'inactive'} onClose={noop} />}
      {tab === 'sales' && (
        <SalesView journal={journal} markets={book.markets} products={book.products} clients={book.clients} settings={book.settings} saving={false}
          onNewSale={noop} onNewMarket={noop} onVoid={reject} onSaveMarket={async () => false} onDeclareTax={noop} />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);
