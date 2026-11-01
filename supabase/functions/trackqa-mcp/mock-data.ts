import type { FindingInput, FindingReceipt } from './findings.ts'

export const ISSUE_STATUSES = ['OPEN', 'IN_PROGRESS', 'FOR_TESTING', 'PASSED', 'FAILED', 'DONE'] as const
export type IssueStatus = typeof ISSUE_STATUSES[number]

export interface Project {
  id: string
  name: string
  key: string
}

export interface Issue {
  id: string
  project_id: string
  issue_number: number
  title: string
  description: string
  status: IssueStatus
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
}

export type IssueSummary = Omit<Issue, 'description'>
export interface IssueQuery { limit: number; offset: number; status?: IssueStatus }
export interface DataAccess {
  getProject(projectId: string): Promise<Project | null>
  listIssues(projectId: string, query: IssueQuery): Promise<{ issues: IssueSummary[]; nextOffset: number | null }>
  getIssue(projectId: string, issueId: string): Promise<Issue | null>
  submitFinding?(input: FindingInput): Promise<FindingReceipt>
}

export const MOCK_PROJECT_ID = '11111111-1111-4111-8111-111111111111'
export const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222'
export const MOCK_ISSUE_ID = '33333333-3333-4333-8333-333333333333'
export const OTHER_ISSUE_ID = '55555555-5555-4555-8555-555555555555'

const projects: readonly Readonly<Project>[] = Object.freeze([
  Object.freeze({ id: MOCK_PROJECT_ID, name: 'Synthetic checkout project', key: 'DEMO' }),
  Object.freeze({ id: OTHER_PROJECT_ID, name: 'Synthetic account project', key: 'OTHER' }),
])
const issues: readonly Readonly<Issue>[] = Object.freeze([
  Object.freeze({
    id: MOCK_ISSUE_ID, project_id: MOCK_PROJECT_ID, issue_number: 1,
    title: 'Synthetic checkout button issue', description: 'Mock report for protocol tests only.',
    status: 'OPEN', priority: 'HIGH',
  }),
  Object.freeze({
    id: '44444444-4444-4444-8444-444444444444', project_id: MOCK_PROJECT_ID, issue_number: 2,
    title: 'Synthetic receipt layout issue', description: 'A second mock report for pagination tests.',
    status: 'IN_PROGRESS', priority: 'MEDIUM',
  }),
  Object.freeze({
    id: OTHER_ISSUE_ID, project_id: OTHER_PROJECT_ID, issue_number: 1,
    title: 'Synthetic account settings issue', description: 'This report belongs to another mock project.',
    status: 'FOR_TESTING', priority: 'LOW',
  }),
])

// No Supabase client, credentials, filesystem access or network calls.
export function createMockDataAccess(): DataAccess {
  return {
    async getProject(projectId) {
      const project = projects.find((row) => row.id === projectId)
      return project ? { ...project } : null
    },
    async listIssues(projectId, query) {
      const matching = issues.filter((row) => row.project_id === projectId
        && (!query.status || row.status === query.status))
      const page = matching.slice(query.offset, query.offset + query.limit)
      return {
        issues: page.map(({ description: _description, ...summary }) => ({ ...summary })),
        nextOffset: query.offset + page.length < matching.length ? query.offset + page.length : null,
      }
    },
    async getIssue(projectId, issueId) {
      const issue = issues.find((row) => row.project_id === projectId && row.id === issueId)
      return issue ? { ...issue } : null
    },
  }
}
