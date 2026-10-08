/**
 * Speak (or paste) → the model proposes → the person corrects → one button
 * writes (doc 124 §5.5). Nothing is written before that button.
 *
 * Two entry points share it: a dictation from anywhere ("I saw Paul, he wants
 * twelve bowls, call him Monday"), and a call transcript attached to a client
 * (exported by the Recorder, or pasted).
 */
import { useEffect, useRef, useState } from 'react';
import { FileText, Mic, Sparkles, Square } from 'lucide-react';
import { useI18n } from '../i18n';
import { localDay } from '../model/client';
import { parseAmount } from '../model/deal';
import { callPrompt, dictationPrompt, parseProposal, type Proposal } from '../model/proposal';
import type { Client, TimelineKind } from '../model/types';
import { infer, pickTextFile } from '../data/host';
import { useDictation } from '../data/useDictation';

interface Props {
  clients: Client[];
  /** Set when attaching a call to this client: the transcript is about them. */
  forClient?: Client;
  saving: boolean;
  onApply: (proposal: Proposal, source?: string) => Promise<boolean>;
  onClose: () => void;
}

type Step =
  | { kind: 'input' }
  | { kind: 'thinking' }
  | { kind: 'review'; proposal: Proposal }
  | { kind: 'failed'; error: string };

const KINDS: readonly TimelineKind[] = ['note', 'call', 'meeting', 'sale'];

