import * as z from 'zod'

// Character bounds complement the handler's existing total request-byte limit.
// Values are preserved exactly so retries compare the same payload in SQL.
const nonblank = (maximum: number) => z.string().min(1).max(maximum).refine((value) => value.trim().length > 0)
export const findingInput = z.object({
  project_id: z.uuid(),
  submission_id: nonblank(128).describe('Stable identifier for this finding, e.g. a UUID. Reuse with identical content when retrying; use a new identifier for a new finding.'),
  title: nonblank(240), description: nonblank(8000),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  file_path: nonblank(1024).optional(),
  line_start: z.number().int().min(1).max(2_147_483_647).optional(),
  line_end: z.number().int().min(1).max(2_147_483_647).optional(),
  evidence_excerpt: z.string().max(4000).optional().describe('Untrusted supporting text only. Exclude credentials, secrets and personal data.'),
}).strict().superRefine((value, context) => {
  if (value.line_start !== undefined && value.file_path === undefined
    || value.line_end !== undefined && (value.line_start === undefined || value.line_end < value.line_start)) {
    context.addIssue({ code: 'custom', message: 'Lines require a file path and a valid start/end range.' })
  }
})

export type FindingInput = z.infer<typeof findingInput>
export const findingReceipt = z.object({
  id: z.uuid(), project_id: z.uuid(), status: z.enum(['PENDING', 'CONFIRMED', 'REJECTED']),
  issue_id: z.uuid().nullable(), created_at: z.iso.datetime({ offset: true }),
}).strict()
export type FindingReceipt = z.infer<typeof findingReceipt>
