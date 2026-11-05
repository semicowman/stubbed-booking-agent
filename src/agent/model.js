// The model behind the agent. One job: given a system prompt and the chat so far, return the next reply. There are no tools, no function
// calling and no streaming; the agent writes action notes as plain text (actions.js).
//
//   local   (default)  any OpenAI-compatible /chat/completions server: LM Studio http://localhost:1234/v1, Ollama http://localhost:11434/v1,
//                      llama-server. This is the only address the program contacts.
//   gemini             Google's Gemini API, with GEMINI_API_KEY. Not isolated while it is on: the chat leaves the computer.

const THINK_BLOCK = /<think>[\s\S]*?<\/think>/gi;
// Special tokens a local model sometimes prints around its thinking ("<|channel>thought<channel|>"): removed, the rest is kept.
export function cleanReply(text) {
  return String(text ?? '')
    .replace(THINK_BLOCK, '')
    .replace(/<\|?channel\|?>(?:thought)?/gi, '')
    .replace(/<\|[a-z_ ]{1,30}\|>/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// -> { name, chat({ system, messages }) -> { text, usage: { input, output } } }
export function createLocalModel({ baseUrl, model, temperature = 0.3, maxTokens = 4096, timeoutMs = 180_000, extraBody = {}, fetchFn = (...a) => globalThis.fetch(...a) }) {
  if (!baseUrl || !model) throw new Error('The local model needs a LOCAL_LLM_URL and a LOCAL_LLM_MODEL.');
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  return {
    name: `local "${model}" at ${baseUrl}`,
    async chat({ system, messages }) {
      const body = { ...extraBody, model, messages: [{ role: 'system', content: String(system ?? '') }, ...messages], temperature, max_tokens: maxTokens, stream: false };
      const payload = JSON.stringify(body);
      let res;
      let text;
      try {
        res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: AbortSignal.timeout(timeoutMs) });
        text = await res.text();
      } catch (err) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
          throw new Error(`The local model did not finish within ${Math.round(timeoutMs / 1000)}s (about ${Math.round(payload.length / 4)} tokens sent; LOCAL_LLM_TIMEOUT_MS raises the limit). Check the server console.`);
        }
        throw new Error(`Cannot reach the local model at ${baseUrl}: ${err?.cause?.code ?? err?.message ?? err}`);
      }
      if (!res.ok) throw new Error(`Local model HTTP ${res.status}: ${text.slice(0, 300)}`);
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error(`The local model returned something that is not JSON: ${text.slice(0, 200)}`); }
      const choice = parsed?.choices?.[0];
      const reply = cleanReply(choice?.message?.content);
      if (choice?.finish_reason === 'length' && !reply) {
        throw new Error(`The local model used all ${maxTokens} tokens without answering. It is probably a reasoning model spending the budget on thinking: turn thinking off on the server, or raise LOCAL_LLM_MAX_TOKENS.`);
      }
      const usage = parsed?.usage ?? {};
      return { text: reply, usage: { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 } };
    },
  };
}

// client: an object with models.generateContent (tests pass a fake); by default the real SDK, loaded only now so the local mode never needs it.
export async function createGeminiModel({ apiKey, model = 'gemini-3.1-flash-lite', temperature = 0.3, maxTokens = 4096, client = null }) {
  let ai = client;
  if (!ai) {
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set (MODEL_PROVIDER=gemini needs it).');
    let sdk;
    try { sdk = await import('@google/genai'); } catch { throw new Error('The Gemini option needs the @google/genai package: run "npm install".'); }
    ai = new sdk.GoogleGenAI({ apiKey, vertexai: false });
  }
  return {
    name: `gemini "${model}"`,
    async chat({ system, messages }) {
      const res = await ai.models.generateContent({
        model,
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        config: { systemInstruction: String(system ?? ''), temperature, maxOutputTokens: maxTokens },
      });
      const usage = res?.usageMetadata ?? {};
      return { text: cleanReply(res?.text), usage: { input: usage.promptTokenCount ?? 0, output: usage.candidatesTokenCount ?? 0 } };
    },
  };
}

// MODEL_PROVIDER=local|gemini; see .env.example for the rest.
export async function modelFromEnv(env = process.env) {
  const provider = String(env.MODEL_PROVIDER ?? 'local').toLowerCase();
  const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const temperature = num(env.TEMPERATURE, 0.3);
  const maxTokens = num(env.MAX_TOKENS, 4096);
  if (provider === 'gemini') return createGeminiModel({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || undefined, temperature, maxTokens });
  if (provider !== 'local') throw new Error(`MODEL_PROVIDER must be "local" or "gemini", not "${provider}".`);
  let extraBody = {};
  try { extraBody = env.LOCAL_LLM_EXTRA_BODY ? JSON.parse(env.LOCAL_LLM_EXTRA_BODY) : {}; } catch { throw new Error('LOCAL_LLM_EXTRA_BODY is not valid JSON.'); }
  return createLocalModel({ baseUrl: env.LOCAL_LLM_URL || 'http://localhost:1234/v1', model: env.LOCAL_LLM_MODEL || 'local', temperature, maxTokens, timeoutMs: num(env.LOCAL_LLM_TIMEOUT_MS, 180_000), extraBody });
}
