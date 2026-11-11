import fs from "node:fs";
import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import { exportsDir, getSession } from "../../../../lib/agent/http";
import { getDb } from "../../../../lib/agent/store";

// GET -> download one export, only if this session created it. The name must
// be a plain generated file name; the resolved path must stay in exports/.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = getSession(req, res);
  const name = String(req.query.name ?? "");
  if (!/^[a-z0-9-]{1,80}\.(md|csv)$/.test(name)) return res.status(400).json({ error: "bad file name" });
  const row = getDb().prepare("SELECT session FROM exports WHERE name = ?").get(name) as any;
  if (!row || row.session !== session) return res.status(404).json({ error: "not found" });
  const dir = path.resolve(exportsDir());
  const file = path.resolve(dir, name);
  if (path.dirname(file) !== dir || !fs.existsSync(file)) return res.status(404).json({ error: "not found" });
  res.setHeader("Content-Type", name.endsWith(".csv") ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.status(200).send(fs.readFileSync(file));
}
