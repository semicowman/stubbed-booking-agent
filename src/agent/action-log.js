// The action log: what the agent would have done, one JSON line per action note, in logs/ (git-ignored). The patient's own details
// (name, email, mobile, health information, the staff summary) are written as "[recorded]": the file shows what was done, not who to.
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export function createActionLog({ dir = 'logs', enabled = true, clock = () => new Date() } = {}) {
  const entries = [];
  const started = clock();
  const stamp = started.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const path = join(dir, `actions-${stamp}.jsonl`);
  let failed = false;
  return {
    path: enabled ? path : null,
    entries,
    write(entry) {
      const line = { at: clock().toISOString(), ...entry };
      entries.push(line);
      if (!enabled || failed) return;
      try {
        mkdirSync(dir, { recursive: true });
        appendFileSync(path, `${JSON.stringify(line)}\n`);
      } catch (err) {
        failed = true; // a log that cannot be written must not stop the chat
        console.warn(`[log] cannot write ${path}: ${err.message}`);
      }
    },
  };
}
