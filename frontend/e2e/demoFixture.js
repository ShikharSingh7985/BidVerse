import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect, test as base } from '@playwright/test';
import { preview } from 'vite';

const backendDir = fileURLToPath(new URL('../../backend/', import.meta.url));
const virtualenvPython = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
const python = process.env.BIDVERSE_E2E_PYTHON || join(backendDir, virtualenvPython);

export const test = base.extend({
  demo: async ({}, use) => {
    const backend = spawn(python, ['-m', 'scripts.serve_demo_test'], {
      cwd: backendDir,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const lines = createInterface({ input: backend.stdout });
    const backendExit = once(backend, 'exit');
    let site;
    const previousTarget = process.env.BIDVERSE_API_TARGET;

    try {
      const [line] = await Promise.race([
        once(lines, 'line'),
        backendExit.then(([code]) => { throw new Error(`Demo backend exited before startup with code ${code}`); }),
      ]);
      const { port, now } = JSON.parse(line);
      const api = `http://127.0.0.1:${port}`;
      await expect.poll(async () => {
        const response = await fetch(`${api}/health/db`, { signal: AbortSignal.timeout(1000) }).catch(() => null);
        return response?.ok;
      }, { message: 'Wait for the FastAPI/PostgreSQL test server' }).toBe(true);

      process.env.BIDVERSE_API_TARGET = api;
      site = await preview({ preview: { host: '127.0.0.1', port: 0 } });
      const origin = `http://127.0.0.1:${site.httpServer.address().port}`;
      await use({ api, origin, now });
    } finally {
      try {
        if (site) await site.close();
      } finally {
        if (previousTarget === undefined) delete process.env.BIDVERSE_API_TARGET;
        else process.env.BIDVERSE_API_TARGET = previousTarget;
        lines.close();
        backend.stdin.end();
        const [code] = await backendExit;
        if (code !== 0) throw new Error(`Demo backend exited with code ${code}`);
      }
    }
  },
});
