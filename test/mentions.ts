import {
  expandMentions,
  mentionHref,
  mentionIdOf,
  type Mention,
} from "../src/renderer/lib/terminal/mention-text"
import { check, finish, section } from "./harness"

/**
 * What an `@` chip becomes on the way to the CLI.
 *
 * The composer shows a name and sends a line of context, so this rewrite is the
 * only place the two meet — and every failure in it is silent in the same
 * direction: the prompt still sends, carrying either a `tabomni://` href the
 * agent can do nothing with, or the wrong thing entirely. The tests are
 * therefore mostly about the shapes a commonmark serializer can produce for a
 * name somebody typed.
 *
 * `expandMentions` takes its lookup as an argument, which is what lets this run
 * without four zustand stores and a database behind it.
 */

const mention = (id: string, label: string, text: string): Mention => ({
  id,
  kind: "note",
  label,
  detail: "note",
  resolve: () => Promise.resolve(text),
})

const catalogue = (...items: Mention[]) => {
  const byId = new Map(items.map((item) => [item.id, item]))
  return (id: string) => byId.get(id)
}

const note = mention("note:n1", "Deploy checklist", "note contents")
const link = (target: Mention, label = target.label) =>
  `[${label}](${mentionHref(target)})`

section("the href carries the id")

check(
  "round trips",
  mentionIdOf(mentionHref(note)) === "note:n1",
  mentionHref(note)
)

check(
  "a relation key survives being a URL component",
  mentionIdOf(
    mentionHref(mention("table:public.users", "public.users", "cols"))
  ) === "table:public.users"
)

check(
  "an ordinary link is not a mention",
  mentionIdOf("https://x.test") === null
)

check(
  "a malformed escape is not a mention",
  mentionIdOf("tabomni://mention/%E0%A4%A") === null
)

section("expanding")

check(
  "a chip becomes its context",
  (await expandMentions(`Follow ${link(note)} today`, catalogue(note))) ===
    "Follow note contents today"
)

check(
  "text with no chips is returned as it is",
  (await expandMentions("nothing here", catalogue(note))) === "nothing here"
)

check(
  "the same chip twice is resolved once and replaced twice",
  await (async () => {
    let reads = 0
    const counted: Mention = {
      ...note,
      resolve: () => {
        reads += 1
        return Promise.resolve("CONTEXT")
      },
    }
    const out = await expandMentions(
      `${link(counted)} and ${link(counted)}`,
      catalogue(counted)
    )
    return out === "CONTEXT and CONTEXT" && reads === 1
  })()
)

check(
  "two different chips each get their own",
  (await expandMentions(
    `${link(note)} then ${link(mention("note:n2", "Other", "second"))}`,
    catalogue(note, mention("note:n2", "Other", "second"))
  )) === "note contents then second"
)

section("what happens when the thing has gone")

check(
  "a mention nothing knows about falls back to its label",
  (await expandMentions(`see ${link(note)}`, catalogue())) ===
    "see Deploy checklist"
)

check(
  "a resolver that throws falls back to the label too",
  (await expandMentions(
    `see ${link(note)}`,
    catalogue({ ...note, resolve: () => Promise.reject(new Error("gone")) })
  )) === "see Deploy checklist"
)

check(
  "an escaped bracket in the label is unescaped in the fallback",
  (await expandMentions(
    `see [Notes \\[draft\\]](${mentionHref(note)})`,
    catalogue()
  )) === "see Notes [draft]"
)

check(
  "an ordinary link beside a chip is left alone",
  (await expandMentions(
    `[docs](https://x.test) and ${link(note)}`,
    catalogue(note)
  )) === "[docs](https://x.test) and note contents"
)

finish()
