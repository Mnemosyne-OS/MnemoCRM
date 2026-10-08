/**
 * A product's picture, read through the host. Four states, never two: no photo
 * (the product's pictogram drawn large, else a monogram), loading, shown, and
 * "has a photo we could not read" — the last one looks different from the first
 * on purpose, or a broken photo passes for a product that never had one and
 * nobody repairs it.
 */
import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { useI18n } from '../i18n';
import { readImage } from '../data/host';
import { initials } from '../model/format';

type PhotoState = { kind: 'none' } | { kind: 'loading' } | { kind: 'ok'; url: string } | { kind: 'error' };

export function ProductPhoto({ path, name, emoji, sold = false }: { path?: string; name: string; emoji?: string; sold?: boolean }) {
  const { t } = useI18n();
  const [state, setState] = useState<PhotoState>(path ? { kind: 'loading' } : { kind: 'none' });

  useEffect(() => {
    if (!path) {
      setState({ kind: 'none' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    readImage(path)
      .then((url) => !cancelled && setState({ kind: 'ok', url }))
      .catch((err) => {
        console.warn('[mnemo-crm] product photo unreadable:', path, err);
        if (!cancelled) setState({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const cls = `crm-photo${sold ? ' crm-photo-sold' : ''}`;
  if (state.kind === 'ok') return <img className={cls} src={state.url} alt={name} />;
  return (
    <div className={`${cls} crm-photo-empty${state.kind === 'error' ? ' crm-photo-broken' : ''}`} aria-label={name}>
      {state.kind === 'error' ? (
        <span className="crm-photo-broken-label">
          <ImageOff size={18} aria-hidden="true" /> {t('product.photoUnreadable')}
        </span>
      ) : state.kind === 'loading' ? (
        <span className="crm-spinner" />
      ) : emoji ? (
        <span className="crm-photo-emoji" aria-hidden="true">{emoji}</span>
      ) : (
        <span className="crm-photo-mono">{initials(name)}</span>
      )}
    </div>
  );
}
