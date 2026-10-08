import { describe, it, expect } from 'vitest';
import { columnIndex, parseCsv, readXlsx, sniffDelimiter, zipEntries } from './tabular';

describe('parseCsv', () => {
  it('reads a French Excel export: BOM, semicolons, CRLF, quotes', () => {
    const csv = '﻿Nom;Email;Note\r\n"Dupont; Hélène";helene@x.fr;"dit ""bonjour"""\r\nPaul;;\r\n\r\n';
    const r = parseCsv(csv);
    expect(r.delimiter).toBe(';');
    expect(r.rows).toEqual([
      ['Nom', 'Email', 'Note'],
      ['Dupont; Hélène', 'helene@x.fr', 'dit "bonjour"'],
      ['Paul', '', ''],
    ]);
    expect(r.mojibake).toBe(false);
  });

  it('keeps a line break inside quotes', () => {
    expect(parseCsv('a,b\n"1\n2",3').rows).toEqual([['a', 'b'], ['1\n2', '3']]);
  });

  it('SAYS when the text was not UTF-8', () => {
    expect(parseCsv('Nom\nH�l�ne').mojibake).toBe(true);
  });

  it('sniffs the delimiter outside quotes', () => {
    expect(sniffDelimiter('"a;b",c,d\n')).toBe(',');
    expect(sniffDelimiter('a\tb\tc')).toBe('\t');
  });
});

describe('columnIndex', () => {
  it('A=0, Z=25, AA=26, AB12=27', () => {
    expect([columnIndex('A1'), columnIndex('Z9'), columnIndex('AA1'), columnIndex('AB12')]).toEqual([0, 25, 26, 27]);
  });
});

// ── A real .xlsx, built here: stored entries plus one deflated, so both paths run.

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close(); } });
  const stream = source.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function makeZip(files: Record<string, string>, deflate: string[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const method = deflate.includes(name) ? 8 : 0;
    const data = method === 8 ? await deflateRaw(raw) : raw;
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
    count++;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, count, true);
  ev.setUint16(10, count, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const workbook = {
  'xl/workbook.xml': `<workbook ${NS}><sheets><sheet name="Pièces" sheetId="1" r:id="rId1"/><sheet name="Vide" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': `<sst ${NS}><si><t>Nom</t></si><si><t>Prix</t></si><si><r><t>Bol </t></r><r><t>bleu</t></r></si></sst>`,
  'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>12.300000000000001</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Tasse</t></is></c><c r="B3"><v>8</v></c></row>
  </sheetData></worksheet>`,
  'xl/worksheets/sheet2.xml': `<worksheet ${NS}><sheetData/></worksheet>`,
};

describe('readXlsx', () => {
  it('reads shared, rich and inline strings, numbers, and gaps between cells', async () => {
    const zip = await makeZip(workbook, ['xl/worksheets/sheet1.xml', 'xl/sharedStrings.xml']);
    const sheets = await readXlsx(zip);
    expect(sheets.map((s) => s.name)).toEqual(['Pièces', 'Vide']);
    expect(sheets[0].rows).toEqual([
      ['Nom', 'Prix'],
      ['Bol bleu', '', '12.300000000000001'],
      ['Tasse', '8'],
    ]);
    expect(sheets[1].rows).toEqual([]);
  });

  it('refuses a file that is not a zip, by name', async () => {
    await expect(readXlsx(new TextEncoder().encode('Nom;Prix\nBol;12'))).rejects.toThrow('NOT_A_ZIP');
  });

  it('lists the zip entries it found', async () => {
    const zip = await makeZip({ 'a.txt': 'x' }, []);
    expect(zipEntries(zip).map((e) => e.name)).toEqual(['a.txt']);
  });
});
