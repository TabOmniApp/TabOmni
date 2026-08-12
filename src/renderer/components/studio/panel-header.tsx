import type { ReactNode } from "react"

import { SECTION_ACCENT, type Section } from "./activity-bar"

/**
 * Every panel's header already carries the label the rail uses for it, so the
 * hue follows from the title rather than from a prop each caller has to
 * remember to pass — and a header that is not a rail section simply gets none.
 */
const ACCENT_BY_TITLE: Record<string, Section> = {
  Explorer: "files",
  Database: "database",
  API: "api",
  Mail: "mail",
  Webhooks: "webhook",
  Terminal: "terminal",
  Notes: "note",
}

/**
 * The header strip at the top of a sidebar panel: a section label, and the
 * actions that belong to that section.
 *
 * Shared so both sidebars — Files and Database — line up pixel for pixel with
 * each other and with the toolbars in the main pane, which all use the same
 * `h-9` strip. Each panel used to spell this out itself, and they had already
 * drifted apart.
 */
export function PanelHeader({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  const section = ACCENT_BY_TITLE[title]
  const accent = section ? SECTION_ACCENT[section] : undefined
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
      <h2 className="flex min-w-0 items-center gap-2 text-[0.7rem] font-medium tracking-wider text-muted-foreground uppercase">
        {accent && (
          <span
            aria-hidden
            style={{ backgroundColor: accent }}
            className="size-1.5 shrink-0 rounded-full"
          />
        )}
        <span className="truncate">{title}</span>
      </h2>
      {children && (
        <div className="flex shrink-0 items-center gap-0.5">{children}</div>
      )}
    </div>
  )
}
