import type { NextApiRequest, NextApiResponse } from "next";
import { getCatalog, label } from "../../../lib/agent/matches";

// GET ?demo=1 -> the match catalog the planner will see.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cat = await getCatalog(req.query.demo === "1");
  res.status(200).json({ matches: cat.map((m) => ({ ...m, label: label(m) })) });
}
