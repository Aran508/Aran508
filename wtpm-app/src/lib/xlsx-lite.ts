/**
 * Minimal, fast XLSX reader for importing the production workbooks.
 * Reads only the sheets that are asked for and returns each cell's cached value and whether
 * it holds a formula. (The full workbook has 23 sheets, 54 charts, pivots and slicers.)
 */
import JSZip from 'jszip';

export interface Cell {
  v: string | number | boolean | null;
  f: boolean;
  formula?: string;
}
export interface Grid {
  name: string;
  rowCount: number;
  get(row: number, col: number): Cell | undefined;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

export function colToNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export class XlsxLite {
  private constructor(
    private zip: JSZip,
    private sheetPaths: Map<string, string>,
    private shared: string[],
  ) {}

  static async open(buf: ArrayBuffer | Buffer | Uint8Array): Promise<XlsxLite> {
    const zip = await JSZip.loadAsync(buf);
    const wbXml = await zip.file('xl/workbook.xml')!.async('string');
    const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
    const rels = new Map<string, string>();
    for (const m of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = m[1].match(/Id="([^"]+)"/)?.[1];
      const target = m[1].match(/Target="([^"]+)"/)?.[1];
      if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    }
    const sheetPaths = new Map<string, string>();
    for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/>/g)) {
      const name = decode(m[1].match(/name="([^"]*)"/)?.[1] ?? '');
      const rid = m[1].match(/r:id="([^"]+)"/)?.[1];
      if (rid && rels.has(rid)) sheetPaths.set(name, rels.get(rid)!);
    }
    const shared: string[] = [];
    const ss = zip.file('xl/sharedStrings.xml');
    if (ss) {
      const xml = await ss.async('string');
      for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        const texts = [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]);
        // ignore phonetic runs
        shared.push(decode(texts.join('')));
      }
    }
    return new XlsxLite(zip, sheetPaths, shared);
  }

  sheetNames() {
    return [...this.sheetPaths.keys()];
  }

  findSheet(name: string): string | undefined {
    const want = name.trim().toLowerCase();
    return this.sheetNames().find((n) => n.trim().toLowerCase() === want);
  }

  async sheet(name: string): Promise<Grid | null> {
    const real = this.findSheet(name);
    if (!real) return null;
    const xml = await this.zip.file(this.sheetPaths.get(real)!)!.async('string');
    const rows = new Map<number, Map<number, Cell>>();
    let maxRow = 0;
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    for (const m of xml.matchAll(cellRe)) {
      const attrs = m[1];
      const ref = attrs.match(/\br="([A-Z]+)(\d+)"/);
      if (!ref) continue;
      const inner = m[2] ?? '';
      const t = attrs.match(/\bt="([^"]+)"/)?.[1];
      const fm = inner.match(/<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/);
      const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
      let v: Cell['v'] = null;
      if (t === 'inlineStr') v = decode([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else if (vm) {
        const raw = vm[1];
        if (t === 's') v = this.shared[Number(raw)] ?? '';
        else if (t === 'str' || t === 'e') v = decode(raw);
        else if (t === 'b') v = raw === '1';
        else v = Number(raw);
      }
      if (v === null && !fm) continue;
      const r = Number(ref[2]);
      const c = colToNum(ref[1]);
      if (!rows.has(r)) rows.set(r, new Map());
      rows.get(r)!.set(c, { v, f: !!fm, formula: fm?.[1] ? decode(fm[1]) : undefined });
      if (r > maxRow) maxRow = r;
    }
    return { name: real, rowCount: maxRow, get: (r, c) => rows.get(r)?.get(c) };
  }
}
