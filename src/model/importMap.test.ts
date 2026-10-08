import { describe, it, expect } from 'vitest';
import { guessMapping, looksLikeHeader, planClients, planProducts, readPrice } from './importMap';
import type { Client, Product } from './types';

const NOW = new Date('2026-09-25T10:00:00Z');

describe('guessMapping', () => {
  it('reads French, English and Spanish headers, one field per column', () => {
    expect(guessMapping(['Prénom', 'Nom', 'Téléphone portable', 'E-mail', 'Ville', 'Commentaires'], 'clients')).toEqual([
      'firstName', 'lastName', 'phone', 'email', 'city', 'note',
    ]);
    expect(guessMapping(['Nombre', 'Correo', 'Teléfono'], 'clients')).toEqual(['name', 'email', 'phone']);
    expect(guessMapping(['Désignation', 'Prix TTC', 'Qté', 'Catégorie'], 'products')).toEqual(['name', 'price', 'skip', 'tags']);
  });

  it('"Nom" alone holds the whole name', () => {
    expect(guessMapping(['Nom', 'Email'], 'clients')).toEqual(['name', 'email']);
  });

  it('never gives the same field to two columns', () => {
    expect(guessMapping(['Email', 'Mail'], 'clients')).toEqual(['email', 'skip']);
  });
});

describe('looksLikeHeader', () => {
  it('a row of words is a header; a row with a price or an e-mail is data', () => {
    expect(looksLikeHeader(['Nom', 'Prix'])).toBe(true);
    expect(looksLikeHeader(['Bol', '12,50'])).toBe(false);
    expect(looksLikeHeader(['Paul', 'paul@x.fr'])).toBe(false);
  });
});

describe('readPrice', () => {
  it('reads what people and spreadsheets write', () => {
    expect(readPrice('12,50 €')).toBe(12.5);
    expect(readPrice('1 200')).toBe(1200);
    expect(readPrice('1.234,56')).toBe(1234.56);
    expect(readPrice('1,234.56')).toBe(1234.56);
    expect(readPrice('12.300000000000001')).toBe(12.3);
    expect(readPrice('45 EUR')).toBe(45);
  });
  it('an empty cell is absent, a word is unreadable, never 0', () => {
    expect(readPrice('')).toBeUndefined();
    expect(readPrice(undefined)).toBeUndefined();
    expect(readPrice('sur demande')).toBeNull();
    expect(readPrice('12.345')).toBeNull();
  });
});

const existing: Client[] = [
  { schema: 1, id: 'x', kind: 'person', name: 'Hélène Dupont', email: 'HELENE@x.fr', tags: [], timeline: [] },
];

describe('planClients', () => {
  const mapping = guessMapping(['Prénom', 'Nom', 'Email', 'Société', 'Notes', 'Code postal', 'Ville'], 'clients');

  it('builds clients, joins first and last name, keeps a note as a dated note', () => {
    const plan = planClients([['Paul', 'Martin', 'paul@x.fr', 'Atelier Sud', 'veut 12 bols', '69001', 'Lyon']], mapping, [], null, 'import de a.csv', NOW);
    expect(plan.create).toHaveLength(1);
    const c = plan.create[0];
    expect(c).toMatchObject({ name: 'Paul Martin', kind: 'person', company: 'Atelier Sud', email: 'paul@x.fr', address: '69001 Lyon' });
    expect(c.timeline[0]).toMatchObject({ kind: 'note', text: 'veut 12 bols', source: 'import de a.csv' });
  });

  it('a row with only a company is a company', () => {
    const plan = planClients([['', '', '', 'Café des Curos', '', '', '']], mapping, [], null, 's', NOW);
    expect(plan.create[0]).toMatchObject({ name: 'Café des Curos', kind: 'company' });
    expect(plan.create[0].company).toBeUndefined();
  });

  it('sets aside what the book already has (same e-mail, any case; same name), and repeats inside the file', () => {
    const plan = planClients(
      [
        ['Autre', 'Nom', 'helene@X.fr', '', '', '', ''],
        ['Hélène', 'Dupont', '', '', '', '', ''],
        ['Jo', 'Lee', 'jo@x.fr', '', '', '', ''],
        ['Jo', 'Lee', '', '', '', '', ''],
      ],
      mapping,
      existing,
      null,
      's',
      NOW,
    );
    expect(plan.create.map((c) => c.name)).toEqual(['Jo Lee']);
    expect(plan.duplicates).toBe(3);
  });

  it('counts rows without a name, and stops at the free room', () => {
    const rows = [['', '', 'a@x.fr', '', '', '', ''], ['A', '1', '', '', '', '', ''], ['B', '2', '', '', '', '', ''], ['C', '3', '', '', '', '', '']];
    const plan = planClients(rows, mapping, [], 2, 's', NOW);
    expect(plan.noName).toBe(1);
    expect(plan.create.map((c) => c.name)).toEqual(['A 1', 'B 2']);
    expect(plan.overLimit).toBe(1);
  });
});

describe('planProducts', () => {
  const mapping = guessMapping(['Produit', 'Prix', 'Stock', 'Description'], 'products');
  const have: Product[] = [{ schema: 1, id: 'p', name: 'Bol bleu', kind: 'series', tags: [] }];

  it('creates products of the DECLARED kind, price and stock read, unreadable cells absent and counted', () => {
    const plan = planProducts(
      [
        ['Vase', '45', '3', 'grès, 20 cm'],
        ['Tasse', 'sur demande', 'beaucoup', ''],
        ['bol  bleu', '12', '1', ''],
      ],
      mapping,
      have,
      null,
      'series',
      NOW,
    );
    expect(plan.create.map((p) => [p.name, p.price, p.stock, p.description])).toEqual([
      ['Vase', 45, 3, 'grès, 20 cm'],
      ['Tasse', undefined, undefined, undefined],
    ]);
    expect(plan.unreadable).toBe(2);
    expect(plan.duplicates).toBe(1);
  });

  it('unique pieces carry no stock and start available', () => {
    const plan = planProducts([['Vase', '45', '3', '']], mapping, [], null, 'unique', NOW);
    expect(plan.create[0]).toMatchObject({ kind: 'unique', status: 'available', price: 45 });
    expect(plan.create[0].stock).toBeUndefined();
    expect(plan.unreadable).toBe(0);
  });
});
