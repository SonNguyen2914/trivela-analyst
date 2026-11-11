import type { NextApiRequest, NextApiResponse } from "next";
import { getSession } from "../../../lib/agent/http";
import { readAudit } from "../../../lib/agent/audit";
import { getDb } from "../../../lib/agent/store";

// GET -> this session's audit log, newest first.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req, res);
  res.status(200).json({ rows: readAudit(getDb(), session, 100) });
}
