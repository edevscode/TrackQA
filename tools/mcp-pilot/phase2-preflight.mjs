import { FIXTURE_PROJECT_ID } from './owner-auth.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const projectRoute = `/rest/v1/projects?id=eq.${FIXTURE_PROJECT_ID}&select=id,name,key,owner_id,mcp_enabled,archived&limit=2`

export class Phase2PreflightError extends Error {
  constructor(code) {
    super('Synthetic pilot preflight did not pass.')
    this.safeCode = code
  }
}
function requireCheck(value, code) { if (!value) throw new Phase2PreflightError(code) }
function requireFixture(rows) {
  requireCheck(Array.isArray(rows) && rows.length === 1
    && rows[0]?.id === FIXTURE_PROJECT_ID && rows[0].name === 'MCP Synthetic Pilot'
    && rows[0].key === 'MCPPILOT', 'fixture_unavailable')
  return rows[0]
}

// This uses the existing authenticated human API, so visibility is subject to
// the Owner's RLS. Never infer global project counts or enablement from it.
// The separate administrative preflight/postcheck remains authoritative for
// all-project MCP state; this function cannot substitute for that check.
export async function verifyOwnerPilotProject(api, expectedOwnerId) {
  try {
    const user = await api('/auth/v1/user')
    requireCheck(UUID.test(expectedOwnerId) && user?.id === expectedOwnerId, 'owner_identity_mismatch')
    const project = requireFixture(await api(projectRoute))
    requireCheck(project.owner_id === user.id, 'fixture_owner_mismatch')
    const members = await api(`/rest/v1/project_members?project_id=eq.${FIXTURE_PROJECT_ID}&user_id=eq.${user.id}&select=user_id,role&limit=2`)
    requireCheck(Array.isArray(members) && members.length === 1
      && members[0]?.user_id === user.id && members[0].role === 'OWNER', 'owner_membership_required')
    requireCheck(project.mcp_enabled === false && project.archived === false, 'fixture_state_changed')
    return { userId: user.id, projectId: project.id, fixtureDisabled: true }
  } catch (error) {
    throw error instanceof Phase2PreflightError ? error : new Phase2PreflightError('owner_fixture_verification_failed')
  }
}

// Cleanup verifies the exact fixture through the Owner's API. Global disablement
// is checked separately through the existing read-only administrative mechanism.
export async function verifyPilotProjectDisabled(api) {
  try {
    const project = requireFixture(await api(projectRoute))
    requireCheck(project.mcp_enabled === false, 'fixture_disablement_failed')
    return { projectId: project.id, fixtureDisabled: true }
  } catch (error) {
    throw error instanceof Phase2PreflightError ? error : new Phase2PreflightError('fixture_disablement_verification_failed')
  }
}
