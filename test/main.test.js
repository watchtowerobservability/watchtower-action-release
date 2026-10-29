'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, artifactName } = require('../src/main.js');

function mockApi() {
  const calls = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() });
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET') return res.end(JSON.stringify({ data: [], next_cursor: null }));
      res.statusCode = 201;
      res.end(JSON.stringify({ id: 'env_1' }));
    });
  });
  return new Promise((ok) => srv.listen(0, () => ok({ srv, calls, url: `http://127.0.0.1:${srv.address().port}` })));
}

test('artifactName strips ~/ and joins prefix', () => {
  assert.equal(artifactName('~/static', 'js/a.js.map'), 'static/js/a.js.map');
  assert.equal(artifactName('', 'a.map'), 'a.map');
});

test('release, upload, environment create, deploy', async () => {
  const { srv, calls, url } = await mockApi();
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  fs.writeFileSync(path.join(dist, 'a.js'), 'x\n//# debugId=11111111-1111-1111-1111-111111111111\n');
  fs.writeFileSync(path.join(dist, 'b.js'), 'no id');
  fs.writeFileSync(path.join(dist, 'a.js.map'), '{}');
  const logs = [];
  const v = await run(
    {
      WT_AUTH_TOKEN: 'secret-key',
      GITHUB_SHA: 'abc123',
      INPUT_PROJECT: 'prj_1',
      INPUT_API_URL: url,
      INPUT_ENVIRONMENT: 'production',
      INPUT_SOURCEMAPS: '.',
      INPUT_DIST: dist,
      INPUT_URL_PREFIX: '~/static',
    },
    (l) => logs.push(l),
  );
  srv.close();
  assert.equal(v, 'abc123');
  assert.ok(calls.every((c) => c.auth === 'Bearer secret-key'));
  const ups = calls.filter((c) => c.url.includes('/artifacts?'));
  assert.equal(ups.length, 2); // b.js has no debug id and is skipped
  assert.ok(ups.some((c) => c.url.includes('kind=sourcemap') && c.url.includes('name=static%2Fa.js.map')));
  const dep = JSON.parse(calls.find((c) => c.url.endsWith('/deployments')).body);
  assert.deepEqual([dep.version, dep.env_id, dep.status], ['abc123', 'env_1', 'succeeded']);
  assert.ok(!logs.join().includes('secret-key'));
});

test('missing token fails', async () => {
  await assert.rejects(run({}), /WT_AUTH_TOKEN/);
});
