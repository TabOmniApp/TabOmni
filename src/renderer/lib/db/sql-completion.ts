import { MySQL, PostgreSQL, sql, type SQLDialect } from "@codemirror/lang-sql"
import type { Extension } from "@codemirror/state"

import type { DbEngine } from "@shared/api"

/**
 * Schema-aware completion for the SQL console.
 *
 * **This file used to be 290 lines and is now this.** Monaco ships grammars for
 * `sql`, `mysql` and `pgsql` and no language service behind any of them —
 * highlighting only — so offering the connected database's tables, and the right
 * table's columns after a `.`, was a completion provider written by hand: a
 * regex that found the tables a statement named and the aliases they were named
 * under, a keyword list, a statement-at-the-cursor split on `;`, and a
 * `Map<modelUri, schema>` because a Monaco provider is registered per *language*
 * and had to work out which of two open consoles it had been handed.
 *
 * `@codemirror/lang-sql` does all of that when handed a schema, which is the
 * thing this console had before the app moved to Monaco and the one thing that
 * move is on record as having cost. It parses the statement rather than
 * regexing it, so an alias inside a subquery resolves and a semicolon inside a
 * string literal does not split anything; and the schema is a *configuration of
 * the editor* rather than a global keyed by document identity, so two consoles
 * cannot answer for each other by construction.
 */

/** One dialect per engine, so the console highlights and completes what it is
 * actually connected to rather than generic SQL. */
const DIALECTS: Record<DbEngine, SQLDialect> = {
  postgres: PostgreSQL,
  mysql: MySQL,
}

/**
 * The console's language, for the engine it is connected to and the schema it
 * can see.
 *
 * Rebuilt and reconfigured whenever either changes — the tables arrive after the
 * console opens, and a keyword list that was fixed at open would be completing
 * against a database nobody is looking at.
 *
 * `upperCaseKeywords` is off deliberately: this console offered lower-case
 * keywords when it was CodeMirror the first time, and a suggestion list that
 * fights the user's own casing is worse than none.
 */
export function sqlLanguage(
  engine: DbEngine,
  schema: Record<string, string[]>
): Extension {
  return sql({
    dialect: DIALECTS[engine],
    schema,
    upperCaseKeywords: false,
  })
}
