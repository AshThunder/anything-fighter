import { AHOLO_SERVICES, fighterServices, type AholoServiceKey, type FighterDef } from "@/lib/fighters";

/** "Powered by Aholo" strip: the Aholo / Manycore services that actually built a fighter. */
export function PoweredBy({ fighter, keys, active, className = "" }: { fighter?: FighterDef; keys?: AholoServiceKey[]; active?: AholoServiceKey; className?: string }) {
  const list = keys ?? (fighter ? fighterServices(fighter) : []);
  if (!list.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`} data-powered-by>
      <span className="mr-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-gold">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-[2px] bg-gold" />
        Powered by Aholo
      </span>
      {list.map((k) => (
        <span
          key={k}
          title={`via ${AHOLO_SERVICES[k].via}`}
          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide ${
            active === k ? "animate-pulse border-blaze bg-blaze text-ink" : "border-line-strong bg-panel-2 text-fg/90"
          }`}
        >
          {AHOLO_SERVICES[k].label}
        </span>
      ))}
    </div>
  );
}
