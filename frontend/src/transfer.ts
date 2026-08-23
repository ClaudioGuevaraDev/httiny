import { Service as WorkspaceService } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/workspace'
import type { Secret } from '../bindings/github.com/ClaudioGuevaraDev/httiny/internal/workspace/models'
import { exportSecrets, prepareImport } from './persistence'
import { useAppStore } from './store'
import type { ImportRejection } from './types'
import type { PreparedImport } from './workspaceFile'
import { PREFS_VERSION, WORKSPACE_VERSION, toPrefsFile, toWorkspaceFile } from './workspaceFile'

/**
 * Moving a whole workspace in and out of a file the user picks.
 *
 * The envelope is this module's, not `workspaceFile.ts`'s: that file owns the schema of
 * the two files the app writes to its own directory, and this is a third shape with a
 * different job and a different lifetime. What it does reuse is everything that decides
 * *what* a workspace is — `toWorkspaceFile`, `toPrefsFile` and the defensive readers —
 * so an export cannot come to disagree with what autosave writes.
 *
 * It is not a pure leaf: it reaches `persistence.ts` for `exportSecrets` and
 * `prepareImport`. That is deliberate. The apply path has to read and re-seed
 * `secretsReadFailed`, `lastKeep` and `lastSecrets`, which are module-private there and
 * must stay that way, so `persistence.ts` owns the credential half whatever this file
 * looks like.
 */

/**
 * The export envelope's own version, and it follows the **same one-way ratchet as
 * `WORKSPACE_VERSION`**: a number that has ever reached a disk is never re-issued, not
 * even by a build that was never released. That rule is written here while there is only
 * a 1 in play precisely because it was learned the expensive way — `WORKSPACE_VERSION`
 * has a burnt 2 and a spent 3 to show for re-using one.
 *
 * Bump it when a change to the shape below cannot be absorbed by `readExportFile`. The
 * two versions *inside* the envelope move on their own schedules and are not this number.
 */
export const EXPORT_VERSION = 1

interface ExportFile {
  app: 'httiny'
  exportVersion: number
  /** Informative only. Nothing branches on either of these. */
  exportedAt: string
  appVersion: string
  workspace: { version: number; payload: unknown }
  prefs: { version: number; payload: unknown }
  /**
   * Absent unless the user opted in — and absent is not the same as empty. See
   * `prepareImport`, which reads the credential store back for an `undefined` and treats
   * a `[]` as the whole answer.
   *
   * A sibling of the payloads rather than a field inside them, which is what keeps
   * `workspaceFile.ts`'s guarantee intact: `StoredAuth` has no token field and
   * `StoredVariable`'s `secret: true` arm has no value, so writing a credential into
   * *that* shape stays a compile error. This list is built by the same functions that
   * feed the OS credential store.
   */
  secrets?: Secret[]
}

