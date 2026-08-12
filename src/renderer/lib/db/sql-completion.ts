import { monaco } from "@/lib/monaco"

/**
 * Schema-aware completion for the SQL console.
 *
 * Monaco ships grammars for `sql`, `mysql` and `pgsql` but no language service
 * behind any of them — highlighting only. This is the part CodeMirror's
 * `lang-sql` used to do for free when handed a schema: offer the connected
 * database's tables, and the right table's columns after a `.`.
 *
 * The parsing here is deliberately regex-deep rather than a real grammar. What
 * it has to answer is only "which tables are named in this statement, under
 * which aliases" — enough for a suggestion list, where being wrong costs one bad
 * entry rather than a broken query. A statement is delimited by `;`, which a
 * semicolon inside a string literal would fool; the result is a slightly wider
 * set of tables in scope, which is the harmless direction to be wrong in.
 */

/** Table name → its columns, exactly as `explorer-store` keeps it: every table
 * appears twice, bare and schema-qualified. */
export type SqlSchema = Record<string, string[]>

/**
 * The live schema per editor, keyed by model URI.
 *
 * Monaco's providers are registered per *language*, not per editor, so a
 * provider serving two open consoles has to work out whose model it was handed.
 * The alternative — one provider registered per editor instance — would have
 * every console answering for every other one.
 */
const schemas = new Map<string, SqlSchema>()

export function setSqlSchema(uri: string, schema: SqlSchema): void {
  schemas.set(uri, schema)
}

export function clearSqlSchema(uri: string): void {
  schemas.delete(uri)
}

/**
 * Enough SQL to complete the shape of a statement.
 *
 * Not a dialect's full reserved list: what earns a place here is what someone
 * types on the way to a query. Lower case, because the console asked
 * CodeMirror for lower-case keywords too and a suggestion list that fights the
 * user's own casing is worse than none.
 */
const KEYWORDS = [
  "select",
  "from",
  "where",
  "group by",
  "order by",
  "having",
  "limit",
  "offset",
  "insert into",
  "values",
  "update",
  "set",
  "delete from",
  "join",
  "inner join",
  "left join",
  "right join",
  "full join",
  "cross join",
  "on",
  "using",
  "as",
  "and",
  "or",
  "not",
  "in",
  "exists",
  "between",
  "like",
  "ilike",
  "is null",
  "is not null",
  "asc",
  "desc",
  "distinct",
  "union",
  "union all",
  "intersect",
  "except",
  "with",
  "case",
  "when",
  "then",
  "else",
  "end",
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "coalesce",
  "nullif",
  "cast",
  "returning",
  "on conflict",
  "do nothing",
  "do update",
  "create table",
  "alter table",
  "drop table",
  "truncate",
  "explain",
  "analyze",
  "begin",
  "commit",
  "rollback",
]

/** The languages the console can be in — one per dialect Monaco ships, since
 * the editor picks its grammar from the connected engine. */
const LANGUAGES = ["sql", "mysql", "pgsql"]

/** Strips whatever this dialect quotes identifiers with: `"pg"`, MySQL's
 * backticks, and the bracketed form that turns up in pasted SQL. */
