/**
 * Import the list a person already keeps (doc 124 §14).
 *
 * CSV and Excel are free. The PDF catalogue import runs on the host's engines
 * and needs a license; it opens its own dialog.
 *
 * Every column guess is shown and can be changed, the count of what will be
 * written is shown BEFORE the button, and nothing already in the book is
 * overwritten: a row that matches is set aside and counted.
 */
import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, FileUp, Lock } from 'lucide-react';
import { useI18n } from '../i18n';
import {
  CLIENT_FIELDS,
  PRODUCT_FIELDS,
  guessMapping,
  looksLikeHeader,
  planClients,
  planProducts,
  type Field,
  type ImportTarget,
} from '../model/importMap';
import { roomLeft, pdfImportAllowed, FREE_LIMITS } from '../model/license';
import { bytesFromDataUrl, parseCsv, readXlsx, type Sheet } from '../model/tabular';
import type { Client, Product, ProductKind } from '../model/types';
import { pickFile, readAnyFile, type LicenseWord } from '../data/host';

export interface ImportOutcome {
  written: number;
  failed: { name: string; error: string }[];
}

interface Props {
  clients: Client[];
  products: Product[];
  license: LicenseWord;
  initialTarget?: ImportTarget;
  onImport: (target: ImportTarget, records: (Client | Product)[], onProgress: (done: number) => void) => Promise<ImportOutcome>;
  onPdf: () => void;
  onLicense: () => void;
  onClose: () => void;
}

