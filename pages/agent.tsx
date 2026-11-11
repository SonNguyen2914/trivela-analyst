import { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import type { Plan } from "../lib/agent/validator";
import type { ToolResult } from "../lib/agent/tools";
import type { AuditRow } from "../lib/agent/audit";

type Status = "pending" | "running" | "done" | "failed" | "skipped" | "refused";
type StepView = { status: Status; result?: ToolResult; error?: string; token?: string };
type PlanResp = {
  ok: boolean; kind?: "plan" | "question"; planId?: string; plan?: Plan; question?: string; summary?: string;
  errors?: string[]; error?: string; provider?: string; model?: string; system?: string;
  trace?: { attempt: number; raw: string; errors: string[] }[];
};

const EXAMPLES = [
  "Compare model vs market for every match",
  "Track Arsenal vs Everton if the gap is over 5%",
  "Export a report for Rayo vs Elche as CSV",
  "Simulate Montréal vs Nashville 20,000 times",
  "I think Arsenal win, log it with high confidence, then show my journal",
  "Clear my prediction journal",
  "Delete it",
];

function Result({ r }: { r: ToolResult }) {
  return (
    <div className="ag-result">
      <b>{r.title}</b>
      {r.text && <p>{r.text}</p>}
      {r.table && (
        <div className="tbl">
          <table>
            <thead><tr>{r.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{r.table.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{String(v)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      {r.download && <a className="btn ag-dl" href={r.download.url} download={r.download.name}>Download {r.download.name}</a>}
    </div>
  );
}

export default function Agent() {
  const router = useRouter();
  const demo = router.query.demo === "1";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState<PlanResp | null>(null);
  const [steps, setSteps] = useState<StepView[]>([]);
  const [running, setRunning] = useState(false);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [lastRequest, setLastRequest] = useState("");

  const loadAudit = useCallback(() => {
    fetch("/api/agent/audit").then((r) => r.json()).then((d) => setAudit(d.rows ?? [])).catch(() => {});
  }, []);
  useEffect(() => { loadAudit(); }, [loadAudit]);

  async function plan(request: string) {
    if (!request.trim() || busy) return;
    setBusy(true); setResp(null); setSteps([]); setLastRequest(request);
    try {
      const r = await fetch("/api/agent/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, demo }) });
      const d: PlanResp = await r.json().catch(() => ({ ok: false, error: "The server sent an unreadable answer." }));
      if (!r.ok) d.ok = false;
      setResp(d);
      if (d.ok && d.kind === "plan" && d.plan) setSteps(d.plan.steps.map(() => ({ status: "pending" })));
    } catch {
      setResp({ ok: false, error: "Could not reach the agent. Check your connection and try again." });
    } finally { setBusy(false); loadAudit(); }
  }

  async function runFrom(start: number, current: StepView[], tokens: Record<number, string> = {}) {
    if (!resp?.planId || !resp.plan) return;
    setRunning(true);
    const next = [...current];
    for (let i = start; i < resp.plan.steps.length; i++) {
      const s = resp.plan.steps[i];
      if (s.destructive && !tokens[i + 1]) {
        next[i] = { ...next[i], status: "pending" };
        setSteps([...next]);
        break; // wait for the Confirm click on this step
      }
      next[i] = { status: "running" }; setSteps([...next]);
      try {
        const r = await fetch("/api/agent/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planId: resp.planId, step: i + 1, token: tokens[i + 1] }) });
        const d = await r.json();
        next[i] = { status: (d.status ?? "failed") as Status, result: d.result, error: d.error ?? (r.ok ? undefined : "The server refused this step.") };
      } catch {
        next[i] = { status: "failed", error: "Could not reach the server." };
      }
      setSteps([...next]);
      if (next[i].status === "refused") break;
    }
    setRunning(false); loadAudit();
  }

  async function confirm(i: number) {
    if (!resp?.planId) return;
    const r = await fetch("/api/agent/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planId: resp.planId, step: i + 1 }) });
    const d = await r.json();
    if (!d.token) { const n = [...steps]; n[i] = { status: "refused", error: d.error ?? "Could not confirm." }; setSteps(n); return; }
    await runFrom(i, steps, { [i + 1]: d.token });
  }

  const started = steps.some((s) => s.status !== "pending");
  const nextPending = steps.findIndex((s) => s.status === "pending");
  const waitingConfirm = resp?.plan && nextPending >= 0 && resp.plan.steps[nextPending].destructive &&
    steps.slice(0, nextPending).every((s) => s.status !== "pending" && s.status !== "running");

  return (
    <>
      <Head><title>Trivela Agent</title></Head>
      <main className="wrap">
        <header className="top">
          <div>
            <h1>Trivela <span>Agent</span></h1>
            <p className="tag">Ask in plain English. The agent writes a plan, you see every step before it runs, and Trivela&apos;s own code checks and runs it. Match prediction and analysis only.</p>
          </div>
          <div className="meta">
            {demo ? <a href="/agent">Demo mode: saved matches · switch to live</a> : <a href="/agent?demo=1">Live matches · switch to demo mode</a>}
            {" · "}<a href="/">Trivela Analyst</a>
          </div>
        </header>

        <section className="panel ag-ask">
          <form onSubmit={(e) => { e.preventDefault(); plan(text); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={400} placeholder="e.g. Compare model vs market for today's matches" aria-label="Your request" />
            <button className="btn" disabled={busy || !text.trim()}>{busy ? "Planning…" : "Plan it"}</button>
          </form>
          <div className="chips">{EXAMPLES.map((x) => <button key={x} type="button" onClick={() => { setText(x); plan(x); }}>{x}</button>)}</div>
        </section>

        <div className="grid ag-grid">
          <section className="panel card" aria-live="polite">
            {!resp && !busy && <p className="skeleton">Type a request or pick an example. Nothing runs until you press Run.</p>}
            {busy && <p className="skeleton">Planning “{lastRequest}”…</p>}
            {resp && !resp.ok && (
              <div className="ag-error">
                <b>Nothing was run.</b>
                <p>{resp.error ?? "The agent could not make a valid plan for this request."}</p>
                {resp.errors && <ul>{resp.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              </div>
            )}
            {resp?.ok && resp.kind === "question" && (
              <div className="ag-question">
                <h3 className="meta">The agent needs to ask first</h3>
                <p className="headline">{resp.question}</p>
                <p className="qa">{resp.summary} Nothing was run.</p>
              </div>
            )}
            {resp?.ok && resp.kind === "plan" && resp.plan && (
              <>
                <div className="matchhead">
                  <p className="headline">{resp.plan.summary}</p>
                  {!started && !resp.plan.steps[0].destructive && <button className="btn" onClick={() => runFrom(0, steps)} disabled={running}>Run {resp.plan.steps.length} step{resp.plan.steps.length > 1 ? "s" : ""}</button>}
                </div>
                <ol className="ag-steps">
                  {resp.plan.steps.map((s, i) => {
                    const v = steps[i] ?? { status: "pending" };
                    return (
                      <li key={i} className={`ag-step ${v.status}`}>
                        <div className="ag-stephead">
                          <code>{s.tool}</code>
                          {s.destructive && <span className="conf low">deletes data</span>}
                          <span className={`ag-status ${v.status}`}>{v.status}</span>
                        </div>
                        <div className="meta">{Object.keys(s.args).length ? JSON.stringify(s.args) : "no arguments"}{s.depends_on.length ? ` · needs step ${s.depends_on.join(", ")}` : ""}</div>
                        <p className="ag-why">{s.why}</p>
                        {s.destructive && waitingConfirm && nextPending === i && (
                          <div className="ag-confirm">
                            <span>This step deletes data and cannot be undone.</span>
                            <button className="btn" onClick={() => confirm(i)} disabled={running}>Confirm and run</button>
                          </div>
                        )}
                        {v.error && <p className="err">{v.error}</p>}
                        {v.result && <Result r={v.result} />}
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            {resp && (resp.trace?.length ?? 0) > 0 && (
              <details className="how">
                <summary>How the agent planned this</summary>
                <p className="meta">Model: {resp.provider} {resp.model} · {resp.trace!.length} attempt{resp.trace!.length > 1 ? "s" : ""}</p>
                {resp.trace!.map((t) => (
                  <div key={t.attempt}>
                    <p className="meta">Attempt {t.attempt}: {t.errors.length ? `rejected by the validator (${t.errors.length} error${t.errors.length > 1 ? "s" : ""})` : "passed the validator"}</p>
                    {t.errors.length > 0 && <ul className="err">{t.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                    <pre>{t.raw}</pre>
                  </div>
                ))}
                <p className="meta">System prompt (persona + template with tools and matches + few-shot + verification ladder)</p>
                <pre>{resp.system}</pre>
              </details>
            )}
          </section>

          <aside className="panel ag-audit">
            <div className="matchhead"><h3 className="meta">Audit log · this session</h3><button className="ag-link" onClick={loadAudit}>refresh</button></div>
            {audit.length === 0 ? <p className="qa">Every plan, confirmation and step will be listed here.</p> : (
              <ul>
                {audit.map((a) => (
                  <li key={a.id}>
                    <span className="meta">{a.at.slice(11, 19)}</span> <code>{a.tool}</code>{a.step ? ` #${a.step}` : ""} <span className={`ag-status ${a.status}`}>{a.status}</span>
                    {a.error && <div className="err">{a.error}</div>}
                    {a.tool === "plan" && a.request && <div className="qa">“{a.request}”</div>}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
        <p className="foot">The language model only writes a plan. A whitelist of tools, a validator and a confirmation step decide what actually runs. Read-only on Trivela&apos;s models.</p>
      </main>
    </>
  );
}
