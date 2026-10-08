/**
 * The settings page: where the book lives, the language, the person's own
 * stages, the currency, the declared VAT situation, the memory, and the demo
 * book. Book settings (stages, currency, VAT, memory) are saved together from
 * one bar that appears only when something changed; the language is a
 * preference of THIS machine and applies at once.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, FlaskConical, FolderOpen, FolderSync, Plus, ShieldAlert, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { useI18n, type LangMode } from '../i18n';
import { addStage, isCurrencyCode, moveStage, removeStage, renameStage, type StageEditError } from '../model/deal';
import type { ChainCheck } from '../model/journal';
import type { BookSettings, Deal } from '../model/types';
import type { MemoryState } from '../data/useBook';

interface Props {
  folder: string;
  settings: BookSettings;
  locked: boolean;
  deals: Deal[];
  counts: { clients: number; deals: number; products: number; sales: number };
  journal: ChainCheck;
  saving: boolean;
  memory: MemoryState;
  demo: { kind: 'idle' } | { kind: 'writing'; done: number; total: number } | { kind: 'failed'; error: string };
  previousFolder: string | null;
  onSave: (settings: BookSettings) => Promise<boolean>;
  onSyncMemory: () => void;
  onChangeFolder: () => void;
  onOpenFolder: () => void;
  onCreateDemo: () => void;
  onBackToPrevious: () => void;
}

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'MXN', 'ARS', 'COP', 'CLP', 'MAD', 'XOF'];
const LANGS: readonly LangMode[] = ['auto', 'fr', 'en', 'es'];

export function SettingsView(props: Props) {
  const { folder, settings, locked, deals, counts, journal, saving, memory, demo, previousFolder } = props;
  const { t, tc, langMode, setLangMode } = useI18n();
  const [draft, setDraft] = useState<BookSettings>(settings);
  const [newLabel, setNewLabel] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const settingsKey = JSON.stringify(settings);

  // A new folder (or a save) brings new settings: the draft follows, unless the person is mid-edit.
  useEffect(() => setDraft(JSON.parse(settingsKey) as BookSettings), [settingsKey]);

  const dirty = useMemo(() => JSON.stringify(draft) !== settingsKey, [draft, settingsKey]);

  const say = (error: StageEditError, count?: number) =>
    setProblem(t(`stages.error.${error}`, count !== undefined ? { count } : undefined));
  const apply = (res: BookSettings | { error: StageEditError; count?: number }) => {
    if ('error' in res) say(res.error, res.count);
    else {
      setProblem(null);
      setDraft(res);
    }
  };

  const save = async () => {
    // A label emptied and never blurred must not be saved blank.
    if (draft.stages.some((s) => !s.label.trim())) return say('EMPTY_LABEL');
    await props.onSave({ ...draft, stages: draft.stages.map((s) => ({ ...s, label: s.label.trim() })) });
  };

  const currencies = CURRENCIES.includes(draft.currency) ? CURRENCIES : [draft.currency, ...CURRENCIES];
  const setFlag = (key: 'memory', on: boolean) =>
    setDraft((d) => {
      const next = { ...d };
      if (on) next[key] = true;
      else delete next[key];
      return next;
    });

  return (
    <div className="crm-settings">
      <header className="crm-board-head">
        <h1>{t('nav.settings')}</h1>
      </header>

      {locked && <div className="crm-notice crm-notice-danger" role="alert"><span>{t('stages.locked')}</span></div>}

      {/* ── The book ───────────────────────────────────────── */}
      <section className="crm-panel">
        <h2>{t('settings.book')}</h2>
        {settings.demo && (
          <div className="crm-notice" role="note">
            <FlaskConical size={16} aria-hidden="true" />
            <span>{t('demo.banner')}</span>
            {previousFolder && (
              <button className="crm-btn crm-btn-sm" onClick={props.onBackToPrevious}>
                <Undo2 size={14} aria-hidden="true" /> {t('demo.back')}
              </button>
            )}
          </div>
        )}
        <div className="crm-settings-path" title={folder}>{folder}</div>
        <div className="crm-settings-actions">
          <button className="crm-btn" onClick={props.onChangeFolder}>
            <FolderSync size={14} aria-hidden="true" /> {t('error.changeFolder')}
          </button>
          <button className="crm-btn" onClick={props.onOpenFolder}>
            <FolderOpen size={14} aria-hidden="true" /> {t('settings.openFolder')}
          </button>
        </div>
        <dl className="crm-settings-counts">
          <div><dt>{t('nav.clients')}</dt><dd>{counts.clients}</dd></div>
          <div><dt>{t('nav.deals')}</dt><dd>{counts.deals}</dd></div>
          <div><dt>{t('nav.catalog')}</dt><dd>{counts.products}</dd></div>
          <div><dt>{t('nav.sales')}</dt><dd>{counts.sales}</dd></div>
        </dl>
        {journal.broken ? (
          <div className="crm-status-line crm-status-bad"><ShieldAlert size={14} aria-hidden="true" /> {t(`journal.broken.${journal.broken.reason}`, { seq: journal.broken.seq })}</div>
        ) : journal.entries.length > 0 ? (
          <div className="crm-status-line crm-status-ok"><ShieldCheck size={14} aria-hidden="true" /> {tc('journal.intact', journal.entries.length)}</div>
        ) : null}
      </section>

      {/* ── Language (this machine) ────────────────────────── */}
      <section className="crm-panel">
        <h2>{t('settings.language')}</h2>
        <div className="crm-seg" role="radiogroup" aria-label={t('settings.language')}>
          {LANGS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={langMode === l} aria-pressed={langMode === l} onClick={() => setLangMode(l)}>
              {t(`settings.lang.${l}`)}
            </button>
          ))}
        </div>
        <small className="crm-card-sub">{t('settings.languageHint')}</small>
      </section>

      {/* ── Stages ─────────────────────────────────────────── */}
      <section className="crm-panel">
        <h2>{t('stages.title')}</h2>
        <p className="crm-card-sub">{t('stages.body')}</p>
        <ol className="crm-stage-list">
          {draft.stages.map((stage, i) => (
            <li key={stage.id} className="crm-stage-row">
              <span className="crm-stage-index">{i + 1}</span>
              <input
                className="crm-input"
                value={stage.label}
                aria-label={t('stages.label')}
                onChange={(e) => setDraft((d) => ({ ...d, stages: d.stages.map((s) => (s.id === stage.id ? { ...s, label: e.target.value } : s)) }))}
                onBlur={(e) => apply(renameStage(draft, stage.id, e.target.value))}
              />
              <button className="crm-icon-btn" aria-label={t('stages.up')} disabled={i === 0} onClick={() => setDraft((d) => moveStage(d, stage.id, -1))}>
                <ArrowUp size={14} />
              </button>
              <button className="crm-icon-btn" aria-label={t('stages.down')} disabled={i === draft.stages.length - 1} onClick={() => setDraft((d) => moveStage(d, stage.id, 1))}>
                <ArrowDown size={14} />
              </button>
              <button className="crm-icon-btn" aria-label={t('stages.remove')} onClick={() => apply(removeStage(draft, stage.id, deals))}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ol>
        <form
          className="crm-stage-add"
          onSubmit={(e) => {
            e.preventDefault();
            const res = addStage(draft, newLabel);
            apply(res);
            if (!('error' in res)) setNewLabel('');
          }}
        >
          <input className="crm-input" value={newLabel} placeholder={t('stages.newHint')} onChange={(e) => setNewLabel(e.target.value)} />
          <button type="submit" className="crm-btn">
            <Plus size={14} aria-hidden="true" /> {t('stages.add')}
          </button>
        </form>
        {problem && <p className="crm-error-text" role="alert">{problem}</p>}
      </section>

      {/* ── Money and VAT ──────────────────────────────────── */}
      <section className="crm-panel">
        <h2>{t('settings.money')}</h2>
        <div className="crm-grid-2">
          <label className="crm-field">
            <span>{t('stages.currency')}</span>
            <select className="crm-input" value={draft.currency} onChange={(e) => isCurrencyCode(e.target.value) && setDraft((d) => ({ ...d, currency: e.target.value }))}>
              {currencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="crm-field">
            <span>{t('tax.label')}</span>
            <select
              className="crm-input"
              value={draft.taxStatus ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setDraft((d) => {
                  const next = { ...d };
                  if (v === 'franchise' || v === 'vat' || v === 'other') next.taxStatus = v;
                  else delete next.taxStatus;
                  return next;
                });
              }}
            >
              <option value="">{t('tax.undeclared')}</option>
              {(['franchise', 'vat', 'other'] as const).map((s) => (
                <option key={s} value={s}>{t(`tax.choice.${s}`)}</option>
              ))}
            </select>
          </label>
        </div>
        {draft.taxStatus && draft.taxStatus !== 'franchise' && <p className="crm-card-sub">{t(`tax.notice.${draft.taxStatus}`)}</p>}
      </section>

      {/* ── Memory ─────────────────────────────────────────── */}
      <section className="crm-panel">
        <h2>{t('settings.memory')}</h2>
        <label className="crm-check">
          <input type="checkbox" checked={draft.memory === true} onChange={(e) => setFlag('memory', e.target.checked)} />
          {t('memory.toggle')}
        </label>
        <small className="crm-card-sub">{t('memory.explain')}</small>
        {settings.memory === true && (
          <div className="crm-memory-line">
            <span className="crm-card-sub">{memoryLabel(t, memory)}</span>
            <button type="button" className="crm-btn crm-btn-sm" disabled={memory.kind === 'sending'} onClick={props.onSyncMemory}>{t('memory.sync')}</button>
          </div>
        )}
      </section>

      {/* ── Demo book ──────────────────────────────────────── */}
      <section className="crm-panel">
        <h2><FlaskConical size={14} aria-hidden="true" /> {t('demo.title')}</h2>
        <p className="crm-card-sub">{t('demo.body')}</p>
        <button className="crm-btn" disabled={demo.kind === 'writing'} onClick={props.onCreateDemo}>
          <FlaskConical size={14} aria-hidden="true" /> {demo.kind === 'writing' ? t('demo.writing', { done: demo.done, total: demo.total }) : t('demo.create')}
        </button>
        {demo.kind === 'failed' && (
          <p className="crm-error-text" role="alert">{demo.error === 'FOLDER_NOT_EMPTY' ? t('demo.notEmpty') : t('error.save', { error: demo.error })}</p>
        )}
      </section>

      {dirty && (
        <div className="crm-savebar" role="region" aria-label={t('settings.unsaved')}>
          <span>{t('settings.unsaved')}</span>
          <button className="crm-btn crm-btn-ghost" onClick={() => setDraft(JSON.parse(settingsKey) as BookSettings)}>{t('form.cancel')}</button>
          <button className="crm-btn crm-btn-primary" disabled={saving || locked} onClick={() => void save()}>
            {saving ? t('saving') : t('form.save')}
          </button>
        </div>
      )}
    </div>
  );
}

function memoryLabel(t: (k: string, v?: Record<string, string | number>) => string, m: MemoryState): string {
  switch (m.kind) {
    case 'sending':
      return t('memory.sending', { done: m.done, total: m.total });
    case 'sent':
      return t('memory.sent', { count: m.count });
    case 'failed':
      return t('memory.failed', { error: m.error });
    default:
      return t('memory.idle');
  }
}
