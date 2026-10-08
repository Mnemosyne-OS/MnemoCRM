/**
 * Deals in columns, one per stage the person wrote (doc 124 §6.1). A card is
 * dragged to another column, or moved from its own dialog (the keyboard path).
 */
import { useState } from 'react';
import { Archive, Plus, Settings2 } from 'lucide-react';
import { useI18n } from '../i18n';
import { boardColumns, totalOf } from '../model/deal';
import { formatMoney, formatTotal, relativeDay } from '../model/format';
import type { BookSettings, Client, Deal, Product } from '../model/types';
import { ProductPhoto } from './ProductPhoto';

interface Props {
  deals: Deal[];
  clients: Client[];
  products: Product[];
  settings: BookSettings;
  today: string;
  onOpen: (dealId: string) => void;
  onNew: (stageId: string) => void;
  onMove: (dealId: string, stageId: string) => void;
  onEditStages: () => void;
}

export function DealsBoard({ deals, clients, products, settings, today, onOpen, onNew, onMove, onEditStages }: Props) {
  const { t, tc, lang } = useI18n();
  const [showClosed, setShowClosed] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const columns = boardColumns(deals, settings.stages);
  const closed = deals
    .filter((d) => d.closed)
    .sort((a, b) => Date.parse(b.closed!.at) - Date.parse(a.closed!.at));

  const card = (deal: Deal) => {
    const photo = deal.productIds.map((id) => productById.get(id)).find((p) => p?.photoPath || p?.emoji);
    return (
      <button
        key={deal.id}
        className={`crm-deal${dragId === deal.id ? ' crm-deal-dragging' : ''}`}
        draggable={!deal.closed}
        onDragStart={(e) => {
          setDragId(deal.id);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', deal.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOverStage(null);
        }}
        onClick={() => onOpen(deal.id)}
      >
        {photo && <ProductPhoto path={photo.photoPath} emoji={photo.emoji} name={photo.name} />}
        <span className="crm-deal-title">{deal.title}</span>
        {deal.clientId && <span className="crm-card-sub">{names.get(deal.clientId) ?? '—'}</span>}
        <span className="crm-deal-foot">
          <span>{deal.amount !== undefined ? formatMoney(lang, settings.currency, deal.amount) : '—'}</span>
          {deal.nextStep && <span className="crm-card-when">{relativeDay(lang, today, deal.nextStep.date)}</span>}
          {deal.closed && (
            <span className={`crm-badge crm-badge-${deal.closed.outcome}`}>{t(`deal.outcome.${deal.closed.outcome}`)}</span>
          )}
        </span>
      </button>
    );
  };

  return (
    <div className="crm-board-wrap">
      <header className="crm-board-head">
        <h1>{t('nav.deals')}</h1>
        <div className="crm-board-tools">
          <button className="crm-btn" onClick={() => setShowClosed((v) => !v)} aria-pressed={showClosed}>
            <Archive size={14} aria-hidden="true" /> {tc('deal.closedCount', closed.length)}
          </button>
          <button className="crm-btn" onClick={onEditStages}>
            <Settings2 size={14} aria-hidden="true" /> {t('stages.edit')}
          </button>
        </div>
      </header>

      {showClosed ? (
        closed.length === 0 ? (
          <div className="crm-col-empty">{t('deal.noClosed')}</div>
        ) : (
          <div className="crm-closed-list">{closed.map(card)}</div>
        )
      ) : (
        <div className="crm-board">
          {columns.map(({ stage, deals: inCol }) => {
            const key = stage?.id ?? '__orphan';
            const total = totalOf(inCol);
            return (
              <section
                key={key}
                className={`crm-board-col${overStage === key ? ' crm-board-col-over' : ''}`}
                aria-label={stage?.label ?? t('stages.unknown')}
                onDragOver={(e) => {
                  if (!stage || !dragId) return;
                  e.preventDefault();
                  setOverStage(key);
                }}
                onDragLeave={() => setOverStage((s) => (s === key ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/plain') || dragId;
                  setOverStage(null);
                  setDragId(null);
                  if (stage && id) onMove(id, stage.id);
                }}
              >
                <header className="crm-board-col-head">
                  <span className="crm-board-col-title">{stage?.label ?? t('stages.unknown')}</span>
                  <span className="crm-board-col-count">{inCol.length}</span>
                </header>
                <div className="crm-board-col-total" title={total?.partial ? t('deal.totalPartial') : undefined}>
                  {formatTotal(lang, settings.currency, total)}
                </div>
                <div className="crm-board-cards">
                  {inCol.map(card)}
                  {stage && (
                    <button className="crm-board-add" onClick={() => onNew(stage.id)}>
                      <Plus size={14} aria-hidden="true" /> {t('deal.new')}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
