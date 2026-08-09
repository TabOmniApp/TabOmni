import { arrange, bare, kindOf, PREFIX } from "../src/renderer/lib/tabs"
import { check, finish, section } from "./harness"

/**
 * The workbench tab strip's ordering.
 *
 * The strip is one row over four panels, each of which owns only which tabs it
 * has open — so where a tab sits relative to another panel's is held apart from
 * all of them, written once when a drag lands and reconciled against reality on
 * every render afterwards. That reconciliation is what breaks quietly: it is
 * asked about a saved order that may name tabs that have since closed, and
 * about tabs opened since that the order has never seen, and a wrong answer is
 * a tab that jumps or disappears rather than an error.
 */

/** Ids as the strip builds them, short enough to read in a failure. */
const t1 = `${PREFIX.database}public.users`
const t2 = `${PREFIX.database}public.orders`
const t3 = `${PREFIX.database}public.items`
const a1 = `${PREFIX.api}req-1`
const a2 = `${PREFIX.api}req-2`
const s1 = `${PREFIX.spec}docs/FR_008.spec.json`
const x1 = `${PREFIX.terminal}sess-1`

const tab = (id: string) => ({ id })
const ids = (items: { id: string }[]) => items.map((item) => item.id)

section("no arrangement yet")

check(
  "an empty order leaves the panels grouped",
  ids(arrange([tab(t1), tab(a1), tab(t2)], [])).join() === [t1, a1, t2].join()
)

section("a tab dropped into another panel's run")

/** The reported bug: an API tab put between two Database tabs sprang back. */
const interleaved = [t1, a1, t2]
check(
  "the arrangement is what the strip shows",
  ids(arrange([tab(t1), tab(t2), tab(a1)], interleaved)).join() ===
    [t1, a1, t2].join(),
  ids(arrange([tab(t1), tab(t2), tab(a1)], interleaved))
)

check(
  "it survives the panels reporting their own tabs in their own order",
  ids(arrange([tab(a1), tab(t2), tab(t1)], interleaved)).join() ===
    [t1, a1, t2].join()
)

section("the order goes stale")

check(
  "an id for a closed tab matches nothing",
  ids(arrange([tab(t1), tab(a1)], [t1, t2, a1])).join() === [t1, a1].join()
)

check(
  "an id repeated in the order does not place the tab twice",
  ids(arrange([tab(t1), tab(a1)], [t1, a1, t1])).join() === [t1, a1].join()
)

check(
  "closing everything leaves nothing",
  arrange([], [t1, a1, t2]).length === 0
)

section("a tab opened since the last drag")

check(
  "a new table lands after the last table, not at the end of the strip",
  ids(arrange([tab(t1), tab(t2), tab(t3), tab(a1)], [t1, a1, t2])).join() ===
    [t1, a1, t2, t3].join(),
  ids(arrange([tab(t1), tab(t2), tab(t3), tab(a1)], [t1, a1, t2]))
)

check(
  "a new request lands after the last request",
  ids(arrange([tab(t1), tab(a1), tab(a2), tab(t2)], [t1, a1, t2])).join() ===
    [t1, a1, a2, t2].join()
)

check(
  "the first tab of a panel with none open goes to the end",
  ids(arrange([tab(t1), tab(a1), tab(x1)], [a1, t1])).join() ===
    [a1, t1, x1].join()
)

check(
  "several new tabs of one panel keep their own sequence",
  ids(arrange([tab(t1), tab(t2), tab(t3), tab(a1)], [a1, t1])).join() ===
    [a1, t1, t2, t3].join(),
  ids(arrange([tab(t1), tab(t2), tab(t3), tab(a1)], [a1, t1]))
)

check(
  "a strip whose whole order is stale still shows everything",
  ids(arrange([tab(t1), tab(a1)], ["db:gone", "api:gone"])).join() ===
    [t1, a1].join()
)

section("ids carry their panel")

check("a table id names the database panel", kindOf(t1) === "database")
check("a request id names the api panel", kindOf(a1) === "api")
check("a spec id names the spec panel", kindOf(s1) === "spec")
check("a session id names the terminal panel", kindOf(x1) === "terminal")
check("an unprefixed id names none", kindOf("public.users") === null)

check("the prefix comes back off", bare(t1, "database") === "public.users")
check(
  "a spec's path survives the round trip",
  bare(s1, "spec") === "docs/FR_008.spec.json"
)

/**
 * No prefix may begin with another, or `kindOf` would answer with whichever it
 * happened to test first — a rule the map is small enough to hide a breach of.
 */
const prefixes = Object.values(PREFIX)
check(
  "no prefix is a prefix of another",
  prefixes.every((one) =>
    prefixes.every((other) => one === other || !other.startsWith(one))
  ),
  prefixes
)

finish()