function unquote(part: string): string {
  return part.replace(/^["`[]|["`\]]$/g, "")
}

/** Resolves a written table name — quoted, schema-qualified or neither —
 * against the schema's own keys, which are neither. */
function lookupFor(schema: SqlSchema) {
  const byLower = new Map<string, string>()
  for (const key of Object.keys(schema)) byLower.set(key.toLowerCase(), key)

  return function resolve(written: string): string | null {
    const parts = written.split(".").map(unquote).filter(Boolean)
    if (parts.length === 0) return null
    const full = parts.join(".").toLowerCase()
    const bare = parts[parts.length - 1]!.toLowerCase()
    return byLower.get(full) ?? byLower.get(bare) ?? null
  }
}

/**
 * Every table the statement names, under both its own name and its alias.
 *
 * The lookahead is what keeps a keyword from being read as an alias: without
 * it `from users where ...` binds `where` as an alias for `users`, and every
 * column suggestion afterwards is filed under a table nobody wrote.
 */
const SOURCES =
  /\b(?:from|join|update|into)\s+([\w."`[\]]+)(?:\s+(?:as\s+)?(?!on\b|using\b|where\b|inner\b|left\b|right\b|full\b|cross\b|outer\b|join\b|group\b|order\b|having\b|limit\b|offset\b|set\b|values\b|select\b|union\b|window\b|returning\b|with\b)([a-zA-Z_]\w*))?/gi

function tablesInScope(
  statement: string,
  resolve: (written: string) => string | null
): Map<string, string> {
  const scope = new Map<string, string>()
  for (const match of statement.matchAll(SOURCES)) {
    const [, written, alias] = match
    if (!written) continue
    const table = resolve(written)
    if (!table) continue
    scope.set(unquote(written.split(".").pop() ?? "").toLowerCase(), table)
    if (alias) scope.set(alias.toLowerCase(), table)
  }
  return scope
}

/** The statement the cursor sits in, so a query lower down the tab does not
 * put its tables in scope for this one. */
function statementAt(text: string, offset: number): string {
  const start = text.lastIndexOf(";", offset - 1) + 1
  const end = text.indexOf(";", offset)
  return text.slice(start, end === -1 ? text.length : end)
}

/** Tables whose schema-qualified key sits under `namespace` — what `public.`
 * should offer, since a namespace has no columns of its own. */
function tablesUnder(schema: SqlSchema, namespace: string): string[] {
  const prefix = `${namespace.toLowerCase()}.`
  return Object.keys(schema)
    .filter((key) => key.toLowerCase().startsWith(prefix))
    .map((key) => key.slice(prefix.length))
}

for (const language of LANGUAGES) {
  monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ["."],

    provideCompletionItems(model, position) {
      const schema = schemas.get(model.uri.toString()) ?? {}
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      const resolve = lookupFor(schema)
      const statement = statementAt(
        model.getValue(),
        model.getOffsetAt(position)
      )
      const scope = tablesInScope(statement, resolve)

      const linePrefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      })

      // `u.`, `users.` or `public.users.` — the qualifier is everything before
      // the last dot, and it decides the whole list.
      const qualified = /([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.\w*$/.exec(
        linePrefix
      )
      if (qualified) {
        const written = qualified[1]!
        const table = scope.get(written.toLowerCase()) ?? resolve(written)
        if (table) {
          return { suggestions: columnItems(schema[table] ?? [], range) }
        }
        // Not a table, so the one thing left it can be is a schema namespace.
        return {
          suggestions: tablesUnder(schema, written).map((name) =>
            item(name, monaco.languages.CompletionItemKind.Struct, range, "1")
          ),
        }
      }

      // Unqualified: the columns you are most likely reaching for are the ones
      // belonging to tables this statement already names, so they sort above
      // the schema's tables and well above the keywords.
      const suggestions: monaco.languages.CompletionItem[] = []
      const seen = new Set<string>()
      for (const table of new Set(scope.values())) {
        for (const column of schema[table] ?? []) {
          if (seen.has(column)) continue
          seen.add(column)
          suggestions.push({
            ...item(
              column,
              monaco.languages.CompletionItemKind.Field,
              range,
              "0"
            ),
            detail: table,
          })
        }
      }

      // Bare keys only: the schema carries every table twice, and offering
      // `users` beside `public.users` is one list with everything in it twice.
      for (const table of Object.keys(schema)) {
        if (table.includes(".")) continue
        suggestions.push(
          item(table, monaco.languages.CompletionItemKind.Struct, range, "1")
        )
      }

      for (const keyword of KEYWORDS) {
        suggestions.push(
          item(keyword, monaco.languages.CompletionItemKind.Keyword, range, "2")
        )
      }

      return { suggestions }
    },
  })
}

function columnItems(
  columns: string[],
  range: monaco.IRange
): monaco.languages.CompletionItem[] {
  return columns.map((column) =>
    item(column, monaco.languages.CompletionItemKind.Field, range, "0")
  )
}

function item(
  label: string,
  kind: monaco.languages.CompletionItemKind,
  range: monaco.IRange,
  sortText: string
): monaco.languages.CompletionItem {
  return { label, kind, insertText: label, range, sortText }
}
