import { useState } from 'react'
import type { ProjectRole } from '../lib/database.types'
import ConfirmModal from './ConfirmModal'

const roleLabels: Record<ProjectRole, string> = {
  OWNER: 'Owner', DEVELOPER: 'Developer', QA: 'QA tester',
}
const roleDescriptions: Record<ProjectRole, string> = {
  OWNER: 'Owners can manage members, roles, and project settings, and retain owner issue permissions.',
  DEVELOPER: 'Developers work on assigned issues and submit them for testing. They cannot create new reports.',
  QA: 'QA testers create reports and verify their own reported issues. They cannot perform development actions.',
}

type Props = {
  member: { role: ProjectRole; full_name: string | null; email: string }
  projectName: string
  onSave: (previousRole: ProjectRole, nextRole: ProjectRole) => Promise<string | null>
}

export default function MemberRoleControl({ member, projectName, onSave }: Props) {
  const [open, setOpen] = useState(false)
  const [previousRole, setPreviousRole] = useState(member.role)
  const [nextRole, setNextRole] = useState(member.role)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = member.full_name ?? member.email
  const changedElsewhere = member.role !== previousRole

  const close = () => { if (!saving) setOpen(false) }
  const save = async () => {
    if (saving || nextRole === previousRole || changedElsewhere) return
    setSaving(true)
    setError(null)
    try {
      const message = await onSave(previousRole, nextRole)
      if (message) setError(message)
      else setOpen(false)
    } catch {
      setError('Unable to change this role. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Change role for ${name}`}
        onClick={() => {
          setPreviousRole(member.role)
          setNextRole(member.role)
          setError(null)
          setOpen(true)
        }}
        className="inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded border border-outline-variant px-sm py-xs text-label-md font-medium text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus-visible:outline-2"
      >
        Change role
      </button>
      <ConfirmModal
        open={open}
        onClose={close}
        onConfirm={save}
        title="Change member role"
        confirmLabel="Confirm role change"
        variant="primary"
        isLoading={saving}
        confirmDisabled={nextRole === previousRole || changedElsewhere}
        description={(
          <div className="space-y-sm">
            <p className="break-words font-semibold text-on-surface">{name}</p>
            {member.full_name && <p className="break-words">{member.email}</p>}
            <p>Project: {projectName}</p>
            <p>Current role: <strong>{roleLabels[previousRole]}</strong></p>
            <label className="block">
              <span className="mb-xs block font-medium">New role</span>
              <select
                value={nextRole}
                onChange={(event) => { setNextRole(event.target.value as ProjectRole); setError(null) }}
                disabled={saving || changedElsewhere}
                className="w-full rounded border border-outline-variant bg-surface-container-lowest px-sm py-xs text-on-surface focus-visible:outline-2 disabled:opacity-60"
              >
                <option value="DEVELOPER">Developer</option>
                <option value="QA">QA tester</option>
                <option value="OWNER">Owner</option>
              </select>
            </label>
            <p>{roleDescriptions[nextRole]}</p>
            {nextRole !== previousRole && <p className="font-medium text-on-surface">{roleLabels[previousRole]} → {roleLabels[nextRole]}</p>}
            {changedElsewhere && <p role="alert" className="text-error">This member’s role has changed. Close this dialog and review their current role before trying again.</p>}
            {error && <p role="alert" className="text-error">{error}</p>}
          </div>
        )}
      />
    </>
  )
}
