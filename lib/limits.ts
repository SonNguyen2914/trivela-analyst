// Best-effort spend guard for a public demo: per-IP hourly limit on Ask and a
// daily cap on LLM calls. In-memory, so it resets when the server restarts;
// the provider-side spend limit is the hard backstop.

const perIp = new Map<string, number[]>();
let day = "";
let calls = 0;

export function allowAsk(ip: string, now = Date.now()): boolean {
  const limit = Number(process.env.ASK_PER_IP_PER_HOUR ?? 10);
  const recent = (perIp.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= limit) return false;
  recent.push(now);
  perIp.set(ip, recent);
  return true;
}

export function takeDailyCall(now = new Date()): boolean {
  const d = now.toISOString().slice(0, 10);
  if (d !== day) { day = d; calls = 0; }
  if (calls >= Number(process.env.LLM_DAILY_CALLS ?? 300)) return false;
  calls += 1;
  return true;
}
