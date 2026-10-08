/**
 * The catalogue as a wall of pictures (doc 124 §5.3: an artisan recognises the
 * piece before reading its name). A sold unique piece turns grey with the day
 * it left, and leaves the "for sale" view; it stays in the book.
 */
import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useI18n } from '../i18n';
import { adjustStock, filterCatalog, isOutOfStock, setUniqueStatus, type CatalogFilter } from '../model/product';
import { formatMoney } from '../model/format';
import type { Product, UniqueStatus } from '../model/types';
import { ProductPhoto } from './ProductPhoto';

interface Props {
  products: Product[];
  currency: string;
  saving: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onSave: (product: Product) => Promise<boolean>;
}

const NEXT_STATUSES: Record<UniqueStatus, UniqueStatus[]> = {
  available: ['reserved', 'sold'],
  reserved: ['available', 'sold'],
  sold: ['available'],
};

export function CatalogView({ products, currency, saving, onOpen, onNew, onSave }: Props) {
  const { t, lang } = useI18n();
  const [filter, setFilter] = useState<CatalogFilter>('forSale');
  const shown = filterCatalog(products, filter);

  return (
    <div>
      <header className="crm-board-head">
        <h1>{t('nav.catalog')}</h1>
        <div className="crm-board-tools">
          <div className="crm-seg" role="group">
            {(['forSale', 'sold', 'all'] as const).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {t(`catalog.filter.${f}`)}
              </button>
            ))}
          </div>
          <button className="crm-btn crm-btn-primary" onClick={onNew}>
            <Plus size={14} aria-hidden="true" /> {t('product.new')}
          </button>
        </div>
      </header>

      {products.length === 0 ? (
        <div className="crm-welcome">
          <h2>{t('catalog.empty.title')}</h2>
          <p>{t('catalog.empty.body')}</p>
          <button className="crm-btn crm-btn-primary crm-btn-lg" onClick={onNew}>
            <Plus size={18} aria-hidden="true" /> {t('product.new')}
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div className="crm-col-empty">{t(`catalog.none.${filter}`)}</div>
      ) : (
        <div className="crm-catalog">
          {shown.map((p) => {
            const sold = p.kind === 'unique' && p.status === 'sold';
            return (
              <article key={p.id} className={`crm-tile${sold ? ' crm-tile-sold' : ''}`}>
                <button className="crm-tile-open" onClick={() => onOpen(p.id)} aria-label={p.name}>
                  <ProductPhoto path={p.photoPath} emoji={p.emoji} name={p.name} sold={sold} />
                  {sold && (
                    <span className="crm-stamp">
                      {t('product.soldStamp')}
                      {p.soldAt && <small>{new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(new Date(p.soldAt))}</small>}
                    </span>
                  )}
                </button>
                <div className="crm-tile-body">
                  <div className="crm-tile-name">{p.name}</div>
                  <div className="crm-tile-meta">
                    <span>{p.price !== undefined ? formatMoney(lang, currency, p.price) : '—'}</span>
                    <span className="crm-badge">{t(`product.kind.${p.kind}`)}</span>
                  </div>
                  {p.kind === 'series' ? (
                    <div className="crm-tile-actions">
                      {p.stock === undefined ? (
                        <span className="crm-card-sub">{t('product.stockUntracked')}</span>
                      ) : (
                        <>
                          <button className="crm-icon-btn" aria-label={t('product.stockMinus')} disabled={saving || p.stock === 0} onClick={() => void onSave(adjustStock(p, -1))}>
                            <Minus size={14} />
                          </button>
                          <span className={isOutOfStock(p) ? 'crm-status-bad' : ''}>
                            {isOutOfStock(p) ? t('product.outOfStock') : t('product.inStock', { count: p.stock })}
                          </span>
                          <button className="crm-icon-btn" aria-label={t('product.stockPlus')} disabled={saving} onClick={() => void onSave(adjustStock(p, 1))}>
                            <Plus size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="crm-tile-actions">
                      <span className={`crm-badge crm-badge-${p.status}`}>{t(`product.status.${p.status}`)}</span>
                      {NEXT_STATUSES[p.status ?? 'available'].map((s) => (
                        <button key={s} className="crm-btn crm-btn-ghost crm-btn-sm" disabled={saving} onClick={() => void onSave(setUniqueStatus(p, s))}>
                          {t(`product.to.${s}`)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
