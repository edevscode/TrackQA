import type { ProjectInvitation } from './database.types'

export type InvitationWithProject = ProjectInvitation & {
  projects: { name: string; key: string; owner: { full_name: string | null; email: string } | null } | null
  inviter: { full_name: string | null; email: string } | null
}

export const invitationLoadMessage = 'Unable to load invitations. Check your connection and try again.'

export async function loadPendingInvitations(email: string, request: (email: string) => PromiseLike<{
  data: InvitationWithProject[] | null; error: unknown
}>): Promise<InvitationWithProject[]> {
  try {
    if (!email.trim()) throw new Error()
    const { data, error } = await request(email.trim().toLowerCase())
    // Only a successful empty array means there are no invitations.
    if (error || !Array.isArray(data)) throw new Error()
    return data
  } catch { throw new Error(invitationLoadMessage) }
}
