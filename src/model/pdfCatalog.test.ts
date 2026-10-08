import { describe, it, expect } from 'vitest';
import { mergeItems, pagePrompt, parseCatalogAnswer, photoName, readBox } from './pdfCatalog';
import { boxToPixels } from '../data/crop';

describe('parseCatalogAnswer', () => {
  it('keeps what can be checked, drops a nameless entry, never invents a price', () => {
    const raw = 'Here you go:\n```json\n{"products":[' +
      '{"name":" Vase grès ","price":45,"description":"20 cm","box":[0.1,0.2,0.5,0.6]},' +
      '{"name":"Tasse","price":null,"description":null,"box":null},' +
      '{"name":"","price":3},' +
      '{"name":"Bol","price":-2,"box":[0.1,0.1,0.11,0.5]}' +
      ']}\n```';
    const r = parseCatalogAnswer(raw, 3);
    expect(r.readable).toBe(true);
    expect(r.dropped).toBe(1);
    expect(r.items).toEqual([
      { name: 'Vase grès', price: 45, description: '20 cm', box: [0.1, 0.2, 0.5, 0.6], page: 3 },
      { name: 'Tasse', page: 3 },
      { name: 'Bol', page: 3 },
    ]);
  });

  it('an answer that is not the JSON asked for is unreadable, not an empty page', () => {
    expect(parseCatalogAnswer('I cannot see any product.', 1)).toEqual({ items: [], dropped: 0, readable: false });
    expect(parseCatalogAnswer('{"products":[]}', 1)).toEqual({ items: [], dropped: 0, readable: true });
  });
});

describe('readBox', () => {
  it('clamps a box that rounds past the edge, refuses one off the page or too small', () => {
    expect(readBox([-0.01, 0, 1.01, 0.5])).toEqual([0, 0, 1, 0.5]);
    expect(readBox([0.1, 0.1, 1.5, 0.5])).toBeUndefined();
    expect(readBox([0.1, 0.1, 0.12, 0.5])).toBeUndefined();
    expect(readBox([0.1, 0.1, 0.5])).toBeUndefined();
    expect(readBox(['0.1', 0.1, 0.5, 0.5])).toBeUndefined();
  });
});

describe('mergeItems', () => {
  it('the same product read twice keeps the first and fills its gaps', () => {
    const merged = mergeItems([
      { name: 'Vase', page: 1, box: [0, 0, 0.5, 0.5] },
      { name: 'vase', page: 4, price: 45, description: 'grès' },
      { name: 'Tasse', page: 2 },
    ]);
    expect(merged).toEqual([
      { name: 'Vase', page: 1, box: [0, 0, 0.5, 0.5], price: 45, description: 'grès' },
      { name: 'Tasse', page: 2 },
    ]);
  });
});

describe('the rest', () => {
  it('the prompt forbids a guessed price and asks for the photo box', () => {
    const p = pagePrompt(2, 9, 'EUR');
    expect(p).toContain('page 2 of 9');
    expect(p).toContain('Never guess a price');
    expect(p).toContain('box');
  });

  it('a photo name is safe for the host (letters, digits, dash, dot)', () => {
    expect(photoName('Vase « grès » 20 cm / bleu', 'abcdef1234')).toBe('vase-gres-20-cm-bleu-abcdef12.jpg');
    expect(photoName('★★★', 'abcdef1234')).toBe('piece-abcdef12.jpg');
    expect(photoName('Vase', 'x')).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('a crop gets a small margin and stays on the page', () => {
    expect(boxToPixels([0.1, 0.2, 0.5, 0.6], 1000, 2000)).toEqual({ x: 90, y: 380, width: 420, height: 840 });
    expect(boxToPixels([0, 0, 1, 1], 100, 100)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});
