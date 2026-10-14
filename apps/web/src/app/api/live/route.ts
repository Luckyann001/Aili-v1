import { connection } from "next/server";
import { isLocalRequest, liveEnabled, recordedLiveRequested } from "@/turn/live";
import { recordedLiveParts } from "aili-recorded-live";

// GET /api/live: whether live answers are on for THIS request (docs/m3-live-browser-plan.md slice 1).
// The client asks here instead of reading a public build flag, so nothing about live mode is in the
// bundle. Only a yes or no; no key, model or configuration detail. `connection()` makes it run per
// request (with Cache Components a GET handler is otherwise prerendered at build time).
export async function GET(request: Request) {
  await connection();
  // The e2e test build's recorded live path counts too, only for the test's own requests (slice 6).
  const recorded = !!recordedLiveParts && recordedLiveRequested(request);
  return Response.json({ live: (liveEnabled() || recorded) && isLocalRequest(request) }, { headers: { "cache-control": "no-store" } });
}
