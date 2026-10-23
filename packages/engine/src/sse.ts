import type { TurnEvent } from "./turn";

// Server-Sent Events framing for turn events (CLAUDE.md: turn events over SSE). Pure: the route
// writes `encodeEvent` strings; the client feeds network chunks to `createSseParser`, which copes
// with events split across chunks, several events in one chunk, CRLF line ends and comment lines.

/** One event as an SSE frame. JSON on a single data line (JSON.stringify never emits newlines). */
export function encodeEvent(e: TurnEvent): string {
  return `event: ${e.type}\nid: ${e.turn_id}:${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;
}

/** A comment frame; clients ignore it. Useful to keep a connection open. */
export const encodeComment = (text: string) => `: ${text.replace(/[\r\n]+/g, " ")}\n\n`;

export interface SseParser {
  /** Feed the next chunk of text from the stream. */
  push(chunk: string): void;
  /** Text received after the last complete frame (an incomplete frame when the stream ended). */
  leftover(): string;
}

export function createSseParser(onEvent: (e: TurnEvent) => void, onError: (problem: string) => void = () => {}): SseParser {
  let buffer = "";
  let carryCR = false; // a "\r" at the end of a chunk may be the first half of "\r\n"
  const frame = (raw: string) => {
    const data: string[] = [];
    for (const line of raw.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "data") data.push(value);
    }
    if (data.length === 0) return; // comment-only or event/id-only frame
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      return onError("an event's data was not valid JSON");
    }
    const e = parsed as Partial<TurnEvent> | null;
    if (!e || typeof e !== "object" || typeof e.type !== "string" || typeof e.seq !== "number" || typeof e.rev !== "number" || typeof e.turn_id !== "string") {
      return onError("an event was missing type, turn_id, seq or rev");
    }
    onEvent(e as TurnEvent);
  };
  return {
    push(chunk) {
      let text = (carryCR ? "\r" : "") + chunk;
      carryCR = text.endsWith("\r");
      if (carryCR) text = text.slice(0, -1);
      buffer += text.replace(/\r\n?/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        frame(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    },
    leftover: () => buffer,
  };
}
