import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function waitForServer(url, timeoutMs = 10000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res);
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Server did not start on ${url}`));
        } else {
          setTimeout(attempt, 200);
        }
      });
    };
    attempt();
  });
}

test('starts an HTTP health endpoint in SSE mode', async () => {
  const child = spawn(process.execPath, ['index.js'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      USE_SSE: 'true',
      PORT: '3101',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  try {
    const res = await waitForServer('http://127.0.0.1:3101/');
    assert.equal(res.statusCode, 200);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
});
