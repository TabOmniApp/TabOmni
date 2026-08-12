import { withRowLimit } from "../src/renderer/lib/db/row-limit"
import { check, finish, section } from "./harness"

/**
 * The query console's row cap. It rewrites SQL the user wrote, so the cases
 * that matter are the ones where it must keep its hands off: a statement that
 * limits itself, one a trailing `limit` would break, and anything that writes.
 */

const capped = (sql: string) => withRowLimit(sql, 500)

section("capped")

check("a bare select", capped("select * from products") !== null)
check(
  "a trailing semicolon is replaced, not kept",
  capped("select * from products;") === "select * from products\nlimit 500"
)
check("an order by", capped("select * from t order by id desc") !== null)
check("a union", capped("select a from t union select a from u") !== null)
check("a leading CTE", capped("with x as (select 1) select * from x") !== null)
check("a leading comment", capped("-- listing\nselect * from t") !== null)
check("uppercase", capped("SELECT * FROM T") !== null)
check(
  "the cap lands on its own line, clear of a trailing comment",
  capped("select * from t -- everything") ===
    "select * from t -- everything\nlimit 500"
)

section("left alone")

check("its own limit", capped("select * from t limit 10") === null)
check("its own offset", capped("select * from t offset 20") === null)
check(
  "fetch first",
  capped("select * from t fetch first 10 rows only") === null
)
check("for update", capped("select * from t for update") === null)
check(
  "lock in share mode",
  capped("select * from t lock in share mode") === null
)
check("select into", capped("select * into archive from t") === null)
check("insert", capped("insert into t (a) values (1)") === null)
check("update", capped("update t set a = 1") === null)
check(
  "a data-modifying CTE",
  capped("with x as (select id from t) delete from u using x") === null
)
check("DDL", capped("create table t (id int)") === null)
check("a script", capped("select * from a; select * from b") === null)
check("empty", capped("   ") === null)
// The word test is on boundaries: a column called "deleted" is not a DELETE.
check(
  "a column whose name contains a keyword",
  capped("select deleted_at from t") !== null
)

finish()
