/**
 * "Today" — the home screen (doc 124 §5.1): who to get back to, not a list
 * of everyone. One primary action when the book is empty.
 */
import { Briefcase, UserPlus } from 'lucide-react';
import { useI18n } from '../i18n';
import { byRecent } from '../model/client';
import { planDay, type DueItem } from '../model/day';
import { formatDay, relativeDay } from '../model/format';
import type { Client, Deal } from '../model/types';
import { Avatar } from './Avatar';

interface Props {
  clients: Client[];
  deals: Deal[];
  today: string;
  onOpenClient: (id: string) => void;
  onOpenDeal: (id: string) => void;
  onNew: () => void;
}

export function TodayView({ clients, deals, today, onOpenClient, onOpenDeal, onNew }: Props) {
  const { t, tc, lang } = useI18n();
  const plan = planDay(clients, deals, today);
  const due = plan.overdue.length + plan.today.length;
  const recent = byRecent(clients).slice(0, 8);

  const column = (
    title: string,
    list: DueItem[],
    empty: string,
    tone: 'danger' | 'accent' | 'muted',
  ) => (
    <section className="crm-col" aria-label={title}>
      <h2 className="crm-col-title">
        <span className={`crm-dot${tone === 'muted' ? '' : ` crm-dot-${tone}`}`} />
        {title} <b>{list.length}</b>
      </h2>
      {list.length === 0 ? (
        <div className="crm-col-empty">{empty}</div>
      ) : (
        list.map((item) => (
          <button
            key={`${item.kind}:${item.id}`}
            className={`crm-card${tone === 'muted' ? '' : ` crm-card-${tone}`}`}
            onClick={() => (item.kind === 'client' ? onOpenClient(item.id) : onOpenDeal(item.id))}
          >
            <span className="crm-card-top">
              <span className="crm-card-name">
                {item.kind === 'deal' && <Briefcase size={13} aria-label={t('nav.deals')} />} {item.title}
              </span>
              <span className="crm-card-when">{relativeDay(lang, today, item.date)}</span>
            </span>
            {(item.note || item.sub) && <span className="crm-card-sub">{item.note ?? item.sub}</span>}
          </button>
        ))
      )}
    </section>
  );

  return (
    <div>
      <header className="crm-today-head">
        <div>
          <div className="crm-today-date">{formatDay(lang, today)}</div>
          <h1>{due === 0 ? t('today.headline.zero') : tc('today.headline', due)}</h1>
        </div>
      </header>

      {clients.length === 0 && deals.length === 0 ? (
        <div className="crm-welcome">
          <h2>{t('today.welcome.title')}</h2>
          <p>{t('today.welcome.body')}</p>
          <button className="crm-btn crm-btn-primary crm-btn-lg" onClick={onNew}>
            <UserPlus size={18} aria-hidden="true" /> {t('action.newClient')}
          </button>
        </div>
      ) : (
        <>
          <div className="crm-cols">
            {column(t('today.overdue'), plan.overdue, t('today.emptyOverdue'), 'danger')}
            {column(t('today.today'), plan.today, t('today.emptyToday'), 'accent')}
            {column(t('today.soon'), plan.soon, t('today.emptySoon'), 'muted')}
          </div>

          <h2 className="crm-section-title">{t('today.recent')}</h2>
          <div className="crm-chips">
            {recent.map((client) => (
              <button key={client.id} className="crm-person-chip" onClick={() => onOpenClient(client.id)}>
                <Avatar name={client.name} /> {client.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
