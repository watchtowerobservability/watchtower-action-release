'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const mask = (s, key) => (key ? String(s).split(key).join('***') : String(s));

function client(base, key, project) {
  const root = `${base.replace(/\/+$/, '')}/v1/projects/${encodeURIComponent(project)}`;
  return async function call(method, p, { body, headers } = {}) {
    const res = await fetch(root + p, {
      method,
      headers: { authorization: `Bearer ${key}`, ...headers },
      body,
    });
    const text = await res.text();
    if (!res.ok && res.status !== 409) throw new Error(mask(`${method} ${p} -> ${res.status} ${text.slice(0, 300)}`, key));
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
}

const git = (...a) => {
  try {
    return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

/** Commits since the previous tag (the last 50 when there is none); tags need checkout fetch-depth: 0. */
function commitRange(sha, repo) {
  const prev = git('describe', '--tags', '--abbrev=0', `${sha}^`);
  const range = prev ? [`${prev}..${sha}`] : ['-50', sha];
  const out = git('log', '--format=%x01%H%x1f%ae%x1f%cI%x1f%s', '--name-only', ...range);
  return out
    .split('\x01')
    .filter(Boolean)
    .slice(0, 1000)
    .map((chunk) => {
      const [head, ...files] = chunk.split('\n').filter(Boolean);
      const [h, author_email, committed_at, message] = head.split('\x1f');
      return { sha: h, repo, author_email, committed_at, message, files: files.slice(0, 500) };
    });
}

function* walk(p) {
  if (fs.statSync(p).isFile()) return yield p;
  for (const e of fs.readdirSync(p)) yield* walk(path.join(p, e));
}

function artifactName(prefix, rel) {
  return path.posix.join(prefix.replace(/^~?\/*/, ''), rel.split(path.sep).join('/')).replace(/^\/+/, '');
}

async function uploadFiles(call, { dirs, dist, prefix, release }) {
  let n = 0;
  for (const d of dirs) {
    const base = path.resolve(dist, d);
    const root = fs.statSync(base).isFile() ? path.dirname(base) : base;
    for (const file of walk(base)) {
      const isMap = file.endsWith('.map');
      if (!isMap && !file.endsWith('.js')) continue;
      const data = fs.readFileSync(file);
      // The API refuses scripts without a debug id (422), so skip them.
      if (!isMap && !data.subarray(-2048).toString().includes('//# debugId=')) continue;
      const q = new URLSearchParams({
        kind: isMap ? 'sourcemap' : 'minified',
        name: artifactName(prefix, path.relative(root, file)),
        release,
      });
      await call('POST', `/artifacts?${q}`, { body: data, headers: { 'content-type': 'application/octet-stream' } });
      n++;
    }
  }
  return n;
}

async function envId(call, name) {
  const find = async () => {
    let cursor = '';
    do {
      const { json } = await call('GET', `/environments?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const hit = json.data.find((e) => e.name === name);
      if (hit) return hit.id;
      cursor = json.next_cursor;
    } while (cursor);
    return null;
  };
  const id = await find();
  if (id) return id;
  const r = await call('POST', '/environments', {
    body: JSON.stringify({ name }),
    headers: { 'content-type': 'application/json' },
  });
  return r.status === 409 ? find() : r.json.id; // 409: created concurrently
}

async function run(env, log = console.log) {
  const inp = (n) => (env[`INPUT_${n.toUpperCase()}`] || '').trim();
  const key = env.WT_AUTH_TOKEN;
  const project = inp('project') || env.WT_PROJECT;
  if (!key) throw new Error('WT_AUTH_TOKEN is required (store it as a repository secret)');
  if (!project) throw new Error('project input or WT_PROJECT is required');
  const sha = env.GITHUB_SHA || git('rev-parse', 'HEAD');
  const version = inp('release') || sha;
  if (!version) throw new Error('release input is required outside a git checkout');
  const call = client(inp('api_url') || env.WT_API_URL || 'https://api.watchtower.observer', key, project);
  const json = { 'content-type': 'application/json' };

  const commits = sha ? commitRange(sha, env.GITHUB_REPOSITORY || '') : [];
  await call('POST', '/releases', {
    body: JSON.stringify({ version, ref: sha || undefined, commits }),
    headers: json,
  });
  log(`release ${version} ready (${commits.length} commits)`);

  const dirs = inp('sourcemaps').split(/\s+/).filter(Boolean);
  if (dirs.length) {
    const n = await uploadFiles(call, { dirs, dist: inp('dist') || '.', prefix: inp('url_prefix'), release: version });
    log(`uploaded ${n} files`);
  }

  const environment = inp('environment');
  if (environment) {
    const now = new Date().toISOString();
    const done = inp('finalize') !== 'false';
    await call('POST', '/deployments', {
      body: JSON.stringify({
        version,
        env_id: await envId(call, environment),
        status: done ? 'succeeded' : 'started',
        started_at: now,
        finished_at: done ? now : undefined,
        source: 'github-actions',
      }),
      headers: json,
    });
    log(`deploy to ${environment} recorded`);
  }
  return version;
}

module.exports = { run, artifactName, commitRange };

if (require.main === module) {
  run(process.env)
    .then((v) => {
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `release=${v}\n`);
    })
    .catch((e) => {
      console.log(`::error::${mask(e.message, process.env.WT_AUTH_TOKEN)}`);
      process.exit(1);
    });
}