export function CaptureDialog({ clients, forClient, saving, onApply, onClose }: Props) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [source, setSource] = useState<string | undefined>(undefined);
  const [step, setStep] = useState<Step>({ kind: 'input' });
  const [problem, setProblem] = useState<string | null>(null);
  const dictation = useDictation(lang, (heard) => setText((prev) => (prev ? `${prev}\n${heard}` : heard)));
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const propose = async () => {
    if (!text.trim()) return;
    setStep({ kind: 'thinking' });
    const today = localDay();
    const weekday = new Intl.DateTimeFormat('en', { weekday: 'long' }).format(new Date());
    const prompt = forClient ? callPrompt(text, forClient, today, weekday) : dictationPrompt(text, clients, today, weekday);
    try {
      // RAG off: an extraction must be fed the words said, not unrelated notes.
      const answer = await infer(prompt, { rag: false, maxTokens: 700 });
      const proposal = parseProposal(answer.text, forClient ? [forClient] : clients, text);
      // Nothing usable from the model: the words themselves become a plain note to review.
      setStep({
        kind: 'review',
        proposal: proposal ?? { kind: forClient ? 'call' : 'note', note: text.trim().slice(0, 4000), ...(forClient ? { clientId: forClient.id } : {}) },
      });
    } catch (err) {
      console.warn('[mnemo-crm] proposal failed:', err);
      setStep({ kind: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  };

  const pickFile = async () => {
    try {
      const file = await pickTextFile(t('capture.textFilter'));
      if (!file) return;
      setText(file.text.slice(0, 16000));
      setSource(file.path);
    } catch (err) {
      console.warn('[mnemo-crm] transcript unreadable:', err);
      setProblem(t('capture.fileUnreadable', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const listening = dictation.state.kind === 'listening';

  return (
    <div className="crm-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="crm-dialog crm-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="crm-capture-title">
        <h2 id="crm-capture-title">{forClient ? t('capture.callTitle', { name: forClient.name }) : t('capture.title')}</h2>

        {step.kind !== 'review' && (
          <>
            <p className="crm-card-sub">{forClient ? t('capture.callBody') : t('capture.body')}</p>
            <textarea
              ref={textRef}
              className="crm-textarea crm-capture-text"
              value={text}
              placeholder={forClient ? t('capture.callPlaceholder') : t('capture.placeholder')}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="crm-capture-tools">
              {listening ? (
                <button type="button" className="crm-btn crm-btn-listening" onClick={() => void dictation.stop()}>
                  <Square size={14} aria-hidden="true" /> {t('capture.stop')}
                </button>
              ) : (
                <button type="button" className="crm-btn" disabled={dictation.state.kind === 'transcribing'} onClick={() => void dictation.start()}>
                  <Mic size={14} aria-hidden="true" /> {dictation.state.kind === 'transcribing' ? t('capture.transcribing') : t('capture.speak')}
                </button>
              )}
              {forClient && (
                <button type="button" className="crm-btn" onClick={() => void pickFile()}>
                  <FileText size={14} aria-hidden="true" /> {t('capture.pickFile')}
                </button>
              )}
              {source && <span className="crm-card-sub crm-capture-source" title={source}>{source}</span>}
            </div>
            {dictation.state.kind === 'failed' && (
              <p className="crm-error-text" role="alert">{t(`capture.dictation.${knownDictationError(dictation.state.error)}`, { error: dictation.state.error })}</p>
            )}
            {problem && <p className="crm-error-text" role="alert">{problem}</p>}
            {step.kind === 'failed' && <p className="crm-error-text" role="alert">{t('capture.modelFailed', { error: step.error })}</p>}
            <p className="crm-card-sub">{t('capture.costNote')}</p>
            <div className="crm-dialog-actions">
              <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>{t('form.cancel')}</button>
              <button type="button" className="crm-btn crm-btn-primary" disabled={!text.trim() || step.kind === 'thinking' || listening} onClick={() => void propose()}>
                <Sparkles size={14} aria-hidden="true" /> {step.kind === 'thinking' ? t('capture.thinking') : t('capture.propose')}
              </button>
            </div>
          </>
        )}

        {step.kind === 'review' && (
          <ReviewForm
            proposal={step.proposal}
            clients={clients}
            lockedClient={forClient}
            saving={saving}
            heard={text}
            onBack={() => setStep({ kind: 'input' })}
            onApply={async (p) => {
              if (await onApply(p, source)) onClose();
            }}
            parseError={(msg) => setProblem(msg)}
          />
        )}
        {step.kind === 'review' && problem && <p className="crm-error-text" role="alert">{problem}</p>}
      </div>
    </div>
  );
}

/** The dictation refusals that have their own sentence; the rest shows its code. */
function knownDictationError(error: string): string {
  const known = ['NO_ENGINE', 'MIC_BUSY', 'NO_SPEECH', 'PERMISSION_DENIED'];
  const hit = known.find((k) => error.includes(k));
  return hit ?? 'other';
}

function ReviewForm(props: {
  proposal: Proposal;
  clients: Client[];
  lockedClient?: Client;
  saving: boolean;
  heard: string;
  onBack: () => void;
  onApply: (p: Proposal) => Promise<void>;
  parseError: (msg: string | null) => void;
}) {
  const { proposal, clients, lockedClient, saving, heard, onBack, onApply, parseError } = props;
  const { t, lang } = useI18n();
  const [clientChoice, setClientChoice] = useState(proposal.clientId ?? (proposal.newClientName ? '__new' : ''));
  const [newName, setNewName] = useState(proposal.newClientName ?? '');
  const [kind, setKind] = useState<TimelineKind>(proposal.kind);
  const [note, setNote] = useState(proposal.note);
  const [withFollowUp, setWithFollowUp] = useState(!!proposal.followUp);
  const [fDate, setFDate] = useState(proposal.followUp?.date ?? localDay());
  const [fNote, setFNote] = useState(proposal.followUp?.note ?? '');
  const [withDeal, setWithDeal] = useState(!!proposal.deal);
  const [dTitle, setDTitle] = useState(proposal.deal?.title ?? '');
  const [dAmount, setDAmount] = useState(proposal.deal?.amount !== undefined ? new Intl.NumberFormat(lang, { useGrouping: false }).format(proposal.deal.amount) : '');

  const apply = async () => {
    parseError(null);
    if (!lockedClient && !clientChoice) return parseError(t('capture.needClient'));
    if (clientChoice === '__new' && !newName.trim()) return parseError(t('form.nameRequired'));
    if (!note.trim()) return parseError(t('capture.needNote'));
    const amount = withDeal ? parseAmount(dAmount) : undefined;
    if (withDeal && (amount === null || !dTitle.trim())) return parseError(t('capture.dealInvalid'));
    const p: Proposal = {
      kind,
      note: note.trim(),
      ...(lockedClient ? { clientId: lockedClient.id } : clientChoice === '__new' ? { newClientName: newName.trim() } : { clientId: clientChoice }),
      ...(withFollowUp && fDate ? { followUp: { date: fDate, ...(fNote.trim() ? { note: fNote.trim() } : {}) } } : {}),
      ...(withDeal ? { deal: { title: dTitle.trim(), ...(typeof amount === 'number' ? { amount } : {}) } } : {}),
    };
    await onApply(p);
  };

  return (
    <div className="crm-review">
      <p className="crm-review-badge"><Sparkles size={12} aria-hidden="true" /> {t('capture.proposed')}</p>
      <details className="crm-review-heard">
        <summary>{t('capture.heard')}</summary>
        <p>{heard}</p>
      </details>

      {!lockedClient && (
        <div className="crm-grid-2">
          <label className="crm-field">
            <span>{t('deal.client')}</span>
            <select className="crm-input" value={clientChoice} onChange={(e) => setClientChoice(e.target.value)}>
              <option value="">{t('capture.pickClient')}</option>
              <option value="__new">{t('capture.newClient')}</option>
              {[...clients].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          {clientChoice === '__new' && (
            <label className="crm-field">
              <span>{t('field.name')}</span>
              <input className="crm-input" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
          )}
        </div>
      )}

      <div className="crm-seg" role="group">
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{t(`entry.${k}`)}</button>
        ))}
      </div>
      <textarea className="crm-textarea" value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('timeline.title')} />

      <label className="crm-check">
        <input type="checkbox" checked={withFollowUp} onChange={(e) => setWithFollowUp(e.target.checked)} /> {t('followup.title')}
      </label>
      {withFollowUp && (
        <div className="crm-grid-2">
          <input className="crm-input" type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} aria-label={t('followup.date')} />
          <input className="crm-input" value={fNote} placeholder={t('followup.note')} onChange={(e) => setFNote(e.target.value)} />
        </div>
      )}

      <label className="crm-check">
        <input type="checkbox" checked={withDeal} onChange={(e) => setWithDeal(e.target.checked)} /> {t('deal.new')}
      </label>
      {withDeal && (
        <div className="crm-grid-2">
          <input className="crm-input" value={dTitle} placeholder={t('deal.titleHint')} onChange={(e) => setDTitle(e.target.value)} aria-label={t('deal.title')} />
          <input className="crm-input" inputMode="decimal" value={dAmount} placeholder={t('deal.amountHint')} onChange={(e) => setDAmount(e.target.value)} aria-label={t('deal.amount', { currency: '' })} />
        </div>
      )}

      <div className="crm-dialog-actions">
        <button type="button" className="crm-btn crm-btn-ghost" onClick={onBack}>{t('capture.back')}</button>
        <button type="button" className="crm-btn crm-btn-primary" disabled={saving} onClick={() => void apply()}>
          {saving ? t('saving') : t('capture.write')}
        </button>
      </div>
    </div>
  );
}
