/**
 * The agent door of MnemoCRM (doc 149), driven through the handlers the
 * component hands the SDK: each write goes through the book's own save and
 * shows the client, a refusal is named, and a client who said no is never
 * put in the agenda.
 */
import { render } from '@testing-library/react';
import type { MnemoAgentHandlers } from '../sdk/mnemo-sdk';
import { starterSettings } from '../model/deal';
import type { Client, Deal, Product } from '../model/types';

let handlers: MnemoAgentHandlers = {};
const off = vi.fn();
const addFollowUpToAgenda = vi.fn(async (..._a: unknown[]) => ({ added: 1 }));

vi.mock('../data/host', () => ({
  sdk: {
    onAgentActions: (h: MnemoAgentHandlers) => {
      handlers = h;
      return { ready: Promise.resolve({ actions: Object.keys(h) }), off };
    },
  },
  addFollowUpToAgenda: (...a: unknown[]) => addFollowUpToAgenda(...a),
}));

import { CrmAgentActions } from './CrmAgentActions';

const client = (over: Partial<Client> = {}): Client => ({ schema: 1, id: 'c1', kind: 'person', name: 'Paul', tags: [], timeline: [], ...over });

function mount(clients: Client[], opts: { license?: 'active' | 'inactive' | 'unknown'; saveOk?: boolean; deals?: Deal[]; products?: Product[] } = {}) {
  const upsertClient = vi.fn(async (_c: Client) => opts.saveOk ?? true);
  const upsertProduct = vi.fn(async (_p: Product) => opts.saveOk ?? true);
  const openClient = vi.fn();
  const book = {
    clients, deals: opts.deals ?? [], products: opts.products ?? [], settings: starterSettings((id) => STAGE_LABELS[id] ?? id),
    license: opts.license ?? 'unknown', upsertClient, upsertProduct,
  } as unknown as Parameters<typeof CrmAgentActions>[0]['book'];
  const ui = {
    setTab: vi.fn(), setQuery: vi.fn(), openDeal: vi.fn(), openProduct: vi.fn(), closeDialogOf: vi.fn(),
    closeView: vi.fn((): 'dialog' | 'sheet' | 'nothing' => 'dialog'),
    saveDeal: vi.fn(async (_d: Deal) => opts.saveOk ?? true),
  };
  const view = render(<CrmAgentActions book={book} openClient={openClient} view={ui} />);
  return { upsertClient, upsertProduct, openClient, ui, view };
}

const STAGE_LABELS: Record<string, string> = { request: 'Demande', quote: 'Devis envoyé', making: 'En fabrication', delivered: 'Livré', paid: 'Payé' };
const deal = (over: Partial<Deal> = {}): Deal => ({ schema: 1, id: 'd1', title: 'Vase bleu', stageId: 'request', productIds: [], history: [], ...over });
const product = (over: Partial<Product> = {}): Product => ({ schema: 1, id: 'p1', name: 'Bol à thé', kind: 'unique', status: 'available', tags: [], ...over });
/** Two clients called Marie: a first name alone is two people. */
const MARIES = [client({ id: 'm1', name: 'Marie Dupont' }), client({ id: 'm2', name: 'Marie Lefèvre', company: 'Atelier Rose' })];

beforeEach(() => {
  handlers = {};
  off.mockClear();
  addFollowUpToAgenda.mockClear();
  addFollowUpToAgenda.mockImplementation(async () => ({ added: 1 }));
});

