/**
 * MnemoCRM — the customer book of a small business, a freelancer or a
 * craftsperson (doc 124). Lot 0: clients and follow-ups. Lot 1: deals in the
 * person's own stages, and a catalogue of series and unique pieces. Everything
 * is stored as files in a folder the person chose.
 */
import { useEffect, useRef, useState } from 'react';
import { BarChart3, Briefcase, CalendarDays, FileUp, FlaskConical, FolderOpen, Mic, Package, Receipt, Search, Settings, Undo2, UserPlus, Users } from 'lucide-react';
import { getLanguage, useI18n } from './i18n';
import { addTimelineEntry, contactRefused, createClient, localDay } from './model/client';
import { planDay } from './model/day';
import { createDeal, moveDeal } from './model/deal';
import type { Proposal } from './model/proposal';
import { addFollowUpToAgenda } from './data/host';
import type { Client, Deal, Product } from './model/types';
import { useBook } from './data/useBook';
import { TodayView } from './components/TodayView';
import { ClientsView } from './components/ClientsView';
import { ClientForm } from './components/ClientForm';
import { DealsBoard } from './components/DealsBoard';
import { DealDialog } from './components/DealDialog';
import { SettingsView } from './components/SettingsView';
import { AnalyticsView } from './components/AnalyticsView';
import { buildDemoBook } from './model/demo';
import { openFolderInOS } from './data/host';
import { CatalogView } from './components/CatalogView';
import { ProductDialog } from './components/ProductDialog';
import { SalesView } from './components/SalesView';
import { SaleDialog } from './components/SaleDialog';
import { MarketDialog } from './components/MarketDialog';
import { CaptureDialog } from './components/CaptureDialog';
import { ImportDialog } from './components/ImportDialog';
import { PdfImportDialog } from './components/PdfImportDialog';
import { LicenseDialog, type LicenseReason } from './components/LicenseDialog';
import { mayCreate } from './model/license';
import type { ImportTarget } from './model/importMap';
// Imported, not referenced as './icon.svg': a runtime string is not copied into
// dist/, so the packaged cartridge would show a broken image.
import iconUrl from '../icon.svg';

type Tab = 'today' | 'clients' | 'deals' | 'catalog' | 'sales' | 'analytics' | 'settings';

type Dialog =
  | { kind: 'client'; client?: Client }
  | { kind: 'deal'; deal?: Deal; stageId?: string; clientId?: string }
  | { kind: 'product'; product?: Product }
  | { kind: 'sale'; marketId?: string }
  | { kind: 'market' }
  | { kind: 'capture'; client?: Client }
  | { kind: 'import'; target: ImportTarget }
  | { kind: 'pdf' };

