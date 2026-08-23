import { StreamLanguage } from '@codemirror/language'
import { EditorView } from '@uiw/react-codemirror'
import type { Extension } from '@uiw/react-codemirror'
import { csharp, java } from '@codemirror/legacy-modes/mode/clike'
import { go } from '@codemirror/legacy-modes/mode/go'
import { http } from '@codemirror/legacy-modes/mode/http'
import { javascript } from '@codemirror/legacy-modes/mode/javascript'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { python } from '@codemirror/legacy-modes/mode/python'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { rust } from '@codemirror/legacy-modes/mode/rust'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import type { SnippetMode } from './targets'

/**
 * Highlighting per snippet mode.
 *
 * Every array is built **once, at module scope**, for the reason `response/syntax.ts`
 * spells out: a fresh `extensions` array makes CodeMirror reconfigure itself, and the code
 * view re-renders on every keystroke in the URL bar while the modal is open.
 *
 * Nine grammars, no new dependency — `@codemirror/legacy-modes` already carries all of
 * them, `http` included, which is what lets the Raw target colour its request-line and
 * header names rather than showing a wall of grey.
 *
 * Lines wrap here, unlike the response viewer's default. A snippet is generated at a
 * width nobody chose — a bearer token is one 900-character word — and a horizontal
 * scrollbar in a modal hides the end of exactly the line worth reading.
 */
const mode = (grammar: Parameters<typeof StreamLanguage.define>[0]): Extension[] => [StreamLanguage.define(grammar), EditorView.lineWrapping]

const TABLE: Record<SnippetMode, Extension[]> = {
  http: mode(http),
  shell: mode(shell),
  powershell: mode(powerShell),
  javascript: mode(javascript),
  python: mode(python),
  go: mode(go),
  // `clike` carries a dialect per language rather than one C grammar, so Java's and C#'s
  // own keyword sets are available for the price of the import that was needed anyway.
  java: mode(java),
  csharp: mode(csharp),
  ruby: mode(ruby),
  rust: mode(rust),
}

export const extensionsFor = (snippetMode: SnippetMode): Extension[] => TABLE[snippetMode]
