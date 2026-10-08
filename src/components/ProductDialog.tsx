/**
 * Create or edit a product. A series has a stock (left empty = not tracked,
 * which is not "out of stock"); a unique piece has a status instead.
 */
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { parseAmount } from '../model/deal';
import { PICTOGRAMS, createProduct, normalizeProduct } from '../model/product';
import { amountToInput } from '../model/format';
import type { Product, ProductKind } from '../model/types';
import { pickImage } from '../data/host';
import { ProductPhoto } from './ProductPhoto';

interface Props {
  product?: Product;
  currency: string;
  saving: boolean;
  onSave: (product: Product) => Promise<boolean>;
  onClose: () => void;
}

export function ProductDialog({ product, currency, saving, onSave, onClose }: Props) {
  const { t, lang } = useI18n();
  const [name, setName] = useState(product?.name ?? '');
  const [kind, setKind] = useState<ProductKind>(product?.kind ?? 'unique');
  const [price, setPrice] = useState(amountToInput(lang, product?.price));
  const [stock, setStock] = useState(product?.stock !== undefined ? String(product.stock) : '');
  const [photo, setPhoto] = useState(product?.photoPath ?? '');
  const [emoji, setEmoji] = useState(product?.emoji ?? '');
  const [tags, setTags] = useState((product?.tags ?? []).join(', '));
  const [description, setDescription] = useState(product?.description ?? '');
  const [errors, setErrors] = useState<{ name?: boolean; price?: boolean; stock?: boolean; photo?: string }>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const picking = useRef(false);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choosePhoto = async () => {
    // A latch, not a deadline: the OS dialog stays open as long as the person browses.
    if (picking.current) return;
    picking.current = true;
    try {
      const path = await pickImage(t('product.imageFilter'));
      if (path) setPhoto(path);
      setErrors((e) => ({ ...e, photo: undefined }));
    } catch (err) {
      console.warn('[mnemo-crm] photo picker failed:', err);
      setErrors((e) => ({ ...e, photo: err instanceof Error ? err.message : String(err) }));
    } finally {
      picking.current = false;
    }
  };

  const submit = async () => {
    const parsedPrice = parseAmount(price);
    const trimmedStock = stock.trim();
    const parsedStock = trimmedStock === '' ? undefined : /^\d{1,6}$/.test(trimmedStock) ? Number(trimmedStock) : null;
    const next = { name: !name.trim(), price: parsedPrice === null, stock: kind === 'series' && parsedStock === null };
    setErrors(next);
    if (next.name || next.price || next.stock) return;
    const fields = {
      name,
      kind,
      price: parsedPrice ?? undefined,
      stock: kind === 'series' ? parsedStock ?? undefined : undefined,
      photoPath: photo || undefined,
      emoji: emoji || undefined,
      description: description.trim() || undefined,
      tags: tags.split(',').map((x) => x.trim()).filter(Boolean),
    };
    const now = new Date();
    const record = product
      ? normalizeProduct({ ...product, ...fields, updatedAt: now.toISOString() })
      : createProduct(fields, now);
    if (record && (await onSave(record))) onClose();
  };

  return (
    <div className="crm-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="crm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-product-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 id="crm-product-title">{product ? t('product.editTitle') : t('product.newTitle')}</h2>

        <div className="crm-product-photo-field">
          <button type="button" className="crm-photo-pick" onClick={() => void choosePhoto()}>
            {photo || emoji ? <ProductPhoto path={photo || undefined} emoji={emoji || undefined} name={name || '?'} /> : (
              <span className="crm-photo-pick-empty"><ImagePlus size={24} aria-hidden="true" />{t('product.pickPhoto')}</span>
            )}
          </button>
          {photo && (
            <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setPhoto('')}>
              <X size={14} aria-hidden="true" /> {t('product.removePhoto')}
            </button>
          )}
          {errors.photo && <small className="crm-error-text">{errors.photo}</small>}
        </div>

        <div className="crm-field">
          <span>{t('product.pictogram')}</span>
          <div className="crm-emoji-grid" role="radiogroup" aria-label={t('product.pictogram')}>
            <button type="button" role="radio" aria-checked={!emoji} className="crm-emoji-none" onClick={() => setEmoji('')}>
              {t('product.noPictogram')}
            </button>
            {PICTOGRAMS.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={emoji === e} onClick={() => setEmoji(e)}>
                {e}
              </button>
            ))}
          </div>
          <small>{t('product.pictogramHint')}</small>
        </div>

        <label className="crm-field">
          <span>{t('product.name')}</span>
          <input ref={nameRef} className="crm-input" value={name} aria-invalid={!!errors.name} onChange={(e) => setName(e.target.value)} />
          {errors.name && <small className="crm-error-text">{t('form.nameRequired')}</small>}
        </label>

        <div className="crm-field">
          <span>{t('product.kind')}</span>
          <div className="crm-seg" role="group">
            {(['unique', 'series'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {t(`product.kind.${k}`)}
              </button>
            ))}
          </div>
          <small>{t(`product.kindHint.${kind}`)}</small>
        </div>

        <div className="crm-grid-2">
          <label className="crm-field">
            <span>{t('product.price', { currency })}</span>
            <input className="crm-input" inputMode="decimal" value={price} aria-invalid={!!errors.price} onChange={(e) => setPrice(e.target.value)} />
            {errors.price && <small className="crm-error-text">{t('deal.amountInvalid')}</small>}
          </label>
          {kind === 'series' && (
            <label className="crm-field">
              <span>{t('product.stock')}</span>
              <input className="crm-input" inputMode="numeric" value={stock} placeholder={t('product.stockHint')} aria-invalid={!!errors.stock} onChange={(e) => setStock(e.target.value)} />
              {errors.stock && <small className="crm-error-text">{t('product.stockInvalid')}</small>}
            </label>
          )}
        </div>

        <label className="crm-field">
          <span>{t('product.description')}</span>
          <textarea className="crm-input" rows={3} value={description} placeholder={t('product.descriptionHint')} onChange={(e) => setDescription(e.target.value)} />
        </label>

        <label className="crm-field">
          <span>{t('field.tags')}</span>
          <input className="crm-input" value={tags} onChange={(e) => setTags(e.target.value)} />
          <small>{t('field.tagsHint')}</small>
        </label>

        <div className="crm-dialog-actions">
          <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>{t('form.cancel')}</button>
          <button type="submit" className="crm-btn crm-btn-primary" disabled={saving}>
            {saving ? t('saving') : product ? t('form.save') : t('product.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
