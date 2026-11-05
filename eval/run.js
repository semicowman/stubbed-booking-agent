// `npm run eval`: scripted patients against the real agent and the model you configured (.env). Prints a one-line result per scenario
// and the failures; `-- --verbose` prints every conversation, `-- --only <text>` runs the scenarios whose name contains the text.
import { modelFromEnv } from '../src/agent/model.js';
import { buildSystemPrompt } from '../src/agent/prompt.js';
import { runScenario, formatTranscript } from './lib.js';
import { scenarios } from './scenarios.js';

try { process.loadEnvFile(); } catch { /* no .env */ }
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const only = args.includes('--only') ? String(args[args.indexOf('--only') + 1] ?? '').toLowerCase() : '';
const chosen = scenarios.filter((s) => !only || s.name.toLowerCase().includes(only));
if (!chosen.length) { console.error(`No scenario matches "${only}".`); process.exit(2); }

let model;
try { model = await modelFromEnv(); } catch (err) { console.error(err.message); process.exit(2); }
const system = buildSystemPrompt();
console.log(`Model: ${model.name}\n${chosen.length} scenario(s)\n`);

let failed = 0;
const tokens = { input: 0, output: 0, calls: 0 };
for (const scenario of chosen) {
  let result;
  try {
    result = await runScenario(scenario, { model, system, now: Date.now });
  } catch (err) {
    failed += 1;
    console.log(`ERROR  ${scenario.name}\n       ${err.message}\n`);
    continue;
  }
  tokens.input += result.usage.input; tokens.output += result.usage.output; tokens.calls += result.usage.calls;
  if (!result.passed) failed += 1;
  console.log(`${result.passed ? 'PASS ' : 'FAIL '}  ${scenario.name}  (${result.usage.calls} model calls, ${result.ended ? `ended: ${result.endReason}` : 'still open'})`);
  for (const p of result.problems) console.log(`         - ${p}`);
  if (verbose || !result.passed) console.log(`${formatTranscript(result)}\n`);
}
console.log(`\n${chosen.length - failed}/${chosen.length} passed. ${tokens.calls} model calls, ${tokens.input} tokens in, ${tokens.output} tokens out.`);
process.exit(failed ? 1 : 0);
