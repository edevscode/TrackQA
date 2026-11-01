export type ProjectRole = 'OWNER' | 'DEVELOPER' | 'QA'
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELED'
export type IssuePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'FOR_TESTING' | 'PASSED' | 'FAILED' | 'DONE'
export type QaResult = 'PASSED' | 'FAILED'
export type AiFinding = {
  id: string
  project_id: string
  connection_id: string
  submission_id: string
  title: string
  description: string
  suggested_priority: IssuePriority
  file_path: string | null
  line_start: number | null
  line_end: number | null
  evidence_excerpt: string | null
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED'
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  issue_id: string | null
  created_at: string
  updated_at: string
}
export type FindingReceipt = Pick<AiFinding, 'id' | 'project_id' | 'status' | 'issue_id' | 'created_at'>
export type ActivityAction =
  | 'CREATED'
  | 'ASSIGNED'
  | 'REASSIGNED'
  | 'PRIORITY_CHANGED'
  | 'STATUS_CHANGED'
  | 'SUBMITTED_FOR_TESTING'
  | 'QA_PASSED'
  | 'QA_FAILED'
  | 'MARKED_DONE'
  | 'COMMENT_ADDED'
export type NotificationType =
  | 'ISSUE_ASSIGNED'
  | 'READY_FOR_TESTING'
  | 'QA_PASSED'
  | 'QA_FAILED'
  | 'ISSUE_DONE'
  | 'COMMENT_ADDED'
  | 'INVITATION'

