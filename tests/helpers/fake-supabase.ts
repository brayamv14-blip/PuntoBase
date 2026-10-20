/**
 * Supabase simulado en memoria (solo lo que usan las rutas de PuntoBase).
 * Imita el comportamiento relevante: filtros, unicidad (error 23505) y actualizaciones condicionales.
 */
type Row = Record<string, unknown>;
type Err = { code?: string; message: string } | null;

export interface UniqueRule {
  table: string;
  columns: string[];
  /** Solo aplica si el valor no es null (indice unico parcial). */
  partial?: boolean;
}

export class FakeDb {
  tables: Record<string, Row[]> = {};
  unique: UniqueRule[] = [];
  private seq = 0;
  /** Para provocar fallos: devuelve un error y la operacion no se aplica. */
  failOn: ((table: string, op: string) => Err) | null = null;

  constructor(unique: UniqueRule[] = []) {
    this.unique = unique;
  }

  uuid(): string {
    this.seq++;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  seed(table: string, rows: Row[]): void {
    for (const r of rows) this.rows(table).push({ id: this.uuid(), created_at: new Date().toISOString(), ...r });
  }

  from(table: string) {
    return new Query(this, table);
  }
}

type Filter = (row: Row) => boolean;

class Query implements PromiseLike<{ data: unknown; error: Err; count?: number | null }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row | Row[] | null = null;
  private onConflict: string | null = null;
  private returning = false;
  private singleMode: "none" | "single" | "maybe" = "none";
  private wantCount = false;
  private headOnly = false;
  private orderBy: { col: string; asc: boolean } | null = null;
  private limitN: number | null = null;
  private rangeR: [number, number] | null = null;

  constructor(
    private db: FakeDb,
    private table: string
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== "select") this.returning = true;
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(row: Row | Row[]) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  upsert(row: Row, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = row;
    this.onConflict = opts?.onConflict ?? null;
    return this;
  }
  update(row: Row) {
    this.op = "update";
    this.payload = row;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val || (r[col] == null && val == null));
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  gte(col: string, val: string) {
    this.filters.push((r) => String(r[col]) >= val);
    return this;
  }
  lte(col: string, val: string) {
    this.filters.push((r) => String(r[col]) <= val);
    return this;
  }
  lt(col: string, val: string) {
    this.filters.push((r) => String(r[col]) < val);
    return this;
  }
  like(col: string, pattern: string) {
    const re = new RegExp("^" + pattern.replace(/%/g, ".*") + "$");
    this.filters.push((r) => re.test(String(r[col] ?? "")));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(a: number, b: number) {
    this.rangeR = [a, b];
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }

  private checkUnique(row: Row, ignore?: Row): Err {
    for (const rule of this.db.unique.filter((u) => u.table === this.table)) {
      const vals = rule.columns.map((c) => row[c]);
      if (rule.partial && vals.some((v) => v == null)) continue;
      const clash = this.db.rows(this.table).some(
        (r) => r !== ignore && rule.columns.every((c, i) => r[c] === vals[i])
      );
      if (clash) return { code: "23505", message: `duplicate key (${rule.columns.join(",")})` };
    }
    return null;
  }

  private run(): { data: unknown; error: Err; count?: number | null } {
    const failure = this.db.failOn?.(this.table, this.op);
    if (failure) return { data: null, error: failure };

    const all = this.db.rows(this.table);
    let result: Row[] = [];

    if (this.op === "insert" || this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      for (const input of list) {
        const row: Row = { id: this.db.uuid(), created_at: new Date().toISOString(), ...input };
        if (this.op === "upsert" && this.onConflict) {
          const existing = all.find((r) => r[this.onConflict!] === input[this.onConflict!]);
          if (existing) {
            Object.assign(existing, input);
            result.push(existing);
            continue;
          }
        }
        const clash = this.checkUnique(row);
        if (clash) return { data: null, error: clash };
        all.push(row);
        result.push(row);
      }
    } else if (this.op === "update") {
      const targets = all.filter((r) => this.filters.every((f) => f(r)));
      for (const t of targets) {
        const next = { ...t, ...(this.payload as Row) };
        const clash = this.checkUnique(next, t);
        if (clash) return { data: null, error: clash };
        Object.assign(t, this.payload);
      }
      result = targets;
    } else if (this.op === "delete") {
      const targets = all.filter((r) => this.filters.every((f) => f(r)));
      this.db.tables[this.table] = all.filter((r) => !targets.includes(r));
      result = targets;
    } else {
      result = all.filter((r) => this.filters.every((f) => f(r)));
      if (this.orderBy) {
        const { col, asc } = this.orderBy;
        result = [...result].sort((a, b) =>
          String(a[col] ?? "") < String(b[col] ?? "") ? (asc ? -1 : 1) : String(a[col] ?? "") > String(b[col] ?? "") ? (asc ? 1 : -1) : 0
        );
      }
      if (this.rangeR) result = result.slice(this.rangeR[0], this.rangeR[1] + 1);
      if (this.limitN != null) result = result.slice(0, this.limitN);
    }

    const count = this.wantCount ? result.length : undefined;
    const copy = result.map((r) => ({ ...r }));
    const wantsRows = this.op === "select" || this.returning;

    if (this.singleMode !== "none") {
      if (copy.length > 1 && this.singleMode === "single") return { data: null, error: { message: "multiple rows" } };
      if (copy.length === 0) {
        return this.singleMode === "single"
          ? { data: null, error: { code: "PGRST116", message: "no rows" } }
          : { data: null, error: null };
      }
      return { data: copy[0], error: null, count };
    }
    return { data: this.headOnly ? null : wantsRows ? copy : null, error: null, count };
  }

  then<T1, T2>(
    onfulfilled?: ((v: { data: unknown; error: Err; count?: number | null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((e: unknown) => T2 | PromiseLike<T2>) | null
  ) {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}
