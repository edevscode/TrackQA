import * as z from 'zod'
import type { ConnectionAccess } from './access.ts'
import { DatabaseError, diagnostic } from './database-rpc.ts'
import type { DatabaseRpc, Diagnose, RpcOperation } from './database-rpc.ts'
import { ISSUE_STATUSES } from './mock-data.ts'
import type { DataAccess, IssueQuery } from './mock-data.ts'
import { findingInput, findingReceipt } from './findings.ts'

const projectSchema = z.object({ id: z.uuid(), name: z.string(), key: z.string() }).strict()
const summarySchema = z.object({
  id: z.uuid(), project_id: z.uuid(), issue_number: z.number().int().min(-2_147_483_648).max(2_147_483_647),
  title: z.string(), status: z.enum(ISSUE_STATUSES), priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
}).strict()
const issueSchema = summarySchema.extend({ description: z.string() }).strict()
const querySchema = z.object({
  limit: z.number().int().min(1).max(50), offset: z.number().int().min(0).max(10_000),
  status: z.enum(ISSUE_STATUSES).optional(),
}).strict()

// The hash and verified scope are captured in a private request-local closure.
// There are no credential properties or caller-controlled RPC/query endpoints.
export function createDatabaseDataAccess(rpc: DatabaseRpc, hash: string, access: Readonly<ConnectionAccess>, diagnose?: Diagnose): DataAccess {
  const projectId = access.projectId
  function fail(operation: RpcOperation, code: 'input' | 'scope' | 'invalid_response'): never {
    const error = new DatabaseError(code)
    diagnostic(diagnose, operation, error)
    throw error
  }
  function scope(id: string, operation: RpcOperation) {
    if (!/^[0-9a-f]{64}$/.test(hash) || !z.uuid().safeParse(projectId).success || id !== projectId) fail(operation, 'scope')
  }
  function rows<T>(value: unknown, schema: z.ZodType<T>, maximum: number, operation: RpcOperation): T[] {
    const result = z.array(schema).max(maximum).safeParse(value)
    if (!result.success) fail(operation, 'invalid_response')
    return result.data
  }
  return {
    async submitFinding(input) {
      const operation = 'mcp_submit_finding'
      scope(input.project_id, operation)
      const parsed = findingInput.safeParse(input)
      if (!parsed.success) fail(operation, 'input')
      const value = parsed.data
      const result = rows(await rpc(operation, {
        p_token_hash: hash, p_project_id: projectId, p_submission_id: value.submission_id,
        p_title: value.title, p_description: value.description, p_severity: value.severity,
        p_file_path: value.file_path ?? null, p_line_start: value.line_start ?? null,
        p_line_end: value.line_end ?? null, p_evidence_excerpt: value.evidence_excerpt ?? null,
      }), findingReceipt, 1, operation)
      if (result.length !== 1) fail(operation, 'invalid_response')
      if (result[0].project_id !== projectId) fail(operation, 'scope')
      return result[0]
    },
    async getProject(id) {
      const operation = 'mcp_list_projects'
      scope(id, operation)
      const projects = rows(await rpc(operation, { p_token_hash: hash }), projectSchema, 1, operation)
      if (projects.some((project) => project.id !== projectId)) fail(operation, 'scope')
      return projects[0] ?? null
    },
    async listIssues(id, query: IssueQuery) {
      const operation = 'mcp_list_issues'
      scope(id, operation)
      const input = querySchema.safeParse(query)
      if (!input.success) fail(operation, 'input')
      const { limit, offset, status } = input.data
      const issues = rows(await rpc(operation, {
        p_token_hash: hash, p_limit: limit, p_offset: offset, p_status: status ?? null,
      }), summarySchema, limit, operation)
      if (issues.some((issue) => issue.project_id !== projectId || (status !== undefined && issue.status !== status))) fail(operation, 'scope')
      const next = offset + limit
      // SQL has no total/has_more field. A following full-page request may be empty.
      return { issues, nextOffset: issues.length === limit && next <= 10_000 ? next : null }
    },
    async getIssue(id, issueId) {
      const operation = 'mcp_get_issue'
      scope(id, operation)
      if (!z.uuid().safeParse(issueId).success) fail(operation, 'input')
      const issues = rows(await rpc(operation, { p_token_hash: hash, p_issue_id: issueId }), issueSchema, 1, operation)
      if (issues.some((issue) => issue.project_id !== projectId || issue.id !== issueId)) fail(operation, 'scope')
      return issues[0] ?? null
    },
  }
}
