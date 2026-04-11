#!/usr/bin/env node
// panel/server.js — Admin panel HTTP server for ai-server-agent
// Zero npm dependencies. Uses only Node.js built-in modules.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

// --- Config ---

// Bootstrap: find the config file using env or code-relative path
const _BOOT_HOME = process.env.AGENT_HOME || path.resolve(__dirname, '..');
const _BOOT_CONFIG = path.join(_BOOT_HOME, 'config', 'agent.conf');

function parseConfigFile(configFile) {
  const config = {};
  if (!fs.existsSync(configFile)) return config;
  const lines = fs.readFileSync(configFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Match KEY=value, KEY="value", KEY='value', export KEY=value
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) {
      let val = match[2];
      // Strip outer quotes (single or double)
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      config[match[1]] = val;
    }
  }
  return config;
}

// First pass: read config to discover real AGENT_HOME
const _bootConfig = parseConfigFile(_BOOT_CONFIG);

// Resolve final AGENT_HOME: config file value takes precedence, but only if the path exists.
// In containers the conf may contain a host path that isn't mounted at the same location.
const _configHome = _bootConfig.AGENT_HOME;
const AGENT_HOME = (_configHome && fs.existsSync(_configHome)) ? _configHome : _BOOT_HOME;

// Derive all data paths from the resolved AGENT_HOME
const CONFIG_FILE = path.join(AGENT_HOME, 'config', 'agent.conf');
const STATE_FILE = path.join(AGENT_HOME, 'data', 'state.json');
const SCHEDULES_FILE = path.join(AGENT_HOME, 'data', 'schedules.json');
const TOPICS_DIR = path.join(AGENT_HOME, 'memory', 'topics');
const MEMORY_FILE = path.join(AGENT_HOME, 'memory', 'MEMORY.md');
const STATIC_DIR = path.join(__dirname, 'dist');

// Second pass: reload config from canonical path (may differ if AGENT_HOME changed)
function loadConfig() { return parseConfigFile(CONFIG_FILE); }

const config = loadConfig();
const ADMIN_TOKEN = config.ADMIN_TOKEN || process.env.ADMIN_TOKEN || '';
const PANEL_PORT = parseInt(config.PANEL_PORT || process.env.PANEL_PORT || '3000', 10);

console.log(`[panel] AGENT_HOME: ${AGENT_HOME}`);
console.log(`[panel] CONFIG: ${CONFIG_FILE}`);
console.log(`[panel] SCHEDULES: ${SCHEDULES_FILE}`);
console.log(`[panel] STATIC: ${STATIC_DIR}`);

if (!ADMIN_TOKEN) {
  console.error('ADMIN_TOKEN not set in config/agent.conf. Panel disabled.');
  process.exit(0);
}

// Discover providers from PROVIDER_CMD_* keys
function getProviders() {
  const providers = [];
  for (const key of Object.keys(config)) {
    const match = key.match(/^PROVIDER_CMD_(.+)$/);
    if (match) providers.push(match[1]);
  }
  return providers;
}

// --- JSON file helpers (atomic write) ---

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return filePath === SCHEDULES_FILE ? [] : {};
  }
}

function writeJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

// --- Auth ---

