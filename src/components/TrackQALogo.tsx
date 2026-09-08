interface TrackQABugIconProps {
  className?: string
  withBackground?: boolean
}

/**
 * Official TrackQA Bug Logo Icon
 */
export function TrackQABugIcon({
  className = 'w-6 h-6',
  withBackground = true,
}: TrackQABugIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      className={className}
      fill="none"
      aria-hidden="true"
    >
      {withBackground && (
        <rect width="512" height="512" rx="128" fill="#1b1c3e" />
      )}

      <g fill="none" stroke="#ffffff" strokeLinecap="round" strokeLinejoin="round">
        {/* Antennae / Terminal nodes */}
        <path d="M220 128 C204 98 178 92 160 102" strokeWidth="16" />
        <path d="M292 128 C308 98 334 92 352 102" strokeWidth="16" />
        <circle cx="158" cy="104" r="6" fill="#ffffff" stroke="none" />
        <circle cx="354" cy="104" r="6" fill="#ffffff" stroke="none" />

        {/* Head */}
        <path d="M214 154 C214 130 298 130 298 154 Z" fill="#ffffff" strokeWidth="12" />

        {/* 6 Bug Legs - Angular geometric high-tech legs */}
        <path d="M180 200 L120 180 L102 136" strokeWidth="16" />
        <path d="M332 200 L392 180 L410 136" strokeWidth="16" />

        <path d="M164 260 L96 260 L78 288" strokeWidth="16" />
        <path d="M348 260 L416 260 L434 288" strokeWidth="16" />

        <path d="M182 320 L124 350 L108 400" strokeWidth="16" />
        <path d="M330 320 L388 350 L404 400" strokeWidth="16" />

        {/* Large Bold Solid QA Verification Shield Body */}
        <path
          d="M256 174 L340 216 V312 C340 376 256 418 256 418 C256 418 172 376 172 312 V216 Z"
          fill="#ffffff"
          stroke="none"
        />

        {/* Cutout Inverted Checkmark and Bug Split on Navy Inside Shield */}
        <path d="M256 200 V232" stroke="#1b1c3e" strokeWidth="14" />
        <path d="M218 288 L246 318 L296 256" stroke="#1b1c3e" strokeWidth="22" />
      </g>
    </svg>
  )
}

interface TrackQALogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showText?: boolean
  className?: string
  textClassName?: string
}

export default function TrackQALogo({
  size = 'md',
  showText = true,
  className = '',
  textClassName = '',
}: TrackQALogoProps) {
  const sizeMap = {
    sm: {
      icon: 'w-8 h-8',
      text: 'text-lg',
    },
    md: {
      icon: 'w-10 h-10',
      text: 'text-2xl',
    },
    lg: {
      icon: 'w-12 h-12',
      text: 'text-3xl',
    },
    xl: {
      icon: 'w-24 h-24',
      text: 'text-5xl',
    },
  }

  const { icon, text } = sizeMap[size]

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* Official Dark Squircle Vector Logo */}
      <TrackQABugIcon className={`${icon} shrink-0`} />

      {/* Bold Font Wordmark */}
      {showText && (
        <span
          className={`font-black tracking-tighter text-on-surface leading-none ${text} ${textClassName}`}
        >
          Track<span className="text-[#4338ca] font-black">QA</span>
        </span>
      )}
    </div>
  )
}
