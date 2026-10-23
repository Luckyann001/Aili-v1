import { handleDemand } from "../../../turn/demandLog";

// POST /api/demand: notes "Tell me when it's ready" in the local demand log (dev only; see demandLog.ts).
export const POST = (request: Request) => handleDemand(request);
