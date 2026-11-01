import * as z from 'zod'

// Trusted server-side authorization output, never parsed from MCP arguments.
// The bearer authorizer builds this only from the checked resolver's output.
const accessSchema = z.object({
  connectionId: z.uuid(),
  userId: z.uuid(),
  projectId: z.uuid(),
  approved: z.boolean(),
  isMember: z.boolean(),
  mcpEnabled: z.boolean(),
  projectArchived: z.boolean(),
  revoked: z.boolean(),
}).strict()

export type ConnectionAccess = z.infer<typeof accessSchema>
export type Authorize = (request: Request) => Promise<ConnectionAccess | null>

export const denyAccess: Authorize = async () => null

export function permittedAccess(value: unknown): Readonly<ConnectionAccess> | null {
  const result = accessSchema.safeParse(value)
  if (!result.success) return null
  const access = result.data
  if (!access.approved || !access.isMember || !access.mcpEnabled
    || access.projectArchived || access.revoked) return null
  return Object.freeze(access)
}
