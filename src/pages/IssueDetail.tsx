import {
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUp,
  ChevronUp,
  CircleCheck,
  ClipboardCheck,
  Code2,
  Equal,
  FileText,
  FlaskConical,
  Paperclip,
  Pencil,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../components/Avatar'
import ConfirmModal from '../components/ConfirmModal'
import Sidebar from '../components/Sidebar'
import { useAuth } from '../contexts/AuthContext'
import { useProject } from '../contexts/ProjectContext'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import { invalidateProjectCache } from '../lib/cache'
import { MAX_UPLOAD_BYTES, uploadToCloudinary } from '../lib/cloudinary'
import { supabase } from '../lib/supabase'
import type {
  ActivityAction,
  Issue,
  IssueAttachment,
  IssuePriority,
  IssueStatus,
  Project,
  ProjectRole,
  QaVerification,
  QaVerificationAttachment,
} from '../lib/database.types'

const workflowSteps: IssueStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'FOR_TESTING',
  'PASSED',
  'DONE',
]

const priorityConfig: Record<IssuePriority, { icon: typeof ChevronsUp; className: string }> = {
  CRITICAL: { icon: ChevronsUp, className: 'text-rose-600' },
  HIGH: { icon: ChevronUp, className: 'text-amber-600' },
  MEDIUM: { icon: Equal, className: 'text-outline' },
  LOW: { icon: ChevronDown, className: 'text-outline' },
}

const activityText: Partial<Record<ActivityAction, (a: TimelineActivity) => string>> = {
  CREATED: () => 'created this issue',
  ASSIGNED: () => 'assigned this issue',
  REASSIGNED: () => 'reassigned this issue',
  PRIORITY_CHANGED: (a) => `changed priority from ${a.from_value} to ${a.to_value}`,
  STATUS_CHANGED: (a) => `changed status to ${a.to_value}`,
  SUBMITTED_FOR_TESTING: () => 'submitted this issue for testing',
  QA_PASSED: () => 'marked QA as passed',
  QA_FAILED: () => 'marked QA as failed',
  MARKED_DONE: () => 'marked this issue as done',
}

type Member = {
  user_id: string
  full_name: string | null
  avatar_url?: string | null
  role: ProjectRole
}

type TimelineActivity = {
  id: string
  action: ActivityAction
  from_value: string | null
  to_value: string | null
  created_at: string
  actor: { full_name: string | null } | null
}

type TimelineComment = {
  id: string
  content: string
  created_at: string
  author: { full_name: string | null; avatar_url: string | null } | null
}

type AttachmentRow = IssueAttachment & {
  uploader: { full_name: string | null } | null
}

function isImageAttachment(mimeType: string | null) {
  return !!mimeType && mimeType.startsWith('image/')
}

