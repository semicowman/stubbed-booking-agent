// Terminal chat with the stubbed booking agent: `npm run chat`.
// You play the patient. The agent's replies appear as the patient would see them; below each reply are the action notes it wrote
// (what it would have done), checked against the booking rules. Nothing is booked, sent or looked up.
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { modelFromEnv } from './agent/model.js';
import { buildSystemPrompt } from './agent/prompt.js';
import { createAgent } from './agent/agent.js';
import { createActionLog } from './agent/action-log.js';

try { process.loadEnvFile(); } catch { /* no .env: the defaults apply */ }

let model;
try {
  model = await modelFromEnv();
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

const log = createActionLog({ enabled: process.env.ACTION_LOG !== '0', dir: process.env.ACTION_LOG_DIR || 'logs' });
const system = buildSystemPrompt();
let pending = [];
const newAgent = () => createAgent({ model, system, onAction: (entry) => { log.write(entry); pending.push(entry); } });
let agent = newAgent();

const show = (entry) => {
  if (entry.action === 'staff_summary') return `  [noted] staff summary for the hand-over (${entry.why})`;
  const args = Object.keys(entry.args ?? {}).length ? ` ${JSON.stringify(entry.args)}` : '';
  const errors = entry.errors?.length ? `  <- rules: ${entry.errors.join(', ')}` : '';
  const problems = entry.problems?.length ? `  <- note problems: ${entry.problems.join('; ')}` : '';
  return `  [${entry.status.replace('_', ' ')}] ${entry.action}${args}${errors}${problems}`;
};

const HELP = `Commands:
  /reset     start a new conversation
  /actions   every action note so far, this run
  /state     what the rules check currently holds (no personal details)
  /help      this list
  /exit      quit (or Ctrl+C)`;

console.log('STUBBED booking agent: nothing is booked, sent or looked up. It writes action notes instead.');
console.log(`Model: ${model.name}${process.env.MODEL_PROVIDER === 'gemini' ? '   (the chat leaves this computer)' : ''}`);
console.log(log.path ? `Action log: ${log.path} (personal details are written as [recorded])` : 'Action log: off');
console.log(`${HELP}\n`);

const rl = readline.createInterface({ input, output, prompt: 'You: ' });
rl.prompt();
for await (const line of rl) {
  const text = line.trim();
  if (!text) { rl.prompt(); continue; }
  if (text === '/exit') break;
  if (text === '/help') console.log(HELP);
  else if (text === '/reset') { agent = newAgent(); console.log('New conversation.'); }
  else if (text === '/actions') console.log(log.entries.length ? log.entries.map(show).join('\n') : 'No action notes yet.');
  else if (text === '/state') {
    const s = agent.session;
    console.log(JSON.stringify({ patient: s.facts, draft: s.draft, flags: s.flags, requested: s.requested.map((r) => ({ service: r.service, clinic: r.clinic, date: r.date, time: r.time })), notBooked: s.notBooked, ended: s.ended ? s.ended.reason : null }, null, 2));
  } else {
    pending = [];
    try {
      const result = await agent.send(text);
      console.log(`\nAgent: ${result.reply}\n`);
      if (pending.length) console.log(`${pending.map(show).join('\n')}\n`);
      if (result.handover) console.log(`--- hand-over note for the team ---\n${result.handover}\n---\n`);
      if (result.ended) { console.log(`Session ended (${result.endReason}). /reset starts a new one.\n`); }
    } catch (err) {
      console.error(`\nThe model call failed: ${err.message}\n`);
    }
  }
  rl.prompt();
}
const u = agent.usage;
console.log(`\n${u.calls} model call(s), ${u.input} tokens in, ${u.output} tokens out this conversation.`);
process.exit(0);
