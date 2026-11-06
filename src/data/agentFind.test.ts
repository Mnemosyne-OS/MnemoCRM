import { describe, expect, it } from 'vitest';
import { findNamed, nameWords, type Named } from './agentFind';

const person = (id: string, name: string, company?: string): Named<string> => ({
  item: id, id, names: company ? [name, company] : [name], label: company ? `${name} · ${company}` : name,
});
const CLIENTS = [
  person('c1', 'Marie Dupont'),
  person('c2', 'Marie Lefèvre', 'Atelier Rose'),
  person('c3', 'Paul'),
  person('c4', 'Paul Martin'),
  person('c5', 'Hélène Côté'),
];
const kind = { code: 'NO_CLIENT', noun: 'client' };

describe('a client named the way a person says it', () => {
  it('folds case, accents, titles, fillers and a plural', () => {
    expect(nameWords('la fiche de Madame Hélène CÔTÉ')).toEqual(['helene', 'cote']);
    expect(nameWords("l'affaire des vases bleus")).toEqual(['vase', 'bleu']);
  });

  it('an id, the whole name, or every word of it', () => {
    expect(findNamed(CLIENTS, 'c4', kind)).toBe('c4');
    expect(findNamed(CLIENTS, 'Marie Dupont', kind)).toBe('c1');
    expect(findNamed(CLIENTS, 'madame helene cote', kind)).toBe('c5');
    // A company finds the person who works there.
    expect(findNamed(CLIENTS, "Marie de l'Atelier Rose", kind)).toBe('c2');
    // « Paul » is a whole name: it wins over the client who holds the word.
    expect(findNamed(CLIENTS, 'Paul', kind)).toBe('c3');
    expect(findNamed(CLIENTS, 'Martin', kind)).toBe('c4');
  });

  it('two clients with the same first name are refused with their full names, never the first taken', () => {
    expect(() => findNamed(CLIENTS, 'Marie', kind)).toThrow('AMBIGUOUS: "Marie" names several clients: Marie Dupont, Marie Lefèvre · Atelier Rose; say which');
  });

  it('two clients with the same full name are refused with what tells them apart', () => {
    const twins = [person('a', 'Marie Dupont', 'Lyon'), person('b', 'Marie Dupont', 'Nantes')];
    expect(() => findNamed(twins, 'Marie Dupont', kind)).toThrow(/^AMBIGUOUS: .*Marie Dupont · Lyon, Marie Dupont · Nantes/);
  });

  it('no match is refused with the names that exist', () => {
    expect(() => findNamed(CLIENTS, 'Jacques', kind)).toThrow('NO_CLIENT: no client named "Jacques"; clients: Marie Dupont, Marie Lefèvre · Atelier Rose, Paul, Paul Martin, Hélène Côté');
    expect(() => findNamed(CLIENTS, '', kind)).toThrow(/^BAD_ARG/);
    expect(() => findNamed(CLIENTS, 'la fiche du client', kind)).toThrow(/^NO_CLIENT: "la fiche du client" names no client/);
    expect(() => findNamed([], 'Paul', kind)).toThrow('clients: none');
  });

  it('a long list is capped and says how many it left out', () => {
    const many = Array.from({ length: 15 }, (_, i) => person(`x${i}`, `Client${i}`));
    expect(() => findNamed(many, 'Zoé', kind)).toThrow(/Client11 \(\+3\)$/);
  });
});
