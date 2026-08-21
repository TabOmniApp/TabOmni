import { useDatabases } from "../db/databases-store"
import { useExplorer } from "../db/explorer-store"
import { mentions, primeMentions } from "../terminal/mentions"
import type { PlainMention } from "./mention-text"

export { primeMentions }

/**
 * What the assistant's `@` menu offers — the same catalogue the chat composer's
 * menu is built from, kept to the part a name can carry, plus the databases
 * themselves.
 *
 * Deliberately `lib/terminal/mentions.ts` rather than a second reader of the
 * same stores: what the workspace is holding is one question, and two answers to
 * it would drift the first time a panel changed. A row here is the same name the
 * chat composer's menu shows — `mydatabase.mytable` — because two menus on one
 * keyboard naming the same table two ways is the confusing part, and the name is
 * the whole reference. What this adds is the one thing only a name can offer: the
 * databases themselves, connected to or not.
 */
export function assistantMentions(): PlainMention[] {
  const { databases, selectedId } = useDatabases.getState()
  // The catalogue's tables are the open database's, so this is that database —
  // named in the row's detail rather than spliced into the name, both because it
  // is already in the name on the engines where a schema *is* a database, and
  // because a connection called "Shop (staging)" does not belong in the middle
  // of an identifier. What resolves the rest is the agent's own
  // `list_databases`, which answers with each record's name and database.
  const open = useExplorer.getState().databaseId
  const database =
    databases.find((candidate) => candidate.id === (open ?? selectedId)) ?? null

  // Every database, connected to or not: the list is the manifest's, read at
  // launch, and `list_tables` takes a name — so this is the row that answers
  // "what is even in this workspace?" without opening a panel.
  const rows: PlainMention[] = databases.map((record) => ({
    kind: "database",
    label: record.name,
    detail: `${record.engine} · ${record.database}`,
  }))

  for (const mention of mentions()) {
    rows.push({
      kind: mention.kind,
      label: mention.label,
      detail:
        mention.kind === "table" && database
          ? `${mention.detail} in ${database.name}`
          : mention.detail,
    })
  }

  return rows
}
