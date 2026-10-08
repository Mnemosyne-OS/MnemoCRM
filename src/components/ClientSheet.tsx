/**
 * One client, as a story (doc 124 §5.4): who they are, the next follow-up,
 * and the history of every exchange, newest first.
 */
import { useEffect, useState } from 'react';
import { Briefcase, CalendarCheck, CalendarX, Check, PhoneCall, Pencil, Plus } from 'lucide-react';
import { useI18n } from '../i18n';
import { addTimelineEntry, contactRefused, followUpAgainstConsent, sortedTimeline } from '../model/client';
import { formatDay, formatInstant, formatMoney, relativeDay } from '../model/format';
import type { BookSettings, Client, Deal, TimelineKind } from '../model/types';
import { addFollowUpToAgenda } from '../data/host';
import { Avatar } from './Avatar';
import { KnowPanel } from './KnowPanel';

interface Props {
  client: Client;
  today: string;
  saving: boolean;
  onSave: (client: Client) => Promise<boolean>;
  onEdit: () => void;
  deals: Deal[];
  settings: BookSettings;
  onOpenDeal: (id: string) => void;
  onNewDeal: () => void;
  onAttachCall: () => void;
}

type AgendaState = { kind: 'idle' } | { kind: 'ok' } | { kind: 'failed'; reason: string };

const ENTRY_KINDS: readonly TimelineKind[] = ['note', 'call', 'meeting', 'sale'];

export function ClientSheet({ client, today, saving, onSave, onEdit, deals, settings, onOpenDeal, onNewDeal, onAttachCall }: Props) {
  const { t, lang } = useI18n();
  const [day, setDay] = useState(client.followUp?.date ?? today);
  const [note, setNote] = useState(client.followUp?.note ?? '');
  const [agenda, setAgenda] = useState<AgendaState>({ kind: 'idle' });
  const [entryKind, setEntryKind] = useState<TimelineKind>('note');
  const [entryText, setEntryText] = useState('');
  const [confirmRefused, setConfirmRefused] = useState(false);

  // Switching client resets the drafts: a note typed for one must not land on another.
  useEffect(() => {
    setDay(client.followUp?.date ?? today);
    setNote(client.followUp?.note ?? '');
    setAgenda({ kind: 'idle' });
    setEntryText('');
    setConfirmRefused(false);
  }, [client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const planFollowUp = async () => {
    // Someone who said NO is asked about first: the agenda would ring before any warning.
    if (contactRefused(client) && !confirmRefused) {
      setConfirmRefused(true);
      return;
    }
    setConfirmRefused(false);
    const trimmed = note.trim();
    const planned: Client = {
      ...client,
      followUp: { date: day, ...(trimmed ? { note: trimmed } : {}) },
      updatedAt: new Date().toISOString(),
    };
    if (!(await onSave(planned))) return;
    try {
      const outcome = await addFollowUpToAgenda(day, t('followup.agendaTitle', { name: client.name }), trimmed || undefined);
      if (outcome.added > 0) {
        setAgenda({ kind: 'ok' });
        await onSave({ ...planned, followUp: { ...planned.followUp!, inAgenda: true } });
      } else {
        setAgenda({ kind: 'failed', reason: t('followup.agendaRefused') });
      }
    } catch (err) {
      console.warn('[mnemo-crm] agenda refused the follow-up:', err);
      setAgenda({ kind: 'failed', reason: err instanceof Error ? err.message : String(err) });
    }
  };

  const markDone = async () => {
    const done = client.followUp?.note ? `${t('followup.doneEntry')}: ${client.followUp.note}` : t('followup.doneEntry');
    const next = addTimelineEntry({ ...client, followUp: undefined }, 'call', done);
    delete next.followUp;
    if (await onSave(next)) setAgenda({ kind: 'idle' });
  };

  const addEntry = async () => {
    if (!entryText.trim()) return;
    if (await onSave(addTimelineEntry(client, entryKind, entryText))) setEntryText('');
  };

  const timeline = sortedTimeline(client);
  const facts: [string, string | undefined][] = [
    [t('field.company'), client.company],
    [t('field.email'), client.email],
    [t('field.phone'), client.phone],
    [t('field.address'), client.address],
    [t('field.source'), client.source],
  ];

  return (
    <article className="crm-sheet" aria-label={client.name}>
      <header className="crm-sheet-head">
        <Avatar name={client.name} large />
        <div>
          <h1>{client.name}</h1>
          <p>
            <span className="crm-badge">{t(`kind.${client.kind}`)}</span>
            {client.createdAt && <> · {t('sheet.since', { date: formatInstant(lang, client.createdAt) })}</>}
          </p>
        </div>
        <div className="crm-sheet-actions">
          <button className="crm-btn" onClick={onAttachCall}>
            <PhoneCall size={14} aria-hidden="true" /> {t('capture.attachCall')}
          </button>
          <button className="crm-btn" onClick={onEdit}>
            <Pencil size={14} aria-hidden="true" /> {t('sheet.edit')}
          </button>
        </div>
      </header>

      <dl className="crm-facts">
        {facts.map(([label, value]) => (
          <div className="crm-fact" key={label}>
            <dt>{label}</dt>
            <dd>{value ?? '—'}</dd>
          </div>
        ))}
        <div className="crm-fact">
          <dt>{t('consent.label')}</dt>
          <dd>
            {client.contactConsent === undefined
              ? t('consent.unknown')
              : client.contactConsent.value
                ? t('consent.yes')
                : t('consent.no')}
          </dd>
        </div>
        {client.tags.length > 0 && (
          <div className="crm-fact">
            <dt>{t('field.tags')}</dt>
            <dd>
              {client.tags.map((tag) => (
                <span key={tag} className="crm-tag">{tag}</span>
              ))}
            </dd>
          </div>
        )}
      </dl>

      <KnowPanel client={client} deals={deals} settings={settings} />

      <section className="crm-panel" aria-labelledby="crm-followup-title">
        <h2 id="crm-followup-title">{t('followup.title')}</h2>
        {followUpAgainstConsent(client) && (
          <div className="crm-notice crm-notice-danger" role="alert">
            <span>{t('consent.warn')}</span>
          </div>
        )}
        {client.followUp ? (
          <div className="crm-followup-current">
            <span className="crm-followup-day">{formatDay(lang, client.followUp.date)}</span>
            <span className="crm-card-when">{relativeDay(lang, today, client.followUp.date)}</span>
            <button className="crm-btn" onClick={() => void markDone()} disabled={saving}>
              <Check size={14} aria-hidden="true" /> {t('followup.done')}
            </button>
          </div>
        ) : (
          <p className="crm-card-sub">{t('followup.none')}</p>
        )}
        <div className="crm-followup-row">
          <label className="crm-field">
            <span>{t('followup.date')}</span>
            <input className="crm-input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className="crm-field crm-field-grow">
            <span>{t('followup.note')}</span>
            <input className="crm-input" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button className="crm-btn crm-btn-primary" onClick={() => void planFollowUp()} disabled={saving || !day}>
            {confirmRefused ? t('followup.planAnyway') : t('followup.plan')}
          </button>
        </div>
        {confirmRefused && (
          <div className="crm-notice crm-notice-danger" role="alert">
            <span>{t('followup.refusedAsk')}</span>
          </div>
        )}
        {agenda.kind === 'ok' && (
          <div className="crm-status-line crm-status-ok">
            <CalendarCheck size={14} aria-hidden="true" /> {t('followup.inAgenda')}
          </div>
        )}
        {agenda.kind === 'failed' && (
          <div className="crm-status-line crm-status-bad" role="alert">
            <CalendarX size={14} aria-hidden="true" /> {t('followup.notInAgenda', { error: agenda.reason })}
          </div>
        )}
        {agenda.kind === 'idle' && client.followUp?.inAgenda && (
          <div className="crm-status-line crm-status-ok">
            <CalendarCheck size={14} aria-hidden="true" /> {t('followup.inAgenda')}
          </div>
        )}
      </section>

      <section className="crm-panel" aria-labelledby="crm-deals-title">
        <div className="crm-panel-head">
          <h2 id="crm-deals-title">{t('nav.deals')}</h2>
          <button className="crm-btn crm-btn-sm" onClick={onNewDeal}>
            <Plus size={14} aria-hidden="true" /> {t('deal.new')}
          </button>
        </div>
        {deals.length === 0 ? (
          <p className="crm-card-sub">{t('deal.noneForClient')}</p>
        ) : (
          <ul className="crm-deal-lines">
            {deals.map((d) => (
              <li key={d.id}>
                <button className="crm-row" onClick={() => onOpenDeal(d.id)}>
                  <Briefcase size={14} aria-hidden="true" />
                  <span className="crm-row-text">
                    <span className="crm-row-name">{d.title}</span>
                    <span className="crm-row-sub">
                      {d.closed
                        ? t(`deal.outcome.${d.closed.outcome}`)
                        : settings.stages.find((s) => s.id === d.stageId)?.label ?? t('stages.unknown')}
                    </span>
                  </span>
                  <span className="crm-deal-line-amount">{d.amount !== undefined ? formatMoney(lang, settings.currency, d.amount) : '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="crm-panel" aria-labelledby="crm-history-title">
        <h2 id="crm-history-title">{t('timeline.title')}</h2>
        <div className="crm-composer">
          <textarea
            className="crm-textarea"
            value={entryText}
            placeholder={t('timeline.placeholder')}
            onChange={(e) => setEntryText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void addEntry();
            }}
          />
          <div className="crm-composer-bar">
            <div className="crm-seg" role="group">
              {ENTRY_KINDS.map((k) => (
                <button key={k} type="button" aria-pressed={entryKind === k} onClick={() => setEntryKind(k)}>
                  {t(`entry.${k}`)}
                </button>
              ))}
            </div>
            <button className="crm-btn crm-btn-primary" onClick={() => void addEntry()} disabled={saving || !entryText.trim()}>
              {t('timeline.add')}
            </button>
          </div>
        </div>
        {timeline.length === 0 ? (
          <p className="crm-card-sub">{t('timeline.empty')}</p>
        ) : (
          <ol className="crm-timeline">
            {timeline.map((entry) => (
              <li key={entry.id} className="crm-entry">
                <div className="crm-entry-meta">
                  <span className="crm-badge">{t(`entry.${entry.kind}`)}</span>
                  <span>{formatInstant(lang, entry.at)}</span>
                </div>
                <p className="crm-entry-text">{entry.text}</p>
                {entry.source && <p className="crm-entry-source" title={entry.source}>{t('timeline.source', { source: entry.source.split(/[\\/]/).pop() ?? entry.source })}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
