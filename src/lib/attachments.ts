import { supabase } from './supabase'
import { MAX_UPLOAD_BYTES } from './cloudinary'

const bucket = 'issue-attachments'

export async function saveIssueAttachment(file: File, projectId: string, issueId: string, userId: string, verificationId?: string) {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('File is larger than the 50MB limit.')
  const path = `${projectId}/${issueId}/${crypto.randomUUID()}`
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })
  if (uploadError) throw uploadError
  const fields = {
    uploaded_by: userId,
    storage_path: path,
    file_name: file.name,
    mime_type: file.type || null,
    file_size_bytes: file.size,
  }
  const { error } = verificationId
    ? await supabase.from('qa_verification_attachments').insert({ ...fields, qa_verification_id: verificationId })
    : await supabase.from('issue_attachments').insert({ ...fields, issue_id: issueId })
  if (error) {
    await supabase.storage.from(bucket).remove([path])
    throw error
  }
}

export async function resolveAttachmentUrls<T extends { storage_path: string }>(rows: T[]): Promise<(T & { url: string })[]> {
  return Promise.all(rows.map(async (row) => {
    // Existing Cloudinary assets remain compatible; never render arbitrary
    // caller-supplied URL schemes as links or image sources.
    if (/^https:\/\/res\.cloudinary\.com\//i.test(row.storage_path)) {
      return { ...row, url: row.storage_path }
    }
    if (row.storage_path.includes('://')) throw new Error('Unsupported attachment URL')
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(row.storage_path, 300)
    if (error) throw error
    return { ...row, url: data.signedUrl }
  }))
}

export async function removeAttachmentFile(path: string) {
  if (/^https:\/\//i.test(path)) return // Legacy Cloudinary assets require server-side deletion.
  const { error } = await supabase.storage.from(bucket).remove([path])
  if (error) throw error
}
