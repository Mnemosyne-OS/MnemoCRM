/**
 * App mounted on a READY book (doc 124, verification pass of 30/09): the
 * buttons that create are gated at the screen, not only at the hook. A full
 * free book asks for a license instead of opening a form that cannot be
 * saved; an unknown verdict never refuses (doc 124 §14). And a dictated
 * follow-up never rings someone who said NO (doc 124 §8).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createClient } from './model/client';
import { starterSettings } from './model/deal';
import { FREE_LIMITS, type LicenseVerdict } from './model/license';
import type { Client } from './model/types';

let book: Record<string, unknown> = {};
vi.mock('./data/useBook', () => ({ useBook: () => book }));

const addFollowUpToAgenda = vi.fn(async () => ({ added: 1 }));
vi.mock('./data/host', async (orig) => ({ ...(await orig<object>()), addFollowUpToAgenda: (...a: unknown[]) => addFollowUpToAgenda(...(a as [])) }));

// The dialog itself is model-driven; here it only hands App one proposal the person accepted.
let proposal: Record<string, unknown> = {};
vi.mock('./components/CaptureDialog', () => ({
  CaptureDialog: (p: { onApply: (x: unknown) => Promise<boolean> }) => <button onClick={() => void p.onApply(proposal)}>apply-proposal</button>,
}));

import App from './App';
import { setLangMode } from './i18n';

function readyBook(license: LicenseVerdict, clients: Client[]) {
  const noop = vi.fn(async () => true);
  return {
    status: { kind: 'ready', folder: 'C:/carnet' },
    clients,
    deals: [],
    products: [],
    markets: [],
    journal: { entries: [], broken: null },
    settings: { ...starterSettings((id: string) => id), taxStatus: 'franchise' },
    settingsState: 'ok',
    unreadable: [],
    memory: { kind: 'off' },
    syncMemory: noop,
    setKindLabel: () => {},
    saving: false,
    saveError: null,
    clearSaveError: () => {},
    chooseFolder: noop,
    reload: noop,
    demo: { kind: 'idle' },
    createDemoBook: noop,
    backToPrevious: noop,
    previousFolder: null,
    upsertClient: noop,
    upsertDeal: noop,
    upsertProduct: noop,
    upsertMarket: noop,
    recordSale: noop,
    voidSale: noop,
    license,
    refreshLicense: vi.fn(async () => license),
    limitHit: null,
    clearLimitHit: () => {},
    importRecords: noop,
    saveSettings: noop,
    ensureSettingsWritten: noop,
  };
}

const full = () => Array.from({ length: FREE_LIMITS.clients }, (_, i) => createClient({ kind: 'person', name: `Client ${i}` })!);

describe('App: the free limit at the button', () => {
  beforeEach(() => setLangMode('fr'));

  it('a full free book asks for a license instead of opening the client form', () => {
    book = readyBook('inactive', full());
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Nouveau client/ }));
    expect(screen.getByText('Votre carnet est plein')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Nouveau client' })).toBeNull();
  });

  it('the same book with an UNKNOWN verdict opens the form: nobody could check is not a refusal', () => {
    book = readyBook('unknown', full());
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Nouveau client/ }));
    expect(screen.queryByText('Votre carnet est plein')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Nouveau client' })).toBeTruthy();
  });
});

describe('App: a dictated follow-up', () => {
  beforeEach(() => {
    setLangMode('fr');
    addFollowUpToAgenda.mockClear();
  });

  const run = async (client: Client) => {
    const upsertClient = vi.fn(async () => true);
    book = { ...readyBook('active', [client]), upsertClient };
    proposal = { clientId: client.id, kind: 'call', note: 'Rappeler pour la commande', followUp: { date: '2026-10-05' } };
    render(<App />);
    fireEvent.click(screen.getByTitle("Dites ce qui s'est passé"));
    fireEvent.click(screen.getByText('apply-proposal'));
    await waitFor(() => expect(upsertClient).toHaveBeenCalled());
    return upsertClient;
  };

  it('for someone who said NO: written in the book, never in the agenda, and the line says why', async () => {
    const refused = { ...createClient({ kind: 'person', name: 'Anna' })!, contactConsent: { value: false, at: '2026-09-01T00:00:00.000Z' } };
    const upsertClient = await run(refused);
    await screen.findByText(/ce client a refusé d'être recontacté/);
    expect(addFollowUpToAgenda).not.toHaveBeenCalled();
    expect((upsertClient.mock.calls[0] as unknown as [Client])[0].followUp).toEqual({ date: '2026-10-05' });
  });

  it('for someone never asked: it goes to the agenda', async () => {
    await run(createClient({ kind: 'person', name: 'Paul' })!);
    await waitFor(() => expect(addFollowUpToAgenda).toHaveBeenCalledTimes(1));
  });
});
