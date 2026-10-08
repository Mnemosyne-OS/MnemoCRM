/**
 * The screens MOUNTED against a mocked host (doc 124, verification pass of
 * 30/09), for the rules the model tests cannot reach: the journal break on
 * screen, the VAT question, a sold unique piece out of the sale grid, a sale
 * over the stock, the consent gate before the agenda rings, the PDF stop /
 * page cap / NO_VISION doors, and the license dialog on an unknown verdict.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../data/host', () => {
  class NoVisionError extends Error {
    constructor() {
      super('NO_VISION');
    }
  }
  return {
    NoVisionError,
    addFollowUpToAgenda: vi.fn(async () => ({ added: 1 })),
    readImage: vi.fn(async () => {
      throw new Error('NOT_AN_IMAGE');
    }),
    pickFile: vi.fn(async () => 'C:/Users/deb/catalogue.pdf'),
    renderPdfPage: vi.fn(async () => ({ image: 'AAAA', pages: 45, w: 100, h: 100 })),
    inferOnImage: vi.fn(),
    extractPdfText: vi.fn(async () => 'Bol bleu 24 €'),
    infer: vi.fn(async () => ({ text: '{"products":[{"name":"Bol bleu","price":24}]}', sources: [] })),
    saveProductPhoto: vi.fn(async () => 'C:/vault/bol.jpg'),
    offerLicense: vi.fn(async () => ({ opened: true })),
    pickTextFile: vi.fn(),
    dictationStatus: vi.fn(),
    startDictation: vi.fn(),
    stopDictation: vi.fn(),
    cancelDictation: vi.fn(),
  };
});

import * as host from '../data/host';
import { setLangMode } from '../i18n';
import { SalesView } from '../components/SalesView';
import { SaleDialog } from '../components/SaleDialog';
import { ClientSheet } from '../components/ClientSheet';
import { PdfImportDialog } from '../components/PdfImportDialog';
import { LicenseDialog } from '../components/LicenseDialog';
import { DealDialog } from '../components/DealDialog';
import { ClientForm } from '../components/ClientForm';
import { buildSale, chainHead, verifyJournal } from '../model/journal';
import { createDeal, starterSettings } from '../model/deal';
import type { Client, JournalEntry, Product } from '../model/types';

const settings = starterSettings((id) => id);
const unit = (over: Partial<Product>): Product => ({ schema: 1, id: 'u', name: 'Bol bleu', kind: 'unique', status: 'available', tags: [], ...over });
const series = (over: Partial<Product>): Product => ({ schema: 1, id: 's', name: 'Mug', kind: 'series', stock: 3, price: 12, tags: [], ...over });

function journalOf(n: number): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (let i = 0; i < n; i++) {
    out.push(buildSale({ at: '2026-09-20T10:00:00.000Z', place: 'workshop', lines: [{ label: 'x', qty: 1, unitPrice: 10 }], payment: 'cash', currency: 'EUR' }, chainHead(out))!);
  }
  return out;
}

beforeEach(() => {
  // The mode is read once at module load: the setter is the only way to pin it after.
  setLangMode('fr');
  vi.clearAllMocks();
});

const salesProps = () => ({
  markets: [], products: [], clients: [], saving: false,
  onNewSale: vi.fn(), onNewMarket: vi.fn(), onVoid: vi.fn(), onSaveMarket: vi.fn(), onDeclareTax: vi.fn(),
});

describe('SalesView: the journal and the VAT line on screen', () => {
  it('a line edited outside the app is NAMED, with its number, as an alert', () => {
    const entries = journalOf(3);
    (entries[2] as { lines: { unitPrice: number }[] }).lines[0].unitPrice = 999;
    render(<SalesView {...salesProps()} journal={verifyJournal(entries)} settings={{ ...settings, taxStatus: 'franchise' }} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/n°3/);
    expect(alert).toHaveTextContent(/modifiée hors de MnemoCRM/);
  });

  it('an intact journal says so, and an undeclared VAT situation asks the question (never deduced)', () => {
    render(<SalesView {...salesProps()} journal={verifyJournal(journalOf(2))} settings={settings} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Une question avant vos ventes/)).toBeTruthy();
    expect(screen.getAllByRole('button').filter((b) => /franchise|TVA|autre/i.test(b.textContent ?? '')).length).toBeGreaterThanOrEqual(3);
  });

  it('VAT declared: the screen says MnemoCRM is NOT a certified register; franchise: nothing', () => {
    const { unmount } = render(<SalesView {...salesProps()} journal={verifyJournal([])} settings={{ ...settings, taxStatus: 'vat' }} />);
    expect(screen.getByText(/n'est pas un logiciel de caisse certifié/)).toBeTruthy();
    unmount();
    render(<SalesView {...salesProps()} journal={verifyJournal([])} settings={{ ...settings, taxStatus: 'franchise' }} />);
    expect(screen.queryByText(/logiciel de caisse/)).toBeNull();
    expect(screen.queryByText(/Une question avant vos ventes/)).toBeNull();
  });

  it('no sale this month renders a dash, never 0', () => {
    render(<SalesView {...salesProps()} journal={verifyJournal([])} settings={{ ...settings, taxStatus: 'franchise' }} />);
    expect(screen.getByText('—')).toBeTruthy();
  });
});

describe('SaleDialog: unique pieces', () => {
  const props = () => ({ clients: [], markets: [], currency: 'EUR', today: '2026-09-30', saving: false, onRecord: vi.fn(async () => ({ ok: true as const, entry: journalOf(1)[0] })), onClose: vi.fn() });

  it('a SOLD unique piece is not in the sale grid; an available one is; a series is', () => {
    render(<SaleDialog {...props()} products={[unit({ id: 'sold', name: 'Vase vendu', status: 'sold' }), unit({ id: 'ok', name: 'Bol dispo' }), series({})]} />);
    expect(screen.queryByText('Vase vendu')).toBeNull();
    expect(screen.getByText('Bol dispo')).toBeTruthy();
    expect(screen.getByText('Mug')).toBeTruthy();
  });

  it('touching a unique piece twice keeps ONE line at qty 1; a series goes to qty 2', () => {
    render(<SaleDialog {...props()} products={[unit({ id: 'ok', name: 'Bol dispo', price: 24 }), series({})]} />);
    fireEvent.click(screen.getByRole('button', { name: /Bol dispo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Bol dispo/ }));
    fireEvent.click(screen.getByRole('button', { name: /Mug/ }));
    fireEvent.click(screen.getByRole('button', { name: /Mug/ }));
    const lines = screen.getAllByRole('listitem');
    expect(lines.length).toBe(2);
    expect(within(lines[0]).getByText('1')).toBeTruthy();
    expect(within(lines[1]).getByText('2')).toBeTruthy();
  });

  it('a sale over the stock is SAID before the press, and still recorded (the paper count may be the wrong one)', async () => {
    const p = props();
    render(<SaleDialog {...p} products={[series({ stock: 2 })]} />);
    fireEvent.click(screen.getByRole('button', { name: /Mug/ }));
    fireEvent.click(screen.getByRole('button', { name: /Mug/ }));
    expect(screen.queryByText(/il passera à 0/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Mug/ }));
    expect(screen.getByText(/le stock en indique 2, il passera à 0/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Enregistrer la vente/));
    await waitFor(() => expect(p.onRecord).toHaveBeenCalledTimes(1));
    expect((p.onRecord.mock.calls[0] as unknown as [{ lines: Array<{ qty: number }> }])[0].lines[0]?.qty).toBe(3);
  });

  it('an untracked stock says nothing at any quantity', () => {
    render(<SaleDialog {...props()} products={[series({ stock: undefined })]} />);
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: /Mug/ }));
    expect(screen.queryByText(/il passera à 0/)).toBeNull();
  });
});

describe('ClientSheet: consent', () => {
  const client: Client = { schema: 1, id: 'c1', kind: 'person', name: 'Anna Roux', tags: [], timeline: [], contactConsent: { value: false, at: '2026-09-01T00:00:00.000Z' } };
  const props = (c: Client, onSave = vi.fn(async () => true)) => ({ client: c, today: '2026-09-30', saving: false, onSave, onEdit: vi.fn(), deals: [], settings, onOpenDeal: vi.fn(), onNewDeal: vi.fn(), onAttachCall: vi.fn() });

  it('a follow-up planned for someone who said NO is flagged on the sheet', () => {
    render(<ClientSheet {...props({ ...client, followUp: { date: '2026-10-02' } })} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/refusé d'être recontacté/);
  });

  it('planning a follow-up for someone who said NO asks FIRST: nothing written, nothing in the agenda, until the second press', async () => {
    const onSave = vi.fn(async () => true);
    render(<ClientSheet {...props(client, onSave)} />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Planifier' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/dans votre agenda et sonnera/);
    expect(onSave).not.toHaveBeenCalled();
    expect(host.addFollowUpToAgenda).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Planifier quand même' }));
    await waitFor(() => expect(host.addFollowUpToAgenda).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalled();
  });

  it('a client who said yes, or was never asked, is planned in one press', async () => {
    const onSave = vi.fn(async () => true);
    const asked: Client = { ...client, contactConsent: undefined };
    render(<ClientSheet {...props(asked, onSave)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Planifier' }));
    await waitFor(() => expect(host.addFollowUpToAgenda).toHaveBeenCalledTimes(1));
  });
});

describe('DealDialog: a next step for someone who said NO', () => {
  const refused: Client = { schema: 1, id: 'c1', kind: 'person', name: 'Anna Roux', tags: [], timeline: [], contactConsent: { value: false, at: '2026-09-01T00:00:00.000Z' } };
  const deal = createDeal({ title: 'Vaisselle', stageId: settings.stages[0].id, clientId: 'c1' })!;

  it('keeps the step in the book and never rings the agenda, and says why', async () => {
    const onSave = vi.fn(async () => true);
    render(<DealDialog deal={deal} clients={[refused]} products={[]} settings={settings} today="2026-09-30" saving={false} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Prochaine étape'), { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText(/ce client a refusé d'être recontacté/);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(host.addFollowUpToAgenda).not.toHaveBeenCalled();
  });

  it('the same step for a client who agreed goes to the agenda', async () => {
    render(<DealDialog deal={deal} clients={[{ ...refused, contactConsent: { value: true, at: '2026-09-01T00:00:00.000Z' } }]} products={[]} settings={settings} today="2026-09-30" saving={false} onSave={vi.fn(async () => true)} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Prochaine étape'), { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(host.addFollowUpToAgenda).toHaveBeenCalledTimes(1));
  });
});

describe('ClientForm: a hidden field is not saved', () => {
  it('a person turned into a company loses the company line it can no longer see', async () => {
    const onSubmit = vi.fn(async () => true);
    const person: Client = { schema: 1, id: 'c1', kind: 'person', name: 'Atelier Roux', company: 'Ancien employeur', tags: [], timeline: [] };
    render(<ClientForm initial={person} saving={false} onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entreprise' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect((onSubmit.mock.calls[0] as unknown as [{ company?: string }])[0].company).toBeUndefined();
  });
});

describe('PdfImportDialog: the host engines, mocked', () => {
  const props = () => ({ products: [], currency: 'EUR', license: 'active' as const, onImport: vi.fn(async (records: Product[]) => ({ written: records.length, failed: [] })), onLicense: vi.fn(), onClose: vi.fn() });

  it('announces the number of model calls BEFORE starting, capped at 30 pages, and says how many pages are left out', async () => {
    render(<PdfImportDialog {...props()} />);
    fireEvent.click(screen.getByText(/Choisir un PDF|Choisir le PDF|Ouvrir un PDF/));
    await screen.findByText('catalogue.pdf');
    expect(screen.getByText(/30 appels au modèle/)).toBeTruthy();
    expect(screen.getByText(/15 pages seront/)).toBeTruthy();
    expect(host.inferOnImage).not.toHaveBeenCalled();
  });

  it('Stop ends the reading after the page in flight, and the review says it was stopped', async () => {
    let calls = 0;
    (host.inferOnImage as ReturnType<typeof vi.fn>).mockImplementation(
      // No box: jsdom never loads an <img>, so a crop would wait 15 s per item — a limit of the DOM, not of the dialog.
      () => new Promise((resolve) => setTimeout(() => { calls++; resolve(`{"products":[{"name":"Bol ${calls}","price":24}]}`); }, 20)),
    );
    render(<PdfImportDialog {...props()} />);
    fireEvent.click(screen.getByText(/Choisir un PDF|Choisir le PDF|Ouvrir un PDF/));
    await screen.findByText('catalogue.pdf');
    fireEvent.click(screen.getByText(/Lire le catalogue/));
    const stop = await screen.findByRole('button', { name: /Arrêter/ });
    fireEvent.click(stop);
    await waitFor(() => expect(screen.getByText(/Arrêté avant la fin/)).toBeTruthy(), { timeout: 3000 });
    expect(calls).toBeLessThan(5);
    console.log('[probe pdf stop] model calls before stop took effect:', calls);
  });

  it('a model that cannot see: the screen says so and offers the text-only reading, which then runs without photos', async () => {
    (host.inferOnImage as ReturnType<typeof vi.fn>).mockImplementation(async () => { throw new host.NoVisionError(); });
    render(<PdfImportDialog {...props()} />);
    fireEvent.click(screen.getByText(/Choisir un PDF|Choisir le PDF|Ouvrir un PDF/));
    await screen.findByText('catalogue.pdf');
    fireEvent.click(screen.getByText(/Lire le catalogue/));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/ne voit pas les images/);
    fireEvent.click(screen.getByRole('button', { name: /Lire seulement le texte/ }));
    await waitFor(() => expect(host.extractPdfText).toHaveBeenCalledTimes(1));
    await screen.findByDisplayValue('Bol bleu');
    expect(host.saveProductPhoto).not.toHaveBeenCalled();
  });
});

describe('PdfImportDialog: a price read from the page is written the way the input reads it', () => {
  it('12 000 lands as "12000", never with a group separator that parseAmount refuses', async () => {
    (host.inferOnImage as ReturnType<typeof vi.fn>).mockResolvedValue('{"products":[{"name":"Grand vase","price":12000}]}');
    (host.renderPdfPage as ReturnType<typeof vi.fn>).mockResolvedValue({ image: 'AAAA', pages: 1, w: 100, h: 100 });
    render(<PdfImportDialog products={[]} currency="EUR" license="active" onImport={vi.fn(async (records: Product[]) => ({ written: records.length, failed: [] }))} onLicense={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/Choisir le PDF/));
    await screen.findByText('catalogue.pdf');
    fireEvent.click(screen.getByText(/Lire le catalogue/));
    await screen.findByDisplayValue('Grand vase');
    expect(screen.getByDisplayValue('12000')).toBeTruthy();
  });
});

describe('LicenseDialog: the recheck', () => {
  it('an UNKNOWN verdict closes the dialog (nothing refused); an INACTIVE one says there is still none', async () => {
    const onClose = vi.fn();
    const { unmount } = render(<LicenseDialog reason="clients" onRecheck={async () => 'unknown'} onClose={onClose} />);
    fireEvent.click(screen.getByText(/revérifier/));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    unmount();
    const onClose2 = vi.fn();
    render(<LicenseDialog reason="clients" onRecheck={async () => 'inactive'} onClose={onClose2} />);
    fireEvent.click(screen.getByText(/revérifier/));
    await screen.findByText(/Toujours pas de licence/);
    expect(onClose2).not.toHaveBeenCalled();
  });
});
