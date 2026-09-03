import type { IssuePriority } from './database.types'

// Lives at module scope, not component state, so it survives client-side
// navigation away from and back to the Report Issue form. A real browser
// refresh re-evaluates this module and resets it to {}, which is the
// intended "discard on refresh" behavior.
export interface IssueDraft {
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
}

let draft: Partial<IssueDraft> = {}

export function getIssueDraft(): Partial<IssueDraft> {
  return draft
}

export function setIssueDraft(next: Partial<IssueDraft>) {
  draft = { ...draft, ...next }
}

export function clearIssueDraft() {
  draft = {}
}
