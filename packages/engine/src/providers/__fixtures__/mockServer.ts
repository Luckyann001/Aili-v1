import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { onTestFinished } from "vitest";
import type { MockReply } from "./anthropicResponses";

// A local HTTP server on 127.0.0.1 for the adapter tests (no external network). Closed after each test.

export interface Received {
  headers: IncomingHttpHeaders;
  body: string;
}

/** A local server answering each request with the next reply (the last one repeats). */
export async function mockServer(replies: MockReply[]) {
  const received: Received[] = [];
  let closedEarly = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      const r = replies[received.length - 1] ?? replies.at(-1)!;
      if (r === "hang") return void res.on("close", () => closedEarly++);
      if ("raw" in r) return void (res.writeHead(r.status, { "content-type": "application/json" }), res.end(r.raw));
      res.writeHead(r.status, { "content-type": "application/json", ...r.headers });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const close = () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve())));
  onTestFinished(close);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received, closedEarly: () => closedEarly, close };
}

