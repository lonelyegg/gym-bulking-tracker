// Runs the real apps-script/Code.gs in Node against an in-memory fake of the Sheets API,
// so the app's sync code can be tested end to end without Google.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

type Cell = string | number | boolean | Date;

class FakeRange {
  constructor(private sheet: FakeSheet, private r: number, private c: number, private nr: number, private nc: number) {}
  getValues(): Cell[][] {
    const out: Cell[][] = [];
    for (let i = 0; i < this.nr; i++) {
      const row: Cell[] = [];
      for (let j = 0; j < this.nc; j++) row.push(this.sheet.grid[this.r - 1 + i]?.[this.c - 1 + j] ?? '');
      out.push(row);
    }
    return out;
  }
  setValues(values: Cell[][]) {
    if (values.length !== this.nr || values.some((v) => v.length !== this.nc)) {
      throw new Error(`setValues: expected ${this.nr}x${this.nc}`);
    }
    values.forEach((row, i) => row.forEach((v, j) => {
      const grid = this.sheet.grid;
      while (grid.length <= this.r - 1 + i) grid.push([]);
      const target = grid[this.r - 1 + i];
      while (target.length < this.c - 1 + j) target.push('');
      target[this.c - 1 + j] = v;
    }));
    this.sheet.writes++;
    return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}

export class FakeSheet {
  grid: Cell[][] = [];
  writes = 0;
  constructor(public name: string) {}
  getLastRow() { return this.grid.length; }
  getLastColumn() { return this.grid.reduce((m, r) => Math.max(m, r.length), 0); }
  getRange(r: number, c: number, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  setFrozenRows() { /* not needed */ }
  /** Data rows as objects keyed by header, for assertions. */
  rows(): Record<string, Cell>[] {
    const [headers = [], ...body] = this.grid;
    return body.map((row) => Object.fromEntries(headers.map((h, i) => [String(h), row[i] ?? ''])));
  }
}

export function createFakeScript(token = 'secret-token') {
  const sheets = new Map<string, FakeSheet>();
  const props = new Map<string, string>([['API_TOKEN', token]]);
  const spreadsheet = {
    getSheetByName: (n: string) => sheets.get(n) ?? null,
    insertSheet: (n: string) => { const s = new FakeSheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()],
    deleteSheet: (s: FakeSheet) => { sheets.delete(s.name); },
    getSpreadsheetTimeZone: () => 'UTC',
  };
  const ctx = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k: string) => props.get(k) ?? null,
      setProperty: (k: string, v: string) => props.set(k, v),
      deleteProperty: (k: string) => props.delete(k),
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => ({ setMimeType() { return this; }, getContent: () => text }),
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d: Date) => d.toISOString().slice(0, 10),
    },
    Logger: { log() {} },
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../apps-script/Code.gs'), 'utf8'), ctx);
  const script = ctx as unknown as { doPost: (e: unknown) => { getContent(): string }; doGet: () => { getContent(): string }; setup: () => void };

  return {
    sheets,
    sheet: (name: string) => sheets.get(name),
    /** Handle a POST body like the web app would. */
    post(body: string): string {
      return script.doPost({ postData: { contents: body } }).getContent();
    },
    /** Act as another device talking to the same Sheet. */
    call(action: string, payload: object = {}, tok = token) {
      return JSON.parse(this.post(JSON.stringify({ token: tok, action, ...payload })));
    },
    setup: () => script.setup(),
  };
}

export type FakeScript = ReturnType<typeof createFakeScript>;
