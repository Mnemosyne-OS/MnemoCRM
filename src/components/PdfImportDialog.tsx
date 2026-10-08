/**
 * A catalogue PDF into products, with the host's engines (doc 124 §14).
 *
 * 1. The host renders each page (the renderer MnemoReader uses).
 * 2. A model that can see reads the page: names, prices, details, and where
 *    each product's picture sits. One inference per page, SAID before it runs,
 *    because it can spend credits.
 * 3. The pictures are cut out of the page here, shown for review, and saved
 *    into MnemoCRM's own vault only for the products the person keeps, where
 *    the image memory finds them later.
 *
 * A model that cannot see refuses instead of guessing (doc 74); the dialog
 * then offers the text-only reading, without pictures, and says so.
 */
import { useEffect, useRef, useState } from 'react';
import { FileUp, ImageOff, Square } from 'lucide-react';
import { useI18n } from '../i18n';
import { parseAmount } from '../model/deal';
import { amountToInput } from '../model/format';
import { createProduct } from '../model/product';
import { roomLeft } from '../model/license';
import { MAX_PDF_PAGES, mergeItems, pagePrompt, parseCatalogAnswer, photoName, textPrompt, type Box, type CatalogItem } from '../model/pdfCatalog';
import type { Product, ProductKind } from '../model/types';
import {
  NoVisionError,
  extractPdfText,
  infer,
  inferOnImage,
  pickFile,
  renderPdfPage,
  saveProductPhoto,
  type LicenseWord,
} from '../data/host';
import { cropJpeg } from '../data/crop';
import type { ImportOutcome } from './ImportDialog';

interface Props {
  products: Product[];
  currency: string;
  license: LicenseWord;
  onImport: (records: Product[], onProgress: (done: number) => void) => Promise<ImportOutcome>;
  onLicense: () => void;
  onClose: () => void;
}

interface Row {
  key: string;
  keep: boolean;
  name: string;
  price: string;
  description: string;
  page: number;
  box?: Box;
  /** The cut-out, base64 JPEG; absent when there is no picture or the cut failed. */
  crop?: string;
  duplicate: boolean;
}