export type ImportOutcome = { state: 'cancelled' } | { state: 'rejected'; reason: ImportRejection } | { state: 'ready'; prepared: PreparedImport }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** `YYYYMMDD-HHmm`, so exports from one day sort next to each other in a file listing. */
const stamp = (now: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

/**
 * Builds the file from live store state.
 *
 * `includeSecrets` is passed in rather than read from the store because it is not store
 * state: it is a switch that lasts one visit to the panel, the line `defaultRedactSecrets`
 * already draws for the code view's own switch.
 */
export function toExportFile(state: ReturnType<typeof useAppStore.getState>, includeSecrets: boolean, now: Date): ExportFile {
  return {
    app: 'httiny',
    exportVersion: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    appVersion: __APP_VERSION__,
    workspace: { version: WORKSPACE_VERSION, payload: toWorkspaceFile(state) },
    prefs: { version: PREFS_VERSION, payload: toPrefsFile(state) },
    ...(includeSecrets ? { secrets: exportSecrets(state.documents, state.tree) } : {}),
  }
}

/**
 * Validates a parsed file, with the same discipline as `workspaceFile.ts`'s readers:
 * nothing is asserted with `as`, and this is untrusted input by definition.
 *
 * The two guards it does apply are refusals rather than repairs, which is the opposite of
 * how the payload readers behave, and on purpose — a payload can be degraded field by
 * field, a version cannot.
 */
export function readExportFile(raw: unknown): { ok: true; file: ExportFile } | { ok: false; reason: ImportRejection } {
  if (!isRecord(raw) || raw.app !== 'httiny' || !isRecord(raw.workspace) || !isRecord(raw.prefs)) return { ok: false, reason: 'malformed' }

  const exportVersion = typeof raw.exportVersion === 'number' ? raw.exportVersion : 0
  if (exportVersion < 1) return { ok: false, reason: 'malformed' }
  if (exportVersion > EXPORT_VERSION) return { ok: false, reason: 'newer-app' }

  // The rule `hydrate` applies to `workspace.json`, for the reason `WORKSPACE_VERSION`
  // documents at length: a build that half-understands a payload and writes the result
  // back truncates it, and here the autosave subscriber is already listening, so the
  // damage would reach disk on the next tick rather than being declined harmlessly.
  const workspaceVersion = typeof raw.workspace.version === 'number' ? raw.workspace.version : 0
  if (workspaceVersion > WORKSPACE_VERSION) return { ok: false, reason: 'newer-workspace' }

  // `prefs.version` is deliberately not guarded. `hydrate` does not guard it either, and
  // inventing a stricter rule for import than the load path applies would refuse files
  // the app would happily have opened.

  const secrets = Array.isArray(raw.secrets)
    ? raw.secrets.filter(isRecord).map(entry => ({
        id: typeof entry.id === 'string' ? entry.id : '',
        token: typeof entry.token === 'string' ? entry.token : '',
        password: typeof entry.password === 'string' ? entry.password : '',
      }))
    : undefined

  return {
    ok: true,
    file: {
      app: 'httiny',
      exportVersion,
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
      appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '',
      workspace: { version: workspaceVersion, payload: raw.workspace.payload },
      prefs: { version: typeof raw.prefs.version === 'number' ? raw.prefs.version : 0, payload: raw.prefs.payload },
      ...(secrets ? { secrets: secrets.filter(entry => entry.id) } : {}),
    },
  }
}

/**
 * Writes the whole configuration to a file the user picks.
 *
 * Resolves to the shape `useSave` takes, so a cancel is silent and only a real failure is
 * announced — dismissing a file dialog is the most ordinary thing a person can do with
 * one.
 */
export async function exportWorkspace(title: string, includeSecrets: boolean): Promise<{ ok: boolean; cancelled: boolean }> {
  try {
    const now = new Date()
    // Indented, because the file is meant to be readable and diffable — the same choice
    // `workspace.json` makes for the same reason.
    const contents = JSON.stringify(toExportFile(useAppStore.getState(), includeSecrets, now), null, 2)
    const result = await WorkspaceService.ExportFile(contents, `httiny-workspace-${stamp(now)}.json`, title)
    if (!result.ok && !result.cancelled) console.warn('[transfer] export failed', result.errorCode, result.errorText)
    return { ok: result.ok, cancelled: result.cancelled }
  } catch (error) {
    console.error('[transfer] export failed', error)
    return { ok: false, cancelled: false }
  }
}

/**
 * Opens a file, validates it and resolves its credentials — and changes nothing.
 *
 * Everything destructive waits for the confirmation that the caller raises with the
 * result. Nobody should be asked to approve a replace that is then going to be refused,
 * which is why both version guards run here rather than after the question.
 */
export async function importWorkspace(title: string): Promise<ImportOutcome> {
  let contents: string
  try {
    const result = await WorkspaceService.ImportFile(title)
    if (result.cancelled) return { state: 'cancelled' }
    if (!result.ok) {
      console.warn('[transfer] import failed', result.errorCode, result.errorText)
      return { state: 'rejected', reason: 'unreadable' }
    }
    contents = result.contents
  } catch (error) {
    console.error('[transfer] import failed', error)
    return { state: 'rejected', reason: 'unreadable' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return { state: 'rejected', reason: 'malformed' }
  }

  const read = readExportFile(parsed)
  if (!read.ok) return { state: 'rejected', reason: read.reason }

  return { state: 'ready', prepared: await prepareImport(read.file.workspace.payload, read.file.prefs.payload, read.file.secrets) }
}

/**
 * The whole import gesture, for the three surfaces that offer it.
 *
 * Shared rather than repeated because only one of those surfaces — the Storage panel —
 * has room to print why a file was refused. Raised from the sidebar's empty state or from
 * the command palette, a refusal opens Settings on that panel so the sentence has
 * somewhere to land instead of the click looking like it did nothing.
 *
 * A cancelled dialog is silent, and nothing is cleared on the way in beyond a stale
 * refusal: everything up to the confirmation is non-destructive.
 */
export async function startImport(title: string): Promise<void> {
  useAppStore.getState().setImportRejection(null)
  const outcome = await importWorkspace(title)
  if (outcome.state === 'cancelled') return
  if (outcome.state === 'rejected') {
    useAppStore.getState().setImportRejection(outcome.reason)
    useAppStore.getState().openSettings()
    return
  }
  useAppStore.getState().askConfirm({ kind: 'importWorkspace', prepared: outcome.prepared })
}
