import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalModel, createGeminiModel, modelFromEnv, cleanReply } from '../../src/agent/model.js';

const ok = (content, extra = {}) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop', ...extra }], usage: { prompt_tokens: 7, completion_tokens: 3 } }), { status: 200 });

test('local model: posts the system prompt and chat to /chat/completions, no tools', async () => {
  const seen = [];
  const fetchFn = async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return ok('Hello!'); };
  const model = createLocalModel({ baseUrl: 'http://local.test/v1/', model: 'tiny', fetchFn, temperature: 0.1 });
  const res = await model.chat({ system: 'SYS', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(seen[0].url, 'http://local.test/v1/chat/completions');
  assert.deepEqual(seen[0].body.messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }]);
  assert.equal(seen[0].body.tools, undefined);
  assert.equal(seen[0].body.temperature, 0.1);
  assert.deepEqual(res, { text: 'Hello!', usage: { input: 7, output: 3 } });
});

test('local model: thinking blocks and special tokens are removed', async () => {
  const model = createLocalModel({ baseUrl: 'http://x/v1', model: 'm', fetchFn: async () => ok('<think>hmm</think>Hi there<|im_end|>') });
  assert.equal((await model.chat({ system: '', messages: [] })).text, 'Hi there');
  assert.equal(cleanReply('<|channel>thought<channel|>Okay'), 'Okay');
});

test('local model: clear errors for HTTP failures, bad JSON, no answer and an unreachable server', async () => {
  const mk = (fetchFn) => createLocalModel({ baseUrl: 'http://x/v1', model: 'm', fetchFn, maxTokens: 50 });
  await assert.rejects(mk(async () => new Response('boom', { status: 500 })).chat({ system: '', messages: [] }), /HTTP 500/);
  await assert.rejects(mk(async () => new Response('<html>', { status: 200 })).chat({ system: '', messages: [] }), /not JSON/);
  await assert.rejects(mk(async () => ok('', { finish_reason: 'length' })).chat({ system: '', messages: [] }), /used all 50 tokens/);
  await assert.rejects(mk(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }).chat({ system: '', messages: [] }), /Cannot reach the local model at http:\/\/x\/v1: ECONNREFUSED/);
  await assert.rejects(mk(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }).chat({ system: '', messages: [] }), /did not finish within/);
});

test('gemini model: maps the chat to contents and reads text and usage (fake client)', async () => {
  const seen = [];
  const client = { models: { generateContent: async (req) => { seen.push(req); return { text: 'Hi', usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } }; } } };
  const model = await createGeminiModel({ client, model: 'g-test' });
  const res = await model.chat({ system: 'SYS', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }] });
  assert.deepEqual(seen[0].contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(seen[0].config.systemInstruction, 'SYS');
  assert.deepEqual(res, { text: 'Hi', usage: { input: 4, output: 2 } });
});

test('modelFromEnv: local by default, gemini needs a key, anything else is refused', async () => {
  assert.match((await modelFromEnv({})).name, /local "local" at http:\/\/localhost:1234\/v1/);
  assert.match((await modelFromEnv({ LOCAL_LLM_URL: 'http://100.1.2.3:8080/v1', LOCAL_LLM_MODEL: 'qwen' })).name, /qwen.*100\.1\.2\.3:8080/);
  await assert.rejects(modelFromEnv({ MODEL_PROVIDER: 'gemini' }), /GEMINI_API_KEY is not set/);
  await assert.rejects(modelFromEnv({ MODEL_PROVIDER: 'openai' }), /must be "local" or "gemini"/);
  await assert.rejects(modelFromEnv({ LOCAL_LLM_EXTRA_BODY: '{nope' }), /not valid JSON/);
});
