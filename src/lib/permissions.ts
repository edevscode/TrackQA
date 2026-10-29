import type { ProjectRole } from './database.types'

export function canReportIssues(role: ProjectRole | null | undefined): boolean {
  return role === 'QA' || role === 'OWNER'
}

export function canDevelopIssues(role: ProjectRole | null | undefined): boolean {
  return role === 'DEVELOPER' || role === 'OWNER'
}
