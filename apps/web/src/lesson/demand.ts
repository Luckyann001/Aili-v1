// "Tell me when it's ready" (the drone lesson's last chip): noted in the local demand log through
// POST /api/demand (dev only), and the page says plainly what happened (step 4 session 2).

export const DEMAND_NOTE = {
  written: "Noted on this computer only, in a local file. Nothing was sent anywhere.",
  test: "Noted (a test build: nothing was written).",
  unavailable: "Noting interest isn't available in this build yet.",
} as const;

export async function noteDemand(): Promise<string> {
  try {
    const res = await fetch("/api/demand", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ topic: "learned-controllers", from: "drone-pid lesson" }) });
    if (!res.ok) return DEMAND_NOTE.unavailable;
    const body = (await res.json()) as { written?: boolean };
    return body.written ? DEMAND_NOTE.written : DEMAND_NOTE.test;
  } catch {
    return DEMAND_NOTE.unavailable;
  }
}
