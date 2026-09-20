/**
 * A tiny in-memory stand-in for the parts of the Supabase query builder the
 * bots use: select/insert/update with eq/neq/lt/gte/in filters, order, limit,
 * single/maybeSingle. Good enough to run whole conversations offline.
 */
let counter = 0;

export function createFakeDb({ tables = {}, defaults = {}, uniqueKeys = {}, rejectColumns = {} } = {}) {
  const data = {};
  for (const [name, rows] of Object.entries(tables)) data[name] = rows.map((row) => ({ ...row }));
  const rowsOf = (table) => (data[table] ??= []);

  function builder(table) {
    const state = { op: "select", filters: [], patch: null, insertRows: null, orderBy: null, limitN: null, wantRows: false };

    const matches = (row) =>
      state.filters.every(([kind, col, value]) => {
        const cell = row[col];
        if (kind === "eq") return cell === value;
        if (kind === "neq") return cell !== value;
        if (kind === "lt") return cell < value;
        if (kind === "gte") return cell >= value;
        if (kind === "in") return value.includes(cell);
        return true;
      });

    function run() {
      const rows = rowsOf(table);
      if (state.op === "insert") {
        const inserted = [];
        for (const input of state.insertRows) {
          for (const column of rejectColumns[table] || []) {
            if (column in input) {
              return { data: null, error: { code: "42703", message: `column "${column}" of relation "${table}" does not exist` } };
            }
          }
          const key = uniqueKeys[table];
          if (key && rows.some((row) => row[key] === input[key])) {
            return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          const row = { id: `${table}-${++counter}`, created_at: new Date().toISOString(), ...(defaults[table] || {}), ...input };
          rows.push(row);
          inserted.push({ ...row });
        }
        return { data: inserted, error: null };
      }
      if (state.op === "update") {
        const updated = rows.filter(matches);
        for (const row of updated) Object.assign(row, state.patch);
        return { data: updated.map((row) => ({ ...row })), error: null };
      }
      let result = rows.filter(matches).map((row) => ({ ...row }));
      if (state.orderBy) {
        const [col, ascending] = state.orderBy;
        result.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (ascending ? 1 : -1));
      }
      if (state.limitN != null) result = result.slice(0, state.limitN);
      return { data: result, error: null };
    }

    const api = {
      select() { state.wantRows = true; return api; },
      insert(rows) { state.op = "insert"; state.insertRows = Array.isArray(rows) ? rows : [rows]; return api; },
      update(patch) { state.op = "update"; state.patch = patch; return api; },
      eq(col, value) { state.filters.push(["eq", col, value]); return api; },
      neq(col, value) { state.filters.push(["neq", col, value]); return api; },
      lt(col, value) { state.filters.push(["lt", col, value]); return api; },
      gte(col, value) { state.filters.push(["gte", col, value]); return api; },
      in(col, value) { state.filters.push(["in", col, value]); return api; },
      order(col, { ascending = true } = {}) { state.orderBy = [col, ascending]; return api; },
      limit(n) { state.limitN = n; return api; },
      single() {
        const { data: rows, error } = run();
        if (error) return Promise.resolve({ data: null, error });
        return Promise.resolve(rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "expected one row" } });
      },
      maybeSingle() {
        const { data: rows, error } = run();
        if (error) return Promise.resolve({ data: null, error });
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return api;
  }

  return { from: builder, data, rowsOf };
}
