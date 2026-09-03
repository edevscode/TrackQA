import {
  ChevronDown,
  ChevronRight,
  ChevronsUp,
  ChevronUp,
  Equal,
  FileText,
  Save,
  UploadCloud,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { MAX_UPLOAD_BYTES, uploadToCloudinary } from '../lib/cloudinary'
import { supabase } from '../lib/supabase'
import type { IssuePriority } from '../lib/database.types'
import { clearIssueDraft, getIssueDraft, setIssueDraft } from '../lib/issueDraftStore'
import { invalidateProjectCache } from '../lib/cache'

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const priorities: {
  value: IssuePriority
  label: string
  icon: typeof ChevronsUp
  iconClass: string
  checkedClass: string
}[] = [
  {
    value: 'CRITICAL',
    label: 'Critical',
    icon: ChevronsUp,
    iconClass: 'text-error',
    checkedClass: 'peer-checked:border-error peer-checked:bg-error-container peer-checked:text-on-error-container',
  },
  {
    value: 'HIGH',
    label: 'High',
    icon: ChevronUp,
    iconClass: 'text-orange-600',
    checkedClass: 'peer-checked:border-orange-600 peer-checked:bg-orange-50 peer-checked:text-orange-900',
  },
  {
    value: 'MEDIUM',
    label: 'Medium',
    icon: Equal,
    iconClass: 'text-amber-600',
    checkedClass: 'peer-checked:border-amber-600 peer-checked:bg-amber-50 peer-checked:text-amber-900',
  },
  {
    value: 'LOW',
    label: 'Low',
    icon: ChevronDown,
    iconClass: 'text-emerald-600',
    checkedClass: 'peer-checked:border-emerald-600 peer-checked:bg-emerald-50 peer-checked:text-emerald-900',
  },
]

const inputClass =
  'w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-lg text-on-surface outline-none placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/30'

type Member = { user_id: string; full_name: string | null }

function CreateIssue() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { currentProject } = useProject()

  const draft = getIssueDraft()

  const [members, setMembers] = useState<Member[]>([])
  const [title, setTitle] = useState(draft.title ?? '')
  const [description, setDescription] = useState(draft.description ?? '')
  const [steps, setSteps] = useState(draft.steps ?? '')
  const [expected, setExpected] = useState(draft.expected ?? '')
  const [actual, setActual] = useState(draft.actual ?? '')
  const [priority, setPriority] = useState<IssuePriority>(draft.priority ?? 'HIGH')
  const [assigneeId, setAssigneeId] = useState(draft.assigneeId ?? '')
  const [device, setDevice] = useState(draft.device ?? '')
  const [browser, setBrowser] = useState(draft.browser ?? '')
  const [appVersion, setAppVersion] = useState(draft.appVersion ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  // Persisted to module-level state (not localStorage) so it survives
  // client-side navigation but is discarded on an actual page refresh.
  useEffect(() => {
    setIssueDraft({
      title,
      description,
      steps,
      expected,
      actual,
      priority,
      assigneeId,
      device,
      browser,
      appVersion,
    })
  }, [title, description, steps, expected, actual, priority, assigneeId, device, browser, appVersion])

  useEffect(() => {
    if (!currentProject) return
    supabase
      .from('project_members')
      .select('user_id, profiles(full_name)')
      .eq('project_id', currentProject.id)
      .then(({ data }) => {
        setMembers(
          (data ?? []).map((m) => ({
            user_id: m.user_id,
            full_name: (m as unknown as { profiles: { full_name: string | null } }).profiles
              ?.full_name,
          })),
        )
      })
  }, [currentProject])

  const addFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const incoming = Array.from(fileList)
    const oversized = incoming.some((f) => f.size > MAX_UPLOAD_BYTES)
    setAttachmentError(oversized ? 'Some files exceed the 50MB limit and were skipped.' : null)
    setPendingFiles((prev) => [...prev, ...incoming.filter((f) => f.size <= MAX_UPLOAD_BYTES)])
  }

  const handleFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files)
    e.target.value = ''
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    addFiles(e.dataTransfer.files)
  }

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!currentProject || !user) return

    setSubmitting(true)
    setError(null)

    const { data, error: insertError } = await supabase
      .from('issues')
      .insert({
        project_id: currentProject.id,
        title,
        description: description || null,
        steps_to_reproduce: steps || null,
        expected_result: expected || null,
        actual_result: actual || null,
        environment_device: device || null,
        environment_browser: browser || null,
        environment_app_version: appVersion || null,
        priority,
        assignee_id: assigneeId || null,
      })
      .select('id')
      .single()

    if (insertError) {
      setError(insertError.message)
      setSubmitting(false)
      return
    }

    for (const file of pendingFiles) {
      try {
        const result = await uploadToCloudinary(file, `trackqa/issues/${data.id}`)
        await supabase.from('issue_attachments').insert({
          issue_id: data.id,
          uploaded_by: user.id,
          storage_path: result.url,
          file_name: file.name,
          mime_type: file.type || null,
          file_size_bytes: result.bytes,
        })
      } catch {
        // The issue itself was already created; a failed attachment can be
        // retried from the issue detail page's Attachments card.
      }
    }

    clearIssueDraft()
    invalidateProjectCache(currentProject.id)
    navigate(`/issues/${data.id}`)
  }

  const handleCancel = () => {
    clearIssueDraft()
    navigate('/issues')
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="mx-auto w-full max-w-[1280px] flex-1 px-lg py-lg">
        <div className="mb-lg flex items-start justify-between gap-md">
          <div>
            <div className="mb-xs flex items-center gap-xs text-body-md text-on-surface-variant">
              <Link to="/issues" className="hover:text-primary">
                Issues
              </Link>
              <ChevronRight size={16} />
              <span className="text-on-surface">Report Issue</span>
            </div>
            <h1 className="text-headline-xl font-bold text-on-surface">
              Report New Issue
            </h1>
          </div>
          <div className="flex shrink-0 gap-sm">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-label-md font-semibold text-on-surface hover:bg-surface-container-low"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="issue-form"
              disabled={submitting}
              className="flex items-center gap-xs rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary shadow-raised hover:bg-primary-container disabled:opacity-60"
            >
              <Save size={18} />
              {submitting ? 'Creating…' : 'Create Issue'}
            </button>
          </div>
        </div>

        {error && (
          <p className="mb-md rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
            {error}
          </p>
        )}

        <form id="issue-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-lg lg:grid-cols-3">
          <div className="flex flex-col gap-lg lg:col-span-2">
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest shadow-raised">
              <div className="border-b border-outline-variant px-md py-sm text-headline-md font-semibold text-on-surface">
                Issue Details
              </div>
              <div className="flex flex-col gap-md p-md">
                <div>
                  <label htmlFor="title" className="mb-sm block text-label-md text-on-surface-variant">
                    Issue Title <span className="text-error">*</span>
                  </label>
                  <input
                    id="title"
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Login button unresponsive on mobile safari"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="description" className="mb-sm block text-label-md text-on-surface-variant">
                    Description
                  </label>
                  <textarea
                    id="description"
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Provide a detailed description of the issue..."
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest shadow-raised">
              <div className="border-b border-outline-variant px-md py-sm text-headline-md font-semibold text-on-surface">
                Reproduction
              </div>
              <div className="flex flex-col gap-md p-md">
                <div>
                  <label htmlFor="steps" className="mb-sm block text-label-md text-on-surface-variant">
                    Steps to Reproduce
                  </label>
                  <textarea
                    id="steps"
                    rows={3}
                    value={steps}
                    onChange={(e) => setSteps(e.target.value)}
                    placeholder={'1. Go to...\n2. Click on...\n3. Observe...'}
                    className={`${inputClass} font-mono text-code-sm`}
                  />
                </div>
                <div className="grid grid-cols-1 gap-md md:grid-cols-2">
                  <div>
                    <label htmlFor="expected" className="mb-sm block text-label-md text-on-surface-variant">
                      Expected Result
                    </label>
                    <textarea
                      id="expected"
                      rows={2}
                      value={expected}
                      onChange={(e) => setExpected(e.target.value)}
                      placeholder="What should happen?"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="actual" className="mb-sm block text-label-md text-on-surface-variant">
                      Actual Result
                    </label>
                    <textarea
                      id="actual"
                      rows={2}
                      value={actual}
                      onChange={(e) => setActual(e.target.value)}
                      placeholder="What actually happens?"
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest shadow-raised">
              <div className="border-b border-outline-variant px-md py-sm text-headline-md font-semibold text-on-surface">
                Attachments
              </div>
              <div className="flex flex-col gap-sm p-md">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  className="cursor-pointer rounded-lg border-2 border-dashed border-outline-variant p-xl text-center transition-colors hover:bg-surface-container-low"
                >
                  <UploadCloud className="mx-auto mb-sm text-outline" size={40} />
                  <p className="mb-xs text-body-md text-on-surface-variant">
                    Drag and drop files here, or click to select
                  </p>
                  <p className="text-label-md text-outline">
                    Images, videos, and documents (Max 50MB each)
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFilesSelected}
                  />
                </div>

                {attachmentError && (
                  <p className="text-body-md text-error">{attachmentError}</p>
                )}

                {pendingFiles.length > 0 && (
                  <div className="flex flex-col gap-xs">
                    {pendingFiles.map((file, i) => (
                      <div
                        key={`${file.name}-${i}`}
                        className="flex items-center gap-sm rounded-md border border-outline-variant p-sm"
                      >
                        <FileText className="shrink-0 text-on-surface-variant" size={18} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-body-md text-on-surface">
                            {file.name}
                          </div>
                          <div className="text-[12px] text-on-surface-variant">
                            {formatBytes(file.size)}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label="Remove file"
                          onClick={() => removePendingFile(i)}
                          className="shrink-0 rounded-sm p-xs text-on-surface-variant hover:bg-error-container hover:text-on-error-container"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-lg">
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest shadow-raised">
              <div className="border-b border-outline-variant px-md py-sm text-headline-md font-semibold text-on-surface">
                Classification
              </div>
              <div className="flex flex-col gap-md p-md">
                <div>
                  <span className="mb-sm block text-label-md text-on-surface-variant">
                    Priority
                  </span>
                  <div className="grid grid-cols-2 gap-sm">
                    {priorities.map(({ value, label, icon: Icon, iconClass, checkedClass }) => (
                      <label key={value} className="cursor-pointer">
                        <input
                          type="radio"
                          name="priority"
                          value={value}
                          checked={priority === value}
                          onChange={() => setPriority(value)}
                          className="peer sr-only"
                        />
                        <div
                          className={`flex items-center justify-center gap-xs rounded-md border border-outline-variant p-sm text-center transition-colors hover:bg-surface-container-low ${checkedClass}`}
                        >
                          <Icon className={iconClass} size={18} />
                          <span className="text-label-md">{label}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="assignee" className="mb-sm block text-label-md text-on-surface-variant">
                    Assignee
                  </label>
                  <select
                    id="assignee"
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Unassigned</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.full_name ?? 'Unnamed'}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="mb-sm block text-label-md text-on-surface-variant">
                    Project
                  </span>
                  <p className="rounded-md border border-outline-variant bg-surface-container-low px-md py-sm text-body-lg text-on-surface">
                    {currentProject?.name} ({currentProject?.key})
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest shadow-raised">
              <div className="border-b border-outline-variant px-md py-sm text-headline-md font-semibold text-on-surface">
                Environment
              </div>
              <div className="flex flex-col gap-md p-md">
                <div>
                  <label htmlFor="device" className="mb-sm block text-label-md text-on-surface-variant">
                    Device / OS
                  </label>
                  <input
                    id="device"
                    type="text"
                    value={device}
                    onChange={(e) => setDevice(e.target.value)}
                    placeholder="e.g., iPhone 13 / iOS 16"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="browser" className="mb-sm block text-label-md text-on-surface-variant">
                    Browser / Version
                  </label>
                  <input
                    id="browser"
                    type="text"
                    value={browser}
                    onChange={(e) => setBrowser(e.target.value)}
                    placeholder="e.g., Chrome 114"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="app_version" className="mb-sm block text-label-md text-on-surface-variant">
                    App Version
                  </label>
                  <input
                    id="app_version"
                    type="text"
                    value={appVersion}
                    onChange={(e) => setAppVersion(e.target.value)}
                    placeholder="e.g., v2.4.1-beta"
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateIssue
