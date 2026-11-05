// The web page's back end: a request handler with no framework. It serves one HTML file and a small JSON API:
//
//   GET  /api/info                 the model in use, whether the chat leaves this computer, the action-log path
//   POST /api/chats                start a conversation -> { id }
//   POST /api/chats/:id/messages   { text } -> the reply, the action notes, the rules findings, the hand-over note
//   GET  /api/chats/:id            what the rules check holds so far (no personal details) and token use
//   GET/PUT /api/personas          the simulated-patient cards (saved to a local JSON file)
//   POST /api/personas/reset       back to the shipped examples
//
// Safety: the server is meant for http://localhost only (server.js binds the loopback address), and every request is also refused unless
// its Host header is a local name (DNS-rebinding), a write must come from this page's own origin and be JSON (cross-site forms), bodies
// are capped, and the page never shows model text as HTML.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createAgent } from '../agent/agent.js';
import { maskedArgs } from '../agent/actions.js';
import { loadPersonas, savePersonas, resetPersonas } from './personas.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_BODY = 256 * 1024;
const MAX_MESSAGE = 4000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return reject(new HttpError(415, 'send JSON'));
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { tooBig = true; chunks.length = 0; return; } // keep reading (and dropping) so the answer can be delivered
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(new HttpError(413, 'that is too large'));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new HttpError(400, 'not valid JSON')); }
    });
    req.on('error', reject);
  });
}

export function createApp({ model, system, now = Date.now, log = { write() {}, path: null }, personasFile, defaultsFile, indexFile, isolated = true, maxChats = 20 }) {
  const chats = new Map(); // id -> { agent, busy }

  const find = (id) => {
    const chat = chats.get(id);
    if (!chat) throw new HttpError(404, 'that conversation is not open any more: start a new one');
    return chat;
  };

  async function route(req, res, url) {
    const { method } = req;
    const path = url.pathname;
    if (method === 'GET' && path === '/') return send(res, 200, await readFile(indexFile, 'utf8'), 'text/html; charset=utf-8');
    if (method === 'GET' && path === '/api/info') return send(res, 200, { model: model.name, isolated, actionLog: log.path ?? null });

    if (method === 'POST' && path === '/api/chats') {
      await readJson(req);
      const id = randomUUID();
      if (chats.size >= maxChats) chats.delete(chats.keys().next().value); // the oldest open chat goes
      chats.set(id, { busy: false, agent: createAgent({ model, system, now, onAction: (entry) => log.write({ chat: id.slice(0, 8), ...entry }) }) });
      return send(res, 201, { id });
    }

    let m = /^\/api\/chats\/([0-9a-f-]{36})(\/messages)?$/.exec(path);
    if (m) {
      const chat = find(m[1]);
      if (method === 'GET' && !m[2]) {
        const s = chat.agent.session;
        return send(res, 200, { turns: chat.agent.turns, usage: chat.agent.usage, facts: s.facts, draft: s.draft, flags: s.flags, requested: s.requested, notBooked: s.notBooked, ended: s.ended ? s.ended.reason : null });
      }
      if (method === 'POST' && m[2]) {
        const body = await readJson(req);
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) throw new HttpError(400, 'type a message first');
        if (text.length > MAX_MESSAGE) throw new HttpError(400, `messages are limited to ${MAX_MESSAGE} characters`);
        if (chat.busy) throw new HttpError(409, 'the agent is still answering the last message');
        chat.busy = true;
        try {
          const r = await chat.agent.send(text);
          return send(res, 200, {
            reply: r.reply,
            ended: r.ended,
            endReason: r.endReason,
            handover: r.handover ?? null,
            notes: r.notes.map((n) => ({ name: n.name, args: maskedArgs(n.args), problems: n.problems, invalid: n.invalid })),
            rejected: r.rejected.length,
            findings: r.findings.map((f) => ({ level: f.level, code: f.code, text: f.text, ...(f.say ? { say: f.say } : {}) })),
            usage: chat.agent.usage,
            turn: chat.agent.turns,
          });
        } catch (err) {
          throw new HttpError(502, `The model call failed: ${err.message}`);
        } finally {
          chat.busy = false;
        }
      }
    }

    if (path === '/api/personas') {
      if (method === 'GET') return send(res, 200, await loadPersonas({ file: personasFile, defaultsFile }));
      if (method === 'PUT') {
        const body = await readJson(req);
        try { return send(res, 200, { personas: await savePersonas(personasFile, body.personas), custom: true }); } catch (err) { throw new HttpError(400, err.message); }
      }
    }
    if (method === 'POST' && path === '/api/personas/reset') {
      await readJson(req);
      return send(res, 200, { personas: await resetPersonas({ file: personasFile, defaultsFile }), custom: true });
    }
    throw new HttpError(404, 'not found');
  }

  async function handle(req, res) {
    try {
      const host = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
      if (!LOCAL_HOSTS.has(host)) throw new HttpError(403, 'this page only answers on localhost');
      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) throw new HttpError(403, 'cross-site requests are refused');
      }
      await route(req, res, new URL(req.url, `http://${req.headers.host}`));
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      send(res, status, { error: status === 500 ? 'something went wrong on the server' : err.message });
    }
  }

  return { handle, chats };
}