type Step =
  | { kind: 'pick' }
  | { kind: 'probing' }
  | { kind: 'confirm'; path: string; file: string; pages: number }
  | { kind: 'reading'; page: number; total: number; found: number }
  | { kind: 'noVision'; path: string }
  | { kind: 'textReading' }
  | { kind: 'review'; textOnly: boolean; unread: number; skippedPages: number; stopped: boolean }
  | { kind: 'writing'; done: number; total: number; phase: 'photos' | 'files' }
  | { kind: 'done'; outcome: ImportOutcome; photoFailed: number }
  | { kind: 'failed'; error: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function PdfImportDialog({ products, currency, license, onImport, onLicense, onClose }: Props) {
  const { t, tc, lang } = useI18n();
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [rows, setRows] = useState<Row[]>([]);
  const [kind, setKind] = useState<ProductKind>('unique');
  const stopRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopRef.current = true;
    };
  }, []);

  const busy = ['probing', 'reading', 'textReading', 'writing'].includes(step.kind);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const existing = new Set(products.map((p) => p.name.trim().toLowerCase()));
  const room = roomLeft('products', license, [], products);

  const toRows = async (items: CatalogItem[], pageImages: Map<number, string>): Promise<Row[]> => {
    const out: Row[] = [];
    let kept = 0;
    for (const [i, it] of mergeItems(items).entries()) {
      let crop: string | undefined;
      const pageImage = pageImages.get(it.page);
      if (it.box && pageImage) {
        try {
          crop = await cropJpeg(pageImage, it.box);
        } catch (err) {
          console.warn('[mnemo-crm] picture not cut out:', err);
        }
      }
      const duplicate = existing.has(it.name.trim().toLowerCase());
      const keep = !duplicate && (room === null || kept < room);
      if (keep) kept++;
      out.push({
        key: `${it.page}-${i}`,
        keep,
        name: it.name,
        price: amountToInput(lang, it.price),
        description: it.description ?? '',
        page: it.page,
        ...(it.box ? { box: it.box } : {}),
        ...(crop ? { crop } : {}),
        duplicate,
      });
    }
    return out;
  };

  const pick = async () => {
    try {
      const path = await pickFile(t('pdf.filter'), ['pdf']);
      if (!path) return;
      setStep({ kind: 'probing' });
      const first = await renderPdfPage(path, 0);
      if (!aliveRef.current) return;
      setStep({ kind: 'confirm', path, file: path.split(/[\\/]/).pop() ?? path, pages: first.pages });
    } catch (err) {
      console.warn('[mnemo-crm] PDF not opened:', err);
      setStep({ kind: 'failed', error: message(err) });
    }
  };

  const read = async (path: string, pages: number) => {
    stopRef.current = false;
    const total = Math.min(pages, MAX_PDF_PAGES);
    const images = new Map<number, string>();
    const items: CatalogItem[] = [];
    let unread = 0;
    let stopped = false;
    for (let p = 1; p <= total; p++) {
      if (stopRef.current) {
        stopped = true;
        break;
      }
      setStep({ kind: 'reading', page: p, total, found: items.length });
      try {
        const page = await renderPdfPage(path, p - 1);
        images.set(p, page.image);
        const answer = await inferOnImage(pagePrompt(p, pages, currency), page.image);
        const parsed = parseCatalogAnswer(answer, p);
        if (!parsed.readable) unread++;
        items.push(...parsed.items);
      } catch (err) {
        if (err instanceof NoVisionError) {
          if (aliveRef.current) setStep({ kind: 'noVision', path });
          return;
        }
        console.warn(`[mnemo-crm] page ${p} not read:`, err);
        unread++;
      }
      if (!aliveRef.current) return;
    }
    const next = await toRows(items, images);
    if (!aliveRef.current) return;
    setRows(next);
    setStep({ kind: 'review', textOnly: false, unread, skippedPages: Math.max(0, pages - total), stopped });
  };

  const readText = async (path: string) => {
    setStep({ kind: 'textReading' });
    try {
      const text = await extractPdfText(path);
      const answer = await infer(textPrompt(text, currency), { rag: false, maxTokens: 4000 });
      const parsed = parseCatalogAnswer(answer.text, 1);
      const next = await toRows(parsed.items.map(({ box: _box, ...rest }) => rest), new Map());
      if (!aliveRef.current) return;
      setRows(next);
      setStep({ kind: 'review', textOnly: true, unread: parsed.readable ? 0 : 1, skippedPages: 0, stopped: false });
    } catch (err) {
      console.warn('[mnemo-crm] PDF text not read:', err);
      if (aliveRef.current) setStep({ kind: 'failed', error: message(err) });
    }
  };

  const kept = rows.filter((r) => r.keep);
  const badPrice = kept.some((r) => parseAmount(r.price) === null);
  const overRoom = room !== null && kept.length > room;

  const write = async () => {
    if (kept.length === 0 || badPrice || overRoom) return;
    const now = new Date();
    const records: Product[] = [];
    let photoFailed = 0;
    for (const [i, r] of kept.entries()) {
      setStep({ kind: 'writing', done: i, total: kept.length, phase: 'photos' });
      const draft = createProduct(
        {
          name: r.name,
          kind,
          ...(parseAmount(r.price) !== undefined ? { price: parseAmount(r.price) as number } : {}),
          ...(r.description.trim() ? { description: r.description.trim() } : {}),
        },
        now,
      );
      if (!draft) continue;
      if (r.crop) {
        try {
          draft.photoPath = await saveProductPhoto(photoName(r.name, draft.id), r.crop);
        } catch (err) {
          console.warn('[mnemo-crm] picture not saved:', err);
          photoFailed++;
        }
      }
      if (!aliveRef.current) return;
      records.push(draft);
    }
    setStep({ kind: 'writing', done: 0, total: records.length, phase: 'files' });
    const outcome = await onImport(records, (done) => setStep({ kind: 'writing', done, total: records.length, phase: 'files' }));
    if (aliveRef.current) setStep({ kind: 'done', outcome, photoFailed });
  };

  const patch = (key: string, change: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...change } : r)));

  return (
    <div className="crm-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="crm-dialog crm-dialog-import" role="dialog" aria-modal="true" aria-labelledby="crm-pdf-title">
        <h2 id="crm-pdf-title">
          <FileUp size={18} aria-hidden="true" /> {t('pdf.title')}
        </h2>

        {step.kind === 'pick' && (
          <>
            <p>{t('pdf.intro')}</p>
            <div className="crm-dialog-actions">
              <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>{t('form.cancel')}</button>
              <button type="button" className="crm-btn crm-btn-primary" onClick={() => void pick()}>{t('pdf.pick')}</button>
            </div>
          </>
        )}

        {(step.kind === 'probing' || step.kind === 'textReading') && (
          <div className="crm-import-wait" aria-busy="true">
            <div className="crm-spinner" /> {t(step.kind === 'probing' ? 'pdf.probing' : 'pdf.textReading')}
          </div>
        )}

        {step.kind === 'confirm' && (
          <>
            <p className="crm-import-file">{step.file}</p>
            <p>{tc('pdf.pages', step.pages)}</p>
            <p className="crm-import-cost">{tc('pdf.cost', Math.min(step.pages, MAX_PDF_PAGES))}</p>
            {step.pages > MAX_PDF_PAGES && <p>{t('pdf.tooLong', { max: MAX_PDF_PAGES, skipped: step.pages - MAX_PDF_PAGES })}</p>}
            <div className="crm-dialog-actions">
              <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>{t('form.cancel')}</button>
              <button type="button" className="crm-btn crm-btn-primary" onClick={() => void read(step.path, step.pages)}>{t('pdf.start')}</button>
            </div>
          </>
        )}

        {step.kind === 'reading' && (
          <>
            <div className="crm-import-wait" aria-busy="true">
              <div className="crm-spinner" /> {t('pdf.reading', { page: step.page, total: step.total })} · {tc('pdf.found', step.found)}
            </div>
            <div className="crm-dialog-actions">
              <button type="button" className="crm-btn" onClick={() => { stopRef.current = true; }}>
                <Square size={14} aria-hidden="true" /> {t('pdf.stop')}
              </button>
            </div>
          </>
        )}

        {step.kind === 'noVision' && (
          <>
            <p role="alert">{t('pdf.noVision')}</p>
            <div className="crm-dialog-actions">
              <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>{t('form.cancel')}</button>
              <button type="button" className="crm-btn crm-btn-primary" onClick={() => void readText(step.path)}>{t('pdf.textOnly')}</button>
            </div>
          </>
        )}

        {step.kind === 'review' && (
          <>
            <ul className="crm-import-plan">
              <li><strong>{tc('pdf.foundTotal', rows.length)}</strong></li>
              {step.textOnly && <li>{t('pdf.textOnlyNote')}</li>}
              {step.stopped && <li>{t('pdf.stopped')}</li>}
              {step.unread > 0 && <li>{tc('pdf.unread', step.unread)}</li>}
              {step.skippedPages > 0 && <li>{tc('pdf.skipped', step.skippedPages)}</li>}
              {rows.some((r) => r.duplicate) && <li>{tc('import.duplicates', rows.filter((r) => r.duplicate).length)}</li>}
              {room !== null && (
                <li className={overRoom ? 'crm-import-limit' : undefined}>
                  {t('pdf.room', { room })}{' '}
                  {overRoom && <button type="button" className="crm-btn crm-btn-sm" onClick={onLicense}>{t('license.get')}</button>}
                </li>
              )}
            </ul>
            <div className="crm-seg" role="group" aria-label={t('product.kind')}>
              {(['unique', 'series'] as const).map((k) => (
                <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{t(`import.kind.${k}`)}</button>
              ))}
            </div>
            {rows.length === 0 ? (
              <p>{t('pdf.nothing')}</p>
            ) : (
              <div className="crm-pdf-grid">
                {rows.map((r) => (
                  <div key={r.key} className="crm-pdf-card" data-keep={r.keep}>
                    <label className="crm-pdf-keep">
                      <input type="checkbox" checked={r.keep} onChange={(e) => patch(r.key, { keep: e.target.checked })} />
                      <span>{r.duplicate ? t('pdf.already') : t('pdf.keep')}</span>
                      <small>{t('pdf.page', { page: r.page })}</small>
                    </label>
                    <div className="crm-pdf-photo">
                      {r.crop ? (
                        <img src={`data:image/jpeg;base64,${r.crop}`} alt={r.name} />
                      ) : (
                        <span className="crm-pdf-nophoto"><ImageOff size={20} aria-hidden="true" />{t('pdf.noPhoto')}</span>
                      )}
                    </div>
                    <input className="crm-input" value={r.name} aria-label={t('product.name')} onChange={(e) => patch(r.key, { name: e.target.value })} />
                    <input
                      className="crm-input"
                      inputMode="decimal"
                      value={r.price}
                      placeholder={t('pdf.noPrice')}
                      aria-label={t('product.price', { currency })}
                      aria-invalid={parseAmount(r.price) === null}
                      onChange={(e) => patch(r.key, { price: e.target.value })}
                    />
                    <textarea className="crm-input" rows={2} value={r.description} placeholder={t('product.descriptionHint')} aria-label={t('product.description')} onChange={(e) => patch(r.key, { description: e.target.value })} />
                  </div>
                ))}
              </div>
            )}
            {badPrice && <p className="crm-error-text" role="alert">{t('pdf.badPrice')}</p>}
            <div className="crm-dialog-actions">
              <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>{t('form.cancel')}</button>
              <button type="button" className="crm-btn crm-btn-primary" disabled={kept.length === 0 || badPrice || overRoom || !kept.every((r) => r.name.trim())} onClick={() => void write()}>
                {tc('import.go.products', kept.length)}
              </button>
            </div>
          </>
        )}

        {step.kind === 'writing' && (
          <div className="crm-import-wait" aria-busy="true">
            <div className="crm-spinner" /> {t(step.phase === 'photos' ? 'pdf.writingPhotos' : 'import.writing', { done: step.done, total: step.total })}
          </div>
        )}

        {step.kind === 'done' && (
          <>
            <p role="status"><strong>{tc('import.written.products', step.outcome.written)}</strong></p>
            {step.photoFailed > 0 && <p role="alert">{tc('pdf.photoFailed', step.photoFailed)}</p>}
            {step.outcome.failed.length > 0 && (
              <div className="crm-notice crm-notice-danger" role="alert">
                <span>{tc('import.failed', step.outcome.failed.length)} {step.outcome.failed.slice(0, 5).map((f) => `${f.name} (${f.error})`).join(', ')}</span>
              </div>
            )}
            <div className="crm-dialog-actions">
              <button type="button" className="crm-btn crm-btn-primary" onClick={onClose}>{t('import.close')}</button>
            </div>
          </>
        )}

        {step.kind === 'failed' && (
          <>
            <p className="crm-error-text" role="alert">{t('pdf.failed', { error: step.error })}</p>
            <div className="crm-dialog-actions">
              <button type="button" className="crm-btn" onClick={() => setStep({ kind: 'pick' })}>{t('import.back')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
