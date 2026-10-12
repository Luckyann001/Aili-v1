import { handleInterrupt } from "../../../../turn/server";

// POST /api/turn/interrupt { request_id, state_rev }: stop that turn on this server instance.
export const POST = handleInterrupt;
