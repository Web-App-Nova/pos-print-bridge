#!/usr/bin/env node
/**
 * API smoke test against a running agent.
 * Usage: node scripts/smoke-test.mjs [baseUrl]
 */
const base = process.argv[2] || 'http://127.0.0.1:9247';

async function get(path) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const failures = [];

function assert(cond, msg) {
  if (!cond) failures.push(msg);
  else console.log(`  OK  ${msg}`);
}

console.log(`Smoke testing ${base}`);

const health = await get('/health');
assert(health.status === 200, 'GET /health 200');
assert(health.json?.status === 'running', 'health.status === running');
assert(typeof health.json?.version === 'string', 'health.version present');
assert(typeof health.json?.uptime === 'number', 'health.uptime present');

const status = await get('/status');
assert(status.status === 200, 'GET /status 200');
assert(status.json?.ok === true, 'status.ok === true');
assert(typeof status.json?.version === 'string', 'status.version present');

const version = await get('/version');
assert(version.status === 200, 'GET /version 200');
assert(version.json?.version === health.json?.version, 'version matches health');

const jobs = await get('/jobs');
assert(jobs.status === 200, 'GET /jobs 200');
assert(Array.isArray(jobs.json?.jobs), 'jobs array');

const bad = await post('/print', {});
assert(bad.status === 400, 'POST /print empty → 400');

const noTarget = await post('/print', { text: 'x' });
assert(noTarget.status === 400, 'POST /print no target → 400');

const queues = await get('/queues');
assert(queues.status === 200, 'GET /queues 200');

console.log('Discovery (may take up to 90s)…');
const discover = await get('/discover');
assert(discover.status === 200, 'GET /discover 200');
assert(Array.isArray(discover.json?.devices), 'discover.devices array');

const printers = await get('/printers');
assert(printers.status === 200, 'GET /printers 200');
assert(Array.isArray(printers.json), 'printers is array');

if (failures.length) {
  console.error('\nFAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('\nAll smoke checks passed.');