function checkAuth(req) {
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(ADMIN_TOKEN);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

// --- Routing ---

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function send401(res) {
  sendJSON(res, 401, { error: 'Unauthorized' });
}

function send404(res) {
  sendJSON(res, 404, { error: 'Not found' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Parse URL path parameters: /api/topics/:id/messages
function matchRoute(pattern, urlPath) {
  const patternParts = pattern.split('/');
  const urlParts = urlPath.split('/');
  if (patternParts.length !== urlParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(urlParts[i]);
    } else if (patternParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

// --- API Handlers ---

function apiTopics(req, res) {
  const state = readJSON(STATE_FILE);
  const topics = [];

  // Collect from state.json topics
  const stateTopics = state.topics || {};
  const topicProviders = state.topic_providers || {};
  const topicNames = state.topic_names || {};

  // Scan topic directories for data
  let topicDirs = [];
  try { topicDirs = fs.readdirSync(TOPICS_DIR); } catch {}

  // Build set of all known topic IDs
  const allIds = new Set([
    ...Object.keys(stateTopics),
    ...Object.keys(topicProviders),
    ...topicDirs.filter(d => /^\d+$/.test(d)),
  ]);

  // Also include schedule_topics
  const scheduleTopics = state.schedule_topics || {};
  for (const name of Object.keys(scheduleTopics)) {
    allIds.add(String(scheduleTopics[name]));
  }

  for (const id of allIds) {
    const topicDir = path.join(TOPICS_DIR, id);
    let msgCount = 0;
    let lastActivity = null;

    const msgsFile = path.join(topicDir, 'messages.jsonl');
    if (fs.existsSync(msgsFile)) {
      const lines = fs.readFileSync(msgsFile, 'utf8').trim().split('\n').filter(Boolean);
      msgCount = lines.length;
      if (msgCount > 0) {
        try {
          const last = JSON.parse(lines[lines.length - 1]);
          lastActivity = last.ts || null;
        } catch {}
      }
    }

    // Find schedule name if this is a schedule topic
    let scheduleName = null;
    for (const [name, tid] of Object.entries(scheduleTopics)) {
      if (String(tid) === String(id)) { scheduleName = name; break; }
    }

    topics.push({
      id: String(id),
      active: stateTopics[id]?.active === true,
      archived: stateTopics[id]?.archived === true,
      provider: topicProviders[id] || config.DEFAULT_PROVIDER || 'claude',
      messageCount: msgCount,
      lastActivity,
      scheduleName,
      label: scheduleName ? `Scheduled: ${scheduleName}` : (topicNames[id] || `Thread ${id}`),
    });
  }

  // Sort by last activity descending
  topics.sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''));
  sendJSON(res, 200, topics);
}

function validateTopicId(id) {
  return /^\d+$/.test(id);
}

function apiTopicMessages(req, res, params) {
  if (!validateTopicId(params.id)) return sendJSON(res, 400, { error: 'Invalid topic ID' });
  const msgsFile = path.join(TOPICS_DIR, params.id, 'messages.jsonl');
  if (!fs.existsSync(msgsFile)) return sendJSON(res, 200, []);
  const lines = fs.readFileSync(msgsFile, 'utf8').trim().split('\n').filter(Boolean);
  const messages = lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  sendJSON(res, 200, messages);
}

function apiTopicContext(req, res, params) {
  if (!validateTopicId(params.id)) return sendJSON(res, 400, { error: 'Invalid topic ID' });
  const ctxFile = path.join(TOPICS_DIR, params.id, 'context.md');
  if (!fs.existsSync(ctxFile)) return sendJSON(res, 200, { content: '' });
  sendJSON(res, 200, { content: fs.readFileSync(ctxFile, 'utf8') });
}

function apiGetMemory(req, res) {
  const content = fs.existsSync(MEMORY_FILE) ? fs.readFileSync(MEMORY_FILE, 'utf8') : '';
  sendJSON(res, 200, { content });
}

async function apiSaveMemory(req, res) {
  const body = await readBody(req);
  if (typeof body.content !== 'string') return sendJSON(res, 400, { error: 'content required' });
  fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
  fs.writeFileSync(MEMORY_FILE, body.content, 'utf8');
  sendJSON(res, 200, { ok: true });
}

function apiDeleteTopic(req, res, params) {
  if (!validateTopicId(params.id)) return sendJSON(res, 400, { error: 'Invalid topic ID' });
  const state = readJSON(STATE_FILE);
  const id = params.id;

  // Remove from state
  if (state.topics) delete state.topics[id];
  if (state.topic_providers) delete state.topic_providers[id];
  if (state.topic_workdirs) delete state.topic_workdirs[id];

  // Remove schedule_topics reference
  if (state.schedule_topics) {
    for (const [name, tid] of Object.entries(state.schedule_topics)) {
      if (String(tid) === String(id)) delete state.schedule_topics[name];
    }
  }

  writeJSON(STATE_FILE, state);

  // Delete topic directory
  const topicDir = path.join(TOPICS_DIR, id);
  if (fs.existsSync(topicDir)) {
    fs.rmSync(topicDir, { recursive: true, force: true });
  }

  sendJSON(res, 200, { ok: true });
}

function apiCloseTopic(req, res, params) {
  if (!validateTopicId(params.id)) return sendJSON(res, 400, { error: 'Invalid topic ID' });
  const state = readJSON(STATE_FILE);
  if (!state.topics) state.topics = {};
  if (!state.topics[params.id]) state.topics[params.id] = {};
  state.topics[params.id].active = false;
  writeJSON(STATE_FILE, state);
  sendJSON(res, 200, { ok: true });
}

function apiArchiveTopic(req, res, params) {
  if (!validateTopicId(params.id)) return sendJSON(res, 400, { error: 'Invalid topic ID' });
  const state = readJSON(STATE_FILE);
  if (!state.topics) state.topics = {};
  if (!state.topics[params.id]) state.topics[params.id] = {};
  state.topics[params.id].archived = true;
  state.topics[params.id].active = false;
  writeJSON(STATE_FILE, state);
  sendJSON(res, 200, { ok: true });
}

function apiUnarchiveTopic(req, res, params) {
  if (!validateTopicId(params.id)) return sendJSON(res, 400, { error: 'Invalid topic ID' });
  const state = readJSON(STATE_FILE);
  if (!state.topics) state.topics = {};
  if (!state.topics[params.id]) state.topics[params.id] = {};
  state.topics[params.id].archived = false;
  writeJSON(STATE_FILE, state);
  sendJSON(res, 200, { ok: true });
}

async function apiRenameTopic(req, res, params) {
  if (!validateTopicId(params.id)) return sendJSON(res, 400, { error: 'Invalid topic ID' });
  const body = await readBody(req);
  if (!body.label || typeof body.label !== 'string' || !body.label.trim()) {
    return sendJSON(res, 400, { error: 'label required' });
  }
  const state = readJSON(STATE_FILE);
  if (!state.topic_names) state.topic_names = {};
  state.topic_names[params.id] = body.label.trim();
  writeJSON(STATE_FILE, state);
  sendJSON(res, 200, { ok: true });
}

// Helper: make a GET request to Telegram Bot API
function telegramGet(method, params) {
  return new Promise((resolve, reject) => {
    const token = config.TELEGRAM_BOT_TOKEN || '';
    if (!token) return reject(new Error('TELEGRAM_BOT_TOKEN not configured'));
    const qs = new URLSearchParams(params).toString();
    const url = `https://api.telegram.org/bot${token}/${method}?${qs}`;
    https.get(url, (resp) => {
      let data = '';
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function apiSyncTopics(req, res) {
  const state = readJSON(STATE_FILE);
  const offset = state.last_update_id || 0;

  let updates;
  try {
    updates = await telegramGet('getUpdates', { timeout: 0, limit: 100, offset, allowed_updates: '["message"]' });
  } catch (err) {
    return sendJSON(res, 500, { error: `Telegram API error: ${err.message}` });
  }

  if (!updates.ok || !Array.isArray(updates.result)) {
    return sendJSON(res, 502, { error: 'Telegram API returned error', detail: updates });
  }

  const freshState = readJSON(STATE_FILE);
  if (!freshState.topic_names) freshState.topic_names = {};
  if (!freshState.topics) freshState.topics = {};

  let namesFound = 0, closedFound = 0, reopenedFound = 0;

  for (const update of updates.result) {
    const msg = update.message;
    if (!msg) continue;
    const tid = String(msg.message_thread_id || '');
    if (!tid) continue;

    // forum_topic_created: store name
    if (msg.forum_topic_created && msg.forum_topic_created.name) {
      freshState.topic_names[tid] = msg.forum_topic_created.name;
      namesFound++;
    }

    // forum_topic_closed: mark inactive
    if ('forum_topic_closed' in msg) {
      if (!freshState.topics[tid]) freshState.topics[tid] = {};
      freshState.topics[tid].active = false;
      closedFound++;
    }

    // forum_topic_reopened: mark active
    if ('forum_topic_reopened' in msg) {
      if (!freshState.topics[tid]) freshState.topics[tid] = {};
      freshState.topics[tid].active = true;
      reopenedFound++;
    }
  }

  writeJSON(STATE_FILE, freshState);
  sendJSON(res, 200, {
    ok: true,
    updatesScanned: updates.result.length,
    namesFound,
    closedFound,
    reopenedFound,
  });
}

function apiSchedules(req, res) {
  console.log(`[api] GET /api/schedules — reading ${SCHEDULES_FILE}`);
  const schedules = readJSON(SCHEDULES_FILE);
  console.log(`[api] Found ${schedules.length} schedule(s):`, schedules.map(s => s.name));
  const state = readJSON(STATE_FILE);
  const lastRuns = state.schedules_last_run || {};

  const enriched = schedules.map(s => ({
    ...s,
    lastRun: lastRuns[s.name] || null,
  }));

  sendJSON(res, 200, enriched);
}

async function apiCreateSchedule(req, res) {
  const body = await readBody(req);
  const schedules = readJSON(SCHEDULES_FILE);

  if (!body.name || !/^[a-zA-Z0-9_-]+$/.test(body.name) || !body.cron || !body.prompt) {
    return sendJSON(res, 400, { error: 'Invalid name (alphanumeric, -, _ only), cron, or prompt required' });
  }
  if (body.provider && !getProviders().includes(body.provider)) {
    return sendJSON(res, 400, { error: 'Invalid provider' });
  }
  if (body.workdir && !body.workdir.startsWith('/')) {
    return sendJSON(res, 400, { error: 'Workdir must be an absolute path' });
  }

  if (schedules.find(s => s.name === body.name)) {
    return sendJSON(res, 409, { error: `Schedule '${body.name}' already exists` });
  }

  schedules.push({
    name: body.name,
    cron: body.cron,
    prompt: body.prompt,
    provider: body.provider || null,
    workdir: body.workdir || '/git',
    topic_name: body.topic_name || `Scheduled: ${body.name}`,
  });

  writeJSON(SCHEDULES_FILE, schedules);
  sendJSON(res, 201, { ok: true });
}

async function apiUpdateSchedule(req, res, params) {
  const body = await readBody(req);
  const schedules = readJSON(SCHEDULES_FILE);
  const idx = schedules.findIndex(s => s.name === params.name);
  if (idx === -1) return send404(res);

  const s = schedules[idx];
  if (body.provider && !getProviders().includes(body.provider)) {
    return sendJSON(res, 400, { error: 'Invalid provider' });
  }
  if (body.workdir && !body.workdir.startsWith('/')) {
    return sendJSON(res, 400, { error: 'Workdir must be an absolute path' });
  }
  if (body.cron !== undefined) s.cron = body.cron;
  if (body.prompt !== undefined) s.prompt = body.prompt;
  if (body.provider !== undefined) s.provider = body.provider;
  if (body.workdir !== undefined) s.workdir = body.workdir;
  if (body.topic_name !== undefined) s.topic_name = body.topic_name;
  if (body.name !== undefined && body.name !== params.name) {
    // Rename: update schedule_topics in state
    s.name = body.name;
    const state = readJSON(STATE_FILE);
    if (state.schedule_topics && state.schedule_topics[params.name]) {
      state.schedule_topics[body.name] = state.schedule_topics[params.name];
      delete state.schedule_topics[params.name];
      writeJSON(STATE_FILE, state);
    }
  }

  writeJSON(SCHEDULES_FILE, schedules);
  sendJSON(res, 200, { ok: true });
}

function apiDeleteSchedule(req, res, params) {
  const schedules = readJSON(SCHEDULES_FILE);
  const filtered = schedules.filter(s => s.name !== params.name);
  if (filtered.length === schedules.length) return send404(res);
  writeJSON(SCHEDULES_FILE, filtered);
  sendJSON(res, 200, { ok: true });
}

function apiRunSchedule(req, res, params) {
  const schedules = readJSON(SCHEDULES_FILE);
  if (!schedules.find(s => s.name === params.name)) return send404(res);

  const script = path.join(AGENT_HOME, 'bin', 'schedule-run.sh');
  execFile('/bin/bash', [script, params.name], {
    env: { ...process.env, AGENT_HOME },
    cwd: AGENT_HOME,
  }, (err, stdout, stderr) => {
    if (err) {
      console.error(`schedule-run.sh error for '${params.name}':`, stderr || err.message);
    }
    if (stdout) console.log(`schedule-run.sh stdout:`, stdout.slice(0, 500));
  });

  sendJSON(res, 202, { ok: true, message: `Running '${params.name}' in background` });
}

function apiProviders(req, res) {
  sendJSON(res, 200, getProviders());
}

function apiStatus(req, res) {
  const state = readJSON(STATE_FILE);
  const schedules = readJSON(SCHEDULES_FILE);
  sendJSON(res, 200, {
    defaultProvider: state.default_provider || config.DEFAULT_PROVIDER || 'claude',
    topicCount: (() => {
      try { return fs.readdirSync(TOPICS_DIR).filter(d => /^\d+$/.test(d)).length; } catch { return 0; }
    })(),
    scheduleCount: schedules.length,
    pollTimeout: parseInt(config.POLL_TIMEOUT || '55', 10),
    providers: getProviders(),
  });
}

async function apiUpdateSettings(req, res) {
  const body = await readBody(req);

  // Update default_provider in state.json
  if (body.defaultProvider) {
    if (!getProviders().includes(body.defaultProvider)) {
      return sendJSON(res, 400, { error: 'Invalid provider' });
    }
    const state = readJSON(STATE_FILE);
    state.default_provider = body.defaultProvider;
    writeJSON(STATE_FILE, state);
  }


  sendJSON(res, 200, { ok: true });
}

// --- Static file serving ---

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  // Strip query string
  filePath = filePath.split('?')[0];
  const fullPath = path.join(STATIC_DIR, filePath);

  // Security: prevent directory traversal
  if (!fullPath.startsWith(STATIC_DIR)) return send404(res);

  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    // SPA fallback
    const indexPath = path.join(STATIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(indexPath));
      return;
    }
    return send404(res);
  }

  const ext = path.extname(fullPath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(fullPath));
}

// --- Request handler ---

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // API routes require auth
  if (pathname.startsWith('/api/')) {
    if (!checkAuth(req)) return send401(res);

    try {
      let params;

      // Topics
      if (method === 'GET' && pathname === '/api/topics') return apiTopics(req, res);
      if (method === 'GET' && (params = matchRoute('/api/topics/:id/messages', pathname))) return apiTopicMessages(req, res, params);
      if (method === 'GET' && (params = matchRoute('/api/topics/:id/context', pathname))) return apiTopicContext(req, res, params);
      if (method === 'DELETE' && (params = matchRoute('/api/topics/:id', pathname))) return apiDeleteTopic(req, res, params);
      if (method === 'POST' && (params = matchRoute('/api/topics/:id/close', pathname))) return apiCloseTopic(req, res, params);
      if (method === 'POST' && (params = matchRoute('/api/topics/:id/archive', pathname))) return apiArchiveTopic(req, res, params);
      if (method === 'POST' && (params = matchRoute('/api/topics/:id/unarchive', pathname))) return apiUnarchiveTopic(req, res, params);
      if (method === 'PUT' && (params = matchRoute('/api/topics/:id/rename', pathname))) return apiRenameTopic(req, res, params);
      if (method === 'POST' && pathname === '/api/topics/sync') return apiSyncTopics(req, res);

      // Schedules
      if (method === 'GET' && pathname === '/api/schedules') return apiSchedules(req, res);
      if (method === 'POST' && pathname === '/api/schedules') return apiCreateSchedule(req, res);
      if (method === 'PUT' && (params = matchRoute('/api/schedules/:name', pathname))) return apiUpdateSchedule(req, res, params);
      if (method === 'DELETE' && (params = matchRoute('/api/schedules/:name', pathname))) return apiDeleteSchedule(req, res, params);
      if (method === 'POST' && (params = matchRoute('/api/schedules/:name/run', pathname))) return apiRunSchedule(req, res, params);

      // Memory
      if (method === 'GET' && pathname === '/api/memory') return apiGetMemory(req, res);
      if (method === 'PUT' && pathname === '/api/memory') return apiSaveMemory(req, res);

      // System
      if (method === 'GET' && pathname === '/api/providers') return apiProviders(req, res);
      if (method === 'GET' && pathname === '/api/status') return apiStatus(req, res);
      if (method === 'PUT' && pathname === '/api/settings') return apiUpdateSettings(req, res);

      return send404(res);
    } catch (err) {
      console.error('API error:', err);
      sendJSON(res, 500, { error: err.message });
    }
    return;
  }

  // Static files (no auth)
  serveStatic(req, res);
});

server.listen(PANEL_PORT, '0.0.0.0', () => {
  console.log(`Admin panel listening on http://0.0.0.0:${PANEL_PORT}`);
});
