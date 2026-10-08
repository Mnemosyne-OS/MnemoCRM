/**
 * "What we know" about a client (doc 124 §5.4): the book's own facts, plus
 * what the rest of the person's memory holds (recorded calls, notes, mails),
 * WITH the sources it came from. On demand only: each press is an inference,
 * which can spend cloud credits, so it never runs when the sheet opens.
 */
import { useEffect, useState } from 'react';
import { BookOpen, RefreshCw, Sparkles } from 'lucide-react';
import { useI18n } from '../i18n';
import { bookFacts } from '../model/memory';
import { knowPrompt } from '../model/proposal';
import { formatInstant, formatMoney } from '../model/format';
import type { BookSettings, Client, Deal } from '../model/types';
import { infer, type MemorySource } from '../data/host';

type KnowState =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'ok'; text: string; sources: MemorySource[]; at: string }
  | { kind: 'failed'; error: string };

export function KnowPanel({ client, deals, settings }: { client: Client; deals: Deal[]; settings: BookSettings }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<KnowState>({ kind: 'idle' });

  // Another client, another answer: never show Paul's summary on Anna's sheet.
  useEffect(() => setState({ kind: 'idle' }), [client.id]);

  const ask = async () => {
    setState({ kind: 'asking' });
    const dealLines = deals.map((d) => {
      const stage = settings.stages.find((s) => s.id === d.stageId)?.label ?? d.stageId;
      const amount = d.amount !== undefined ? `, ${formatMoney(lang, settings.currency, d.amount)}` : '';
      return `${d.title} (${d.closed ? d.closed.outcome : stage}${amount})`;
    });
    const facts = bookFacts(client, dealLines, (k) => t(`entry.${k}`));
    try {
      const answer = await infer(knowPrompt(client, facts, lang), {
        rag: true,
        // The retrieval looks for the client, not for the instructions around them.
        ragQuery: client.company ? `${client.name} ${client.company}` : client.name,
        maxTokens: 700,
      });
      setState({ kind: 'ok', text: answer.text, sources: answer.sources, at: new Date().toISOString() });
    } catch (err) {
      console.warn('[mnemo-crm] "what we know" failed:', err);
      setState({ kind: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <section className="crm-panel crm-know" aria-labelledby="crm-know-title">
      <div className="crm-panel-head">
        <h2 id="crm-know-title"><BookOpen size={14} aria-hidden="true" /> {t('know.title')}</h2>
        <button className="crm-btn crm-btn-sm" onClick={() => void ask()} disabled={state.kind === 'asking'}>
          {state.kind === 'ok' ? <RefreshCw size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}{' '}
          {state.kind === 'asking' ? t('know.asking') : state.kind === 'ok' ? t('know.again') : t('know.ask')}
        </button>
      </div>

      {state.kind === 'idle' && <p className="crm-card-sub">{t('know.hint')}</p>}
      {state.kind === 'asking' && <div className="crm-spinner" aria-label={t('know.asking')} />}
      {state.kind === 'failed' && <p className="crm-error-text" role="alert">{t('know.failed', { error: state.error })}</p>}
      {state.kind === 'ok' && (
        <>
          <p className="crm-review-badge"><Sparkles size={12} aria-hidden="true" /> {t('know.byModel', { date: formatInstant(lang, state.at) })}</p>
          <div className="crm-know-text">{state.text}</div>
          {state.sources.length === 0 ? (
            <p className="crm-card-sub">{t('know.noSources')}</p>
          ) : (
            <details className="crm-know-sources">
              <summary>{t('know.sources', { count: state.sources.length })}</summary>
              <ul>
                {state.sources.map((s, i) => (
                  <li key={i}>
                    <span className="crm-badge">{s.vault}</span>
                    {s.filePath && <span className="crm-know-path" title={s.filePath}>{s.filePath.split(/[\\/]/).pop()}</span>}
                    <p>{s.text.slice(0, 280)}{s.text.length > 280 ? '…' : ''}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
