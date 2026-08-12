/**
 * The templates a workspace starts with.
 *
 * Seeded once, on the first read of an empty template list, and ordinary
 * templates from that moment on — renameable, editable, deletable, and gone for
 * good once deleted. They are not consulted again at startup (see
 * `SEEDED_KEY` in `templates.ts`), which is what stops a template someone
 * deliberately threw away from coming back on the next launch.
 *
 * Four rather than a library of them: each one is here because it is a shape
 * this studio's own work keeps producing — a call with a payload, a bug worth
 * writing down before it is understood, a decision whose reasons will be asked
 * about later. A list long enough to need scrolling would be a menu to read
 * rather than a head start.
 *
 * Every field is left blank rather than filled with a plausible example: a
 * template is a skeleton to type into, and sample text is something to delete
 * first.
 */
export type TemplatePreset = {
  name: string
  description: string
  markdown: string
}

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    name: "Meeting notes",
    description: "Who was there, what was decided, what happens next.",
    markdown: `# Meeting

**When:**
**Who:**

## Context

## Decisions

-

## Actions

- [ ]

## Open questions

-
`,
  },
  {
    name: "Bug repro",
    description: "The steps, what happened, and what should have.",
    markdown: `# Bug

**Where:**
**Build:**

## Steps

1.
2.
3.

## Expected

## Actual

## Notes
`,
  },
  {
    name: "API endpoint",
    description: "One call: its payload, its response, its failures.",
    markdown: `# \`GET /\`

What it is for.

## Request

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
|  |  |  |  |

\`\`\`json
{}
\`\`\`

## Response

\`\`\`json
{}
\`\`\`

## Errors

| Status | When |
| --- | --- |
|  |  |
`,
  },
  {
    name: "Decision record",
    description: "The choice, the options it ruled out, and why.",
    markdown: `# Decision

**Date:**
**Status:** proposed

## Context

## Options

### Option A

**For:**
**Against:**

### Option B

**For:**
**Against:**

## Decision

## Consequences
`,
  },
]
