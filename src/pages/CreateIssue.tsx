import {
  ChevronRight,
  ChevronsUp,
  ChevronUp,
  Equal,
  ChevronDown,
  FileText,
  Save,
  UploadCloud,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
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
    iconClass: 'text-rose-600',
    checkedClass: 'border-rose-600 bg-rose-50 text-rose-900 ring-2 ring-rose-600/20 font-semibold',
  },
  {
    value: 'HIGH',
    label: 'High',
    icon: ChevronUp,
    iconClass: 'text-amber-600',
    checkedClass: 'border-amber-600 bg-amber-50 text-amber-900 ring-2 ring-amber-600/20 font-semibold',
  },
  {
    value: 'MEDIUM',
    label: 'Medium',
    icon: Equal,
    iconClass: 'text-slate-600',
    checkedClass: 'border-primary bg-primary-fixed/30 text-primary ring-2 ring-primary/20 font-semibold',
  },
  {
    value: 'LOW',
    label: 'Low',
    icon: ChevronDown,
    iconClass: 'text-slate-400',
    checkedClass: 'border-slate-400 bg-surface-container text-on-surface-variant font-semibold',
  },
]

const inputClass =
  'w-full rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-md text-on-surface outline-none placeholder:text-outline focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all'

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
        // Continue silently if single attachment fails; can be re-uploaded on detail
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

      <div className="flex flex-1 flex-col min-w-0">
        <TopBar />

        <main className="flex-1 px-md py-md lg:px-lg lg:py-lg">
          {/* Header Strip */}
          <div className="mb-lg flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between border-b border-outline-variant pb-md">
            <div>
              <div className="mb-xs flex items-center gap-xs text-body-md text-on-surface-variant">
                <Link to="/issues" className="hover:text-primary transition-colors">
                  Issues
                </Link>
                <ChevronRight size={14} />
                <span className="font-semibold text-on-surface">Log Issue</span>
              </div>
              <h1 className="text-headline-xl font-bold tracking-tight text-on-surface">
                Report QA Issue
              </h1>
            </div>

            <div className="flex items-center gap-xs sm:gap-sm">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-md font-medium text-on-surface hover:bg-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="issue-form"
                disabled={submitting}
                className="inline-flex items-center gap-xs rounded-md bg-primary px-md py-sm text-body-md font-semibold text-on-primary hover:bg-primary-container transition-colors disabled:opacity-60"
              >
                <Save size={16} />
                <span>{submitting ? 'Recording Issue…' : 'Save & File Issue'}</span>
              </button>
            </div>
          </div>

          {error && (
            <div className="mb-lg rounded-md border border-error/30 bg-error-container px-md py-sm text-body-md font-medium text-on-error-container">
              {error}
            </div>
          )}

          <form id="issue-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-lg lg:grid-cols-12">
            {/* Left Column: Issue Blueprint & Repro (lg:col-span-8) */}
            <div className="flex flex-col gap-lg lg:col-span-8">
              {/* Issue Summary */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
                <div className="border-b border-outline-variant px-lg py-sm text-headline-md font-semibold text-on-surface">
                  Issue Summary
                </div>
                <div className="flex flex-col gap-md p-lg">
                  <div>
                    <label htmlFor="title" className="mb-xs block text-label-md font-semibold text-on-surface">
                      Summary Title <span className="text-error">*</span>
                    </label>
                    <input
                      id="title"
                      type="text"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g., Checkbox state does not persist on project settings reload"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="description" className="mb-xs block text-label-md font-semibold text-on-surface">
                      Detailed Context &amp; Scope
                    </label>
                    <textarea
                      id="description"
                      rows={4}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Provide full context, affected customer impact, or related dependencies..."
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>

              {/* Steps to Reproduce */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
                <div className="border-b border-outline-variant px-lg py-sm text-headline-md font-semibold text-on-surface">
                  Steps to Reproduce
                </div>
                <div className="flex flex-col gap-md p-lg">
                  <div>
                    <label htmlFor="steps" className="mb-xs block text-label-md font-semibold text-on-surface">
                      Steps to Reproduce
                    </label>
                    <textarea
                      id="steps"
                      rows={4}
                      value={steps}
                      onChange={(e) => setSteps(e.target.value)}
                      placeholder={'1. Navigate to Project Settings\n2. Toggle "Public Join Code"\n3. Hard reload browser (Cmd+Shift+R)\n4. Observe switch state'}
                      className={`${inputClass} font-mono text-code-sm`}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-md md:grid-cols-2">
                    <div>
                      <label htmlFor="expected" className="mb-xs block text-label-md font-semibold text-on-surface">
                        Expected Result
                      </label>
                      <textarea
                        id="expected"
                        rows={3}
                        value={expected}
                        onChange={(e) => setExpected(e.target.value)}
                        placeholder="State should remain enabled after reload..."
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="actual" className="mb-xs block text-label-md font-semibold text-on-surface">
                        Actual Result
                      </label>
                      <textarea
                        id="actual"
                        rows={3}
                        value={actual}
                        onChange={(e) => setActual(e.target.value)}
                        placeholder="Switch resets to disabled state without error toast..."
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Evidence & Attachments */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
                <div className="border-b border-outline-variant px-lg py-sm text-headline-md font-semibold text-on-surface">
                  Evidence &amp; Artifacts
                </div>
                <div className="flex flex-col gap-md p-lg">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                    className="cursor-pointer rounded-md border-2 border-dashed border-outline-variant p-lg text-center transition-colors hover:border-primary/40 hover:bg-surface-container-low"
                  >
                    <UploadCloud className="mx-auto mb-xs text-outline" size={32} />
                    <p className="mb-xs text-body-md font-semibold text-on-surface">
                      Drop screenshots, HAR logs, or test recordings
                    </p>
                    <p className="text-label-md text-on-surface-variant">
                      Images, MP4, WebM, or text traces up to 50MB
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
                          className="flex items-center gap-sm rounded-md border border-outline-variant p-sm bg-surface-container-low"
                        >
                          <FileText className="shrink-0 text-primary" size={18} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-body-md font-medium text-on-surface">
                              {file.name}
                            </p>
                            <span className="font-mono text-code-xs text-on-surface-variant">
                              {formatBytes(file.size)}
                            </span>
                          </div>
                          <button
                            type="button"
                            aria-label="Remove file"
                            onClick={() => removePendingFile(i)}
                            className="shrink-0 rounded p-xs text-on-surface-variant hover:bg-error-container hover:text-on-error-container transition-colors"
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

            {/* Right Column: Classification & Environment (lg:col-span-4) */}
            <div className="flex flex-col gap-lg lg:col-span-4">
              {/* Classification */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
                <div className="border-b border-outline-variant px-lg py-sm text-headline-md font-semibold text-on-surface">
                  Classification
                </div>
                <div className="flex flex-col gap-md p-lg">
                  <div>
                    <span className="mb-xs block text-label-md font-semibold text-on-surface">
                      Severity Priority
                    </span>
                    <div className="grid grid-cols-2 gap-xs">
                      {priorities.map(({ value, label, icon: Icon, iconClass, checkedClass }) => {
                        const isSelected = priority === value
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setPriority(value)}
                            className={`flex items-center justify-center gap-xs rounded-md border p-sm text-body-md transition-colors ${
                              isSelected
                                ? checkedClass
                                : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container-low'
                            }`}
                          >
                            <Icon className={iconClass} size={16} />
                            <span>{label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="assignee" className="mb-xs block text-label-md font-semibold text-on-surface">
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
                    <span className="mb-xs block text-label-md font-semibold text-on-surface">
                      Target Project
                    </span>
                    <div className="rounded-md border border-outline-variant bg-surface-container-low px-md py-sm flex items-center justify-between">
                      <span className="text-body-md font-semibold text-on-surface">
                        {currentProject?.name}
                      </span>
                      <span className="font-mono text-code-xs font-bold text-primary">
                        [{currentProject?.key}]
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Environment Manifest */}
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
                <div className="border-b border-outline-variant px-lg py-sm text-headline-md font-semibold text-on-surface">
                  Environment Manifest
                </div>
                <div className="flex flex-col gap-md p-lg">
                  <div>
                    <label htmlFor="device" className="mb-xs block text-label-md font-semibold text-on-surface">
                      Device / OS Spec
                    </label>
                    <input
                      id="device"
                      type="text"
                      value={device}
                      onChange={(e) => setDevice(e.target.value)}
                      placeholder="e.g. macOS Sonoma 14.4 / MacBook Pro M2"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="browser" className="mb-xs block text-label-md font-semibold text-on-surface">
                      Browser / Runtime
                    </label>
                    <input
                      id="browser"
                      type="text"
                      value={browser}
                      onChange={(e) => setBrowser(e.target.value)}
                      placeholder="e.g. Chrome 124.0.6367.91"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="app_version" className="mb-xs block text-label-md font-semibold text-on-surface">
                      App Build / Release Tag
                    </label>
                    <input
                      id="app_version"
                      type="text"
                      value={appVersion}
                      onChange={(e) => setAppVersion(e.target.value)}
                      placeholder="e.g. v2.8.0-rc.3"
                      className={`${inputClass} font-mono text-code-sm`}
                    />
                  </div>
                </div>
              </div>
            </div>
          </form>
        </main>
      </div>
    </div>
  )
}

export default CreateIssue
