/**
 * Create or edit one deal: title, client, stage, amount, pieces, next step,
 * and its history. Closing a deal (won / lost) archives it; it is never
 * deleted (doc 124 §8).
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarCheck, CalendarX, RotateCcw, ThumbsDown, Trophy } from 'lucide-react';
import { useI18n } from '../i18n';
import { closeDeal, createDeal, moveDeal, normalizeDeal, parseAmount, reopenDeal, withEvent } from '../model/deal';
import { amountToInput, formatInstant } from '../model/format';
import type { BookSettings, Client, Deal, Product } from '../model/types';
import { addFollowUpToAgenda } from '../data/host';
import { contactRefused } from '../model/client';

interface Props {
  deal?: Deal;
  /** Prefills for a new deal. */
  stageId?: string;
  clientId?: string;
  clients: Client[];
  products: Product[];
  settings: BookSettings;
  today: string;
  saving: boolean;
  onSave: (deal: Deal) => Promise<boolean>;
  onClose: () => void;
}

type AgendaState = { kind: 'idle' } | { kind: 'ok' } | { kind: 'failed'; reason: string };

export function DealDialog({ deal, stageId, clientId, clients, products, settings, today, saving, onSave, onClose }: Props) {
  const { t, lang } = useI18n();
  const [title, setTitle] = useState(deal?.title ?? '');
  const [client, setClient] = useState(deal?.clientId ?? clientId ?? '');
  const [stage, setStage] = useState(deal?.stageId ?? stageId ?? settings.stages[0]?.id ?? '');
  const [amount, setAmount] = useState(amountToInput(lang, deal?.amount));
  const [picked, setPicked] = useState<string[]>(deal?.productIds ?? []);
  const [stepDay, setStepDay] = useState(deal?.nextStep?.date ?? '');
  const [stepNote, setStepNote] = useState(deal?.nextStep?.note ?? '');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ title?: boolean; amount?: boolean }>({});
  const [agenda, setAgenda] = useState<AgendaState>({ kind: 'idle' });
  // The deal as last SAVED. A new deal becomes an existing one after its first
  // save, so a second press edits it instead of creating a duplicate.
  const [current, setCurrent] = useState<Deal | undefined>(deal);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Build the deal from the form. Null (with the errors shown) when the form is not valid. */
  const build = (): Deal | null => {
    const parsedAmount = parseAmount(amount);
    const nextErrors = { title: !title.trim(), amount: parsedAmount === null };
    setErrors(nextErrors);
    if (nextErrors.title || nextErrors.amount) return null;
    // An unchanged day keeps its "in the agenda" mark: editing the note must not forget it.
    const stillInAgenda = current?.nextStep?.inAgenda === true && current.nextStep.date === stepDay;
    const nextStep = stepDay
      ? { date: stepDay, ...(stepNote.trim() ? { note: stepNote.trim() } : {}), ...(stillInAgenda ? { inAgenda: true } : {}) }
      : undefined;
    const now = new Date();
    const stageObj = settings.stages.find((s) => s.id === stage);
    if (!current) {
      const created = createDeal(
        { title, stageId: stage, clientId: client || undefined, amount: parsedAmount ?? undefined, productIds: picked, nextStep },
        now,
      );
      return created && note.trim() ? withEvent(created, note, now) : created;
    }
    let next = normalizeDeal({
      ...current,
      title,
      clientId: client || undefined,
      amount: parsedAmount ?? undefined,
      productIds: picked,
      nextStep,
      updatedAt: now.toISOString(),
    });
    if (!next) return null;
    if (stageObj && stageObj.id !== current.stageId) next = moveDeal(next, stageObj, t('deal.movedTo', { stage: stageObj.label }), now);
    if (note.trim()) next = withEvent(next, note, now);
    return next;
  };

  /** Saves, then puts a NEW next step in the agenda. Says so when the agenda refuses. */
  const save = async (after?: (d: Deal) => Deal) => {
    const built = build();
    if (!built) return;
    const next = after ? after(built) : built;
    if (!(await onSave(next))) return;
    setCurrent(next);
    setNote('');
    const stepChanged = next.nextStep && next.nextStep.date !== current?.nextStep?.date && !next.closed;
    const linked = clients.find((c) => c.id === next.clientId);
    if (stepChanged && linked && contactRefused(linked)) {
      // The step stays in the book; the agenda never rings someone who said NO.
      setAgenda({ kind: 'failed', reason: t('followup.refusedReason') });
      return;
    }
    if (stepChanged) {
      try {
        const outcome = await addFollowUpToAgenda(next.nextStep!.date, t('deal.agendaTitle', { title: next.title }), next.nextStep!.note);
        if (outcome.added > 0) {
          const inAgenda = { ...next, nextStep: { ...next.nextStep!, inAgenda: true } };
          if (await onSave(inAgenda)) {
            onClose();
            return;
          }
          setCurrent(inAgenda);
          setAgenda({ kind: 'ok' });
        } else setAgenda({ kind: 'failed', reason: t('followup.agendaRefused') });
      } catch (err) {
        console.warn('[mnemo-crm] agenda refused the deal step:', err);
        setAgenda({ kind: 'failed', reason: err instanceof Error ? err.message : String(err) });
      }
      return; // stay open only on a refusal: that line is what the person needs to read
    }
    onClose();
  };

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const history = current ? [...current.history].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)) : [];
  const sortedClients = [...clients].sort((a, b) => a.name.localeCompare(b.name));
  const pickable = [...products]
    .filter((p) => picked.includes(p.id) || p.kind === 'series' || p.status !== 'sold')
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="crm-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="crm-dialog crm-dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-deal-title"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="crm-deal-title">{current ? t('deal.editTitle') : t('deal.newTitle')}</h2>

        <label className="crm-field">
          <span>{t('deal.title')}</span>
          <input
            ref={titleRef}
            className="crm-input"
            value={title}
            placeholder={t('deal.titleHint')}
            aria-invalid={!!errors.title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {errors.title && <small className="crm-error-text">{t('deal.titleRequired')}</small>}
        </label>

        <div className="crm-grid-2">
          <label className="crm-field">
            <span>{t('deal.client')}</span>
            <select className="crm-input" value={client} onChange={(e) => setClient(e.target.value)}>
              <option value="">{t('deal.noClient')}</option>
              {sortedClients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="crm-field">
            <span>{t('deal.stage')}</span>
            <select className="crm-input" value={stage} onChange={(e) => setStage(e.target.value)}>
              {!settings.stages.some((s) => s.id === stage) && <option value={stage}>{t('stages.unknown')}</option>}
              {settings.stages.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="crm-field">
          <span>{t('deal.amount', { currency: settings.currency })}</span>
          <input
            className="crm-input"
            inputMode="decimal"
            value={amount}
            placeholder={t('deal.amountHint')}
            aria-invalid={!!errors.amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {errors.amount && <small className="crm-error-text">{t('deal.amountInvalid')}</small>}
        </label>

        {pickable.length > 0 && (
          <div className="crm-field">
            <span>{t('deal.products')}</span>
            <div className="crm-pick-chips">
              {pickable.map((p) => (
                <button key={p.id} type="button" className="crm-pick-chip" aria-pressed={picked.includes(p.id)} onClick={() => toggle(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="crm-grid-2">
          <label className="crm-field">
            <span>{t('deal.nextStep')}</span>
            <input className="crm-input" type="date" value={stepDay} min={deal ? undefined : today} onChange={(e) => setStepDay(e.target.value)} />
          </label>
          <label className="crm-field">
            <span>{t('followup.note')}</span>
            <input className="crm-input" value={stepNote} onChange={(e) => setStepNote(e.target.value)} />
          </label>
        </div>

        <label className="crm-field">
          <span>{t('deal.addNote')}</span>
          <textarea className="crm-textarea" value={note} placeholder={t('timeline.placeholder')} onChange={(e) => setNote(e.target.value)} />
        </label>

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

        {history.length > 0 && (
          <div className="crm-field">
            <span>{t('timeline.title')}</span>
            <ol className="crm-timeline crm-timeline-compact">
              {history.map((e) => (
                <li key={e.id} className="crm-entry">
                  <div className="crm-entry-meta">{formatInstant(lang, e.at)}</div>
                  <p className="crm-entry-text">{e.text}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="crm-dialog-actions crm-dialog-actions-split">
          <div className="crm-dialog-actions-left">
            {current && !current.closed && (
              <>
                <button type="button" className="crm-btn" disabled={saving} onClick={() => void save((d) => closeDeal(d, 'won', t('deal.wonLine')))}>
                  <Trophy size={14} aria-hidden="true" /> {t('deal.won')}
                </button>
                <button type="button" className="crm-btn" disabled={saving} onClick={() => void save((d) => closeDeal(d, 'lost', t('deal.lostLine')))}>
                  <ThumbsDown size={14} aria-hidden="true" /> {t('deal.lost')}
                </button>
              </>
            )}
            {current?.closed && (
              <button type="button" className="crm-btn" disabled={saving} onClick={() => void save((d) => reopenDeal(d, t('deal.reopenedLine')))}>
                <RotateCcw size={14} aria-hidden="true" /> {t('deal.reopen')}
              </button>
            )}
          </div>
          <div className="crm-dialog-actions">
            <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>
              {agenda.kind === 'idle' ? t('form.cancel') : t('error.dismiss')}
            </button>
            <button type="submit" className="crm-btn crm-btn-primary" disabled={saving}>
              {saving ? t('saving') : current ? t('form.save') : t('deal.create')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
