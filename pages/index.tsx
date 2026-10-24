import { useEffect, useState } from "react";
import type { PreviewOut, AskOut, Rendered } from "../lib/analyst";
import { displayValue } from "../lib/factSheet";

type Fx = { id: string; date: string; home: string; away: string };
type Demo = { slug: string; league: string; eventId: string; home: string; away: string; date: string };
type Sel = { league: string; id: string; demo?: string; home: string; away: string };

const LEAGUE_NAMES: Record<string, string> = { demo: "Demo", epl: "Premier League", laliga: "La Liga", mls: "MLS", ligamx: "Liga MX" };
const SUGGESTED = ["Why is the model favouring the home side?", "How likely is a draw?", "Does the market agree with Trivela?", "Will both teams score?"];

function Text({ r }: { r: Rendered }) {
  return (
    <>
      {r.segments.map((s, i) =>
        s.type === "text" ? <span key={i}>{s.text}</span>
        : s.type === "fact" ? <span key={i} className="num" title={`Verified: ${s.label} · ${s.source} (${s.factId})`}>{s.text}</span>
        : <span key={i} className="flag" title={s.reason}>{s.text}</span>)}
    </>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function Home() {
  const [fixtures, setFixtures] = useState<Record<string, Fx[]>>({});
  const [demos, setDemos] = useState<Demo[]>([]);
  const [tab, setTab] = useState("demo");
  const [sel, setSel] = useState<Sel | null>(null);
  const [preview, setPreview] = useState<PreviewOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<{ q: string; out: AskOut } | null>(null);
  const [askErr, setAskErr] = useState("");

  useEffect(() => {
    fetch("/api/fixtures").then((r) => r.json()).then((d) => {
      setFixtures(d.leagues ?? {});
      setDemos(d.demo ?? []);
      if (d.demo?.[0]) pick({ league: d.demo[0].league, id: d.demo[0].eventId, demo: d.demo[0].slug, home: d.demo[0].home, away: d.demo[0].away });
    }).catch(() => setErr("Could not reach Trivela for fixtures."));
  }, []);

  function pick(s: Sel) {
    setSel(s); setPreview(null); setAnswer(null); setErr(""); setAskErr(""); setLoading(true);
    const qs = s.demo ? `demo=${s.demo}` : `league=${s.league}&id=${s.id}`;
    fetch(`/api/preview?${qs}`).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Preview failed");
      setPreview(d);
    }).catch((e) => setErr(String(e.message))).finally(() => setLoading(false));
  }

  async function ask(question: string) {
    if (!sel || !question.trim()) return;
    setAsking(true); setAskErr("");
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ league: sel.league, id: sel.id, demo: sel.demo, question }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Ask failed");
      setAnswer({ q: question, out: d }); setQ("");
    } catch (e: any) { setAskErr(String(e.message)); }
    finally { setAsking(false); }
  }

  const list: { s: Sel; date: string }[] = tab === "demo"
    ? demos.map((d) => ({ s: { league: d.league, id: d.eventId, demo: d.slug, home: d.home, away: d.away }, date: d.date }))
    : (fixtures[tab] ?? []).map((f) => ({ s: { league: tab, id: f.id, home: f.home, away: f.away }, date: f.date }));

  const sheet = preview?.sheet;
  const prob = (label: string) => sheet?.facts.find((f) => f.label === label);
  const p = preview?.preview;
  const lastTrace = preview?.trace ?? [];

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Trivela <span>Analyst</span></h1>
          <p className="tag">An AI soccer analyst that explains Trivela&apos;s match predictions in plain English, and proves every number it says.</p>
        </div>
        <span className="meta">Predictions from Trivela&apos;s models · not betting advice</span>
      </header>

      <div className="grid">
        <aside className="panel" aria-label="Pick a match">
          <div className="tabs" role="group" aria-label="League">
            {["demo", "epl", "laliga", "mls", "ligamx"].map((t) => (
              <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{LEAGUE_NAMES[t]}</button>
            ))}
          </div>
          <div className="fx">
            {list.length === 0 && <span className="meta">No upcoming matches loaded.</span>}
            {list.map(({ s, date }) => (
              <button key={(s.demo ?? "") + s.id} aria-pressed={sel?.id === s.id && sel?.demo === s.demo} onClick={() => pick(s)}>
                {s.home} vs {s.away}<small>{LEAGUE_NAMES[s.league]} · {when(date)}{s.demo ? " · saved snapshot" : ""}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel card" aria-live="polite">
          {!sel && <div className="skeleton">Pick a match to get the Analyst&apos;s read.</div>}
          {sel && (
            <div className="matchhead">
              <h2>{sel.home} vs {sel.away}</h2>
              <span className="meta">{LEAGUE_NAMES[sel.league]}{sheet?.match.venue ? ` · ${sheet.match.venue}` : ""}{sheet ? ` · ${when(sheet.match.kickoff)}` : ""}</span>
            </div>
          )}
          {loading && <div className="skeleton">The Analyst is reading Trivela&apos;s numbers…</div>}
          {err && <p className="err">{err}</p>}

          {sheet && (
            <div className="stats" aria-label="Trivela model win, draw, loss">
              {[prob(`${sheet.match.home} win probability`), prob("Draw probability"), prob(`${sheet.match.away} win probability`)].map((f, i) => (
                <div className="stat" key={i}><b>{f ? displayValue(f) : "–"}</b><span>{[sheet.match.home, "Draw", sheet.match.away][i]}</span></div>
              ))}
            </div>
          )}

          {p && (
            <>
              <p className="headline"><Text r={p.headline} /></p>
              <div className="section"><h3>Why</h3><ul>{p.why.map((r, i) => <li key={i}><Text r={r} /></li>)}</ul></div>
              <div className="section"><h3>Risks</h3><ul>{p.risks.map((r, i) => <li key={i}><Text r={r} /></li>)}</ul></div>
              <div className="section"><h3>Model vs market</h3><Text r={p.market_view} /></div>
              <div className="section"><h3>Analyst confidence</h3><span className={`conf ${p.confidence}`}>{p.confidence}</span></div>
            </>
          )}
          {preview && !preview.ok && (
            <div className="section">
              <h3>Model numbers</h3>
              <p className="meta">The written preview is unavailable ({preview.fallbackReason}). Here are Trivela&apos;s raw numbers.</p>
              <ul>{preview.sheet.facts.slice(0, 8).map((f) => <li key={f.id}>{f.label}: <b>{displayValue(f)}</b></li>)}</ul>
            </div>
          )}

          {sheet && (
            <div className="section ask">
              <h3>Ask Trivela</h3>
              <form onSubmit={(e) => { e.preventDefault(); ask(q); }}>
                <input id="ask" value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} placeholder="Ask about this match…" aria-label="Your question" />
                <button className="btn" disabled={asking}>{asking ? "Thinking…" : "Ask"}</button>
              </form>
              <div className="chips">{SUGGESTED.map((s) => <button key={s} onClick={() => { setQ(s); ask(s); }}>{s}</button>)}</div>
              {askErr && <p className="err">{askErr}</p>}
              {answer && (
                <>
                  <div className="qa">You asked: {answer.q}</div>
                  <div className="answer">{answer.out.answer ? <Text r={answer.out.answer} /> : `No answer: ${answer.out.fallbackReason ?? "try again"}`}</div>
                </>
              )}
            </div>
          )}

          {preview && (
            <details className="how" id="how">
              <summary>How the Analyst works (prompt engineering)</summary>
              <div className="steps">
                <div className="step"><b>1 · Fact sheet</b>{preview.sheet.facts.length} numbers from Trivela, each with an id.</div>
                <div className="step"><b>2 · Persona</b>A plain-spoken analyst for fans. Never betting advice.</div>
                <div className="step"><b>3 · Template + few-shot</b>Strict JSON, one worked example.</div>
                <div className="step"><b>4 · Verification ladder</b>Numbers only as {"{{F#}}"} ids. Every number checked on the server.</div>
                <div className="step"><b>5 · Refine once</b>Failures are listed back to the model for one retry; anything left is flagged.</div>
              </div>
              <p className="meta">Provider: {preview.provider || "–"} {preview.model} · attempts: {lastTrace.length} · flagged after checks: {lastTrace.at(-1)?.violations.length ?? 0}{(preview as any).cached ? " · served from cache" : ""}</p>
              {lastTrace.map((t) => (
                <div key={t.attempt}>
                  <h3 className="meta">Attempt {t.attempt}: {t.violations.length ? `${t.violations.length} unverified number(s) → ${t.attempt === 1 ? "sent back for a rewrite" : "stripped and flagged"}` : "all numbers verified"}</h3>
                  <pre>{t.raw}</pre>
                </div>
              ))}
              <h3 className="meta">Fact sheet (Source A)</h3>
              <div className="tbl"><table><thead><tr><th>Id</th><th>Fact</th><th>Value</th><th>Source</th></tr></thead>
                <tbody>{preview.sheet.facts.map((f) => <tr key={f.id}><td>{f.id}</td><td>{f.label}</td><td>{displayValue(f)}</td><td>{f.source}</td></tr>)}</tbody></table></div>
              <h3 className="meta">System prompt sent to the model</h3>
              <pre>{preview.system}</pre>
            </details>
          )}
        </section>
      </div>
      <p className="foot">Data: Trivela (namson.dev/bet-suggester) model runs, Kalshi prices and ESPN results. The Analyst may only say numbers that are on the fact sheet; hover a green number to see where it came from.</p>
      <div id="caption" />
    </main>
  );
}
