import { AHOLO_SERVICES, fighterServices, type AholoServiceKey, type FighterDef } from "@/lib/fighters";

/** "Powered by" strip: the Aholo / Manycore services that actually built a fighter. */
export function PoweredBy({ fighter, keys, active, className = "" }: { fighter?: FighterDef; keys?: AholoServiceKey[]; active?: AholoServiceKey; className?: string }) {
  const list = keys ?? (fighter ? fighterServices(fighter) : []);
  if (!list.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`} data-powered-by>
      <span className="mr-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-orange-200/50">Powered by Aholo</span>
      {list.map((k) => (
        <span
          key={k}
          title={`via ${AHOLO_SERVICES[k].via}`}
          className={`rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider ${
            active === k ? "animate-pulse border-orange-400 bg-orange-500/20 text-orange-50" : "border-orange-300/20 bg-black/30 text-orange-100/75"
          }`}
        >
          {AHOLO_SERVICES[k].label}
        </span>
      ))}
    </div>
  );
}
