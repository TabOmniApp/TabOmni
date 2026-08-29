/**
 * The one piece of the updater with an opinion: which of two versions is newer.
 *
 * Worth a test rather than a glance, because both ways of getting it wrong are
 * silent. Say `1.0.9` is newer than `1.0.19` — string comparison, the obvious
 * implementation — and every user is offered a downgrade forever. Say a
 * prerelease is newer than the release it precedes and the same thing happens
 * to whoever is running one.
 */
import { isNewer, versionParts } from "../src/main/updater"
import { check, finish, section } from "./harness"

section("versionParts")

check("splits a plain version", versionParts("1.0.19").join(".") === "1.0.19")
check("drops a leading v", versionParts("v1.0.19").join(".") === "1.0.19")
check(
  "stops at a prerelease rather than folding it in",
  versionParts("1.0.20-beta.1").join(".") === "1.0.20"
)
check("reads a non-number as zero", versionParts("1.x.3").join(".") === "1.0.3")

section("isNewer")

check("a later patch", isNewer("1.0.20", "1.0.19"))
check(
  "compares numerically, not as text — the bug this exists for",
  isNewer("1.0.19", "1.0.9")
)
check("a later minor", isNewer("1.1.0", "1.0.99"))
check("the same version is not newer", !isNewer("1.0.19", "1.0.19"))
check("a tag's v changes nothing", !isNewer("v1.0.19", "1.0.19"))
check(
  "an older release is never offered — a dev build stays put",
  !isNewer("1.0.19", "1.0.20")
)
check("a release beats its own prerelease", isNewer("1.0.20", "1.0.20-beta.1"))
check(
  "a prerelease of the version you have is not an update",
  !isNewer("1.0.20-beta.1", "1.0.20")
)
check(
  "a shorter version is padded rather than treated as smaller",
  !isNewer("1.0", "1.0.0")
)
check("and the other way round", isNewer("1.0.1", "1.0"))

finish()
