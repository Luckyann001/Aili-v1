import { connection } from "next/server";
import { isLocalRequest, liveEnabled } from "@/turn/live";

// GET /api/live: whether live answers are on for THIS request (docs/m3-live-browser-plan.md slice 1).
// The client asks here instead of reading a public build flag, so nothing about live mode is in the
// bundle. Only a yes or no; no key, model or configuration detail. `connection()` makes it run per
// request (with Cache Components a GET handler is otherwise prerendered at build time).
export async function GET(request: Request) {
  await connection();
  return Response.json({ live: liveEnabled() && isLocalRequest(request) }, { headers: { "cache-control": "no-store" } });
}
