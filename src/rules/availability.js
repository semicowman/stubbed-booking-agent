// Which clinics offer a service, and on which days (config/service-availability.json). The file is read once, when the agent
// starts. A file that can't be read or understood stops the start-up: running without it would let a patient request a class at a
// clinic that does not run one.

import { readFileSync } from 'node:fs';
import { resolveClinic } from './clinics.js';
import { SERVICES } from './rules.js';

const FILE = new URL('../../config/service-availability.json', import.meta.url);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// JSON text (or an object) -> { [service]: { clinics: [clinic code] | null, days: [weekday] | null } }
export function parseAvailability(input) {
  const raw = typeof input === 'string' ? JSON.parse(input.replace(/^﻿/, '')) : input;
  if (!raw || typeof raw !== 'object') throw new Error('the availability file must be a JSON object');
  const out = {};
  for (const [service, spec] of Object.entries(raw)) {
    if (service === 'about') continue;
    if (!(service in SERVICES)) throw new Error(`"${service}" is not a service`);
    const clinics = spec?.clinics == null ? null : spec.clinics.map((name) => {
      const c = resolveClinic(name);
      if (!c) throw new Error(`${service}: "${name}" is not a clinic`);
      return c.code;
    });
    const days = spec?.days == null ? null : spec.days.map((d) => {
      if (!WEEKDAYS.includes(d)) throw new Error(`${service}: "${d}" is not a weekday`);
      return d;
    });
    out[service] = { clinics, days };
  }
  return out;
}

export function loadAvailability(file = FILE) {
  try {
    return parseAvailability(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`The service availability file is not valid: ${e.message}`);
  }
}

let cached;
export const defaultAvailability = () => (cached ??= loadAvailability());

// Where a service can't be had as asked: null when it can, otherwise { code: 'not_at_clinic' | 'wrong_day', clinics?, days? }.
// clinicCode and weekday may be unknown (undefined): only what is known is checked.
export function availabilityProblem(avail, service, clinicCode, weekday) {
  const spec = avail[service];
  if (!spec) return null;
  if (clinicCode && spec.clinics && !spec.clinics.includes(clinicCode)) return { code: 'not_at_clinic', clinics: spec.clinics };
  if (weekday && spec.days && !spec.days.includes(weekday)) return { code: 'wrong_day', days: spec.days };
  return null;
}
