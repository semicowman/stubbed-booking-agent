import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/web/app.js';
import { cleanPersonas } from '../../src/web/personas.js';

const NOW = () => Date.parse('2026-10-28T02:00:00Z');
const root = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));

async function start(replies, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'stub-web-'));
  let i = 0;
  const gate = extra.gate;
  const model = { name: 'fake model', chat: async () => { if (gate) await gate; return { text: replies[Math.min(i++, replies.length - 1)], usage: { input: 3, output: 2 } }; } };
  const logged = [];
  const app = createApp({ model, system: 's', now: NOW, log: { path: 'x.jsonl', write: (e) => logged.push(e) }, personasFile: join(dir, 'personas.json'), defaultsFile: root('config/personas.default.json'), indexFile: root('src/web/public/index.html'), ...extra.app });
  const server = http.createServer(app.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text };
  };
  return { call, base, server, logged, dir, close: () => { server.close(); server.closeAllConnections?.(); } };
}

test('the page and info are served', async () => {
  const s = await start(['hi']);
  const page = await s.call('GET', '/');
  assert.equal(page.status, 200);
  assert.match(page.text, /<title>Stubbed booking agent<\/title>/);
  assert.ok(!/https?:\/\/(?!localhost|127)/.test(page.text.replace(/<script>[\s\S]*<\/script>/, '')), 'the page loads nothing from outside');
  assert.deepEqual((await s.call('GET', '/api/info')).json, { model: 'fake model', isolated: true, actionLog: 'x.jsonl' });
  s.close();
});

test('a chat: the reply, masked notes, rules findings and the hand-over note come back', async () => {
  const s = await start([
    'Thanks, and your mobile number?\n[[ACTION confirm_age {"age_ok":true}]]\n[[ACTION update_request {"patient_type":"returning"}]]\n[[ACTION save_contact {"name":"Jo Tan","mobile":"9000 1111"}]]',
    'All done.\n[[ACTION end_session {"reason":"patient_declined","summary":"Did not want to book."}]]',
  ]);
  const { id } = (await s.call('POST', '/api/chats', {})).json;
  const first = await s.call('POST', `/api/chats/${id}/messages`, { text: 'I am over 16, my name is Jo Tan, 9000 1111' });
  assert.equal(first.status, 200);
  assert.equal(first.json.reply, 'Thanks, and your mobile number?');
  assert.deepEqual(first.json.notes[2].args, { name: '[recorded]', mobile: '[recorded]' });
  assert.equal(first.json.ended, false);
  const state = (await s.call('GET', `/api/chats/${id}`)).json;
  assert.equal(state.facts.patientType, 'returning');
  assert.ok(!JSON.stringify(state).includes('9000 1111'));
  const last = await s.call('POST', `/api/chats/${id}/messages`, { text: 'never mind' });
  assert.equal(last.json.ended, true);
  assert.equal(last.json.endReason, 'patient_declined');
  assert.match(last.json.handover, /BOOKING AGENT SUMMARY/);
  assert.match(last.json.reply, /This booking session has ended/);
  assert.ok(s.logged.every((e) => e.chat === id.slice(0, 8)));
  s.close();
});

test('bad input is refused with a clear message', async () => {
  const s = await start(['hi']);
  const { id } = (await s.call('POST', '/api/chats', {})).json;
  assert.equal((await s.call('POST', `/api/chats/${id}/messages`, { text: '   ' })).status, 400);
  assert.equal((await s.call('POST', `/api/chats/${id}/messages`, { text: 'x'.repeat(5000) })).status, 400);
  assert.equal((await s.call('POST', '/api/chats/00000000-0000-0000-0000-000000000000/messages', { text: 'hi' })).status, 404);
  assert.equal((await s.call('GET', '/nope')).status, 404);
  const wrongType = await fetch(`${s.base}/api/chats/${id}/messages`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hi' });
  assert.equal(wrongType.status, 415);
  const tooBig = await s.call('PUT', '/api/personas', { personas: [], pad: 'x'.repeat(300_000) });
  assert.equal(tooBig.status, 413);
  s.close();
});

test('only local hosts and this page\'s own origin are accepted', async () => {
  const s = await start(['hi']);
  const port = new URL(s.base).port;
  const viaHost = (host, headers = {}, method = 'GET', path = '/api/info') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Host: host, 'Content-Type': 'application/json', ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(method === 'GET' ? undefined : '{}');
  });
  assert.equal(await viaHost('localhost:' + port), 200);
  assert.equal(await viaHost('evil.example:' + port), 403, 'DNS rebinding');
  assert.equal(await viaHost('localhost:' + port, { Origin: 'http://evil.example' }, 'POST', '/api/chats'), 403, 'cross-site write');
  assert.equal(await viaHost('localhost:' + port, { Origin: 'http://localhost:' + port }, 'POST', '/api/chats'), 201);
  s.close();
});