type Step =
  | { kind: 'choose' }
  | { kind: 'reading' }
  | { kind: 'map'; file: string; sheets: Sheet[]; mojibake: boolean }
  | { kind: 'writing'; done: number; total: number }
  | { kind: 'done'; outcome: ImportOutcome; target: ImportTarget }
  | { kind: 'failed'; error: string };

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function ImportDialog({ clients, products, license, initialTarget = 'clients', onImport, onPdf, onLicense, onClose }: Props) {
  const { t, tc } = useI18n();
  const [target, setTarget] = useState<ImportTarget>(initialTarget);
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [sheetIndex, setSheetIndex] = useState(0);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<Field[]>([]);
  const [kind, setKind] = useState<ProductKind>('series');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && step.kind !== 'writing' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, step.kind]);

  const rows = step.kind === 'map' ? step.sheets[sheetIndex]?.rows ?? [] : [];
  const headers = hasHeader && rows[0] ? rows[0] : (rows[0] ?? []).map((_, i) => t('import.column', { n: i + 1 }));
  const body = hasHeader ? rows.slice(1) : rows;
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length));

  // A new sheet, a new target or a header switch re-guesses the columns.
  useEffect(() => {
    if (step.kind !== 'map') return;
    const hs = hasHeader && rows[0] ? rows[0] : [];
    const guessed = guessMapping(hs, target);
    setMapping(Array.from({ length: width }, (_, i) => guessed[i] ?? 'skip'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind === 'map' ? step.sheets : null, sheetIndex, hasHeader, target]);

  const room = roomLeft(target, license, clients, products);
  const source = step.kind === 'map' ? t('import.sourceLabel', { file: step.file }) : '';
  const plan = useMemo(() => {
    if (step.kind !== 'map') return null;
    return target === 'clients'
      ? planClients(body, mapping, clients, room, source)
      : planProducts(body, mapping, products, room, kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, sheetIndex, hasHeader, mapping, target, kind, clients, products, room, source]);

  const choose = async (format: 'csv' | 'xlsx') => {
    try {
      const path = await pickFile(
        t(format === 'csv' ? 'import.filterCsv' : 'import.filterXlsx'),
        format === 'csv' ? ['csv', 'tsv', 'txt'] : ['xlsx'],
      );
      if (!path) return;
      setStep({ kind: 'reading' });
      const file = await readAnyFile(path);
      let sheets: Sheet[];
      let mojibake = false;
      if (format === 'csv') {
        if (file.isBinary) throw new Error('NOT_TEXT');
        const csv = parseCsv(file.content);
        sheets = [{ name: baseName(path), rows: csv.rows }];
        mojibake = csv.mojibake;
      } else {
        if (!file.isBinary) throw new Error('NOT_A_WORKBOOK');
        sheets = (await readXlsx(bytesFromDataUrl(file.content))).filter((s) => s.rows.length > 0);
      }
      if (sheets.length === 0 || sheets.every((s) => s.rows.length === 0)) throw new Error('EMPTY_FILE');
      setSheetIndex(0);
      setHasHeader(looksLikeHeader(sheets[0].rows[0] ?? []));
      setStep({ kind: 'map', file: baseName(path), sheets, mojibake });
    } catch (err) {
      console.warn('[mnemo-crm] import file unreadable:', err);
      const code = err instanceof Error ? err.message : String(err);
      setStep({ kind: 'failed', error: t(`import.error.${code}`) === `import.error.${code}` ? code : t(`import.error.${code}`) });
    }
  };

  const run = async () => {
    if (!plan || plan.create.length === 0) return;
    const total = plan.create.length;
    setStep({ kind: 'writing', done: 0, total });
    const outcome = await onImport(target, plan.create, (done) => setStep({ kind: 'writing', done, total }));
    setStep({ kind: 'done', outcome, target });
  };

  const fields: readonly Field[] = target === 'clients' ? CLIENT_FIELDS : PRODUCT_FIELDS;
  const pdfLocked = !pdfImportAllowed(license);

  return (
    <div className="crm-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && step.kind !== 'writing' && onClose()}>
      <div className="crm-dialog crm-dialog-import" role="dialog" aria-modal="true" aria-labelledby="crm-import-title">
        <h2 id="crm-import-title">
          <FileUp size={18} aria-hidden="true" /> {t('import.title')}
        </h2>

        {step.kind === 'choose' && (
          <>
            <div className="crm-field">
              <span>{t('import.what')}</span>
              <div className="crm-seg" role="group">
                {(['clients', 'products'] as const).map((k) => (
                  <button key={k} type="button" aria-pressed={target === k} onClick={() => setTarget(k)}>
                    {t(`import.target.${k}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="crm-import-sources">
              <button type="button" className="crm-import-source" onClick={() => void choose('csv')}>
                <FileText size={28} aria-hidden="true" />
                <strong>CSV</strong>
                <small>{t('import.csvHint')}</small>
                <span className="crm-badge">{t('import.free')}</span>
              </button>
              <button type="button" className="crm-import-source" onClick={() => void choose('xlsx')}>
                <FileSpreadsheet size={28} aria-hidden="true" />
                <strong>Excel</strong>
                <small>{t('import.xlsxHint')}</small>
                <span className="crm-badge">{t('import.free')}</span>
              </button>
              {target === 'products' && (
                <button type="button" className="crm-import-source" onClick={pdfLocked ? onLicense : onPdf}>
                  <FileUp size={28} aria-hidden="true" />
                  <strong>{t('import.pdf')}</strong>
                  <small>{t('import.pdfHint')}</small>
                  <span className="crm-badge crm-badge-license">
                    {pdfLocked && <Lock size={12} aria-hidden="true" />} {t('import.licensed')}
                  </span>
                </button>
              )}
            </div>
            {room !== null && (
              <p className="crm-import-room">
                {t(`import.room.${target}`, { room, limit: FREE_LIMITS[target] })}
              </p>
            )}
          </>
        )}

        {step.kind === 'reading' && (
          <div className="crm-import-wait" aria-busy="true">
            <div className="crm-spinner" /> {t('import.reading')}
          </div>
        )}

        {step.kind === 'map' && plan && (
          <>
            <p className="crm-import-file">
              {step.file}
              {step.sheets.length > 1 && (
                <select className="crm-input crm-import-sheet" value={sheetIndex} aria-label={t('import.sheet')} onChange={(e) => setSheetIndex(Number(e.target.value))}>
                  {step.sheets.map((s, i) => (
                    <option key={s.name + i} value={i}>{s.name}</option>
                  ))}
                </select>
              )}
            </p>
            {step.mojibake && (
              <div className="crm-notice crm-notice-danger" role="alert">
                <span>{t('import.mojibake')}</span>
              </div>
            )}
            <div className="crm-import-options">
              <label className="crm-check">
                <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> {t('import.hasHeader')}
              </label>
              {target === 'products' && (
                <div className="crm-seg" role="group" aria-label={t('product.kind')}>
                  {(['series', 'unique'] as const).map((k) => (
                    <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                      {t(`import.kind.${k}`)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="crm-import-map" role="table" aria-label={t('import.columns')}>
              {Array.from({ length: width }, (_, i) => (
                <div className="crm-import-col" role="row" key={i}>
                  <div role="cell" className="crm-import-head">{headers[i] || t('import.column', { n: i + 1 })}</div>
                  <div role="cell" className="crm-import-sample">
                    {body.slice(0, 3).map((r) => r[i]).filter(Boolean).join(' · ') || '—'}
                  </div>
                  <select
                    className="crm-input"
                    aria-label={t('import.fieldFor', { column: headers[i] || String(i + 1) })}
                    value={mapping[i] ?? 'skip'}
                    onChange={(e) => {
                      const next = mapping.slice();
                      const chosen = e.target.value as Field;
                      // One column per field: choosing a field elsewhere frees it here.
                      if (chosen !== 'skip') next.forEach((f, j) => { if (f === chosen) next[j] = 'skip'; });
                      next[i] = chosen;
                      setMapping(next);
                    }}
                  >
                    <option value="skip">{t('import.field.skip')}</option>
                    {fields.map((f) => (
                      <option key={f} value={f}>{t(`import.field.${f}`)}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <ul className="crm-import-plan" aria-live="polite">
              <li><strong>{tc(`import.create.${target}`, plan.create.length)}</strong></li>
              {plan.duplicates > 0 && <li>{tc('import.duplicates', plan.duplicates)}</li>}
              {plan.noName > 0 && <li>{tc('import.noName', plan.noName)}</li>}
              {plan.unreadable > 0 && <li>{tc('import.unreadable', plan.unreadable)}</li>}
              {plan.overLimit > 0 && (
                <li className="crm-import-limit">
                  {tc('import.overLimit', plan.overLimit, { limit: FREE_LIMITS[target] })}{' '}
                  <button type="button" className="crm-btn crm-btn-sm" onClick={onLicense}>{t('license.get')}</button>
                </li>
              )}
            </ul>
            {!mapping.includes('name') && !(target === 'clients' && (mapping.includes('firstName') || mapping.includes('lastName') || mapping.includes('company'))) && (
              <p className="crm-error-text" role="alert">{t('import.needName')}</p>
            )}

            <div className="crm-dialog-actions">
              <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setStep({ kind: 'choose' })}>{t('import.back')}</button>
              <button type="button" className="crm-btn crm-btn-primary" disabled={plan.create.length === 0} onClick={() => void run()}>
                {tc(`import.go.${target}`, plan.create.length)}
              </button>
            </div>
          </>
        )}

        {step.kind === 'writing' && (
          <div className="crm-import-wait" aria-busy="true">
            <div className="crm-spinner" /> {t('import.writing', { done: step.done, total: step.total })}
          </div>
        )}

        {step.kind === 'done' && (
          <>
            <p role="status"><strong>{tc(`import.written.${step.target}`, step.outcome.written)}</strong></p>
            {step.outcome.failed.length > 0 && (
              <div className="crm-notice crm-notice-danger" role="alert">
                <span>
                  {tc('import.failed', step.outcome.failed.length)}{' '}
                  {step.outcome.failed.slice(0, 5).map((f) => `${f.name} (${f.error})`).join(', ')}
                  {step.outcome.failed.length > 5 ? ' …' : ''}
                </span>
              </div>
            )}
            <div className="crm-dialog-actions">
              <button type="button" className="crm-btn crm-btn-primary" onClick={onClose}>{t('import.close')}</button>
            </div>
          </>
        )}

        {step.kind === 'failed' && (
          <>
            <p className="crm-error-text" role="alert">{t('import.failedRead', { error: step.error })}</p>
            <div className="crm-dialog-actions">
              <button type="button" className="crm-btn" onClick={() => setStep({ kind: 'choose' })}>{t('import.back')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
