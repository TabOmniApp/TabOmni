import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import onlyWarn from "eslint-plugin-only-warn"
import pluginReact from "eslint-plugin-react"
import pluginReactHooks from "eslint-plugin-react-hooks"
import globals from "globals"
import tseslint from "typescript-eslint"

/**
 * One config for the whole app, scoped by directory.
 *
 * The main process and the renderer do not share globals — `process` is not in
 * a page and `document` is not in the main process — so the two halves get
 * their own `languageOptions` rather than a union that would typecheck code
 * neither side can run.
 *
 * `only-warn` turns every rule into a warning, and `lint` runs with
 * `--max-warnings 0`, so nothing is silently tolerated while the output still
 * reads as a list of things to fix rather than a wall of errors.
 */
export default [
  {
    ignores: [
      "dist-electron/**",
      "dist-renderer/**",
      "release/**",
      "src/renderer/public/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  { plugins: { onlyWarn } },

  {
    files: ["src/main/**", "src/preload/**", "scripts/**", "test/**"],
    languageOptions: { globals: globals.node },
  },

  {
    files: ["src/renderer/**"],
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    plugins: {
      ...pluginReact.configs.flat.recommended.plugins,
      "react-hooks": pluginReactHooks,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...pluginReact.configs.flat.recommended.rules,
      ...pluginReactHooks.configs.recommended.rules,
      // Unnecessary with the new JSX transform.
      "react/react-in-jsx-scope": "off",
      // TypeScript already describes a component's props.
      "react/prop-types": "off",
    },
  },
]
