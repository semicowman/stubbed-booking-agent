// Local web page for the stubbed booking agent: `npm run web`, then open http://localhost:3000.
// Listens on this computer only (127.0.0.1). Personas you edit are saved in data/personas.json (git-ignored).
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { modelFromEnv } from '../agent/model.js';
import { buildSystemPrompt } from '../agent/prompt.js';
import { createActionLog } from '../agent/action-log.js';
import { createApp } from './app.js';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

export async function startServer({ env = process.env, port = Number(env.PORT) || 3000, model = null, quiet = false } = {}) {
  const useModel = model ?? (await modelFromEnv(env));
  const log = createActionLog({ enabled: env.ACTION_LOG !== '0', dir: env.ACTION_LOG_DIR || 'logs' });
  const app = createApp({
    model: useModel,
    system: buildSystemPrompt(),
    log,
    isolated: String(env.MODEL_PROVIDER ?? 'local').toLowerCase() !== 'gemini',
    personasFile: here('../../data/personas.json'),
    defaultsFile: here('../../config/personas.default.json'),
    indexFile: here('./public/index.html'),
  });
  const server = http.createServer(app.handle);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const url = `http://localhost:${server.address().port}`;
  if (!quiet) {
    console.log(`Stubbed booking agent: ${url}  (this computer only)`);
    console.log(`Model: ${useModel.name}${String(env.MODEL_PROVIDER ?? 'local').toLowerCase() === 'gemini' ? '   (the chat leaves this computer)' : ''}`);
    console.log(log.path ? `Action log: ${log.path}` : 'Action log: off');
  }
  return { server, url, app };
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  try { process.loadEnvFile(); } catch { /* no .env: the defaults apply */ }
  try {
    await startServer();
  } catch (err) {
    console.error(err.code === 'EADDRINUSE' ? `Port ${process.env.PORT || 3000} is already in use: set PORT=<another number>.` : err.message);
    process.exit(2);
  }
}
