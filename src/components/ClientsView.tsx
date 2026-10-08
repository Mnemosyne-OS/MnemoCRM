/**
 * The client list beside the open sheet. On a narrow screen the list and the
 * sheet stack: the list first, the sheet once a client is chosen.
 */
import { useI18n } from '../i18n';
import { daysBetween, searchClients } from '../model/client';
import type { BookSettings, Client, Deal } from '../model/types';
import { Avatar } from './Avatar';
import { ClientSheet } from './ClientSheet';

interface Props {
  clients: Client[];
  query: string;
  selectedId: string | null;
  today: string;
  saving: boolean;
  onSelect: (id: string) => void;
  onSave: (client: Client) => Promise<boolean>;
  onEdit: (client: Client) => void;
  deals: Deal[];
  settings: BookSettings;
  onOpenDeal: (id: string) => void;
  onNewDeal: (clientId: string) => void;
  onAttachCall: (client: Client) => void;
}

function flagColor(client: Client, today: string): string | undefined {
  const day = client.followUp?.date;
  if (!day) return undefined;
  const delta = daysBetween(today, day);
  if (delta < 0) return 'var(--c-danger)';
  if (delta === 0) return 'var(--c-accent)';
  return undefined;
}

export function ClientsView({ clients, query, selectedId, today, saving, onSelect, onSave, onEdit, deals, settings, onOpenDeal, onNewDeal, onAttachCall }: Props) {
  const { t, tc } = useI18n();
  const shown = searchClients(clients, query).sort((a, b) => a.name.localeCompare(b.name));
  const selected = clients.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="crm-split">
      <nav className="crm-list" aria-label={t('nav.clients')}>
        <div className="crm-list-count">{tc('clients.count', shown.length)}</div>
        {shown.length === 0 && <div className="crm-col-empty">{t('clients.empty')}</div>}
        {shown.map((client) => {
          const flag = flagColor(client, today);
          return (
            <button
              key={client.id}
              className="crm-row"
              aria-current={client.id === selectedId}
              onClick={() => onSelect(client.id)}
            >
              <Avatar name={client.name} />
              <span className="crm-row-text">
                <span className="crm-row-name">{client.name}</span>
                <span className="crm-row-sub">{client.company ?? client.source ?? client.email ?? '—'}</span>
              </span>
              {flag && <span className="crm-row-flag" style={{ background: flag }} aria-hidden="true" />}
            </button>
          );
        })}
      </nav>
      {selected ? (
        <ClientSheet
          client={selected}
          today={today}
          saving={saving}
          onSave={onSave}
          onEdit={() => onEdit(selected)}
          deals={deals
            .filter((d) => d.clientId === selected.id)
            .sort((a, b) => Number(!!a.closed) - Number(!!b.closed) || a.title.localeCompare(b.title))}
          settings={settings}
          onOpenDeal={onOpenDeal}
          onNewDeal={() => onNewDeal(selected.id)}
          onAttachCall={() => onAttachCall(selected)}
        />
      ) : (
        <div className="crm-center">
          <p className="crm-card-sub">{t('clients.pick')}</p>
        </div>
      )}
    </div>
  );
}
