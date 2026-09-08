import { TrackQABugIcon } from './TrackQALogo'

export default function AuthShowcasePanel() {
  return (
    <div className="hidden lg:flex lg:w-1/2 relative bg-[#12102e] items-center justify-center p-12 overflow-hidden select-none">


      {/* Center Brand Showcase: Vector Bug Logo & Bold Typography */}
      <div className="relative z-10 flex flex-col items-center text-center max-w-[440px] w-full px-6">
        <TrackQABugIcon className="w-40 h-40 drop-shadow-2xl" />

        {/* Bold Font Wordmark: LOGO */}
        <div className="mt-8">
          <h2 className="text-5xl font-black tracking-tight text-white leading-none">
            Track<span className="text-[#818cf8] font-black">QA</span>
          </h2>
        </div>
      </div>
    </div>
  )
}
