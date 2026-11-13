import Link from "next/link";

/** Shared top bar: logo, an always-visible "Powered by Aholo" badge, and a solid Gallery (or Forge) CTA. */
export function GalleryIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 16l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function SiteHeader({ cta }: { cta?: "forge" | "gallery" }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-1.5 px-3 py-2 sm:gap-3 sm:px-6">
        <Link href="/" className="flex min-h-11 min-w-0 shrink items-center font-arcade text-[15px] leading-none tracking-tight text-fg sm:text-xl" aria-label="Anything Fighter home">
          <span className="max-[22.5rem]:hidden">ANYTHING</span><span className="text-blaze">FIGHTER</span>
        </Link>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <a
            href="https://www.aholo.ai/hackathon"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-gold/60 px-1.5 text-[11px] font-bold uppercase tracking-wider text-gold hover:bg-gold/10 sm:gap-1.5 sm:px-2.5"
            title="Built on Manycore Aholo: Lux3D, SpatialGen, Reality, Viewer, RenderCloud"
            data-aholo-badge
          >
            <span aria-hidden className="h-2 w-2 rounded-[2px] bg-gold" />
            <span className="hidden sm:inline">Powered by</span> Aholo
          </a>
          {cta === "forge" ? (
            <Link href="/#forge" className="btn btn-primary btn-sm">
              <span className="sm:hidden">+ Forge</span>
              <span className="hidden sm:inline">+ Forge a fighter</span>
            </Link>
          ) : (
            <Link href="/gallery" className="btn btn-gold btn-sm px-2 font-extrabold uppercase tracking-wide sm:px-3" data-nav="gallery">
              <GalleryIcon />
              Gallery
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
