import { useEffect, useRef } from 'react';
import { addFollowUpToAgenda, sdk } from '../data/host';
import { findNamed, type Named } from '../data/agentFind';
import type { useBook } from '../data/useBook';
import { translate } from '../i18n';
import { addTimelineEntry, completeFollowUp, contactRefused, createClient, isValidDay, localDay, searchClients, withFollowUp } from '../model/client';
import { planDay } from '../model/day';
import { closeDeal, moveDeal, normalizeDeal, reopenDeal, withEvent } from '../model/deal';
import { mayCreate } from '../model/license';
import { adjustStock, setUniqueStatus } from '../model/product';
import { CRM_TABS, ENTRY_KINDS, UNIQUE_STATUSES, applyClientArgs, clientCard, clientLine, clientsLimit, dealLine, dueLine, dueSoonDays, str, type CrmTab } from '../model/agent';
import type { Client, Deal, Product, Stage, TimelineKind, UniqueStatus } from '../model/types';

type Book = ReturnType<typeof useBook>;

/** What the screen offers an agent: the App's own setters and the deal save its board uses. */
export interface CrmAgentView {
  /** Shows a screen of the rail, as a press on it does. */
  setTab: (tab: CrmTab) => void;
  /** Types in the search box (empty clears it), as the person does. */
  setQuery: (query: string) => void;
  /** Opens a deal's dialog, as a click on its card does. */
  openDeal: (id: string) => void;
  /** Opens a product's dialog, as a click on its tile does. */
  openProduct: (product: Product) => void;
  /** Closes the dialog on screen if it is one of this kind (a written record must not sit under a stale form). */
  closeDialogOf: (kind: 'deal' | 'product') => void;
  /** Closes what is open: a dialog first, else the client sheet. Says which. */
  closeView: () => 'dialog' | 'sheet' | 'nothing';
  /** The board's save: writes the starter stages first, then the deal. */
  saveDeal: (deal: Deal) => Promise<boolean>;
}

/**
 * What an agent may do in the customer book (doc 149), declared in
 * `mnemo-plugin.json` › agentActions and served here while the book is open.
 * Each handler saves through the book's own save (the one the person's
 * buttons use), then shows the change on screen. A client, a deal, a stage or
 * a product is taken by the words the person says OR by its id: the orb plans
 * a spoken sentence without reading the book first (agentFind). Renders
 * nothing; mounted as a CHILD so the live App gains no hook.
 */
