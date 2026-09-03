const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string | undefined
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50MB, matches the UI copy

export interface CloudinaryUploadResult {
  url: string
  publicId: string
  bytes: number
  format: string
  resourceType: string
  originalFilename: string
}

export function isCloudinaryConfigured() {
  return !!CLOUD_NAME && !!UPLOAD_PRESET
}

// Unsigned upload: the browser POSTs directly to Cloudinary with only the
// cloud name + an unsigned upload preset (configured in the Cloudinary
// dashboard as Signing Mode: Unsigned) — no API secret ever touches client
// code. The CLOUDINARY_URL in .env carries the secret and is intentionally
// unused here; it's not exposed to Vite anyway since it isn't VITE_-prefixed.
export async function uploadToCloudinary(
  file: File,
  folder: string,
): Promise<CloudinaryUploadResult> {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error(
      'Cloudinary is not configured. Set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET in .env.',
    )
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('File is larger than the 50MB limit.')
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('upload_preset', UPLOAD_PRESET)
  formData.append('folder', folder)

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`, {
    method: 'POST',
    body: formData,
  })

  const body = await res.json().catch(() => null)

  if (!res.ok) {
    throw new Error(body?.error?.message ?? 'Upload failed')
  }

  return {
    url: body.secure_url,
    publicId: body.public_id,
    bytes: body.bytes,
    format: body.format,
    resourceType: body.resource_type,
    originalFilename: file.name,
  }
}