describe('CrmAgentActions', () => {
  it('a write goes through the book save and shows the client', async () => {
    const { upsertClient, openClient } = mount([client()]);
    await handlers.addNote({ clientId: 'c1', text: 'Wants a blue bowl', kind: 'call' });
    expect(upsertClient).toHaveBeenCalledTimes(1);
    expect(upsertClient.mock.calls[0][0].timeline[0]).toMatchObject({ kind: 'call', text: 'Wants a blue bowl' });
    expect(openClient).toHaveBeenCalledWith('c1');
  });

  it('an unknown client is refused with the names that exist', async () => {
    mount([client()]);
    await expect(Promise.resolve().then(() => handlers.openClient({ clientId: 'nope' }))).rejects.toThrow('NO_CLIENT: no client named "nope"; clients: Paul');
  });

  it('a refused save is said, never reported done', async () => {
    mount([client()], { saveOk: false });
    await expect(handlers.addNote({ clientId: 'c1', text: 'x' })).rejects.toThrow(/^WRITE_FAILED/);
  });

  it('a client who said no keeps the follow-up in the book, never in the agenda', async () => {
    const { upsertClient } = mount([client({ contactConsent: { value: false, at: '2026-01-01T00:00:00.000Z' } })]);
    const r = await handlers.planFollowUp({ clientId: 'c1', date: '2026-10-20' }) as { inAgenda: boolean; reason: string };
    expect(r.inAgenda).toBe(false);
    expect(r.reason).toMatch(/^CONTACT_REFUSED/);
    expect(addFollowUpToAgenda).not.toHaveBeenCalled();
    expect(upsertClient).toHaveBeenCalledTimes(1);
  });

  it('a follow-up the agenda took is saved again with inAgenda', async () => {
    const { upsertClient } = mount([client()]);
    const r = await handlers.planFollowUp({ clientId: 'c1', date: '2026-10-20', note: 'quote' }) as { inAgenda: boolean };
    expect(r.inAgenda).toBe(true);
    expect(upsertClient.mock.calls[1][0].followUp).toEqual({ date: '2026-10-20', note: 'quote', inAgenda: true });
  });

  it('an agenda refusal is reported, the follow-up stays in the book', async () => {
    addFollowUpToAgenda.mockImplementation(async () => ({ added: 0 }));
    const { upsertClient } = mount([client()]);
    const r = await handlers.planFollowUp({ clientId: 'c1', date: '2026-10-20' }) as { inAgenda: boolean; reason: string };
    expect(r).toMatchObject({ inAgenda: false });
    expect(r.reason).toMatch(/^AGENDA_REFUSED/);
    expect(upsertClient).toHaveBeenCalledTimes(1);
  });

  it('a date that is not a day is refused before anything is saved', async () => {
    const { upsertClient } = mount([client()]);
    await expect(handlers.planFollowUp({ clientId: 'c1', date: '2026-02-30' })).rejects.toThrow(/^BAD_ARG: date/);
    expect(upsertClient).not.toHaveBeenCalled();
  });

  it('a full free book refuses a new client with LICENSE_REQUIRED', async () => {
    const many = Array.from({ length: 50 }, (_, i) => client({ id: `c${i}` }));
    const { upsertClient } = mount(many, { license: 'inactive' });
    await expect(handlers.addClient({ name: 'Zoé' })).rejects.toThrow(/^LICENSE_REQUIRED/);
    expect(upsertClient).not.toHaveBeenCalled();
  });

  it('followUpDone without a follow-up is refused; with one, the follow-up becomes a call', async () => {
    mount([client()]);
    await expect(handlers.followUpDone({ clientId: 'c1' })).rejects.toThrow(/^NO_FOLLOW_UP/);
    const { upsertClient } = mount([client({ id: 'c2', followUp: { date: '2026-10-12' } })]);
    await handlers.followUpDone({ clientId: 'c2' });
    const saved = upsertClient.mock.calls[0][0];
    expect('followUp' in saved).toBe(false);
    expect(saved.timeline[0].kind).toBe('call');
  });

  it('subscribes once and lets go on unmount', () => {
    const { view } = mount([client()]);
    view.rerender(<></>);
    expect(off).toHaveBeenCalledTimes(1);
  });
});

