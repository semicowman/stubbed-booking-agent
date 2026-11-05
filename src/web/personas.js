// Simulated-patient personas for the web page. A persona is a reminder card for the person typing as the patient: who they are, what they
// want, how they behave, and the made-up facts they know (click one to put it in the message box). Nothing here reaches the agent: the
// agent only ever sees what you type. Stored as plain JSON; use made-up details only.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const LIMITS = { personas: 50, facts: 20, name: 80, summary: 600, goal: 400, behaviour: 1000, language: 40, openingLine: 300, label: 60, value: 300 };

const text = (v, max, what, { required = false } = {}) => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : null;
  if (s === null) throw new Error(`${what} must be text`);
  if (required && !s) throw new Error(`${what} is required`);
  if (s.length > max) throw new Error(`${what} is longer than ${max} characters`);
  return s;
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'persona';

// input: anything parsed from JSON -> a clean list, or an Error whose message says what is wrong.
export function cleanPersonas(input) {
  if (!Array.isArray(input)) throw new Error('the personas must be a list');
  if (input.length > LIMITS.personas) throw new Error(`at most ${LIMITS.personas} personas`);
  const seen = new Set();
  return input.map((p, i) => {
    if (!p || typeof p !== 'object') throw new Error(`persona ${i + 1} is not an object`);
    const name = text(p.name, LIMITS.name, `persona ${i + 1}: name`, { required: true });
    let id = typeof p.id === 'string' && /^[a-z0-9-]{1,40}$/.test(p.id) ? p.id : slug(name);
    for (let n = 2; seen.has(id); n += 1) id = `${slug(name)}-${n}`;
    seen.add(id);
    const facts = p.facts == null ? [] : p.facts;
    if (!Array.isArray(facts)) throw new Error(`${name}: facts must be a list`);
    if (facts.length > LIMITS.facts) throw new Error(`${name}: at most ${LIMITS.facts} facts`);
    return {
      id,
      name,
      summary: text(p.summary, LIMITS.summary, `${name}: summary`),
      goal: text(p.goal, LIMITS.goal, `${name}: goal`),
      behaviour: text(p.behaviour, LIMITS.behaviour, `${name}: behaviour`),
      language: text(p.language, LIMITS.language, `${name}: language`),
      openingLine: text(p.openingLine, LIMITS.openingLine, `${name}: opening line`),
      facts: facts
        .map((f) => ({ label: text(f?.label, LIMITS.label, `${name}: fact label`), value: text(f?.value, LIMITS.value, `${name}: fact value`) }))
        .filter((f) => f.label || f.value),
    };
  });
}

// The saved personas (file), else the defaults shipped in config/. A saved file that cannot be read falls back to the defaults.
export async function loadPersonas({ file, defaultsFile }) {
  for (const [path, mine] of [[file, true], [defaultsFile, false]]) {
    try {
      return { personas: cleanPersonas(JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''))), custom: mine };
    } catch (err) {
      if (!mine) throw new Error(`The default personas (${defaultsFile}) cannot be read: ${err.message}`);
    }
  }
  return { personas: [], custom: false };
}

export async function savePersonas(file, personas) {
  const clean = cleanPersonas(personas);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(clean, null, 2)}\n`);
  return clean;
}

export async function resetPersonas({ file, defaultsFile }) {
  const { personas } = await loadPersonas({ file: defaultsFile, defaultsFile });
  await savePersonas(file, personas);
  return personas;
}
