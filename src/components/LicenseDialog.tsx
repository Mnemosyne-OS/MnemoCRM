/**
 * The free limit was reached, or a licensed import was asked for (doc 124 §14).
 *
 * It says what the license adds and, just as plainly, what stays without one:
 * nothing already in the book is hidden or locked. The purchase itself is the
 * host's wallet; this dialog only opens it.
 */
import { useEffect, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n';
import { FREE_LIMITS } from '../model/license';
import { offerLicense, type LicenseWord } from '../data/host';

export type LicenseReason = 'clients' | 'products' | 'pdf';

interface Props {
  reason: LicenseReason;
  onRecheck: () => Promise<LicenseWord>;
  onClose: () => void;
}

export function LicenseDialog({ reason, onRecheck, onClose }: Props) {
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = async () => {
    try {
      await offerLicense();
      setNote(t('license.walletOpened'));
    } catch (err) {
      console.warn('[mnemo-crm] wallet did not open:', err);
      setNote(t('license.walletFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  const recheck = async () => {
    setChecking(true);
    try {
      const word = await onRecheck();
      if (word === 'inactive') setNote(t('license.stillNone'));
      else onClose();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="crm-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="crm-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-license-title">
        <h2 id="crm-license-title">
          <KeyRound size={18} aria-hidden="true" /> {t(`license.title.${reason}`)}
        </h2>
        <p>{t(`license.body.${reason}`, { clients: FREE_LIMITS.clients, products: FREE_LIMITS.products })}</p>
        <p className="crm-muted-text">{t('license.keeps')}</p>
        {note && <p role="status">{note}</p>}
        <div className="crm-dialog-actions crm-dialog-actions-split">
          <button type="button" className="crm-btn crm-btn-ghost" disabled={checking} onClick={() => void recheck()}>
            <RefreshCw size={14} aria-hidden="true" /> {checking ? t('license.checking') : t('license.recheck')}
          </button>
          <div className="crm-dialog-actions">
            <button type="button" className="crm-btn" onClick={onClose}>{t('license.later')}</button>
            <button type="button" className="crm-btn crm-btn-primary" onClick={() => void open()}>{t('license.get')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