describe('CrmAgentActions by voice: things named the way the person says them', () => {
  it('a client by their full name, by part of it, or by their company; an id still works', async () => {
    const { upsertClient, openClient } = mount(MARIES);
    await handlers.addNote({ clientId: 'Madame Marie Dupont', text: 'Rappeler jeudi' });
    expect(upsertClient.mock.calls[0][0].id).toBe('m1');
    await handlers.openClient({ clientId: "Marie de l'Atelier Rose" });
    expect(openClient).toHaveBeenLastCalledWith('m2');
    await handlers.openClient({ clientId: 'm1' });
    expect(openClient).toHaveBeenLastCalledWith('m1');
  });

  // Every action that takes a client refuses a shared first name with the full names, never picks one.
  it.each([
    ['client', {}], ['deals', {}], ['openClient', {}], ['updateClient', { phone: '06' }], ['addNote', { text: 'x' }],
    ['planFollowUp', { date: '2026-10-20' }], ['followUpDone', {}],
  ])('%s refuses « Marie » as AMBIGUOUS with both full names', async (action, extra) => {
    const { upsertClient } = mount(MARIES);
    await expect(Promise.resolve().then(() => handlers[action]!({ clientId: 'Marie', ...extra })))
      .rejects.toThrow('AMBIGUOUS: "Marie" names several clients: Marie Dupont, Marie Lefèvre · Atelier Rose; say which');
    expect(upsertClient).not.toHaveBeenCalled();
  });

  it('updateClient changes the phone of the client named', async () => {
    const { upsertClient } = mount(MARIES);
    await handlers.updateClient({ clientId: 'Lefèvre', phone: '06 12 34 56 78' });
    expect(upsertClient.mock.calls[0][0]).toMatchObject({ id: 'm2', phone: '06 12 34 56 78' });
  });

  it('showTab and showClients drive the screen as a press and the search box do', async () => {
    const { ui } = mount(MARIES);
    await handlers.showTab({ tab: 'deals' });
    expect(ui.setTab).toHaveBeenLastCalledWith('deals');
    await expect(Promise.resolve().then(() => handlers.showTab({ tab: 'kitchen' }))).rejects.toThrow(/^BAD_ARG: tab/);
    const r = await handlers.showClients({ query: 'atelier' }) as { matching: number };
    expect(ui.setQuery).toHaveBeenLastCalledWith('atelier');
    expect(ui.setTab).toHaveBeenLastCalledWith('clients');
    expect(r.matching).toBe(1);
    await handlers.showClients({});
    expect(ui.setQuery).toHaveBeenLastCalledWith('');
  });

  it('closeView says what it closed', async () => {
    const { ui } = mount(MARIES);
    expect(await handlers.closeView({})).toEqual({ closed: 'dialog' });
    expect(ui.closeView).toHaveBeenCalledTimes(1);
  });

  it('moveDeal takes the deal by its client and the stage by the person\'s word, through the board\'s save', async () => {
    const { ui } = mount(MARIES, { deals: [deal({ clientId: 'm1' })] });
    const r = await handlers.moveDeal({ deal: 'le vase de Marie Dupont', stage: 'devis envoyé' }) as { changed: boolean };
    expect(r.changed).toBe(true);
    const saved = ui.saveDeal.mock.calls[0][0];
    expect(saved.stageId).toBe('quote');
    expect(saved.history[0].text).toContain('Devis envoyé');
    // A deal dialog left open would show the old stage: it is closed, the board shown.
    expect(ui.closeDialogOf).toHaveBeenCalledWith('deal');
    expect(ui.setTab).toHaveBeenLastCalledWith('deals');
  });

  it('moveDeal refuses an ambiguous deal and an unknown stage with the names that exist', async () => {
    const { ui } = mount(MARIES, { deals: [deal({ id: 'd1', clientId: 'm1' }), deal({ id: 'd2', clientId: 'm2' })] });
    await expect(handlers.moveDeal({ deal: 'vase bleu', stage: 'payé' })).rejects.toThrow(/^AMBIGUOUS: "vase bleu" names several deals: Vase bleu · Marie Dupont · Demande, Vase bleu · Marie Lefèvre · Demande/);
    await expect(handlers.moveDeal({ deal: 'd1', stage: 'expédié' })).rejects.toThrow('NO_STAGE: no stage named "expédié"; stages: Demande, Devis envoyé, En fabrication, Livré, Payé');
    expect(ui.saveDeal).not.toHaveBeenCalled();
  });

  it('a refused deal save is said, never reported done', async () => {
    mount(MARIES, { deals: [deal()], saveOk: false });
    await expect(handlers.moveDeal({ deal: 'vase', stage: 'livré' })).rejects.toThrow(/^WRITE_FAILED/);
  });

  it('a closed deal is not moved: the refusal names the step that unlocks it', async () => {
    const { ui } = mount(MARIES, { deals: [deal({ closed: { at: '2026-10-01T00:00:00.000Z', outcome: 'won' } })] });
    await expect(handlers.moveDeal({ deal: 'vase bleu', stage: 'livré' })).rejects.toThrow('DEAL_CLOSED: "Vase bleu" is won; reopenDeal first');
    await handlers.reopenDeal({ deal: 'vase bleu' });
    expect('closed' in ui.saveDeal.mock.calls[0][0]).toBe(false);
  });

  it('closeDeal marks won or lost; reopenDeal refuses a deal still open', async () => {
    const { ui } = mount(MARIES, { deals: [deal()] });
    await handlers.closeDeal({ deal: 'Vase bleu', outcome: 'lost' });
    expect(ui.saveDeal.mock.calls[0][0].closed?.outcome).toBe('lost');
    await expect(handlers.reopenDeal({ deal: 'Vase bleu' })).rejects.toThrow(/^DEAL_OPEN/);
  });

  it('updateDeal changes the amount and the client by name; nothing passed is refused', async () => {
    const { ui } = mount(MARIES, { deals: [deal({ clientId: 'm1' })] });
    await handlers.updateDeal({ deal: 'vase bleu', amount: 180, client: 'Lefèvre' });
    expect(ui.saveDeal.mock.calls[0][0]).toMatchObject({ amount: 180, clientId: 'm2', title: 'Vase bleu' });
    await expect(handlers.updateDeal({ deal: 'vase bleu' })).rejects.toThrow(/^NOTHING_TO_CHANGE/);
    await expect(handlers.updateDeal({ deal: 'vase bleu', client: 'Marie' })).rejects.toThrow(/^AMBIGUOUS/);
  });

  it('showDeal opens a deal by its title; an ambiguous title is refused', async () => {
    const { ui } = mount(MARIES, { deals: [deal({ id: 'd1', clientId: 'm1' }), deal({ id: 'd2', title: 'Service à thé', clientId: 'm2' })] });
    await handlers.showDeal({ deal: 'service à thé' });
    expect(ui.openDeal).toHaveBeenCalledWith('d2');
    await expect(Promise.resolve().then(() => handlers.showDeal({ deal: 'Marie' }))).rejects.toThrow(/^AMBIGUOUS/);
  });

  it('a unique piece is marked sold by its name; a series is refused NOT_UNIQUE', async () => {
    const { upsertProduct, ui } = mount([], { products: [product(), product({ id: 'p2', name: 'Tasse', kind: 'series', status: undefined, stock: 4 })] });
    await handlers.setProductStatus({ product: 'le bol à thé', status: 'sold' });
    expect(upsertProduct.mock.calls[0][0]).toMatchObject({ id: 'p1', status: 'sold' });
    expect(ui.setTab).toHaveBeenLastCalledWith('catalog');
    await expect(handlers.setProductStatus({ product: 'tasses', status: 'sold' })).rejects.toThrow(/^NOT_UNIQUE/);
  });

  it('adjustStock adds to a series by name; an ambiguous product and an untracked stock are refused', async () => {
    const products = [product({ id: 'p2', name: 'Tasse bleue', kind: 'series', status: undefined, stock: 4 }), product({ id: 'p3', name: 'Tasse verte', kind: 'series', status: undefined })];
    const { upsertProduct } = mount([], { products });
    const r = await handlers.adjustStock({ product: 'tasse bleue', delta: 5 }) as { stock: number };
    expect(r.stock).toBe(9);
    expect(upsertProduct.mock.calls[0][0].stock).toBe(9);
    await expect(handlers.adjustStock({ product: 'tasse', delta: 1 })).rejects.toThrow('AMBIGUOUS: "tasse" names several products: Tasse bleue, Tasse verte; say which');
    await expect(handlers.adjustStock({ product: 'tasse verte', delta: 1 })).rejects.toThrow(/^STOCK_NOT_TRACKED/);
  });

  it('a refused product save is said, never reported done', async () => {
    mount([], { products: [product()], saveOk: false });
    await expect(handlers.setProductStatus({ product: 'bol', status: 'reserved' })).rejects.toThrow(/^WRITE_FAILED/);
  });

  it('showProduct opens the piece named', async () => {
    const { ui } = mount([], { products: [product()] });
    await handlers.showProduct({ product: 'bol à thé' });
    expect(ui.openProduct.mock.calls[0][0].id).toBe('p1');
  });
});
