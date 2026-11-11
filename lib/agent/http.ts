// Shared bits for the /api/agent routes: the anonymous session cookie, the
// caller's IP for rate limits, and the per-request context for tools.

import crypto from "node:crypto";
import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "./store";
import type { Catalog } from "./matches";
import type { Ctx } from "./tools";

const COOKIE = "ta_sid";

export function getSession(req: NextApiRequest, res: NextApiResponse): string {
  const have = req.cookies?.[COOKIE];
  if (have && /^[a-f0-9]{32}$/.test(have)) return have;
  const sid = crypto.randomBytes(16).toString("hex");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
  return sid;
}

export const clientIp = (req: NextApiRequest) =>
  String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();

export const exportsDir = () => process.env.AGENT_EXPORTS ?? path.join(process.cwd(), "var", "exports");

export function ctxFor(session: string, catalog: Catalog): Ctx {
  return { db: getDb(), session, catalog, exportsDir: exportsDir() };
}
