// One interface, three adapters. LLM_PROVIDER picks one; keys come only from
// the environment and are never logged or returned to the browser.

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type LlmResult = { text: string; provider: string; model: string };

export interface LlmClient {
  name: string;
  complete(system: string, messages: ChatMessage[], maxTokens?: number): Promise<LlmResult>;
}

class ClaudeClient implements LlmClient {
  name = "claude";
  constructor(private key: string, private model: string) {}
  async complete(system: string, messages: ChatMessage[], maxTokens = 4000): Promise<LlmResult> {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.key, "anthropic-version": "2023-06-01" },
      // Current Claude models reject `temperature`; the defaults are used.
      body: JSON.stringify({ model: this.model, max_tokens: maxTokens, system, messages }),
      signal: AbortSignal.timeout(55000),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      throw new Error(`Claude API ${r.status}: ${String(e?.error?.message ?? "").slice(0, 80)}`);
    }
    const j = await r.json();
    const text = (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    return { text, provider: "claude", model: this.model };
  }
}

class GeminiClient implements LlmClient {
  name = "gemini";
  constructor(private key: string, private model: string) {}
  async complete(system: string, messages: ChatMessage[], maxTokens = 4000): Promise<LlmResult> {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
      }),
      signal: AbortSignal.timeout(55000),
    });
    if (!r.ok) throw new Error(`Gemini API ${r.status}`);
    const j = await r.json();
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    return { text, provider: "gemini", model: this.model };
  }
}

// Deterministic stand-in for tests and for running without a key. It answers
// with placeholders only, so it always verifies.
export class MockClient implements LlmClient {
  name = "mock";
  constructor(private script?: string[]) {}
  private i = 0;
  async complete(): Promise<LlmResult> {
    if (this.script) return { text: this.script[Math.min(this.i++, this.script.length - 1)], provider: "mock", model: "mock" };
    const text = JSON.stringify({
      headline: "The model leans home at {{F1}}, with the draw at {{F2}}.",
      why: ["Home win sits at {{F1}} in Trivela's simulation.", "Expected goals favour the home side: {{F4}} to {{F5}}."],
      risks: ["The away side still wins {{F3}} of simulations."],
      market_view: "The market prices are on the fact sheet; compare them with the model's numbers.",
      confidence: "medium",
    });
    return { text, provider: "mock", model: "mock" };
  }
}

export function getClient(): LlmClient {
  const p = (process.env.LLM_PROVIDER ?? "claude").toLowerCase();
  if (p === "gemini" && process.env.GEMINI_API_KEY) return new GeminiClient(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL ?? "gemini-2.5-flash");
  if (p === "claude" && process.env.ANTHROPIC_API_KEY) return new ClaudeClient(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5");
  return new MockClient();
}
