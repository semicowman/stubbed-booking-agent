// One conversation with the stubbed booking agent.
//
//   patient message -> model -> reply with action notes -> notes pulled out and checked against the booking rules (checks.js)
//     -> if a note or the reply breaks a rule, the model is asked once to write the reply again
//     -> the patient sees the reply without the notes, plus any fixed wording the rules require (closing message, warning)
//
// Nothing here calls anything but the model: the notes are only written down (onAction).

import { extractActions, maskedArgs } from './actions.js';
import { newSession, applyActions, describe } from './checks.js';

const EMPTY_REPLY = "Sorry, I didn't catch that. Could you say it again?";

export function createAgent({ model, system, now = Date.now, availability = undefined, onAction = () => {}, maxRetries = 1 }) {
  let session = newSession();
  let history = []; // what the model has seen: patient messages (with any rules-check hint) and its own replies, notes included
  let hint = '';
  let turn = 0;
  const usage = { input: 0, output: 0, calls: 0 };

  const logActions = (actions, status, extra = {}) => {
    for (const a of actions) onAction({ turn, action: a.name, args: maskedArgs(a.args), status, ...(a.problems.length ? { problems: a.problems } : {}), ...extra });
  };

  async function send(text) {
    if (session.ended) return { reply: '', ended: true, endReason: session.ended.reason, notes: [], rejected: [], findings: [] };
    turn += 1;
    const patientText = String(text ?? '').trim();
    const userContent = hint ? `[Rules check on your last notes, not from the patient]\n${hint}\n\nPatient: ${patientText}` : patientText;
    let messages = [...history, { role: 'user', content: userContent }];
    const rejected = [];
    let accepted = null;

    for (let attempt = 0; ; attempt += 1) {
      const res = await model.chat({ system, messages });
      usage.input += res.usage?.input ?? 0;
      usage.output += res.usage?.output ?? 0;
      usage.calls += 1;
      const parsed = extractActions(res.text);
      const trial = structuredClone(session);
      const checked = applyActions(trial, parsed.actions, { now: now(), availability });
      const errors = checked.findings.filter((f) => f.level === 'error');
      if (!errors.length || attempt >= maxRetries) {
        accepted = { raw: res.text, parsed, trial, checked, errors };
        break;
      }
      rejected.push({ actions: parsed.actions, errors });
      logActions(parsed.actions, 'rejected', { errors: errors.map((e) => e.code) });
      messages = [
        ...messages,
        { role: 'assistant', content: res.text },
        { role: 'user', content: `[Rules check, not from the patient]\nYour last reply broke the booking rules and was not sent:\n${describe(errors)}\n\nWrite the reply to the patient again. The notes of the rejected reply were discarded, so write every note this turn needs, corrected. Do not mention this check.` },
      ];
    }

    const { raw, parsed, trial, checked, errors } = accepted;
    session = trial;
    history = [...history, { role: 'user', content: userContent }, { role: 'assistant', content: raw }];
    logActions(parsed.actions, errors.length ? 'noted_with_errors' : 'noted', errors.length ? { errors: errors.map((e) => e.code) } : {});
    if (session.ended) onAction({ turn, action: 'staff_summary', status: 'noted', why: session.ended.reason });

    const visible = checked.suppressReply ? '' : parsed.reply;
    const reply = [visible, ...checked.appendix].filter(Boolean).join('\n\n') || EMPTY_REPLY;
    hint = session.ended ? '' : describe(dedupe(checked.findings.filter((f) => f.level === 'info')));
    return {
      reply,
      ended: Boolean(session.ended),
      endReason: session.ended?.reason ?? null,
      handover: session.handover ?? null,
      notes: parsed.actions.map((a) => ({ name: a.name, args: a.args, problems: a.problems, invalid: a.invalid })),
      rejected,
      findings: checked.findings,
      errors,
    };
  }

  return {
    send,
    get session() { return structuredClone(session); },
    get usage() { return { ...usage }; },
    get turns() { return turn; },
  };
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((f) => (seen.has(f.code) ? false : seen.add(f.code)));
}
