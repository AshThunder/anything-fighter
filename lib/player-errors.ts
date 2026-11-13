/**
 * Player-facing wording for forge / pipeline errors. The raw message (Aholo task output, HTTP codes, stack-ish
 * text) stays in the job log and server console, and is only shown behind a "Technical details" toggle.
 */
export function friendlyForgeError(raw: string | undefined | null, stage?: string): string {
  const m = raw ?? "";
  if (/not found|expired/i.test(m)) return "This forge job has expired. Forge a new fighter or pick one from the roster.";
  if (/retry limit/i.test(m)) return "We've retried this stage 3 times. Try another photo, or fight with the roster.";
  if (/RIG_|eligib|auto-?rig|skeleton/i.test(m) || stage === "rig") return "Lux3D couldn't fit a skeleton to this shape. Try a photo with a clearer, upright object.";
  if (/balance|credit|quota|insufficient|\b40[123]\b|forbidden|unauthori[sz]ed|auth|api key/i.test(m))
    return "Aholo's live forge is unavailable right now. Fight with the ready-made Lux3D roster meanwhile.";
  if (/\b429\b|rate limit|concurrency|busy/i.test(m)) return "Aholo is very busy right now. Retry in a minute.";
  if (/timed? ?out|network|fetch|\b5\d\d\b|ECONN|socket|terminated/i.test(m)) return "Aholo took too long to answer. Retry this stage.";
  if (/download/i.test(m)) return "We couldn't fetch the result from Aholo. Retry this stage.";
  const what =
    stage === "upload" ? "uploading your photo" : stage === "mascot" ? "designing the fighter" : stage === "mesh" ? "building the 3D mesh" : stage === "retarget" ? "adding fight moves" : "forging";
  return `Something went wrong while ${what}. Retry this stage, or try another photo.`;
}
