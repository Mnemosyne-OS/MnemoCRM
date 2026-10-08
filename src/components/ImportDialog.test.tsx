/**
 * The import screen, mounted: the pieces are tested in model/, this checks the
 * wiring — a file becomes a plan, the plan is what gets written, and the PDF
 * door asks for a license only on a checked absence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../data/host', () => ({
  pickFile: vi.fn(async () => 'C:/Users/deb/clients.csv'),
  readAnyFile: vi.fn(async () => ({
    isBinary: false,
    content: 'Prénom;Nom;Email\nPaul;Martin;paul@x.fr\nHélène;Dupont;helene@x.fr\n;;\n',
  })),
}));

import { ImportDialog } from './ImportDialog';
import type { Client } from '../model/types';

const existing: Client[] = [{ schema: 1, id: 'x', kind: 'person', name: 'Hélène Dupont', tags: [], timeline: [] }];

beforeEach(() => {
  localStorage.setItem('mnemo_crm_lang_mode', 'en');
});

describe('ImportDialog', () => {
  it('reads a CSV, guesses the columns, and writes exactly what the plan says', async () => {
    const onImport = vi.fn(async (_t: string, records: unknown[]) => ({ written: records.length, failed: [] }));
    render(
      <ImportDialog clients={existing} products={[]} license="active" onImport={onImport} onPdf={vi.fn()} onLicense={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('CSV'));
    await screen.findByText('clients.csv');
    // The file name shows before the plan is computed; on a slow runner the
    // plan lands a moment later, so it is awaited, not read at once.
    expect(await screen.findByText('1 client will be created')).toBeTruthy();
    expect(await screen.findByText('1 already in the book, set aside')).toBeTruthy();
    fireEvent.click(screen.getByText('Import 1 client'));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const [target, records] = onImport.mock.calls[0];
    expect(target).toBe('clients');
    expect((records as Client[]).map((c) => [c.name, c.email])).toEqual([['Paul Martin', 'paul@x.fr']]);
    await screen.findByText('1 client imported.');
  });

  it('without a license the free room is said, and the PDF door asks for one', () => {
    const onLicense = vi.fn();
    const onPdf = vi.fn();
    render(
      <ImportDialog clients={existing} products={[]} license="inactive" initialTarget="products" onImport={vi.fn()} onPdf={onPdf} onLicense={onLicense} onClose={vi.fn()} />,
    );
    expect(screen.getByText(/room for 30 more products/)).toBeTruthy();
    fireEvent.click(screen.getByText('PDF catalogue'));
    expect(onLicense).toHaveBeenCalledTimes(1);
    expect(onPdf).not.toHaveBeenCalled();
  });

  it('an unknown license never locks the PDF door', () => {
    const onLicense = vi.fn();
    const onPdf = vi.fn();
    render(
      <ImportDialog clients={[]} products={[]} license="unknown" initialTarget="products" onImport={vi.fn()} onPdf={onPdf} onLicense={onLicense} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('PDF catalogue'));
    expect(onPdf).toHaveBeenCalledTimes(1);
    expect(onLicense).not.toHaveBeenCalled();
    expect(screen.queryByText(/room for/)).toBeNull();
  });
});
