import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { requireValue, setupFor, UUID } from '../core.ts'
import { copilotPaths, copilotRecoveryHome } from '../clients/vscode-copilot-session.ts'
import { COPILOT_FIXTURE } from './copilot-fixture-scope.ts'

// VS Code 1.143.x stores default-chat data under an encoded Copilot session URI.
// Include every known SQLite sidecar; main-file length alone is insufficient.
export const COPILOT_SQLITE_PATH_BUDGET = 240
const encodedSession = 'default-' + Buffer.from('copilotcli:/00000000-0000-4000-8000-000000000000').toString('base64url')
export const freshHostedCopilotHome = (connectorRoot: string) => {
  requireValue(path.isAbsolute(connectorRoot), 'configuration_location_untrusted')
  return path.join(connectorRoot, randomUUID())
}
export function hostedCopilotRecoveryHome(base: string, home: string) {
  requireValue(path.isAbsolute(base) && path.isAbsolute(home) && path.resolve(home).toLowerCase() !== path.resolve(base).toLowerCase(), 'configuration_home_mismatch')
  const relative = path.relative(base, home).split(path.sep)
  if (relative.length === 1 && UUID.test(relative[0])) return home
  return copilotRecoveryHome(base, home) // Previously saved runs/UUID layout only.
}
export function copilotHostedPathBudget(home: string) {
  const files = copilotPaths(home, setupFor(COPILOT_FIXTURE.id, 'vscode-copilot'))
  const database = path.join(files.user, 'agentSessionData', encodedSession, 'session.db')
  const lengths = { main: database.length, journal: (database + '-journal').length,
    wal: (database + '-wal').length, shm: (database + '-shm').length }
  requireValue(Object.values(lengths).every(length => length <= COPILOT_SQLITE_PATH_BUDGET), 'fixture_path_budget_exceeded')
  return { ...lengths, budget: COPILOT_SQLITE_PATH_BUDGET }
}
