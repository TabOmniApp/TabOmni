import claudeCodeIconUrl from "@/assets/svg/claudecode-icon.svg?url"

/**
 * Anthropic's own mark, not a Lucide glyph — brand colour, not `currentColor`,
 * so it does not follow the muted/active text tone the way the other kinds'
 * icons do.
 */
export function ClaudeCodeIcon({ className }: { className?: string }) {
  return <img src={claudeCodeIconUrl} alt="" className={className} />
}
