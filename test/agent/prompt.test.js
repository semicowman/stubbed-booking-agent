import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildSystemPrompt, PLAYBOOK, ACTION_NAMES, sgtToday } from '../../src/agent/prompt.js';
import { ACTIONS } from '../../src/agent/actions.js';

test('the playbook describes every action and every field the parser accepts', () => {
  for (const name of ACTION_NAMES) assert.ok(PLAYBOOK.includes(name), `action ${name} is not in the playbook`);
  for (const field of Object.keys(ACTIONS.update_request.fields)) assert.ok(PLAYBOOK.includes(field), `field ${field} is not in the playbook`);
  for (const reason of ACTIONS.end_session.fields.reason) assert.ok(PLAYBOOK.includes(reason), `end reason ${reason} is not in the playbook`);
});

test('the system prompt carries today\'s date in Singapore time', () => {
  const now = Date.parse('2026-10-28T17:00:00Z'); // already the 29th in Singapore
  assert.equal(sgtToday(now), 'Thursday, 2026-10-29');
  assert.match(buildSystemPrompt({ now }), /Today's date is Thursday, 2026-10-29/);
});

test('the prompt names no real booking system or tool', () => {
  const text = buildSystemPrompt();
  for (const word of ['Firestore', 'find_slots', 'MCP']) assert.ok(!text.includes(word), word);
});

// The repository is meant to hold nothing that connects to a real system. Checked across every file.
test('no source file refers to a real booking system or its credentials', () => {
  const banned = /firestore|@modelcontextprotocol|express\(|axios|firebase|mongodb|pg\(/i;
  const walk = (dir) => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'node_modules' || n === 'logs' || n === '.git') return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const self = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const hits = walk(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
    .filter((p) => /\.(js|mjs|json|md|txt|example)$/.test(p) && !p.endsWith('package-lock.json') && !/README\.md$/.test(p) && p.replace(/\\/g, '/') !== self.replace(/\\/g, '/'))
    .filter((p) => banned.test(readFileSync(p, 'utf8')));
  assert.deepEqual(hits, []);
});