/** The day, refreshed each minute so "today" turns over at midnight. */
function useToday(): string {
  const [today, setToday] = useState(() => localDay());
  useEffect(() => {
    const id = window.setInterval(() => setToday(localDay()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return today;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

/** Known refusal codes get a sentence; anything else is shown raw rather than hidden. */
function saveErrorText(t: (k: string, v?: Record<string, string | number>) => string, error: string): string {
  if (error === 'SETTINGS_UNREADABLE') return t('stages.locked');
  return t('error.save', { error });
}

export default function App() {
  const { t, tc } = useI18n();
  const book = useBook();
  const today = useToday();
  const [tab, setTab] = useState<Tab>('today');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /** Over every other dialog: a form stays open under it, so nothing typed is lost. */
  const [licenseAsk, setLicenseAsk] = useState<LicenseReason | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const ready = book.status.kind === 'ready';
  // Memory lines carry the kind in the person's language.
  book.setKindLabel((k) => t(`entry.${k}`));

  // "/" searches, "n" adds a client, like the tools people already know.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (dialog || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        newClient();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dialog, book.license, book.clients, book.products]);

  // The free limit bounds CREATION: the button asks for a license instead of
  // opening a form that could not be saved. Unknown never refuses (doc 124 §14).
  function newClient() {
    if (mayCreate('clients', book.license, book.clients, book.products)) setDialog({ kind: 'client' });
    else setLicenseAsk('clients');
  }
  function newProduct() {
    if (mayCreate('products', book.license, book.clients, book.products)) setDialog({ kind: 'product' });
    else setLicenseAsk('products');
  }
  const limitReason = licenseAsk ?? book.limitHit;

  const openClient = (id: string) => {
    setSelectedId(id);
    setTab('clients');
  };
  const openDeal = (id: string) => {
    const deal = book.deals.find((d) => d.id === id);
    if (deal) setDialog({ kind: 'deal', deal });
  };

  // ── Full-page states: booting, no folder yet, loading, error ─────────────
  if (book.status.kind === 'booting' || book.status.kind === 'loading') {
    return (
      <div className="crm-center" aria-busy="true">
        <div className="crm-center-card">
          <div className="crm-spinner" />
          <p>{t('boot.loading')}</p>
        </div>
      </div>
    );
  }

  if (book.status.kind === 'noFolder') {
    return (
      <div className="crm-center">
        <div className="crm-center-card">
          <img className="crm-hero-icon" src={iconUrl} alt="" />
          <h1>{t('onboard.title')}</h1>
          <p>{t('onboard.body')}</p>
          <button className="crm-btn crm-btn-primary crm-btn-lg" onClick={() => void book.chooseFolder()}>
            <FolderOpen size={18} aria-hidden="true" /> {t('onboard.pick')}
          </button>
          {book.status.bridgeError && (
            <p className="crm-error-text" role="alert">{t('onboard.bridge', { error: book.status.bridgeError })}</p>
          )}
        </div>
      </div>
    );
  }

  if (book.status.kind === 'error') {
    return (
      <div className="crm-center">
        <div className="crm-center-card">
          <h1>{t('error.title')}</h1>
          <p className="crm-error-text" role="alert">{book.status.message}</p>
          <p>{t('folder.current', { path: book.status.folder })}</p>
          <div className="crm-dialog-actions">
            <button className="crm-btn" onClick={() => void book.chooseFolder()}>{t('error.changeFolder')}</button>
            <button className="crm-btn crm-btn-primary" onClick={book.reload}>{t('error.retry')}</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Ready ────────────────────────────────────────────────────────────────
  const plan = planDay(book.clients, book.deals, today);
  const due = plan.overdue.length + plan.today.length;
  const openDeals = book.deals.filter((d) => !d.closed).length;

  const saveDeal = async (deal: Deal) => {
    // The first deal writes the starter stages to disk, so its stageId means something next time.
    if (!(await book.ensureSettingsWritten())) return false;
    return book.upsertDeal(deal);
  };

  /**
   * Write a proposal the person has read and corrected. Each step writes to
   * disk first; the agenda and the deal come after, and anything that could
   * not follow is SAID in the flash line instead of vanishing.
   */
  const applyProposal = async (p: Proposal, source?: string): Promise<boolean> => {
    let client = p.clientId ? book.clients.find((c) => c.id === p.clientId) : undefined;
    if (!client && p.newClientName) {
      const created = createClient({ kind: 'person', name: p.newClientName });
      if (!created || !(await book.upsertClient(created))) return false;
      client = created;
    }
    if (!client) return false;
    let next = addTimelineEntry(client, p.kind, p.note, new Date(), source);
    if (p.followUp) next = { ...next, followUp: { ...p.followUp } };
    if (!(await book.upsertClient(next))) return false;
    const problems: string[] = [];
    if (p.followUp && contactRefused(client)) {
      // A dictation never rings someone who said NO: the follow-up stays in the book,
      // flagged on the sheet, and planning it anyway is the person's own press there.
      problems.push(t('followup.notInAgenda', { error: t('followup.refusedReason') }));
    } else if (p.followUp) {
      try {
        const outcome = await addFollowUpToAgenda(p.followUp.date, t('followup.agendaTitle', { name: client.name }), p.followUp.note);
        if (outcome.added > 0) await book.upsertClient({ ...next, followUp: { ...next.followUp!, inAgenda: true } });
        else problems.push(t('followup.notInAgenda', { error: t('followup.agendaRefused') }));
      } catch (err) {
        console.warn('[mnemo-crm] agenda refused the dictated follow-up:', err);
        problems.push(t('followup.notInAgenda', { error: err instanceof Error ? err.message : String(err) }));
      }
    }
    if (p.deal) {
      const deal = createDeal({ title: p.deal.title, stageId: book.settings.stages[0].id, clientId: client.id, amount: p.deal.amount });
      if (!deal || !(await saveDeal(deal))) problems.push(t('capture.dealNotSaved'));
    }
    setFlash(problems.length > 0 ? problems.join(' · ') : null);
    openClient(client.id);
    return true;
  };

  const nav = (id: Tab, icon: JSX.Element, label: string, count?: number) => (
    <button className="crm-nav" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
      {icon} {label}
      {count !== undefined && count > 0 && <span className="crm-nav-count">{count}</span>}
    </button>
  );

  return (
    <div className="crm-shell">
      <aside className="crm-rail">
        <div className="crm-brand">
          <img src={iconUrl} alt="" /> MnemoCRM
        </div>
        {nav('today', <CalendarDays size={18} aria-hidden="true" />, t('nav.today'), due)}
        {nav('clients', <Users size={18} aria-hidden="true" />, t('nav.clients'))}
        {nav('deals', <Briefcase size={18} aria-hidden="true" />, t('nav.deals'), openDeals)}
        {nav('catalog', <Package size={18} aria-hidden="true" />, t('nav.catalog'))}
        {nav('sales', <Receipt size={18} aria-hidden="true" />, t('nav.sales'))}
        {nav('analytics', <BarChart3 size={18} aria-hidden="true" />, t('nav.analytics'))}
        <div className="crm-rail-gap" />
        {nav('settings', <Settings size={18} aria-hidden="true" />, t('nav.settings'))}
        <div className="crm-rail-foot">
          <span>{tc('clients.count', book.clients.length)}</span>
          <button className="crm-folder" title={book.status.folder} onClick={() => void book.chooseFolder()}>
            {t('folder.current', { path: book.status.folder })}
          </button>
          <span>{t('shortcut.hint')}</span>
        </div>
      </aside>

      <main className="crm-main">
        <div className="crm-topbar">
          <label className="crm-search">
            <Search size={16} aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              placeholder={t('search.placeholder')}
              aria-label={t('search.placeholder')}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value) setTab('clients');
              }}
            />
          </label>
          <button className="crm-btn" onClick={() => setDialog({ kind: 'import', target: tab === 'catalog' ? 'products' : 'clients' })}>
            <FileUp size={16} aria-hidden="true" /> {t('import.button')}
          </button>
          <button className="crm-btn" onClick={() => setDialog({ kind: 'capture' })} title={t('capture.title')}>
            <Mic size={16} aria-hidden="true" /> {t('capture.dictate')}
          </button>
          <button className="crm-btn crm-btn-primary" onClick={newClient}>
            <UserPlus size={16} aria-hidden="true" /> {t('action.newClient')}
          </button>
        </div>

        <div className={tab === 'clients' ? 'crm-content crm-content-flush' : 'crm-content'}>
          {book.unreadable.length > 0 && (
            <div className="crm-notice" role="status">
              <span>{tc('unreadable.notice', book.unreadable.length, { names: book.unreadable.join(', ') })}</span>
            </div>
          )}
          {book.settingsState === 'unreadable' && (
            <div className="crm-notice" role="status">
              <span>{t('stages.locked')}</span>
            </div>
          )}
          {book.settings.demo && tab !== 'settings' && (
            <div className="crm-notice crm-demo-banner" role="note">
              <FlaskConical size={16} aria-hidden="true" />
              <span>{t('demo.banner')}</span>
              {book.previousFolder && (
                <button className="crm-btn crm-btn-sm" onClick={() => void book.backToPrevious()}>
                  <Undo2 size={14} aria-hidden="true" /> {t('demo.back')}
                </button>
              )}
            </div>
          )}
          {flash && (
            <div className="crm-notice crm-notice-danger" role="alert">
              <span>{flash}</span>
              <button className="crm-btn crm-btn-ghost" onClick={() => setFlash(null)}>{t('error.dismiss')}</button>
            </div>
          )}
          {book.memory.kind === 'failed' && (
            <div className="crm-notice" role="status">
              <span>{t('memory.failed', { error: book.memory.error })}</span>
            </div>
          )}
          {book.saveError && (
            <div className="crm-notice crm-notice-danger" role="alert">
              <span>{saveErrorText(t, book.saveError)}</span>
              <button className="crm-btn crm-btn-ghost" onClick={book.clearSaveError}>{t('error.dismiss')}</button>
            </div>
          )}

          {tab === 'today' && (
            <TodayView
              clients={book.clients}
              deals={book.deals}
              today={today}
              onOpenClient={openClient}
              onOpenDeal={openDeal}
              onNew={newClient}
            />
          )}
          {tab === 'clients' && (
            <ClientsView
              clients={book.clients}
              query={query}
              selectedId={selectedId}
              today={today}
              saving={book.saving}
              onSelect={setSelectedId}
              onSave={book.upsertClient}
              onEdit={(client) => setDialog({ kind: 'client', client })}
              deals={book.deals}
              settings={book.settings}
              onOpenDeal={openDeal}
              onNewDeal={(clientId) => setDialog({ kind: 'deal', clientId })}
              onAttachCall={(client) => setDialog({ kind: 'capture', client })}
            />
          )}
          {tab === 'deals' && (
            <DealsBoard
              deals={book.deals}
              clients={book.clients}
              products={book.products}
              settings={book.settings}
              today={today}
              onOpen={openDeal}
              onNew={(stageId) => setDialog({ kind: 'deal', stageId })}
              onMove={(dealId, stageId) => {
                const deal = book.deals.find((d) => d.id === dealId);
                const stage = book.settings.stages.find((s) => s.id === stageId);
                if (deal && stage && deal.stageId !== stageId) void saveDeal(moveDeal(deal, stage, t('deal.movedTo', { stage: stage.label })));
              }}
              onEditStages={() => setTab('settings')}
            />
          )}
          {tab === 'catalog' && (
            <CatalogView
              products={book.products}
              currency={book.settings.currency}
              saving={book.saving}
              onOpen={(id) => {
                const product = book.products.find((p) => p.id === id);
                if (product) setDialog({ kind: 'product', product });
              }}
              onNew={newProduct}
              onSave={book.upsertProduct}
            />
          )}
          {tab === 'analytics' && (
            <AnalyticsView
              journal={book.journal}
              clients={book.clients}
              deals={book.deals}
              products={book.products}
              markets={book.markets}
              settings={book.settings}
              today={today}
              onOpenClient={openClient}
            />
          )}
          {tab === 'settings' && (
            <SettingsView
              folder={book.status.folder}
              settings={book.settings}
              locked={book.settingsState === 'unreadable'}
              deals={book.deals}
              counts={{
                clients: book.clients.length,
                deals: book.deals.length,
                products: book.products.length,
                sales: book.journal.entries.filter((e) => e.kind === 'sale').length,
              }}
              journal={book.journal}
              saving={book.saving}
              memory={book.memory}
              demo={book.demo}
              previousFolder={book.previousFolder}
              onSave={async (next) => {
                const turningOn = next.memory === true && book.settings.memory !== true;
                const ok = await book.saveSettings(next);
                // Turning the memory on sends the notes already written, once.
                if (ok && turningOn) void book.syncMemory((k) => t(`entry.${k}`));
                return ok;
              }}
              onSyncMemory={() => void book.syncMemory((k) => t(`entry.${k}`))}
              onChangeFolder={() => void book.chooseFolder()}
              onOpenFolder={() => {
                const folder = book.status.kind === 'ready' ? book.status.folder : null;
                if (folder) openFolderInOS(folder).catch((err) => setFlash(t('error.save', { error: err instanceof Error ? err.message : String(err) })));
              }}
              onCreateDemo={() =>
                void book.createDemoBook(() => buildDemoBook(getLanguage(), localDay(), (id) => t(`stage.${id}`)))
              }
              onBackToPrevious={() => void book.backToPrevious()}
            />
          )}
          {tab === 'sales' && (
            <SalesView
              journal={book.journal}
              markets={book.markets}
              products={book.products}
              clients={book.clients}
              settings={book.settings}
              saving={book.saving}
              onNewSale={(marketId) => setDialog({ kind: 'sale', marketId })}
              onNewMarket={() => setDialog({ kind: 'market' })}
              onVoid={book.voidSale}
              onSaveMarket={book.upsertMarket}
              onDeclareTax={(taxStatus) => void book.saveSettings({ ...book.settings, taxStatus })}
            />
          )}
        </div>
      </main>

      {dialog?.kind === 'client' && (
        <ClientForm
          initial={dialog.client}
          saving={book.saving}
          onClose={() => setDialog(null)}
          onSubmit={async (client) => {
            const ok = await book.upsertClient(client);
            if (ok) openClient(client.id);
            return ok;
          }}
        />
      )}
      {dialog?.kind === 'deal' && (
        <DealDialog
          deal={dialog.deal}
          stageId={dialog.stageId}
          clientId={dialog.clientId}
          clients={book.clients}
          products={book.products}
          settings={book.settings}
          today={today}
          saving={book.saving}
          onSave={saveDeal}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'capture' && (
        <CaptureDialog
          clients={book.clients}
          forClient={dialog.client}
          saving={book.saving}
          onApply={applyProposal}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'sale' && (
        <SaleDialog
          products={book.products}
          clients={book.clients}
          markets={book.markets}
          currency={book.settings.currency}
          today={today}
          saving={book.saving}
          presetMarketId={dialog.marketId}
          onRecord={book.recordSale}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'market' && (
        <MarketDialog
          currency={book.settings.currency}
          today={today}
          saving={book.saving}
          onSave={book.upsertMarket}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog
          clients={book.clients}
          products={book.products}
          license={book.license}
          initialTarget={dialog.target}
          onImport={(target, records, onProgress) => book.importRecords(target, records, onProgress)}
          onPdf={() => setDialog({ kind: 'pdf' })}
          onLicense={() => setLicenseAsk('pdf')}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'pdf' && (
        <PdfImportDialog
          products={book.products}
          currency={book.settings.currency}
          license={book.license}
          onImport={(records, onProgress) => book.importRecords('products', records, onProgress)}
          onLicense={() => setLicenseAsk('products')}
          onClose={() => setDialog(null)}
        />
      )}
      {limitReason && (
        <LicenseDialog
          reason={limitReason}
          onRecheck={book.refreshLicense}
          onClose={() => {
            setLicenseAsk(null);
            book.clearLimitHit();
          }}
        />
      )}
      {dialog?.kind === 'product' && (
        <ProductDialog
          product={dialog.product}
          currency={book.settings.currency}
          saving={book.saving}
          onSave={book.upsertProduct}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