export function CrmAgentActions({ book, openClient, view }: {
  book: Book;
  /** Shows a client's sheet, as a click in the list does. */
  openClient: (id: string) => void;
  view: CrmAgentView;
}) {
  const latest = useRef({ book, openClient, view });
  latest.current = { book, openClient, view };

  useEffect(() => {
    /** The full name, and what tells two namesakes apart (their company, else their email). */
    const clientLabel = (c: Client) => [c.name, c.company ?? c.email].filter(Boolean).join(' · ');
    /** A client by id or by the words said: full name, part of it, or the company they work at. */
    const findClient = (ref: unknown): Client => {
      const entries: Array<Named<Client>> = latest.current.book.clients.map((c) => ({
        item: c, id: c.id, names: c.company ? [c.name, c.company] : [c.name], label: clientLabel(c),
      }));
      return findNamed(entries, str(ref), { code: 'NO_CLIENT', noun: 'client' });
    };

    const stageOf = (d: Deal) => (d.closed ? d.closed.outcome : latest.current.book.settings.stages.find((s) => s.id === d.stageId)?.label ?? '?');
    /** A deal by id or by its title, or its client's name; `scope` keeps out deals the action cannot act on. */
    const findDeal = (ref: unknown, scope: 'open' | 'closed' | 'all'): Deal => {
      const { book: b } = latest.current;
      const names = new Map(b.clients.map((c) => [c.id, c.name]));
      const entries = (inScope: 'open' | 'closed' | 'all'): Array<Named<Deal>> => b.deals
        .filter((d) => inScope === 'all' || (inScope === 'open' ? !d.closed : !!d.closed))
        .map((d) => {
          const client = d.clientId ? names.get(d.clientId) : undefined;
          return { item: d, id: d.id, names: client ? [d.title, client] : [d.title], label: [d.title, client, stageOf(d)].filter(Boolean).join(' · ') };
        });
      const kind = { code: 'NO_DEAL', noun: 'deal' };
      try {
        return findNamed(entries(scope), str(ref), kind);
      } catch (err) {
        // A deal that exists but is out of scope gets the step that unlocks it, not « no deal ».
        if (scope === 'all' || !(err instanceof Error) || !err.message.startsWith('NO_DEAL')) throw err;
        let other: Deal;
        try {
          other = findNamed(entries('all'), str(ref), kind);
        } catch {
          throw err;
        }
        throw new Error(other.closed
          ? `DEAL_CLOSED: "${other.title}" is ${other.closed.outcome}; reopenDeal first`
          : `DEAL_OPEN: "${other.title}" is still open (${stageOf(other)})`);
      }
    };
    /** A stage by id or by the person's own word for it. */
    const findStage = (ref: unknown): Stage => {
      const entries: Array<Named<Stage>> = latest.current.book.settings.stages.map((s) => ({ item: s, id: s.id, names: [s.label], label: s.label }));
      return findNamed(entries, str(ref), { code: 'NO_STAGE', noun: 'stage' });
    };
    const findProduct = (ref: unknown): Product => {
      const entries: Array<Named<Product>> = latest.current.book.products.map((p) => ({ item: p, id: p.id, names: [p.name], label: p.name }));
      return findNamed(entries, str(ref), { code: 'NO_PRODUCT', noun: 'product' });
    };

    /** Saves through the book, then shows the client. A refused save is said, never reported done. */
    const save = async (client: Client) => {
      if (!(await latest.current.book.upsertClient(client))) throw new Error('WRITE_FAILED: the client could not be saved; the reason is on the person\'s screen');
      latest.current.openClient(client.id);
      return client;
    };
    /** Saves a deal through the board's save, then shows the board (a deal dialog left open would hold the old values). */
    const saveDeal = async (deal: Deal) => {
      const { view: v } = latest.current;
      if (!(await v.saveDeal(deal))) throw new Error('WRITE_FAILED: the deal could not be saved; the reason is on the person\'s screen');
      v.closeDialogOf('deal');
      v.setTab('deals');
      return deal;
    };
    const saveProduct = async (product: Product) => {
      const { book: b, view: v } = latest.current;
      if (!(await b.upsertProduct(product))) throw new Error('WRITE_FAILED: the product could not be saved; the reason is on the person\'s screen');
      v.closeDialogOf('product');
      v.setTab('catalog');
      return product;
    };

    if (typeof sdk.onAgentActions !== 'function') {
      // An iframe served an older SDK build: it must not take the window down.
      console.warn('[mnemo-crm] this SDK build has no onAgentActions; reload the cartridge to serve agent actions');
      return undefined;
    }

    const sub = sdk.onAgentActions({
      clients: (args) => {
        const { book: b } = latest.current;
        const limit = clientsLimit(args.limit);
        const found = [...searchClients(b.clients, str(args.query))].sort((a, c) => a.name.localeCompare(c.name));
        return { total: b.clients.length, matching: found.length, clients: found.slice(0, limit).map(clientLine) };
      },

      client: (args) => {
        const { book: b } = latest.current;
        return clientCard(findClient(args.clientId), b.deals, b.settings);
      },

      due: (args) => {
        const { book: b } = latest.current;
        const soonDays = dueSoonDays(args.soonDays);
        const today = localDay();
        const plan = planDay(b.clients, b.deals, today, soonDays);
        return { today, overdue: plan.overdue.map(dueLine), dueToday: plan.today.map(dueLine), soon: plan.soon.map(dueLine) };
      },

      deals: (args) => {
        const { book: b } = latest.current;
        const names = new Map(b.clients.map((c) => [c.id, c.name]));
        const clientId = str(args.clientId) ? findClient(args.clientId).id : '';
        const list = b.deals.filter((d) => (!clientId || d.clientId === clientId) && (args.closed === true || !d.closed));
        return list.map((d) => dealLine(d, b.settings, d.clientId ? names.get(d.clientId) : undefined));
      },

      addClient: async (args) => {
        const { book: b } = latest.current;
        // The free limit bounds creation, as the « New client » button does.
        if (!mayCreate('clients', b.license, b.clients, b.products)) throw new Error('LICENSE_REQUIRED: the free book is full of clients; the person can take a license in MnemoCRM');
        const now = new Date();
        const base = createClient({ kind: 'person', name: str(args.name) }, now);
        const created = base && applyClientArgs(base, args, now);
        if (!created) throw new Error('BAD_ARG: name is empty');
        await save(created);
        return { clientId: created.id };
      },

      updateClient: async (args) => {
        const current = findClient(args.clientId);
        const fields = Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'clientId'));
        if (Object.keys(fields).length === 0) throw new Error('NOTHING_TO_CHANGE: pass at least one field to change');
        const next = applyClientArgs(current, fields, new Date());
        if (!next) throw new Error('BAD_ARG: name is empty');
        await save(next);
        return clientLine(next);
      },

      addNote: async (args) => {
        const current = findClient(args.clientId);
        const kind = (str(args.kind) || 'note') as TimelineKind;
        if (!ENTRY_KINDS.includes(kind)) throw new Error(`BAD_ARG: kind is one of ${ENTRY_KINDS.join(', ')}`);
        const text = str(args.text);
        if (!text) throw new Error('BAD_ARG: text is empty');
        const next = addTimelineEntry(current, kind, text, new Date(), str(args.source) || undefined);
        await save(next);
        return { clientId: current.id, entryId: next.timeline[0].id };
      },

      planFollowUp: async (args) => {
        const current = findClient(args.clientId);
        const day = str(args.date);
        if (!isValidDay(day)) throw new Error('BAD_ARG: date is a day, YYYY-MM-DD');
        const planned = await save(withFollowUp(current, day, str(args.note)));
        // Someone who said NO is never rung: the follow-up stays in the book, flagged on the sheet.
        if (contactRefused(current)) return { clientId: current.id, date: day, inAgenda: false, reason: 'CONTACT_REFUSED: this client said no to being contacted again; only the person can put it in the agenda' };
        let added: number;
        try {
          added = (await addFollowUpToAgenda(day, translate('followup.agendaTitle', { name: current.name }), planned.followUp?.note)).added;
        } catch (err) {
          console.warn("[mnemo-crm] agenda refused the agent's follow-up:", err);
          return { clientId: current.id, date: day, inAgenda: false, reason: err instanceof Error ? err.message : String(err) };
        }
        if (added === 0) return { clientId: current.id, date: day, inAgenda: false, reason: 'AGENDA_REFUSED: the agenda refused the date' };
        // In the agenda now: a refused second save is said by save(), never hidden under « not in the agenda ».
        await save({ ...planned, followUp: { ...planned.followUp!, inAgenda: true } });
        return { clientId: current.id, date: day, inAgenda: true };
      },

      followUpDone: async (args) => {
        const current = findClient(args.clientId);
        if (!current.followUp) throw new Error('NO_FOLLOW_UP: this client has no follow-up planned; call due for who has one');
        await save(completeFollowUp(current, translate('followup.doneEntry')));
        return { clientId: current.id, done: true };
      },

      openClient: (args) => {
        const current = findClient(args.clientId);
        latest.current.openClient(current.id);
        return { clientId: current.id, name: current.name, shown: true };
      },

      showTab: (args) => {
        const tab = str(args.tab) as CrmTab;
        if (!CRM_TABS.includes(tab)) throw new Error(`BAD_ARG: tab is one of ${CRM_TABS.join(', ')}`);
        latest.current.view.setTab(tab);
        return { tab, shown: true };
      },

      showClients: (args) => {
        const { book: b, view: v } = latest.current;
        const query = str(args.query);
        v.setQuery(query);
        v.setTab('clients');
        return { query: query || null, matching: searchClients(b.clients, query).length, total: b.clients.length };
      },

      closeView: () => ({ closed: latest.current.view.closeView() }),

      showDeal: (args) => {
        const deal = findDeal(args.deal, 'all');
        latest.current.view.openDeal(deal.id);
        return { dealId: deal.id, title: deal.title, shown: true };
      },

      moveDeal: async (args) => {
        const deal = findDeal(args.deal, 'open');
        const stage = findStage(args.stage);
        if (deal.stageId === stage.id) {
          latest.current.view.setTab('deals');
          return { dealId: deal.id, stage: stage.label, changed: false };
        }
        // The board's own move: the stage's label goes in the deal's history.
        await saveDeal(moveDeal(deal, stage, translate('deal.movedTo', { stage: stage.label })));
        return { dealId: deal.id, stage: stage.label, changed: true };
      },

      closeDeal: async (args) => {
        const outcome = str(args.outcome);
        if (outcome !== 'won' && outcome !== 'lost') throw new Error('BAD_ARG: outcome is won or lost');
        const deal = findDeal(args.deal, 'open');
        await saveDeal(closeDeal(deal, outcome, translate(outcome === 'won' ? 'deal.wonLine' : 'deal.lostLine')));
        return { dealId: deal.id, outcome };
      },

      reopenDeal: async (args) => {
        const deal = findDeal(args.deal, 'closed');
        await saveDeal(reopenDeal(deal, translate('deal.reopenedLine')));
        return { dealId: deal.id, stage: stageOf({ ...deal, closed: undefined }), open: true };
      },

      updateDeal: async (args) => {
        const current = findDeal(args.deal, 'all');
        const hasAmount = typeof args.amount === 'number';
        if (hasAmount && (!Number.isFinite(args.amount) || (args.amount as number) < 0)) throw new Error('BAD_ARG: amount is a number, 0 or more');
        const title = str(args.title);
        const clientRef = str(args.client);
        const note = str(args.note);
        if (!title && !hasAmount && !clientRef && !note) throw new Error('NOTHING_TO_CHANGE: pass title, amount, client or note');
        const clientId = clientRef ? findClient(clientRef).id : current.clientId;
        const now = new Date();
        // The dialog's own rebuild: the same reading as a file, so a bad field cannot slip in.
        let next = normalizeDeal({
          ...current,
          ...(title ? { title } : {}),
          ...(hasAmount ? { amount: args.amount } : {}),
          clientId,
          updatedAt: now.toISOString(),
        });
        if (!next) throw new Error('BAD_ARG: the deal would not be readable');
        if (note) next = withEvent(next, note, now);
        await saveDeal(next);
        return dealLine(next, latest.current.book.settings, latest.current.book.clients.find((c) => c.id === next!.clientId)?.name);
      },

      showProduct: (args) => {
        const product = findProduct(args.product);
        latest.current.view.setTab('catalog');
        latest.current.view.openProduct(product);
        return { productId: product.id, name: product.name, shown: true };
      },

      setProductStatus: async (args) => {
        const status = str(args.status) as UniqueStatus;
        if (!(UNIQUE_STATUSES as readonly string[]).includes(status)) throw new Error(`BAD_ARG: status is one of ${UNIQUE_STATUSES.join(', ')}`);
        const product = findProduct(args.product);
        // A series has a stock, not a status: the model would return it unchanged and « done » would be a lie.
        if (product.kind !== 'unique') throw new Error(`NOT_UNIQUE: "${product.name}" is a series; change its stock with adjustStock`);
        if (product.status === status) {
          latest.current.view.setTab('catalog');
          return { productId: product.id, status, changed: false };
        }
        await saveProduct(setUniqueStatus(product, status));
        return { productId: product.id, status, changed: true };
      },

      adjustStock: async (args) => {
        const delta = typeof args.delta === 'number' && Number.isFinite(args.delta) ? Math.trunc(args.delta) : 0;
        if (delta === 0) throw new Error('BAD_ARG: delta is a whole number, not 0 (+5 adds, -1 removes)');
        const product = findProduct(args.product);
        if (product.kind !== 'series' || product.stock === undefined) throw new Error(`STOCK_NOT_TRACKED: "${product.name}" has no stock count; the person sets one in the product's form`);
        const next = adjustStock(product, delta);
        if (next === product) return { productId: product.id, stock: product.stock, changed: false };
        await saveProduct(next);
        return { productId: product.id, stock: next.stock, changed: true };
      },
    });
    sub.ready.catch((err: unknown) => console.warn('[mnemo-crm] agent actions not served:', err instanceof Error ? err.message : err));
    return () => sub.off();
  }, []);

  return null;
}
