import type { DeadlineInput } from './deadlines'
import type { IssuePriority } from './database.types'

// Tab-memory only. Project changes/navigation retain each project's own draft;
// reload and account changes discard them. No object URLs are allocated here.
export interface IssueDraft extends DeadlineInput {
  title: string
  description: string
  steps: string
  expected: string
  actual: string
  priority: IssuePriority
  assigneeId: string
  device: string
  browser: string
  appVersion: string
  pendingFiles: readonly File[]
}

type Draft = Readonly<Partial<IssueDraft> & { projectId?: string }>
const empty: Draft = Object.freeze({})
const drafts = new Map<string, Draft>()

export function getIssueDraft(projectId: string): Draft {
  return drafts.get(projectId) ?? empty
}

export function setIssueDraft(projectId: string, next: Partial<IssueDraft>) {
  drafts.set(projectId, Object.freeze({ ...drafts.get(projectId), ...next, projectId,
    ...(next.end_of_day && { end_of_day: Object.freeze({ ...next.end_of_day }) }),
    ...(next.pendingFiles && { pendingFiles: Object.freeze([...next.pendingFiles]) }),
  }))
}

// The optional snapshot prevents a late save from erasing a newer draft.
// No project argument is the existing account-change/sign-out cleanup contract.
export function clearIssueDraft(projectId?: string, expected?: Draft) {
  if (projectId === undefined) drafts.clear()
  else if (!expected || drafts.get(projectId) === expected) drafts.delete(projectId)
}
