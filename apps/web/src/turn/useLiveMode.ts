"use client";

import { useEffect, useState } from "react";

// Whether live answers are on for this page (docs/m3-live-browser-plan.md slice 2), asked of the
// server (GET /api/live) rather than read from a public build flag, so nothing about live mode is in
// the bundle. null until the server answers; false on any failure.
export function useLiveMode(): boolean | null {
  const [live, setLive] = useState<boolean | null>(null);
  useEffect(() => {
    let on = true;
    fetch("/api/live", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { live: false }))
      .then((b: { live?: unknown }) => on && setLive(b.live === true))
      .catch(() => on && setLive(false));
    return () => {
      on = false;
    };
  }, []);
  return live;
}
