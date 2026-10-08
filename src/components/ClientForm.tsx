/**
 * New / edit client dialog. Only the name is required. Consent to be
 * contacted again is a three-way answer: "not asked" is not "no".
 */
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { createClient, normalizeClient } from '../model/client';
import type { Client, ClientKind } from '../model/types';

interface Props {
  initial?: Client;
  saving: boolean;
  onSubmit: (client: Client) => Promise<boolean>;
  onClose: () => void;
}

type Consent = 'unknown' | 'yes' | 'no';

export function ClientForm({ initial, saving, onSubmit, onClose }: Props) {
  const { t } = useI18n();
  const [kind, setKind] = useState<ClientKind>(initial?.kind ?? 'person');
  const [name, setName] = useState(initial?.name ?? '');
  const [company, setCompany] = useState(initial?.company ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [source, setSource] = useState(initial?.source ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [consent, setConsent] = useState<Consent>(
    initial?.contactConsent === undefined ? 'unknown' : initial.contactConsent.value ? 'yes' : 'no',
  );
  const [nameError, setNameError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (!name.trim()) {
      setNameError(true);
      nameRef.current?.focus();
      return;
    }
    const now = new Date();
    const fields = {
      kind,
      name,
      // The field is only shown for a person: a company is not "at" another company.
      company: kind === 'person' ? company : '',
      email,
      phone,
      address,
      source,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    };
    // Consent keeps its original date when the answer did not change.
    const previous = initial?.contactConsent;
    const contactConsent =
      consent === 'unknown'
        ? undefined
        : previous && previous.value === (consent === 'yes')
          ? previous
          : { value: consent === 'yes', at: now.toISOString() };

    const next = initial
      ? normalizeClient({ ...initial, ...fields, contactConsent, updatedAt: now.toISOString() })
      : (() => {
          const created = createClient(fields, now);
          return created ? normalizeClient({ ...created, contactConsent }) : null;
        })();
    if (!next) {
      setNameError(true);
      return;
    }
    if (await onSubmit(next)) onClose();
  };

  return (
    <div className="crm-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="crm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-form-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="crm-form-title">{initial ? t('form.editTitle') : t('form.newTitle')}</h2>

        <div className="crm-seg" role="group">
          {(['person', 'company'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {t(`kind.${k}`)}
            </button>
          ))}
        </div>

        <label className="crm-field">
          <span>{t('field.name')}</span>
          <input
            ref={nameRef}
            className="crm-input"
            value={name}
            aria-invalid={nameError}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(false);
            }}
          />
          {nameError && <small className="crm-error-text">{t('form.nameRequired')}</small>}
        </label>

        {kind === 'person' && (
          <label className="crm-field">
            <span>{t('field.company')}</span>
            <input className="crm-input" value={company} onChange={(e) => setCompany(e.target.value)} />
          </label>
        )}

        <div className="crm-grid-2">
          <label className="crm-field">
            <span>{t('field.email')}</span>
            <input className="crm-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="crm-field">
            <span>{t('field.phone')}</span>
            <input className="crm-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
        </div>

        <label className="crm-field">
          <span>{t('field.address')}</span>
          <input className="crm-input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>

        <label className="crm-field">
          <span>{t('field.source')}</span>
          <input className="crm-input" value={source} placeholder={t('field.sourceHint')} onChange={(e) => setSource(e.target.value)} />
        </label>

        <label className="crm-field">
          <span>{t('field.tags')}</span>
          <input className="crm-input" value={tags} onChange={(e) => setTags(e.target.value)} />
          <small>{t('field.tagsHint')}</small>
        </label>

        <div className="crm-field">
          <span>{t('consent.label')}</span>
          <div className="crm-seg" role="group" aria-label={t('consent.label')}>
            {(['unknown', 'yes', 'no'] as const).map((c) => (
              <button key={c} type="button" aria-pressed={consent === c} onClick={() => setConsent(c)}>
                {t(`consent.${c}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="crm-dialog-actions">
          <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>
            {t('form.cancel')}
          </button>
          <button type="submit" className="crm-btn crm-btn-primary" disabled={saving}>
            {saving ? t('saving') : initial ? t('form.save') : t('form.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