export type Profile = {
  id: string
  full_name: string | null
  email: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export type Project = {
  timezone: string
  id: string
  name: string
  key: string
  access_code?: string | null
  description: string | null
  owner_id: string
  issue_seq: number
  archived: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type ProjectMember = {
  id: string
  project_id: string
  user_id: string
  role: ProjectRole
  created_at: string
}

export type ProjectInvitation = {
  id: string
  project_id: string
  email: string
  role: ProjectRole
  status: InvitationStatus
  invited_by: string | null
  created_at: string
  responded_at: string | null
  expires_at: string
}

export type DeadlineMode = 'none' | 'single' | 'stages'
export type DeadlineTiming = {
  start_timezone: string | null
  ready_for_qa_timezone: string | null
  qa_decision_timezone: string | null
  resolve_timezone: string | null
  deadline_mode: DeadlineMode
  resolve_time: string | null
  start_time: string | null
  ready_for_qa_time: string | null
  qa_decision_time: string | null
  resolve_cutoff_at: string | null
  start_cutoff_at: string | null
  ready_for_qa_cutoff_at: string | null
  qa_decision_cutoff_at: string | null
}
export type IssueDeadlines = DeadlineTiming & {
  resolve_by: string | null
  start_by: string | null
  ready_for_qa_by: string | null
  qa_decision_by: string | null
  deadline_timezone: string
  work_cycle: number
  work_started_at: string | null
  ready_for_qa_at: string | null
  qa_decided_at: string | null
  completed_at: string | null
}

export type DeadlineSnapshot = Omit<IssueDeadlines, 'deadline_timezone' | keyof DeadlineTiming> & Partial<DeadlineTiming> & {
  timezone: string
  status: IssueStatus
}

export type DeadlineHistory = {
  id: string
  issue_id: string
  actor_id: string | null
  event: 'CREATED' | 'TARGETS_CHANGED' | 'MILESTONE_REACHED' | 'REWORK_STARTED'
  work_cycle: number
  before_values: DeadlineSnapshot | null
  after_values: DeadlineSnapshot
  created_at: string
}

export type Issue = IssueDeadlines & {
  id: string
  project_id: string
  issue_number: number
  title: string
  description: string | null
  steps_to_reproduce: string | null
  expected_result: string | null
  actual_result: string | null
  environment_device: string | null
  environment_browser: string | null
  environment_app_version: string | null
  priority: IssuePriority
  status: IssueStatus
  reporter_id: string | null
  assignee_id: string | null
  created_at: string
  updated_at: string
}

export type QaVerification = {
  id: string
  issue_id: string
  qa_user_id: string | null
  result: QaResult
  comment: string | null
  failure_reason: string | null
  verified_at: string
}

export type QaVerificationAttachment = {
  id: string
  qa_verification_id: string
  uploaded_by: string | null
  storage_path: string
  file_name: string
  mime_type: string | null
  file_size_bytes: number | null
  created_at: string
}

export type IssueComment = {
  id: string
  issue_id: string
  author_id: string | null
  content: string
  created_at: string
  updated_at: string
}

export type IssueAttachment = {
  id: string
  issue_id: string
  uploaded_by: string | null
  storage_path: string
  file_name: string
  mime_type: string | null
  file_size_bytes: number | null
  created_at: string
}

export type IssueActivity = {
  id: string
  issue_id: string
  actor_id: string | null
  action: ActivityAction
  from_value: string | null
  to_value: string | null
  note: string | null
  created_at: string
}

export type Notification = {
  id: string
  recipient_id: string
  actor_id: string | null
  type: NotificationType
  title: string
  message: string | null
  project_id: string | null
  issue_id: string | null
  is_read: boolean
  read_at: string | null
  created_at: string
}

export type NotificationPreferences = {
  user_id: string
  email_on_issue_assigned: boolean
  daily_digest: boolean
  updated_at: string
}

export type ProjectDashboardStats = {
  due_soon_issues: number
  overdue_issues: number
  missed_target_issues: number
  project_id: string
  open_issues: number
  in_progress_issues: number
  for_testing_issues: number
  passed_issues: number
  failed_issues: number
  done_issues: number
  completed_this_week: number
}

export type MemberStats = {
  project_id: string
  user_id: string
  assigned_issues: number
  completed_issues: number
  in_progress_issues: number
  for_testing_issues: number
}

// Mirrors postgrest-js's GenericRelationship. Populated for the foreign keys
// actually used as embeds (e.g. `profiles!issues_assignee_id_fkey(...)`,
// `projects(name, key)`) — postgrest-js resolves those against this array at
// the type level, so an empty array here silently breaks any embedded select.
// Names match the auto-generated `<table>_<column>_fkey` Postgres gives
// unnamed inline `references` constraints, as used throughout the migration.

export type Database = {
  public: {
    Tables: {
      ai_findings: {
        Row: AiFinding
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [{
          foreignKeyName: 'ai_findings_reviewed_by_fkey'
          columns: ['reviewed_by']
          isOneToOne: false
          referencedRelation: 'profiles'
          referencedColumns: ['id']
        }]
      }
      issue_deadline_history: {
        Row: DeadlineHistory
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
      profiles: {
        Row: Profile
        Insert: Partial<Profile> & { id: string; email: string }
        Update: Partial<Profile>
        Relationships: []
      }
      projects: {
        Row: Project
        Insert: Partial<Project> & { name: string; key: string; owner_id: string }
        Update: Partial<Project>
        Relationships: [
          {
            foreignKeyName: 'projects_owner_id_fkey'
            columns: ['owner_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      project_members: {
        Row: ProjectMember
        Insert: Partial<ProjectMember> & { project_id: string; user_id: string }
        Update: Partial<ProjectMember>
        Relationships: [
          {
            foreignKeyName: 'project_members_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'project_members_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      project_invitations: {
        Row: ProjectInvitation
        Insert: Partial<ProjectInvitation> & { project_id: string; email: string }
        Update: Partial<ProjectInvitation>
        Relationships: [
          {
            foreignKeyName: 'project_invitations_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'project_invitations_invited_by_fkey'
            columns: ['invited_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      issues: {
        Row: Issue
        Insert: Partial<Issue> & { project_id: string; title: string }
        Update: Partial<Issue>
        Relationships: [
          {
            foreignKeyName: 'issues_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'issues_reporter_id_fkey'
            columns: ['reporter_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'issues_assignee_id_fkey'
            columns: ['assignee_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      qa_verifications: {
        Row: QaVerification
        Insert: Partial<QaVerification> & { issue_id: string; result: QaResult }
        Update: Partial<QaVerification>
        Relationships: [
          {
            foreignKeyName: 'qa_verifications_issue_id_fkey'
            columns: ['issue_id']
            isOneToOne: false
            referencedRelation: 'issues'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'qa_verifications_qa_user_id_fkey'
            columns: ['qa_user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      qa_verification_attachments: {
        Row: QaVerificationAttachment
        Insert: Partial<QaVerificationAttachment> & {
          qa_verification_id: string
          storage_path: string
          file_name: string
        }
        Update: Partial<QaVerificationAttachment>
        Relationships: [
          {
            foreignKeyName: 'qa_verification_attachments_qa_verification_id_fkey'
            columns: ['qa_verification_id']
            isOneToOne: false
            referencedRelation: 'qa_verifications'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'qa_verification_attachments_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      issue_comments: {
        Row: IssueComment
        Insert: Partial<IssueComment> & { issue_id: string; content: string }
        Update: Partial<IssueComment>
        Relationships: [
          {
            foreignKeyName: 'issue_comments_issue_id_fkey'
            columns: ['issue_id']
            isOneToOne: false
            referencedRelation: 'issues'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'issue_comments_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      issue_attachments: {
        Row: IssueAttachment
        Insert: Partial<IssueAttachment> & { issue_id: string; storage_path: string; file_name: string }
        Update: Partial<IssueAttachment>
        Relationships: [
          {
            foreignKeyName: 'issue_attachments_issue_id_fkey'
            columns: ['issue_id']
            isOneToOne: false
            referencedRelation: 'issues'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'issue_attachments_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      // Read-only from the client (see the migration's RLS notes) — Insert/
      // Update are typed as empty objects rather than `never` so this still
      // structurally satisfies postgrest-js's GenericTable constraint.
      issue_activity: {
        Row: IssueActivity
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'issue_activity_issue_id_fkey'
            columns: ['issue_id']
            isOneToOne: false
            referencedRelation: 'issues'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'issue_activity_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      notifications: {
        Row: Notification
        Insert: Record<string, never>
        Update: Partial<Pick<Notification, 'is_read' | 'read_at'>>
        Relationships: [
          {
            foreignKeyName: 'notifications_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_issue_id_fkey'
            columns: ['issue_id']
            isOneToOne: false
            referencedRelation: 'issues'
            referencedColumns: ['id']
          },
        ]
      }
      notification_preferences: {
        Row: NotificationPreferences
        Insert: Partial<NotificationPreferences> & { user_id: string }
        Update: Partial<NotificationPreferences>
        Relationships: []
      }
    }
    Views: {
      v_issue_deadlines: {
        Row: Issue & { is_overdue: boolean; has_missed_target: boolean; completed_late: boolean | null; resolution_sort_date: string | null; next_deadline_at: string | null; is_due_soon: boolean }
        Relationships: Database['public']['Tables']['issues']['Relationships']
      }
      v_project_dashboard_stats: { Row: ProjectDashboardStats; Relationships: [] }
      v_member_stats: { Row: MemberStats; Relationships: [] }
    }
    Functions: {
      review_ai_finding: {
        Args: { p_finding_id: string; p_decision: 'CONFIRMED' | 'REJECTED'; p_review_note?: string | null }
        Returns: FindingReceipt[]
      }
      create_project: {
        Args: { p_name: string; p_key: string; p_description?: string | null }
        Returns: Project
      }
      invite_member: {
        Args: { p_project_id: string; p_email: string; p_role?: ProjectRole }
        Returns: ProjectInvitation
      }
      accept_project_invitation: {
        Args: { p_invitation_id: string }
        Returns: ProjectMember
      }
      decline_project_invitation: {
        Args: { p_invitation_id: string }
        Returns: void
      }
      qa_verify_issue: {
        Args: {
          p_issue_id: string
          p_result: QaResult
          p_comment?: string | null
          p_failure_reason?: string | null
        }
        Returns: string
      }
      join_project_with_access_code: {
        Args: { p_access_code: string }
        Returns: Project
      }
      regenerate_project_access_code: {
        Args: { p_project_id: string }
        Returns: string
      }
    }
  }
}