test('a second message while the agent is still answering is refused', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = await start(['hi'], { gate });
  const { id } = (await s.call('POST', '/api/chats', {})).json;
  const first = s.call('POST', `/api/chats/${id}/messages`, { text: 'one' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await s.call('POST', `/api/chats/${id}/messages`, { text: 'two' })).status, 409);
  release();
  assert.equal((await first).status, 200);
  s.close();
});

test('a model failure is a 502 with the reason, and the chat stays usable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stub-web-'));
  let fail = true;
  const model = { name: 'm', chat: async () => { if (fail) throw new Error('Cannot reach the local model at http://x/v1: ECONNREFUSED'); return { text: 'ok', usage: {} }; } };
  const app = createApp({ model, system: 's', now: NOW, personasFile: join(dir, 'p.json'), defaultsFile: root('config/personas.default.json'), indexFile: root('src/web/public/index.html') });
  const server = http.createServer(app.handle);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const { json: { id } } = await post('/api/chats', {});
  const bad = await post(`/api/chats/${id}/messages`, { text: 'hi' });
  assert.equal(bad.status, 502);
  assert.match(bad.json.error, /Cannot reach the local model/);
  fail = false;
  assert.equal((await post(`/api/chats/${id}/messages`, { text: 'hi again' })).status, 200);
  server.close();
  server.closeAllConnections?.();
});

test('personas: defaults, save, validation, reset', async () => {
  const s = await start(['hi']);
  const first = (await s.call('GET', '/api/personas')).json;
  assert.equal(first.custom, false);
  assert.ok(first.personas.length >= 8);
  const edited = first.personas.slice(0, 2).map((p, i) => (i === 0 ? { ...p, name: 'Changed', facts: [...p.facts, { label: 'Extra', value: 'x' }] } : p));
  const saved = await s.call('PUT', '/api/personas', { personas: edited });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.personas[0].name, 'Changed');
  assert.equal(JSON.parse(readFileSync(join(s.dir, 'personas.json'), 'utf8')).length, 2);
  const again = (await s.call('GET', '/api/personas')).json;
  assert.equal(again.custom, true);
  assert.equal(again.personas.length, 2);
  const bad = await s.call('PUT', '/api/personas', { personas: [{ summary: 'no name' }] });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /name is required/);
  const reset = await s.call('POST', '/api/personas/reset', {});
  assert.ok(reset.json.personas.length >= 8);
  s.close();
});

test('persona cleaning: ids made unique, limits enforced, blank facts dropped', () => {
  const [a, b] = cleanPersonas([{ name: 'Jo Tan' }, { name: 'Jo Tan', facts: [{ label: '', value: '' }, { label: 'Email', value: 'a@test.local' }] }]);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(b.facts, [{ label: 'Email', value: 'a@test.local' }]);
  assert.throws(() => cleanPersonas('x'), /must be a list/);
  assert.throws(() => cleanPersonas([{ name: 'x'.repeat(81) }]), /longer than 80/);
  assert.throws(() => cleanPersonas([{ name: 'A', facts: Array.from({ length: 21 }, () => ({ label: 'a', value: 'b' })) }]), /at most 20 facts/);
  assert.throws(() => cleanPersonas([{ name: 'A', goal: 5 }]), /goal must be text/);
});

test('the shipped example personas are valid and carry made-up details only', () => {
  const list = cleanPersonas(JSON.parse(readFileSync(root('config/personas.default.json'), 'utf8')));
  assert.ok(list.length >= 8);
  for (const p of list) for (const f of p.facts) assert.ok(!/@/.test(f.value) || /@test\.local$/.test(f.value), `${p.name}: ${f.value}`);
});
