import { handleTurn } from "../../../turn/server";

// POST /api/turn: one fake-director turn as Server-Sent Events. 404 unless NEXT_PUBLIC_AILI_FAKE_DIRECTOR=1.
export const POST = handleTurn;
