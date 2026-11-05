// The system instruction: the behaviour playbook, the clinic reference, and today's date (Singapore time).
import { readFileSync } from 'node:fs';
import { ACTIONS } from './actions.js';

const read = (name) => readFileSync(new URL(`../../prompts/${name}`, import.meta.url), 'utf8').trim();
export const PLAYBOOK = read('system-prompt.txt');
export const REFERENCE = read('clinic-reference.md');

export function sgtToday(now = Date.now()) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Singapore', weekday: 'long' }).format(now);
  return `${weekday}, ${date}`;
}

export function buildSystemPrompt({ now = Date.now() } = {}) {
  return `${PLAYBOOK}

---

The reference material below is for answering patient questions: locations, services and the service rules in plain words. The booking rules above and the rules checks always take precedence. Never quote prices.

${REFERENCE}

---

Today's date is ${sgtToday(now)} (Singapore Time, SGT / UTC+8): treat this as "today" for the rest of this conversation. Put dates in the patient's own words (date_text, for example "next Monday", "15 Oct"): the rules check works out the actual date, so do not convert them yourself.`.trim();
}

// The action names the playbook must describe (a test keeps the prompt and the parser in step).
export const ACTION_NAMES = Object.keys(ACTIONS);
