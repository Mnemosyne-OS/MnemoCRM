/**
 * Create a market: a name, where, the days, and the stand fee if known
 * (unknown stays unknown: the report then shows no net, never "net = total").
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { parseAmount } from '../model/deal';
import { createMarket } from '../model/market';
import type { Market } from '../model/types';

interface Props {
  currency: string;
  today: string;
  saving: boolean;
  onSave: (market: Market) => Promise<boolean>;
  onClose: () => void;
}

export function MarketDialog({ currency, today, saving, onSave, onClose }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState('');
  const [fee, setFee] = useState('');
  const [errors, setErrors] = useState<{ name?: boolean; fee?: boolean; dates?: boolean }>({});
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    const parsedFee = parseAmount(fee);
    const next = { name: !name.trim(), fee: parsedFee === null, dates: !start || (!!end && end < start) };
    setErrors(next);
    if (next.name || next.fee || next.dates) return;
    const market = createMarket({ name, place, startDate: start, endDate: end || undefined, standFee: parsedFee ?? undefined });
    if (market && (await onSave(market))) onClose();
  };

  return (
    <div className="crm-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="crm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-market-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="crm-market-title">{t('market.new')}</h2>
        <label className="crm-field">
          <span>{t('market.name')}</span>
          <input ref={nameRef} className="crm-input" value={name} placeholder={t('market.nameHint')} aria-invalid={!!errors.name} onChange={(e) => setName(e.target.value)} />
          {errors.name && <small className="crm-error-text">{t('form.nameRequired')}</small>}
        </label>
        <label className="crm-field">
          <span>{t('market.place')}</span>
          <input className="crm-input" value={place} onChange={(e) => setPlace(e.target.value)} />
        </label>
        <div className="crm-grid-2">
          <label className="crm-field">
            <span>{t('market.start')}</span>
            <input className="crm-input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="crm-field">
            <span>{t('market.end')}</span>
            <input className="crm-input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        {errors.dates && <small className="crm-error-text">{t('market.datesInvalid')}</small>}
        <label className="crm-field">
          <span>{t('market.fee')} ({currency})</span>
          <input className="crm-input" inputMode="decimal" value={fee} placeholder={t('deal.amountHint')} aria-invalid={!!errors.fee} onChange={(e) => setFee(e.target.value)} />
          {errors.fee && <small className="crm-error-text">{t('deal.amountInvalid')}</small>}
        </label>
        <div className="crm-dialog-actions">
          <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>{t('form.cancel')}</button>
          <button type="submit" className="crm-btn crm-btn-primary" disabled={saving}>{saving ? t('saving') : t('market.create')}</button>
        </div>
      </form>
    </div>
  );
}
