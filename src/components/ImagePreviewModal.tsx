import { useEffect } from 'react'
import { X, Download, ExternalLink, ZoomIn, ZoomOut, RotateCw } from 'lucide-react'
import { useState } from 'react'

export interface PreviewImage {
  url: string
  title: string
  size?: number | string
  uploader?: string
}

interface ImagePreviewModalProps {
  image: PreviewImage | null
  onClose: () => void
}

export default function ImagePreviewModal({ image, onClose }: ImagePreviewModalProps) {
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)

  // Reset zoom & rotation whenever image changes
  useEffect(() => {
    setScale(1)
    setRotation(0)
  }, [image?.url])

  // Keyboard controls: Escape to close
  useEffect(() => {
    if (!image) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === '+' || e.key === '=') {
        setScale((s) => Math.min(s + 0.25, 3))
      } else if (e.key === '-' || e.key === '_') {
        setScale((s) => Math.max(s - 0.25, 0.5))
      } else if (e.key === '0') {
        setScale(1)
        setRotation(0)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [image, onClose])

  if (!image) return null

  const handleDownload = async () => {
    try {
      const response = await fetch(image.url)
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = image.title || 'attachment'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(image.url, '_blank')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image Preview"
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-black/85 backdrop-blur-sm animate-in fade-in duration-150 select-none p-4 sm:p-6"
      onClick={onClose}
    >
      {/* Top Header Bar */}
      <div
        className="z-10 flex w-full max-w-5xl items-center justify-between rounded-xl border border-white/10 bg-[#161622]/90 px-4 py-3 shadow-2xl backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 items-center gap-3 pr-2">
          <div className="min-w-0">
            <h3 className="truncate font-mono text-sm font-semibold text-white">
              {image.title}
            </h3>
            {(image.size || image.uploader) && (
              <p className="font-mono text-xs text-slate-400">
                {image.size && <span>{image.size}</span>}
                {image.size && image.uploader && <span> · </span>}
                {image.uploader && <span>Uploaded by {image.uploader}</span>}
              </p>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(s - 0.25, 0.5))}
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            title="Zoom out (-)"
          >
            <ZoomOut size={17} />
          </button>
          <button
            type="button"
            onClick={() => setScale(1)}
            className="rounded-lg px-2 py-1 font-mono text-xs font-semibold text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            title="Reset Zoom (0)"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(s + 0.25, 3))}
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            title="Zoom in (+)"
          >
            <ZoomIn size={17} />
          </button>
          <button
            type="button"
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            title="Rotate 90°"
          >
            <RotateCw size={17} />
          </button>

          <div className="mx-1 h-5 w-[1px] bg-white/10" />

          <button
            type="button"
            onClick={handleDownload}
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            title="Download image"
          >
            <Download size={17} />
          </button>
          <a
            href={image.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            title="Open original in new tab"
          >
            <ExternalLink size={17} />
          </a>

          <button
            type="button"
            onClick={onClose}
            className="ml-1 rounded-lg bg-white/10 p-2 text-white hover:bg-rose-500 hover:text-white transition-colors"
            title="Close preview (Esc)"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div
        className="relative my-auto flex max-h-[80vh] max-w-[90vw] items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={image.url}
          alt={image.title}
          style={{
            transform: `scale(${scale}) rotate(${rotation}deg)`,
            transition: 'transform 0.15s ease-out',
          }}
          className="max-h-[78vh] max-w-[88vw] rounded-lg object-contain shadow-2xl ring-1 ring-white/15"
        />
      </div>

      {/* Footer Helper */}
      <div className="z-10 pb-2 text-center font-mono text-xs text-slate-400">
        Click outside or press <kbd className="rounded bg-white/15 px-1.5 py-0.5 text-white">Esc</kbd> to close
      </div>
    </div>
  )
}
