import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../../src/agent/agent.js';

const NOW = () => Date.parse('2026-10-28T02:00:00Z');

// A model that answers from a script and remembers what it was sent.
function scripted(replies) {
  const calls = [];
  return {
    name: 'scripted',
    calls,
    async chat({ system, messages }) {
      calls.push({ system, messages: structuredClone(messages) });
      const next = replies[Math.min(calls.length - 1, replies.length - 1)];
      return { text: typeof next === 'function' ? next(messages) : next, usage: { input: 10, output: 5 } };
    },
  };
}
const make = (replies, extra = {}) => {
  const model = scripted(replies);
  const logged = [];
  const agent = createAgent({ model, system: 'SYSTEM', now: NOW, onAction: (e) => logged.push(e), ...extra });
  return { agent, model, logged };
};

test('the patient sees the reply without the notes; the notes are logged with private fields masked', async () => {
  const { agent, logged } = make(['Thanks! Your clinic?\n[[ACTION confirm_age {"age_ok":true}]]\n[[ACTION save_contact {"name":"A B","mobile":"91234567"}]]']);
  const r = await agent.send('I am over 16, A B, 9123 4567');
  assert.equal(r.reply, 'Thanks! Your clinic?');
  assert.deepEqual(logged.map((l) => [l.action, l.status, l.args]), [['confirm_age', 'noted', { age_ok: true }], ['save_contact', 'noted', { name: '[recorded]', mobile: '[recorded]' }]]);
  assert.equal(agent.usage.calls, 1);
});

test('the model sees its own earlier notes, and the rules-check hint comes with the next message', async () => {
  const { agent, model } = make([
    'Which clinic?\n[[ACTION confirm_age {"age_ok":true}]]\n[[ACTION save_contact {"name":"A B","mobile":"91234567"}]]\n[[ACTION update_request {"patient_type":"returning","service":"checkup","last_visit":"2026-08"}]]',
    'Noted.',
  ]);
  await agent.send('hi');
  await agent.send('Northpoint please');
  const second = model.calls[1].messages;
  assert.equal(second[1].role, 'assistant');
  assert.match(second[1].content, /\[\[ACTION save_contact/);
  assert.match(second[2].content, /^\[Rules check on your last notes, not from the patient\]/);
  assert.match(second[2].content, /Would you like to add a Stretch Session/);
  assert.match(second[2].content, /Patient: Northpoint please$/);
});

test('a reply that breaks a rule is not sent: the model is asked once to write it again', async () => {
  const { agent, model, logged } = make([
    'Sure, how about 1 Mar?\n[[ACTION confirm_age {"age_ok":true}]]\n[[ACTION save_contact {"name":"A B","mobile":"91234567"}]]\n[[ACTION update_request {"date_text":"1 Mar"}]]',
    'We can only book up to two months ahead. Which date works?\n[[ACTION confirm_age {"age_ok":true}]]\n[[ACTION save_contact {"name":"A B","mobile":"91234567"}]]\n[[ACTION update_request {"date_text":"next Tuesday"}]]',
  ]);
  const r = await agent.send('can I come 1 Mar');
  assert.equal(model.calls.length, 2);
  assert.match(model.calls[1].messages.at(-1).content, /broke the booking rules and was not sent/);
  assert.match(model.calls[1].messages.at(-1).content, /Send the patient exactly: "We can only take requests up to two months ahead/);
  assert.equal(r.reply, 'We can only book up to two months ahead. Which date works?');
  assert.equal(r.rejected.length, 1);
  assert.equal(r.errors.length, 0);
  assert.deepEqual(logged.map((l) => l.status), ['rejected', 'rejected', 'rejected', 'noted', 'noted', 'noted']);
  assert.equal(agent.session.draft.date, '2026-11-03', 'only the accepted attempt changed the state');
  assert.equal(agent.session.flags.contact, true);
});

test('after the retry the second reply is used even if it still has errors', async () => {
  const bad = 'x\n[[ACTION update_request {"clinic":"Tampines"}]]';
  const { agent, model, logged } = make([bad]);
  const r = await agent.send('hi');
  assert.equal(model.calls.length, 2);
  assert.equal(r.errors.length > 0, true);
  assert.equal(logged.at(-1).status, 'noted_with_errors');
});

test('under 16: only the fixed message is sent and the session ends', async () => {
  const { agent } = make(['Great, thanks for telling me.\n[[ACTION confirm_age {"age_ok":false}]]']);
  const r = await agent.send('my daughter is 12');
  assert.equal(r.ended, true);
  assert.equal(r.endReason, 'minor');
  assert.match(r.reply, /patients aged 16 and over/);
  assert.ok(!r.reply.includes('Great, thanks'));
  const after = await agent.send('hello?');
  assert.equal(after.reply, '');
  assert.equal(after.ended, true);
});

test('end_session adds the closing message after the agent\'s own text, and the hand-over note is returned', async () => {
  const { agent, logged } = make(['I\'ll pass that on.\n[[ACTION end_session {"reason":"handoff_to_staff","summary":"Wants a person."}]]']);
  const r = await agent.send('person please');
  assert.match(r.reply, /^I'll pass that on\.\n\nLet me get an agent to assist you/);
  assert.match(r.handover, /BOOKING AGENT SUMMARY/);
  assert.ok(logged.some((l) => l.action === 'staff_summary'));
});

test('a reply that is only notes gets a polite fallback instead of silence', async () => {
  const { agent } = make(['[[ACTION update_request {"patient_type":"new"}]]']);
  const r = await agent.send('hi');
  assert.match(r.reply, /Could you say it again/);
});

test('a model failure surfaces as an error and changes nothing', async () => {
  const agent = createAgent({ model: { name: 'x', chat: async () => { throw new Error('down'); } }, system: 's', now: NOW });
  await assert.rejects(agent.send('hi'), /down/);
  assert.equal(agent.turns, 1);
  assert.equal(agent.session.ended, null);
});
