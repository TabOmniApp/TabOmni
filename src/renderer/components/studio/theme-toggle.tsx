import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"

import { IconButton } from "./icon-button"

/**
 * Switches between the light and dark theme.
 *
 * There was already a `d` hotkey for this (see `theme-provider.tsx`) and it
 * stays, but a keystroke nobody is told about is not a feature — this is the
 * visible way in.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  // `resolvedTheme` is undefined for the first paint, before next-themes has
  // read the stored choice. Treated as dark, which is this app's default, so
  // the icon starts out right rather than starting wrong and correcting.
  const dark = resolvedTheme !== "light"

  return (
    <IconButton
      label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Moon /> : <Sun />}
    </IconButton>
  )
}
