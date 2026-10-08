/**
 * Reading the list a person already keeps: a CSV or an Excel file (doc 124 §14).
 *
 * No dependency: a CSV is text, and an .xlsx is a zip of XML that the browser
 * can open with DecompressionStream and DOMParser. What comes out is a grid of
 * strings per sheet; deciding what a column MEANS is importMap's job.
 *
 * Nothing here guesses silently. A CSV saved in a legacy Windows encoding
 * arrives with replacement characters, and the reader SAYS so (`mojibake`)
 * instead of importing "Hélène" as "H�l�ne".
 */

export interface Sheet {
  name: string;
  rows: string[][];
}

export interface CsvResult {
  rows: string[][];
  delimiter: string;
  /** True when the text carries U+FFFD: it was not UTF-8, and accents are lost. */
  mojibake: boolean;
}

/** The delimiter that splits the first line the most, outside quotes. Excel in French writes `;`. */
export function sniffDelimiter(text: string): string {
  const firstLine: string[] = [];
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes) firstLine.push(ch);
  }
  let best = ',';
  let bestCount = 0;
  for (const d of [';', ',', '\t', '|']) {
    const n = firstLine.filter((c) => c === d).length;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/** RFC 4180, with the variants real exports produce: a BOM, CRLF, `;`, quotes doubled inside quotes. */
export function parseCsv(input: string, delimiter?: string): CsvResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const d = delimiter ?? sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === d) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows: dropEmptyRows(rows), delimiter: d, mojibake: text.includes('\ufffd') };
}

function dropEmptyRows(rows: string[][]): string[][] {
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

// ── XLSX ────────────────────────────────────────────────────────────────────

/** Bytes from a `data:…;base64,` URL, the shape dialog.readFile gives a binary file. */
export function bytesFromDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function u16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/** The central directory: where each file of the zip starts and how it is packed. */
export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  // The end-of-central-directory record sits in the last 64 KiB (+22 bytes).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('NOT_A_ZIP');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const decoder = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('BROKEN_ZIP');
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const localOffset = u32(bytes, p + 42);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // A plain ReadableStream, not Blob.stream(): the same code runs in the frame and under jsdom.
  const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data); c.close(); } });
  const stream = source.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readEntry(bytes: Uint8Array, e: ZipEntry): Promise<string> {
  const p = e.localOffset;
  if (u32(bytes, p) !== 0x04034b50) throw new Error('BROKEN_ZIP');
  const start = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28);
  const raw = bytes.subarray(start, start + e.compressedSize);
  if (e.method === 0) return new TextDecoder().decode(raw);
  if (e.method === 8) return new TextDecoder().decode(await inflateRaw(raw));
  throw new Error(`ZIP_METHOD_${e.method}`);
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('BROKEN_XML');
  return doc;
}

/** Elements by LOCAL name: the spreadsheet namespaces vary between writers (Excel, LibreOffice, Numbers). */
function byName(node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS('*', name));
}

/** "A" → 0, "Z" → 25, "AA" → 26. */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref.toUpperCase())?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(el: Element): string {
  return byName(el, 't').map((t) => t.textContent ?? '').join('');
}

/** Every sheet of an .xlsx, in workbook order, as a grid of strings. */
export async function readXlsx(bytes: Uint8Array): Promise<Sheet[]> {
  const entries = zipEntries(bytes);
  const find = (name: string) => entries.find((e) => e.name === name);
  const read = async (name: string) => {
    const e = find(name);
    return e ? readEntry(bytes, e) : null;
  };

  const workbookXml = await read('xl/workbook.xml');
  if (!workbookXml) throw new Error('NOT_A_WORKBOOK');
  const relsXml = await read('xl/_rels/workbook.xml.rels');
  const targets = new Map<string, string>();
  if (relsXml) {
    for (const r of byName(parseXml(relsXml), 'Relationship')) {
      const id = r.getAttribute('Id');
      const target = r.getAttribute('Target');
      if (id && target) targets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
    }
  }

  const sharedXml = await read('xl/sharedStrings.xml');
  const shared = sharedXml ? byName(parseXml(sharedXml), 'si').map(textOf) : [];

  const sheets: Sheet[] = [];
  const declared = byName(parseXml(workbookXml), 'sheet');
  for (let i = 0; i < declared.length; i++) {
    const s = declared[i];
    const rid = s.getAttribute('r:id') ?? s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = (rid && targets.get(rid)) || `worksheets/sheet${i + 1}.xml`;
    const xml = await read(`xl/${target}`);
    if (!xml) continue;
    sheets.push({ name: s.getAttribute('name') ?? `Sheet${i + 1}`, rows: sheetRows(parseXml(xml), shared) });
  }
  return sheets;
}

function sheetRows(doc: Document, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of byName(doc, 'row')) {
    const cells: string[] = [];
    let next = 0;
    for (const c of byName(row, 'c')) {
      const ref = c.getAttribute('r');
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = c.getAttribute('t');
      const v = byName(c, 'v')[0]?.textContent ?? '';
      let value: string;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(c);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else value = v;
      while (cells.length < col) cells.push('');
      cells[col] = value;
    }
    rows.push(cells);
  }
  return dropEmptyRows(rows);
}
