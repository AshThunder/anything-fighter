import Link from "next/link";

/** Shared top bar: logo, an always-visible "Powered by Aholo" badge, and the main nav. */
export function SiteHeader({ cta }: { cta?: "forge" | "gallery" }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <Link href="/" className="flex min-h-11 items-center font-arcade text-lg leading-none tracking-tight text-fg sm:text-xl" aria-label="Anything Fighter home">
          ANYTHING<span className="text-blaze">FIGHTER</span>
        </Link>
        <div className="flex items-center gap-2">
          <a
            href="https://www.aholo.ai/hackathon"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gold/60 px-2.5 text-[11px] font-bold uppercase tracking-wider text-gold hover:bg-gold/10"
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
            <Link href="/gallery" className="btn btn-outline btn-sm" data-nav="gallery">
              Gallery
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
