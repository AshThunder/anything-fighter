"use client";

import { useState } from "react";

type Report = {
  id: string;
  fighterId: string;
  fighterName?: string;
  reason: string;
  email?: string;
  at: number;
  status: "open" | "hidden" | "unpublished";
};

export default function ModerationPage() {
  const [secret, setSecret] = useState("");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const r = await fetch("/api/moderation", { headers: { "x-gallery-secret": secret } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(j.error ?? "Couldn't load reports.");
      setReports(null);
      return;
    }
    setReports(j.reports ?? []);
  };

  const act = async (id: string, action: "hide" | "unpublish") => {
    setBusy(`${action}:${id}`);
    setError(null);
    const r = await fetch("/api/moderation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, id, action }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) {
      setError(j.error ?? "That action failed.");
      return;
    }
    await load();
  };

  return (
    <main className="mx-auto max-w-3xl overflow-x-hidden px-4 py-6 text-fg sm:py-8">
      <h1 className="arcade-title text-[clamp(1.6rem,7vw,1.875rem)] [overflow-wrap:anywhere]">Moderation</h1>
      <p className="mt-2 text-sm text-muted">Owner-only queue. This page is not linked from the public site. Use the GALLERY_SECRET value.</p>
      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Secret"
          className="h-11 min-w-0 flex-1 rounded-lg border-2 border-line-strong bg-ink px-3 text-fg"
        />
        <button type="submit" className="btn btn-primary">
          Load reports
        </button>
      </form>
      {error && (
        <p className="mt-3 rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm" role="alert">
          {error}
        </p>
      )}
      {reports && (
        <ul className="mt-6 flex flex-col gap-3">
          {reports.length === 0 && <li className="text-muted">No reports yet.</li>}
          {reports.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <b>{r.fighterName ?? r.fighterId}</b>
                <span className="text-xs uppercase text-dim">{r.status}</span>
              </div>
              <div className="mt-1 text-xs text-dim">
                {r.fighterId} · {new Date(r.at).toLocaleString()}
                {r.email ? ` · ${r.email}` : ""}
              </div>
              <p className="mt-2 text-sm">{r.reason}</p>
              {r.status === "open" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={!!busy} onClick={() => act(r.fighterId, "unpublish")} className="btn btn-ghost btn-sm">
                    Unpublish photo
                  </button>
                  <button disabled={!!busy} onClick={() => act(r.fighterId, "hide")} className="btn btn-primary btn-sm">
                    Hide fighter
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