function formatBytes(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function IssueDetail() {
  const { issueId } = useParams<{ issueId: string }>()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { currentProject, setCurrentProjectId } = useProject()

  const [issue, setIssue] = useState<Issue | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [reporter, setReporter] = useState<{
    full_name: string | null
    avatar_url: string | null
  } | null>(null)
  const [latestFailure, setLatestFailure] = useState<QaVerification | null>(null)
  const [latestFailureAttachments, setLatestFailureAttachments] = useState<
    QaVerificationAttachment[]
  >([])
  const [members, setMembers] = useState<Member[]>([])
  const [comments, setComments] = useState<TimelineComment[]>([])
  const [activity, setActivity] = useState<TimelineActivity[]>([])
  const [attachments, setAttachments] = useState<AttachmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [comment, setComment] = useState('')
  const [postingComment, setPostingComment] = useState(false)
  const [verification, setVerification] = useState('')
  const [verifying, setVerifying] = useState(false)
  const verificationFileInputRef = useRef<HTMLInputElement>(null)
  const [verificationFiles, setVerificationFiles] = useState<File[]>([])
  const [verificationFileError, setVerificationFileError] = useState<string | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)

  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editPriority, setEditPriority] = useState<IssuePriority>('MEDIUM')
  const [editAssigneeId, setEditAssigneeId] = useState<string>('')
  const [editDescription, setEditDescription] = useState('')
  const [editExpectedResult, setEditExpectedResult] = useState('')
  const [editActualResult, setEditActualResult] = useState('')
  const [editStepsToReproduce, setEditStepsToReproduce] = useState('')
  const [editDevice, setEditDevice] = useState('')
  const [editBrowser, setEditBrowser] = useState('')
  const [editAppVersion, setEditAppVersion] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [confirmModal, setConfirmModal] = useState<{
    open: boolean
    title: string
    description: ReactNode
    confirmLabel: string
    variant: 'danger' | 'warning' | 'primary'
    icon?: ReactNode
    isLoading?: boolean
    onConfirm: () => void | Promise<void>
  }>({
    open: false,
    title: '',
    description: '',
    confirmLabel: 'Confirm',
    variant: 'danger',
    onConfirm: () => {},
  })

  const load = useCallback(async () => {
    if (!issueId) return
    setLoading(true)

    const { data: issueData, error: issueError } = await supabase
      .from('issues')
      .select('*, project:projects(*), reporter:profiles!issues_reporter_id_fkey(full_name, avatar_url)')
      .eq('id', issueId)
      .single()

    if (issueError || !issueData) {
      setNotFound(true)
      setLoading(false)
      return
    }

    const { reporter: reporterProfile, project: projectData, ...issueRow } =
      issueData as unknown as Issue & {
        project: Project | null
        reporter: { full_name: string | null; avatar_url: string | null } | null
      }

    setIssue(issueRow)
    setProject(projectData)
    setReporter(reporterProfile)

    if (projectData && localStorage.getItem('trackqa:currentProjectId') !== projectData.id) {
      setCurrentProjectId(projectData.id)
    }

    const [commentsRes, activityRes, attachmentsRes] = await Promise.all([
      supabase
        .from('issue_comments')
        .select(
          'id, content, created_at, author:profiles!issue_comments_author_id_fkey(full_name, avatar_url)',
        )
        .eq('issue_id', issueId)
        .order('created_at', { ascending: true }),
      supabase
        .from('issue_activity')
        .select('id, action, from_value, to_value, created_at, actor:profiles!issue_activity_actor_id_fkey(full_name)')
        .eq('issue_id', issueId)
        .neq('action', 'COMMENT_ADDED')
        .order('created_at', { ascending: true }),
      supabase
        .from('issue_attachments')
        .select('*, uploader:profiles!issue_attachments_uploaded_by_fkey(full_name)')
        .eq('issue_id', issueId)
        .order('created_at', { ascending: false }),
    ])
    setComments((commentsRes.data as unknown as TimelineComment[]) ?? [])
    setActivity((activityRes.data as unknown as TimelineActivity[]) ?? [])
    setAttachments((attachmentsRes.data as unknown as AttachmentRow[]) ?? [])

    if (issueRow.status === 'FAILED') {
      const { data: failureData } = await supabase
        .from('qa_verifications')
        .select('*')
        .eq('issue_id', issueId)
        .eq('result', 'FAILED')
        .order('verified_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setLatestFailure(failureData)

      if (failureData) {
        const { data: evidenceData } = await supabase
          .from('qa_verification_attachments')
          .select('*')
          .eq('qa_verification_id', failureData.id)
          .order('created_at', { ascending: true })
        setLatestFailureAttachments(evidenceData ?? [])
      } else {
        setLatestFailureAttachments([])
      }
    } else {
      setLatestFailure(null)
      setLatestFailureAttachments([])
    }

    setLoading(false)
  }, [issueId, setCurrentProjectId])

  useEffect(() => {
    load()
  }, [load])

  useRealtimeSync({
    projectId: issue?.project_id || project?.id || currentProject?.id,
    userId: user?.id,
    issueId: issueId,
    onRefresh: () => load(),
  })

  useEffect(() => {
    const projectId = issue?.project_id || project?.id || currentProject?.id
    if (!projectId) return
    supabase
      .from('project_members')
      .select('user_id, role, profiles(full_name, avatar_url)')
      .eq('project_id', projectId)
      .then(({ data }) => {
        setMembers(
          (data ?? []).map((m) => {
            const prof = (
              m as unknown as {
                profiles: { full_name: string | null; avatar_url: string | null } | null
              }
            ).profiles
            return {
              user_id: m.user_id,
              role: m.role,
              full_name: prof?.full_name ?? null,
              avatar_url: prof?.avatar_url ?? null,
            }
          }),
        )
      })
  }, [issue?.project_id, project?.id, currentProject?.id])

  const updateStatus = async (status: IssueStatus) => {
    if (!issue) return
    setTransitioning(true)
    setActionError(null)
    const { error } = await supabase.from('issues').update({ status }).eq('id', issue.id)
    setTransitioning(false)
    if (error) {
      setActionError(error.message)
      return
    }
    invalidateProjectCache(issue.project_id)
    load()
  }

  const addVerificationFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const incoming = Array.from(fileList)
    const oversized = incoming.some((f) => f.size > MAX_UPLOAD_BYTES)
    setVerificationFileError(
      oversized ? 'Some files exceed the 50MB limit and were skipped.' : null,
    )
    setVerificationFiles((prev) => [...prev, ...incoming.filter((f) => f.size <= MAX_UPLOAD_BYTES)])
  }

  const handleVerificationFilesSelected = (e: ChangeEvent<HTMLInputElement>) => {
    addVerificationFiles(e.target.files)
    e.target.value = ''
  }

  const removeVerificationFile = (index: number) => {
    setVerificationFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleQaVerify = async (result: 'PASSED' | 'FAILED') => {
    if (!issue || !user) return
    setVerifying(true)
    setActionError(null)
    const { data: verificationId, error } = await supabase.rpc('qa_verify_issue', {
      p_issue_id: issue.id,
      p_result: result,
      p_comment: result === 'PASSED' ? verification || null : null,
      p_failure_reason: result === 'FAILED' ? verification || null : null,
    })
    if (error || !verificationId) {
      setVerifying(false)
      setActionError(error?.message ?? 'Failed to record verification')
      return
    }

    for (const file of verificationFiles) {
      try {
        const uploadResult = await uploadToCloudinary(file, `trackqa/qa/${verificationId}`)
        await supabase.from('qa_verification_attachments').insert({
          qa_verification_id: verificationId,
          uploaded_by: user.id,
          storage_path: uploadResult.url,
          file_name: file.name,
          mime_type: file.type || null,
          file_size_bytes: uploadResult.bytes,
        })
      } catch {
        // The verification itself is already recorded; a failed evidence
        // upload just means that one file is missing from the record.
      }
    }

    setVerifying(false)
    setVerification('')
    setVerificationFiles([])
    invalidateProjectCache(issue.project_id)
    load()
  }

  const handlePostComment = async (e: FormEvent) => {
    e.preventDefault()
    if (!issue || !user || !comment.trim()) return
    setPostingComment(true)
    const { error } = await supabase.from('issue_comments').insert({
      issue_id: issue.id,
      author_id: user.id,
      content: comment.trim(),
    })
    setPostingComment(false)
    if (!error) {
      setComment('')
      load()
    }
  }


  const openEditModal = () => {
    if (!issue) return
    setEditTitle(issue.title)
    setEditPriority(issue.priority)
    setEditAssigneeId(issue.assignee_id ?? '')
    setEditDescription(issue.description ?? '')
    setEditExpectedResult(issue.expected_result ?? '')
    setEditActualResult(issue.actual_result ?? '')
    setEditStepsToReproduce(issue.steps_to_reproduce ?? '')
    setEditDevice(issue.environment_device ?? '')
    setEditBrowser(issue.environment_browser ?? '')
    setEditAppVersion(issue.environment_app_version ?? '')
    setEditError(null)
    setEditModalOpen(true)
  }

  const handleSaveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!issue || !editTitle.trim()) return
    setSavingEdit(true)
    setEditError(null)

    const { error } = await supabase
      .from('issues')
      .update({
        title: editTitle.trim(),
        priority: editPriority,
        assignee_id: editAssigneeId || null,
        description: editDescription.trim() || null,
        expected_result: editExpectedResult.trim() || null,
        actual_result: editActualResult.trim() || null,
        steps_to_reproduce: editStepsToReproduce.trim() || null,
        environment_device: editDevice.trim() || null,
        environment_browser: editBrowser.trim() || null,
        environment_app_version: editAppVersion.trim() || null,
      })
      .eq('id', issue.id)

    setSavingEdit(false)
    if (error) {
      setEditError(error.message)
    } else {
      setEditModalOpen(false)
      invalidateProjectCache(issue.project_id)
      load()
    }
  }

  const handleUploadAttachment = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (attachmentInputRef.current) attachmentInputRef.current.value = ''
    if (!file || !issue || !user) return

    setUploadingAttachment(true)
    setAttachmentError(null)
    try {
      const result = await uploadToCloudinary(file, `trackqa/issues/${issue.id}`)
      const { error } = await supabase.from('issue_attachments').insert({
        issue_id: issue.id,
        uploaded_by: user.id,
        storage_path: result.url,
        file_name: file.name,
        mime_type: file.type || null,
        file_size_bytes: result.bytes,
      })
      if (error) throw error
      load()
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingAttachment(false)
    }
  }

  const promptDeleteAttachment = (attachmentId: string, fileName: string) => {
    setConfirmModal({
      open: true,
      title: 'Delete Attachment',
      description: `Are you sure you want to delete "${fileName}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        const { error } = await supabase.from('issue_attachments').delete().eq('id', attachmentId)
        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
        if (error) {
          setAttachmentError(error.message)
          return
        }
        setAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
      },
    })
  }

  const handleDeleteIssue = () => {
    if (!issue) return
    const projectKey = activeProject?.key ?? 'TASK'
    const issueCode = `${projectKey}-${issue.issue_number}`
    setConfirmModal({
      open: true,
      title: 'Delete Task',
      description: `Are you sure you want to delete ${issueCode}: "${issue.title}"? All comments, attachments, and QA activity will be permanently destroyed. This action cannot be undone.`,
      confirmLabel: 'Delete Task',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }))
        const { error } = await supabase.from('issues').delete().eq('id', issue.id)
        if (error) {
          setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
          setActionError(error.message)
          return
        }
        invalidateProjectCache(issue.project_id)
        setConfirmModal((prev) => ({ ...prev, open: false, isLoading: false }))
        navigate('/issues')
      },
    })
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-surface">
        <Sidebar />
        <div className="flex-1 px-lg py-lg text-body-lg text-on-surface-variant">
          Loading…
        </div>
      </div>
    )
  }

  if (notFound || !issue) {
    return (
      <div className="flex min-h-screen bg-surface">
        <Sidebar />
        <div className="flex-1 px-lg py-lg">
          <p className="text-body-lg text-on-surface-variant">
            This issue doesn't exist or you don't have access to it.{' '}
            <Link to="/issues" className="font-semibold text-primary hover:underline">
              Back to Issues
            </Link>
          </p>
        </div>
      </div>
    )
  }

  const currentStepIndex =
    issue.status === 'FAILED'
      ? workflowSteps.indexOf('FOR_TESTING')
      : workflowSteps.indexOf(issue.status)
  const Priority = priorityConfig[issue.priority]
  const activeProject = project || currentProject
  const isOwner = activeProject?.owner_id === user?.id
  const myRole = members.find((m) => m.user_id === user?.id)?.role
  const assigneeMember = members.find((m) => m.user_id === issue.assignee_id)
  const isAssignee = issue.assignee_id === user?.id
  const canDev = isAssignee && (isOwner || myRole === 'DEVELOPER')
  const canQa = isOwner || myRole === 'QA'
  const isDone = issue.status === 'DONE'
  const isReporter = issue.reporter_id === user?.id
  const canManageIssue = !isDone && (isOwner || isReporter)
  const canDeleteIssue = isReporter
  const canInteract =
    isOwner ||
    isReporter ||
    issue.assignee_id === user?.id ||
    (myRole === 'QA' && (issue.status === 'FOR_TESTING' || issue.status === 'FAILED'))

  return (
    <div className="flex min-h-screen bg-surface">
      <Sidebar />

      <div className="mx-auto w-full max-w-[1280px] flex-1 px-lg py-lg">
        <div className="mb-md flex items-center gap-xs text-body-md text-on-surface-variant">
          <Link to="/issues" className="hover:text-primary">
            Issues
          </Link>
          <ChevronRight size={16} />
          <span className="text-on-surface">
            {activeProject?.key}-{issue.issue_number}
          </span>
        </div>

        <div className="mb-lg flex flex-wrap items-center justify-between gap-md">
          <h1 className="text-headline-xl font-bold text-on-surface">
            {issue.title}
          </h1>
          <div className="flex items-center gap-sm">
            {canManageIssue && (
              <button
                type="button"
                onClick={openEditModal}
                className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-md font-semibold text-on-surface shadow-sm transition-colors hover:bg-surface-container-low"
              >
                <Pencil size={16} />
                <span>Edit Issue</span>
              </button>
            )}
            {canDeleteIssue && (
              <button
                type="button"
                onClick={handleDeleteIssue}
                className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-body-md font-semibold text-rose-600 shadow-sm transition-colors hover:bg-rose-50 hover:border-rose-300"
              >
                <Trash2 size={16} />
                <span>Delete</span>
              </button>
            )}
          </div>
        </div>

        <div className="mb-lg rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
          <div className="relative flex items-center justify-between">
            <div className="absolute left-[10%] right-[10%] top-1/2 h-1 -translate-y-1/2 bg-surface-container-highest" />
            <div
              className="absolute left-[10%] top-1/2 h-1 -translate-y-1/2 bg-primary"
              style={{ width: `${(currentStepIndex / (workflowSteps.length - 1)) * 80}%` }}
            />

            {workflowSteps.map((step, i) => {
              const done = i < currentStepIndex
              const active = i === currentStepIndex
              const label =
                step === 'FOR_TESTING' && issue.status === 'FAILED' ? 'FAILED' : step.replace('_', ' ')
              return (
                <div key={step} className="relative z-10 flex w-1/5 flex-col items-center">
                  {done && (
                    <div className="mb-xs flex h-6 w-6 items-center justify-center rounded-full bg-primary">
                      <Check className="text-on-primary" size={14} />
                    </div>
                  )}
                  {active && (
                    <div
                      className={`mb-xs flex h-8 w-8 items-center justify-center rounded-full border-4 bg-surface-container-lowest ${
                        issue.status === 'FAILED' ? 'border-error' : 'border-primary'
                      }`}
                    >
                      <div
                        className={`h-2 w-2 rounded-full ${issue.status === 'FAILED' ? 'bg-error' : 'bg-primary'}`}
                      />
                    </div>
                  )}
                  {!done && !active && (
                    <div className="mb-xs h-6 w-6 rounded-full bg-surface-container-highest" />
                  )}
                  <span
                    className={`text-label-md ${
                      active
                        ? `font-bold ${issue.status === 'FAILED' ? 'text-error' : 'text-primary'}`
                        : 'text-on-surface-variant'
                    }`}
                  >
                    {label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {actionError && (
          <p className="mb-lg rounded-md bg-error-container px-md py-sm text-body-md text-on-error-container">
            {actionError}
          </p>
        )}

        <div className="grid grid-cols-1 gap-lg lg:grid-cols-3">
          <div className="flex flex-col gap-lg lg:col-span-2">
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
              <div className="border-b border-outline-variant px-md py-sm text-headline-md font-semibold text-on-surface">
                Description
              </div>
              <div className="flex flex-col gap-md p-md text-body-md text-on-surface-variant">
                <p>{issue.description || 'No description provided.'}</p>
                {issue.expected_result && (
                  <div>
                    <h4 className="mb-xs font-bold text-on-surface">Expected Result</h4>
                    <p>{issue.expected_result}</p>
                  </div>
                )}
                {issue.actual_result && (
                  <div>
                    <h4 className="mb-xs font-bold text-on-surface">Actual Result</h4>
                    <p>{issue.actual_result}</p>
                  </div>
                )}
                {issue.steps_to_reproduce && (
                  <div>
                    <h4 className="mb-xs font-bold text-on-surface">Steps to Reproduce</h4>
                    <p className="whitespace-pre-line">{issue.steps_to_reproduce}</p>
                  </div>
                )}
                {(issue.environment_device || issue.environment_browser || issue.environment_app_version) && (
                  <div>
                    <h4 className="mb-xs font-bold text-on-surface">Environment Details</h4>
                    <div className="rounded-sm border border-outline-variant bg-surface-container-low p-sm font-mono text-code-sm text-on-surface-variant">
                      {issue.environment_device && <>Device/OS: {issue.environment_device}<br /></>}
                      {issue.environment_browser && <>Browser: {issue.environment_browser}<br /></>}
                      {issue.environment_app_version && <>App Version: {issue.environment_app_version}</>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
              <div className="flex items-center justify-between border-b border-outline-variant px-md py-sm">
                <span className="text-headline-md font-semibold text-on-surface">
                  Attachments
                </span>
                <span className="text-label-md text-on-surface-variant">
                  {attachments.length} {attachments.length === 1 ? 'file' : 'files'}
                </span>
              </div>
              <div className="flex flex-col gap-sm p-md">
                {attachments.length === 0 && (
                  <p className="text-body-md text-on-surface-variant">
                    No attachments.
                  </p>
                )}
                {attachments.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-sm rounded-md border border-outline-variant p-sm hover:bg-surface-container-low transition-colors"
                  >
                    {isImageAttachment(a.mime_type) ? (
                      <img
                        src={a.storage_path}
                        alt={a.file_name}
                        className="h-10 w-10 shrink-0 rounded-sm object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-container-highest text-on-surface-variant">
                        <FileText size={18} />
                      </div>
                    )}
                    <a
                      href={a.storage_path}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1"
                    >
                      <div className="truncate text-body-md font-medium text-on-surface hover:text-primary hover:underline">
                        {a.file_name}
                      </div>
                      <div className="flex items-center gap-xs text-[12px] text-on-surface-variant">
                        <Paperclip size={12} />
                        {formatBytes(a.file_size_bytes)}
                        {a.uploader?.full_name && <span>· {a.uploader.full_name}</span>}
                      </div>
                    </a>
                  </div>
                ))}
              </div>
            </div>

            {issue.status === 'OPEN' && (
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md shadow-raised">
                {canDev ? (
                  <>
                    <p className="mb-md text-body-md text-on-surface-variant">
                      This issue is assigned to you. Start progress once you're ready to fix it.
                    </p>
                    <button
                      type="button"
                      disabled={transitioning}
                      onClick={() => updateStatus('IN_PROGRESS')}
                      className="rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary shadow-raised hover:bg-primary-container disabled:opacity-60"
                    >
                      Start Progress
                    </button>
                  </>
                ) : (
                  <p className="text-body-md text-on-surface-variant">
                    {assigneeMember
                      ? `This issue is assigned to ${assigneeMember.full_name ?? 'the developer'}. Waiting for them to start progress.`
                      : 'This issue is open and unassigned. Assign it to yourself or a developer to start progress.'}
                  </p>
                )}
              </div>
            )}

            {issue.status === 'IN_PROGRESS' && (
              <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md shadow-raised">
                {canDev ? (
                  <>
                    <p className="mb-md text-body-md text-on-surface-variant">
                      Once your fix is ready, submit it for QA testing.
                    </p>
                    <button
                      type="button"
                      disabled={transitioning}
                      onClick={() => updateStatus('FOR_TESTING')}
                      className="flex items-center gap-xs rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary shadow-raised hover:bg-primary-container disabled:opacity-60"
                    >
                      <FlaskConical size={18} />
                      Submit for Testing
                    </button>
                  </>
                ) : (
                  <p className="text-body-md text-on-surface-variant">
                    {assigneeMember
                      ? `Work is in progress by ${assigneeMember.full_name ?? 'the assigned developer'}.`
                      : 'This issue is in progress.'}
                  </p>
                )}
              </div>
            )}

            {issue.status === 'FOR_TESTING' && (
              <div
                className={
                  canQa
                    ? 'rounded-lg border-2 border-primary bg-primary-fixed/40 p-md shadow-raised'
                    : 'rounded-lg border border-outline-variant bg-surface-container-lowest p-md shadow-raised'
                }
              >
                {canQa ? (
                  <>
                    <div className="mb-md flex items-center gap-sm">
                      <ClipboardCheck className="text-primary" size={24} />
                      <h3 className="text-headline-md font-semibold text-primary">
                        QA Verification Required
                      </h3>
                    </div>
                    <p className="mb-md text-body-md text-on-surface-variant">
                      This issue is ready for testing. Verify the fix and
                      record the result.
                    </p>
                    <textarea
                      value={verification}
                      onChange={(e) => setVerification(e.target.value)}
                      rows={3}
                      placeholder="Add verification comments or test notes here..."
                      className="mb-md w-full rounded-md border border-outline-variant bg-surface-container-lowest p-sm text-body-md text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                    />

                    <div className="mb-md">
                      <button
                        type="button"
                        onClick={() => verificationFileInputRef.current?.click()}
                        className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-xs text-label-md font-semibold text-on-surface-variant hover:bg-surface-container-low"
                      >
                        <Paperclip size={14} />
                        Attach Evidence
                      </button>
                      <input
                        ref={verificationFileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleVerificationFilesSelected}
                      />

                      {verificationFileError && (
                        <p className="mt-sm text-body-md text-error">{verificationFileError}</p>
                      )}

                      {verificationFiles.length > 0 && (
                        <div className="mt-sm flex flex-col gap-xs">
                          {verificationFiles.map((file, i) => (
                            <div
                              key={`${file.name}-${i}`}
                              className="flex items-center gap-sm rounded-md border border-outline-variant bg-surface-container-lowest p-sm"
                            >
                              <FileText className="shrink-0 text-on-surface-variant" size={16} />
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
                                onClick={() => removeVerificationFile(i)}
                                className="shrink-0 rounded-sm p-xs text-on-surface-variant hover:bg-error-container hover:text-on-error-container"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-md">
                      <button
                        type="button"
                        disabled={verifying}
                        onClick={() => handleQaVerify('PASSED')}
                        className="flex flex-1 items-center justify-center gap-xs rounded-md bg-emerald-700 py-sm text-label-md font-semibold text-white hover:opacity-90 disabled:opacity-60"
                      >
                        <CircleCheck size={18} />
                        Pass Verification
                      </button>
                      <button
                        type="button"
                        disabled={verifying}
                        onClick={() => handleQaVerify('FAILED')}
                        className="flex flex-1 items-center justify-center gap-xs rounded-md bg-error py-sm text-label-md font-semibold text-on-error hover:opacity-90 disabled:opacity-60"
                      >
                        <XCircle size={18} />
                        Fail Verification
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-body-md text-on-surface-variant">
                    This issue is ready for testing. Waiting on a QA member to
                    verify it.
                  </p>
                )}
              </div>
            )}

            {issue.status === 'FAILED' && (
              <div className="rounded-lg border-2 border-error bg-error-container/40 p-md shadow-raised">
                <h3 className="mb-sm text-headline-md font-semibold text-on-error-container">
                  QA Verification Failed
                </h3>
                {latestFailure?.failure_reason && (
                  <p className="mb-md text-body-md text-on-error-container">
                    {latestFailure.failure_reason}
                  </p>
                )}
                {latestFailureAttachments.length > 0 && (
                  <div className="mb-md flex flex-wrap gap-sm">
                    {latestFailureAttachments.map((a) =>
                      isImageAttachment(a.mime_type) ? (
                        <a key={a.id} href={a.storage_path} target="_blank" rel="noreferrer">
                          <img
                            src={a.storage_path}
                            alt={a.file_name}
                            className="h-16 w-16 rounded-sm border border-error/30 object-cover"
                          />
                        </a>
                      ) : (
                        <a
                          key={a.id}
                          href={a.storage_path}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-xs rounded-md border border-error/30 bg-surface-container-lowest px-sm py-xs text-body-md text-on-error-container hover:underline"
                        >
                          <FileText size={14} />
                          {a.file_name}
                        </a>
                      ),
                    )}
                  </div>
                )}
                {canDev ? (
                  <button
                    type="button"
                    disabled={transitioning}
                    onClick={() => updateStatus('IN_PROGRESS')}
                    className="rounded-md bg-primary px-md py-sm text-label-md font-semibold text-on-primary shadow-raised hover:bg-primary-container disabled:opacity-60"
                  >
                    Resume Work
                  </button>
                ) : (
                  <p className="text-body-md text-on-error-container">
                    {assigneeMember
                      ? `Waiting on the assigned developer (${assigneeMember.full_name ?? 'the assignee'}) to resume work.`
                      : 'Waiting on the assigned developer to resume work.'}
                  </p>
                )}
              </div>
            )}

            {issue.status === 'PASSED' && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-md shadow-raised">
                {isOwner ? (
                  <>
                    <p className="mb-md text-body-md text-emerald-800">
                      This issue passed QA. Mark it done to close it out.
                    </p>
                    <button
                      type="button"
                      disabled={transitioning}
                      onClick={() => updateStatus('DONE')}
                      className="rounded-md bg-emerald-700 px-md py-sm text-label-md font-semibold text-white hover:opacity-90 disabled:opacity-60"
                    >
                      Mark Done
                    </button>
                  </>
                ) : (
                  <p className="text-body-md text-emerald-800">
                    This issue passed QA. Waiting on the project owner to
                    close it.
                  </p>
                )}
              </div>
            )}

            {issue.status === 'DONE' && (
              <div className="flex items-center gap-sm rounded-lg border border-outline-variant bg-surface-container-lowest p-md text-body-md text-on-surface-variant">
                <CircleCheck className="text-emerald-600" size={20} />
                This issue is done.
              </div>
            )}
          </div>

          <div className="flex flex-col gap-lg">
            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
              <div className="border-b border-outline-variant px-md py-sm text-headline-md font-semibold text-on-surface">
                Details
              </div>
              <div className="flex flex-col gap-md p-md">
                <div className="flex items-center justify-between">
                  <span className="text-label-md text-on-surface-variant">Status</span>
                  <span className="flex items-center gap-xs rounded-sm bg-primary-fixed-dim px-sm py-xs text-label-md font-semibold text-on-primary-fixed">
                    <FlaskConical size={14} />
                    {issue.status.replace('_', ' ')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-label-md text-on-surface-variant">Priority</span>
                  <span
                    className={`flex items-center gap-xs text-label-md font-semibold ${Priority.className}`}
                  >
                    <Priority.icon size={14} />
                    <span>{issue.priority}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-label-md text-on-surface-variant">Type</span>
                  <span className="flex items-center gap-xs text-label-md font-semibold text-on-surface">
                    <Bug className="text-rose-600" size={18} />
                    Bug
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
              <div className="border-b border-outline-variant px-md py-sm text-headline-md font-semibold text-on-surface">
                People
              </div>
              <div className="flex flex-col gap-md p-md">
                <div className="flex items-center justify-between">
                  <span className="text-label-md text-on-surface-variant">Assignee</span>
                  {assigneeMember ? (
                    <div className="flex items-center gap-sm">
                      <Avatar
                        name={assigneeMember.full_name}
                        avatarUrl={assigneeMember.avatar_url}
                        size={24}
                      />
                      <span className="text-body-md font-medium text-on-surface">
                        {assigneeMember.full_name ?? 'Unnamed'}
                      </span>
                    </div>
                  ) : (
                    <span className="text-body-md text-on-surface-variant italic">
                      Unassigned
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-label-md text-on-surface-variant">Reporter</span>
                  <div className="flex items-center gap-sm">
                    <Avatar name={reporter?.full_name} avatarUrl={reporter?.avatar_url} size={24} />
                    <span className="text-body-md text-on-surface">
                      {reporter?.full_name ?? 'Unknown'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest">
              <div className="border-b border-outline-variant px-md py-sm text-headline-md font-semibold text-on-surface">
                Dates
              </div>
              <div className="flex flex-col gap-md p-md text-body-md text-on-surface-variant">
                <div className="flex justify-between">
                  <span>Created</span>
                  <span>{new Date(issue.created_at).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Updated</span>
                  <span>{new Date(issue.updated_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-xl">
          <h3 className="mb-md text-headline-lg font-semibold text-on-surface">
            Activity
          </h3>
          <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-md">
            {isDone ? (
              <p className="mb-lg text-body-md text-on-surface-variant">
                This issue is done. Comments are closed.
              </p>
            ) : !canInteract ? (
              <p className="mb-lg text-body-md text-on-surface-variant">
                Only the reporter, assignee, or a verifying QA member can
                comment on this issue.
              </p>
            ) : (
              <form onSubmit={handlePostComment} className="mb-lg flex gap-md">
                <Avatar name={profile?.full_name} avatarUrl={profile?.avatar_url} size={32} className="shrink-0" />
                <div className="flex-1">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={2}
                    placeholder="Add a comment..."
                    className="mb-sm w-full rounded-md border border-outline-variant bg-surface-container-lowest p-sm text-body-md text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={postingComment || !comment.trim()}
                      className="rounded-md bg-surface-container-low px-md py-sm text-label-md font-semibold text-on-surface-variant hover:bg-surface-container-high disabled:opacity-60"
                    >
                      {postingComment ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            <div className="relative flex flex-col gap-lg">
              {(comments.length > 0 || activity.length > 0) && (
                <div className="absolute inset-y-0 left-4 z-0 w-0.5 -translate-x-1/2 bg-outline-variant" />
              )}

              {[
                ...comments.map((c) => ({ type: 'comment' as const, at: c.created_at, data: c })),
                ...activity.map((a) => ({ type: 'activity' as const, at: a.created_at, data: a })),
              ]
                .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
                .map((entry) =>
                  entry.type === 'comment' ? (
                    <div key={entry.data.id} className="relative z-10 flex items-start gap-md">
                      <Avatar
                        name={entry.data.author?.full_name}
                        avatarUrl={entry.data.author?.avatar_url}
                        size={32}
                        className="shrink-0 border-4 border-surface-container-lowest"
                      />
                      <div className="flex-1 rounded-md border border-outline-variant bg-surface-container-low p-sm">
                        <div className="mb-xs flex items-center justify-between">
                          <span className="text-label-md text-on-surface">
                            {entry.data.author?.full_name ?? 'Unknown'}
                          </span>
                          <span className="text-[12px] text-on-surface-variant">
                            {new Date(entry.data.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-body-md text-on-surface-variant">
                          {entry.data.content}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div key={entry.data.id} className="relative z-10 flex items-start gap-md">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-4 border-surface-container-lowest bg-surface-container-highest text-on-surface-variant">
                        <Code2 size={16} />
                      </div>
                      <div className="flex-1 py-xs">
                        <span className="text-body-md text-on-surface-variant">
                          <span className="text-label-md text-on-surface">
                            {entry.data.actor?.full_name ?? 'System'}
                          </span>{' '}
                          {activityText[entry.data.action]?.(entry.data) ?? entry.data.action}
                        </span>
                        <span className="ml-sm text-[12px] text-outline">
                          {new Date(entry.data.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ),
                )}

              {comments.length === 0 && activity.length === 0 && (
                <p className="text-body-md text-on-surface-variant">No activity yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Edit Issue Modal */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md animate-in fade-in duration-100">
          <div
            className="fixed inset-0"
            onClick={() => !savingEdit && setEditModalOpen(false)}
          />
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-[680px] flex-col rounded-xl border border-outline-variant bg-surface-container-lowest shadow-raised">
            <div className="flex items-center justify-between border-b border-outline-variant px-lg py-md">
              <div className="flex items-center gap-xs">
                <Pencil size={18} className="text-primary" />
                <h2 className="text-headline-md font-bold text-on-surface">
                  Edit Issue {activeProject?.key}-{issue.issue_number}
                </h2>
              </div>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => setEditModalOpen(false)}
                className="rounded-md p-xs text-outline hover:bg-surface-container hover:text-on-surface"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleSaveEdit}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <div className="flex-1 overflow-y-auto p-lg space-y-md">
                {editError && (
                  <p className="rounded-md bg-error-container p-sm text-body-md text-on-error-container">
                    {editError}
                  </p>
                )}

                <div>
                  <label className="mb-xs block text-label-md font-bold text-on-surface">
                    Title <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-sm text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                    placeholder="Issue title"
                  />
                </div>

                <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                  <div>
                    <label className="mb-xs block text-label-md font-bold text-on-surface">
                      Priority
                    </label>
                    <select
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value as IssuePriority)}
                      className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-sm text-body-md font-semibold text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                    >
                      {(Object.keys(priorityConfig) as IssuePriority[]).map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-xs block text-label-md font-bold text-on-surface">
                      Assignee
                    </label>
                    <select
                      value={editAssigneeId}
                      onChange={(e) => setEditAssigneeId(e.target.value)}
                      className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-sm text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.full_name ?? 'Unnamed'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-xs block text-label-md font-bold text-on-surface">
                    Description
                  </label>
                  <textarea
                    rows={3}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-sm text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                    placeholder="Detailed explanation of the issue"
                  />
                </div>

                <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                  <div>
                    <label className="mb-xs block text-label-md font-bold text-on-surface">
                      Expected Result
                    </label>
                    <textarea
                      rows={2}
                      value={editExpectedResult}
                      onChange={(e) => setEditExpectedResult(e.target.value)}
                      className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-sm text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                      placeholder="What should have happened"
                    />
                  </div>
                  <div>
                    <label className="mb-xs block text-label-md font-bold text-on-surface">
                      Actual Result
                    </label>
                    <textarea
                      rows={2}
                      value={editActualResult}
                      onChange={(e) => setEditActualResult(e.target.value)}
                      className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-sm text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                      placeholder="What actually happened"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-xs block text-label-md font-bold text-on-surface">
                    Steps to Reproduce
                  </label>
                  <textarea
                    rows={3}
                    value={editStepsToReproduce}
                    onChange={(e) => setEditStepsToReproduce(e.target.value)}
                    className="w-full rounded-md border border-outline-variant bg-surface-container-low px-md py-sm text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest font-mono text-code-sm"
                    placeholder="1. Go to...&#10;2. Click on...&#10;3. See error"
                  />
                </div>

                <div>
                  <label className="mb-xs block text-label-md font-bold text-on-surface">
                    Environment Details
                  </label>
                  <div className="grid grid-cols-1 gap-sm sm:grid-cols-3">
                    <input
                      type="text"
                      value={editDevice}
                      onChange={(e) => setEditDevice(e.target.value)}
                      className="w-full rounded-md border border-outline-variant bg-surface-container-low px-sm py-xs text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                      placeholder="Device / OS"
                    />
                    <input
                      type="text"
                      value={editBrowser}
                      onChange={(e) => setEditBrowser(e.target.value)}
                      className="w-full rounded-md border border-outline-variant bg-surface-container-low px-sm py-xs text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                      placeholder="Browser"
                    />
                    <input
                      type="text"
                      value={editAppVersion}
                      onChange={(e) => setEditAppVersion(e.target.value)}
                      className="w-full rounded-md border border-outline-variant bg-surface-container-low px-sm py-xs text-body-md text-on-surface outline-none focus:border-primary focus:bg-surface-container-lowest"
                      placeholder="App Version"
                    />
                  </div>
                </div>

                <div>
                  <div className="mb-xs flex items-center justify-between">
                    <label className="text-label-md font-bold text-on-surface">
                      Attachments ({attachments.length})
                    </label>
                    <button
                      type="button"
                      disabled={uploadingAttachment}
                      onClick={() => attachmentInputRef.current?.click()}
                      className="flex items-center gap-xs rounded-md border border-outline-variant bg-surface-container-lowest px-sm py-xs text-label-md font-semibold text-on-surface-variant shadow-sm hover:bg-surface-container-low disabled:opacity-60"
                    >
                      <UploadCloud size={16} />
                      {uploadingAttachment ? 'Uploading…' : 'Upload Attachment'}
                    </button>
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      className="hidden"
                      onChange={handleUploadAttachment}
                    />
                  </div>

                  {attachmentError && (
                    <p className="mb-xs text-body-md text-error">{attachmentError}</p>
                  )}

                  {attachments.length > 0 ? (
                    <div className="space-y-xs">
                      {attachments.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between gap-sm rounded-md border border-outline-variant bg-surface-container-low p-sm"
                        >
                          <div className="flex min-w-0 items-center gap-sm">
                            {isImageAttachment(a.mime_type) ? (
                              <img
                                src={a.storage_path}
                                alt={a.file_name}
                                className="h-8 w-8 shrink-0 rounded-sm object-cover"
                              />
                            ) : (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surface-container-highest text-on-surface-variant">
                                <FileText size={16} />
                              </div>
                            )}
                            <div className="min-w-0 truncate">
                              <p className="truncate text-body-md font-medium text-on-surface">
                                {a.file_name}
                              </p>
                              <p className="text-[12px] text-on-surface-variant">
                                {formatBytes(a.file_size_bytes)}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            aria-label="Delete attachment"
                            onClick={() => promptDeleteAttachment(a.id, a.file_name)}
                            className="shrink-0 rounded-sm p-xs text-on-surface-variant hover:bg-error-container hover:text-on-error-container transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-body-md text-on-surface-variant italic">
                      No attachments added yet.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-sm border-t border-outline-variant bg-surface-container-low/50 px-lg py-md">
                <button
                  type="button"
                  disabled={savingEdit}
                  onClick={() => setEditModalOpen(false)}
                  className="rounded-md border border-outline-variant bg-surface-container-lowest px-md py-sm text-label-md font-semibold text-on-surface hover:bg-surface-container"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded-md bg-primary px-lg py-sm text-label-md font-semibold text-on-primary shadow-raised hover:bg-primary-container disabled:opacity-60"
                >
                  {savingEdit ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmModal.open}
        onClose={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        description={confirmModal.description}
        confirmLabel={confirmModal.confirmLabel}
        variant={confirmModal.variant}
        icon={confirmModal.icon}
        isLoading={confirmModal.isLoading}
      />
    </div>
  )
}

export default IssueDetail
