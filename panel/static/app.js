// ═══════════════════════════════════════════════════
// ai-server-agent — Operations Console
// Client-side SPA (zero dependencies)
// ═══════════════════════════════════════════════════

let token = localStorage.getItem('admin_token') || '';
let providers = [];
let statusData = {};
let expandedTopic = null;

// ── API layer ──

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401) { doLogout(); throw new Error('Unauthorized'); }
  const data = await res.json();
  if (!res.ok && res.status !== 202) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Auth ──

function doLogin() {
  const input = document.getElementById('token-input');
  token = input.value.trim();
  if (!token) return;
  localStorage.setItem('admin_token', token);
  api('GET', '/status').then(() => showApp()).catch(() => {
    document.getElementById('login-error').style.display = 'block';
    localStorage.removeItem('admin_token');
    token = '';
  });
}

function doLogout() {
  localStorage.removeItem('admin_token');
  token = '';
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login').style.display = 'flex';
  document.getElementById('token-input').value = '';
  document.getElementById('login-error').style.display = 'none';
}

function showApp() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  loadStatus();
  loadTopics();
  loadSchedules();
}

document.getElementById('token-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

// ── Tabs ──

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById(`tab-${tab.dataset.tab}`);
    panel.classList.add('active');
  });
});

// ── Toast ──

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2500);
}

// ── Status ──

async function loadStatus() {
  statusData = await api('GET', '/status');
  providers = statusData.providers || [];
  document.getElementById('header-provider').textContent = statusData.defaultProvider;
  renderSettings();
}

// ═══════════════════
// TOPICS
// ═══════════════════

async function loadTopics() {
  const topics = await api('GET', '/topics');
  const list = document.getElementById('topics-list');

  if (topics.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">💬</div>
        <div class="empty-state-text">No topics yet. Send a message via Telegram to get started.</div>
      </div>`;
    return;
  }

  list.innerHTML = topics.map((t, i) => {
    const statusCls = t.active ? 'active' : 'closed';
    const statusText = t.active ? 'Active' : 'Closed';
    const ts = t.lastActivity ? fmtTime(t.lastActivity) : 'No activity';
    const delay = `animation-delay: ${i * 0.04}s`;

    return `
    <div class="card" style="${delay}" id="topic-${t.id}">
      <div class="card-row">
        <div class="card-main">
          <div class="card-title" onclick="toggleMessages('${t.id}')">${esc(t.label)}</div>
          <div class="card-meta">
            <span class="meta-tag"><span class="provider-badge">${esc(t.provider)}</span></span>
            <span class="meta-tag">${t.messageCount} msgs</span>
            <span class="meta-tag">${ts}</span>
            <span class="meta-tag"><span class="status ${statusCls}">${statusText}</span></span>
          </div>
        </div>
        <div class="card-actions">
          ${t.active ? `<button class="icon-btn warn" onclick="closeTopic('${t.id}')" title="Close topic">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>` : ''}
          <button class="icon-btn danger" onclick="deleteTopic('${t.id}')" title="Delete topic">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 0 1 1.34-1.34h2.66a1.33 1.33 0 0 1 1.34 1.34V4M12 4v9.33a1.33 1.33 0 0 1-1.33 1.34H5.33A1.33 1.33 0 0 1 4 13.33V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
      <div class="card-messages" id="msgs-${t.id}"></div>
    </div>`;
  }).join('');
}

async function toggleMessages(topicId) {
  const panel = document.getElementById(`msgs-${topicId}`);

  if (expandedTopic === topicId) {
    panel.classList.remove('open');
    expandedTopic = null;
    return;
  }

  // Collapse previous
  if (expandedTopic) {
    const prev = document.getElementById(`msgs-${expandedTopic}`);
    if (prev) prev.classList.remove('open');
  }

  expandedTopic = topicId;
  panel.innerHTML = '<div style="padding:1rem;color:var(--text-3);font-size:0.8rem">Loading messages...</div>';
  panel.classList.add('open');

  const messages = await api('GET', `/topics/${topicId}/messages`);

  if (messages.length === 0) {
    panel.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text-3);font-size:0.82rem">No messages recorded</div>';
    return;
  }

  panel.innerHTML = messages.map(m => {
    const fromCls = m.from === 'user' ? 'user' : m.from === 'schedule' ? 'schedule' : 'agent';
    return `
    <div class="msg">
      <div class="msg-header">
        <span class="msg-from ${fromCls}">${esc(m.from)}</span>
        <span>${fmtTime(m.ts)}</span>
      </div>
      <div class="msg-body">${esc(truncate(m.text, 800))}</div>
    </div>`;
  }).join('');

  panel.scrollTop = panel.scrollHeight;
}

async function closeTopic(id) {
  await api('POST', `/topics/${id}/close`);
  toast('Topic closed');
  loadTopics();
}

async function deleteTopic(id) {
  if (!confirm('Delete this topic and all its messages?')) return;
  await api('DELETE', `/topics/${id}`);
  toast('Topic deleted');
  expandedTopic = null;
  loadTopics();
}

async function deleteClosedTopics() {
  const topics = await api('GET', '/topics');
  const closed = topics.filter(t => !t.active);
  if (closed.length === 0) { toast('No closed topics to delete'); return; }
  if (!confirm(`Permanently delete ${closed.length} closed topic(s)?`)) return;
  for (const t of closed) await api('DELETE', `/topics/${t.id}`);
  toast(`Purged ${closed.length} topics`);
  expandedTopic = null;
  loadTopics();
}

// ═══════════════════
// SCHEDULES
// ═══════════════════

async function loadSchedules() {
  const schedules = await api('GET', '/schedules');
  const list = document.getElementById('schedules-list');
  const interval = statusData.heartbeatInterval || 30;

  document.getElementById('heartbeat-note').innerHTML =
    `Schedules execute at heartbeat boundaries. Current interval: <strong>${interval} min</strong>`;

  if (schedules.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⏰</div>
        <div class="empty-state-text">No scheduled tasks. Click "New Task" to create one.</div>
      </div>`;
    return;
  }

  list.innerHTML = schedules.map((s, i) => {
    const human = cronToHuman(s.cron);
    const lastRun = s.lastRun ? s.lastRun.replace(/-/g, (m, idx) => idx > 9 ? ':' : '-') : 'Never';
    const delay = `animation-delay: ${i * 0.04}s`;

    return `
    <div class="card" style="${delay}">
      <div class="card-row">
        <div class="card-main">
          <div class="card-title" style="cursor:default">${esc(s.name)}</div>
          <div class="card-meta">
            <span class="meta-tag"><span class="sched-time">${esc(human)}</span></span>
            <span class="meta-tag"><span class="sched-cron">${esc(s.cron)}</span></span>
            <span class="meta-tag"><span class="provider-badge">${esc(s.provider || statusData.defaultProvider || 'default')}</span></span>
            <span class="meta-tag sched-prompt" title="${esc(s.prompt)}">${esc(s.prompt)}</span>
          </div>
          <div class="card-meta" style="margin-top:0.15rem">
            <span class="meta-tag">📂 ${esc(s.workdir || '/git')}</span>
            <span class="meta-tag">Last: ${esc(lastRun)}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-run" onclick="runSchedule('${esc(s.name)}')" title="Run now">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 2.5l9 5.5-9 5.5z" fill="currentColor"/></svg>
            Run
          </button>
          <button class="icon-btn" onclick="showEditSchedule('${esc(s.name)}')" title="Edit">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Z" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>
          </button>
          <button class="icon-btn danger" onclick="deleteSchedule('${esc(s.name)}')" title="Delete">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 0 1 1.34-1.34h2.66a1.33 1.33 0 0 1 1.34 1.34V4M12 4v9.33a1.33 1.33 0 0 1-1.33 1.34H5.33A1.33 1.33 0 0 1 4 13.33V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function runSchedule(name) {
  await api('POST', `/schedules/${encodeURIComponent(name)}/run`);
  toast(`▶ Running '${name}'`);
}

async function deleteSchedule(name) {
  if (!confirm(`Delete schedule '${name}'?`)) return;
  await api('DELETE', `/schedules/${encodeURIComponent(name)}`);
  toast('Schedule deleted');
  loadSchedules();
}

// ── Schedule Form ──

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function renderScheduleForm(schedule, isEdit) {
  const cron = parseCron(schedule?.cron || '0 8 * * *');
  const area = document.getElementById('schedule-form-area');

  const hourOpts = Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}" ${h === cron.hour ? 'selected' : ''}>${String(h).padStart(2, '0')}</option>`
  ).join('');

  const minSteps = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  if (!minSteps.includes(cron.minute)) minSteps.push(cron.minute);
  minSteps.sort((a, b) => a - b);
  const minOpts = minSteps.map(m =>
    `<option value="${m}" ${m === cron.minute ? 'selected' : ''}>${String(m).padStart(2, '0')}</option>`
  ).join('');

  const dayChips = DAY_LABELS.map((label, i) => {
    const active = cron.days.includes(i + 1) ? 'active' : '';
    return `<div class="day-chip ${active}" onclick="toggleDay(this,${i + 1})" data-day="${i + 1}">${label}</div>`;
  }).join('');

  const dayLabel = getDayLabel(cron.days);

  const provOpts = providers.map(p =>
    `<option value="${p}" ${p === (schedule?.provider || '') ? 'selected' : ''}>${p}</option>`
  ).join('');

  area.innerHTML = `
    <div class="schedule-form">
      <h3>${isEdit ? 'Edit Schedule' : 'New Scheduled Task'}</h3>

      <div class="form-row">
        <span class="form-label">Name</span>
        <input class="form-input" id="sf-name" value="${esc(schedule?.name || '')}"
          ${isEdit ? 'readonly style="opacity:0.5;cursor:not-allowed"' : 'placeholder="my-task"'}>
      </div>

      <div class="form-row">
        <span class="form-label">Time</span>
        <div class="time-picker">
          <select id="sf-hour">${hourOpts}</select>
          <span class="time-sep">:</span>
          <select id="sf-min">${minOpts}</select>
        </div>
      </div>

      <div class="form-row">
        <span class="form-label">Days</span>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:0.3rem">
          <div class="day-chips" id="sf-days">${dayChips}</div>
          <span class="day-summary" id="sf-day-label">${dayLabel}</span>
        </div>
      </div>

      <div class="form-row">
        <span class="form-label">Provider</span>
        <select class="form-select" id="sf-provider" style="width:180px">
          <option value="">Default (${esc(statusData.defaultProvider || 'claude')})</option>
          ${provOpts}
        </select>
      </div>

      <div class="form-row">
        <span class="form-label">Workdir</span>
        <input class="form-input" id="sf-workdir" value="${esc(schedule?.workdir || '/git')}" placeholder="/git/project">
      </div>

      <div class="form-row">
        <span class="form-label top">Prompt</span>
        <textarea class="form-textarea" id="sf-prompt" rows="3" placeholder="What should the agent do?">${esc(schedule?.prompt || '')}</textarea>
      </div>

      <div class="form-actions">
        <button class="btn-primary" onclick="saveSchedule(${isEdit})">${isEdit ? 'Save Changes' : 'Create Task'}</button>
        <button class="btn-ghost" onclick="hideScheduleForm()">Cancel</button>
      </div>
    </div>`;

  area.dataset.editName = isEdit ? schedule.name : '';
  area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideScheduleForm() {
  document.getElementById('schedule-form-area').innerHTML = '';
}

function showAddSchedule() { renderScheduleForm(null, false); }

async function showEditSchedule(name) {
  const schedules = await api('GET', '/schedules');
  const s = schedules.find(x => x.name === name);
  if (s) renderScheduleForm(s, true);
}

function toggleDay(el) {
  el.classList.toggle('active');
  updateDayLabel();
}

function updateDayLabel() {
  const chips = document.querySelectorAll('#sf-days .day-chip.active');
  const days = Array.from(chips).map(c => parseInt(c.dataset.day)).sort((a, b) => a - b);
  document.getElementById('sf-day-label').textContent = getDayLabel(days);
}

function getDayLabel(days) {
  if (days.length === 7) return 'Every day';
  if (days.length === 5 && days.join(',') === '1,2,3,4,5') return 'Weekdays';
  if (days.length === 2 && days.join(',') === '6,7') return 'Weekends';
  if (days.length === 0) return 'No days';
  return days.map(d => DAYS[d - 1]).join(', ');
}

async function saveSchedule(isEdit) {
  const name = document.getElementById('sf-name').value.trim();
  const hour = parseInt(document.getElementById('sf-hour').value);
  const min = parseInt(document.getElementById('sf-min').value);
  const chips = document.querySelectorAll('#sf-days .day-chip.active');
  const days = Array.from(chips).map(c => parseInt(c.dataset.day)).sort((a, b) => a - b);
  const provider = document.getElementById('sf-provider').value || null;
  const workdir = document.getElementById('sf-workdir').value.trim();
  const prompt = document.getElementById('sf-prompt').value.trim();

  if (!name || !prompt) { toast('Name and prompt are required'); return; }
  if (days.length === 0) { toast('Select at least one day'); return; }

  const cron = buildCron(min, hour, days);
  const body = { name, cron, prompt, provider, workdir, topic_name: `Scheduled: ${name}` };

  if (isEdit) {
    const editName = document.getElementById('schedule-form-area').dataset.editName;
    await api('PUT', `/schedules/${encodeURIComponent(editName)}`, body);
    toast('Schedule updated');
  } else {
    await api('POST', '/schedules', body);
    toast('Schedule created');
  }

  hideScheduleForm();
  loadSchedules();
}

// ── Cron helpers ──

function parseCron(expr) {
  const p = expr.split(/\s+/);
  return {
    minute: parseInt(p[0]) || 0,
    hour: parseInt(p[1]) || 0,
    days: p[4] === '*' ? [1,2,3,4,5,6,7] : p[4].split(',').map(Number).filter(d => d >= 1 && d <= 7),
  };
}

function buildCron(min, hour, days) {
  return `${min} ${hour} * * ${days.length === 7 ? '*' : days.join(',')}`;
}

function cronToHuman(expr) {
  const c = parseCron(expr);
  const time = `${String(c.hour).padStart(2,'0')}:${String(c.minute).padStart(2,'0')}`;
  if (c.days.length === 7) return `Daily at ${time}`;
  if (c.days.length === 5 && c.days.join(',') === '1,2,3,4,5') return `Weekdays at ${time}`;
  if (c.days.length === 2 && c.days.join(',') === '6,7') return `Weekends at ${time}`;
  return `${c.days.map(d => DAYS[d-1]).join(', ')} at ${time}`;
}

// ═══════════════════
// SETTINGS
// ═══════════════════

function renderSettings() {
  const area = document.getElementById('settings-area');

  const provOpts = providers.map(p =>
    `<option value="${p}" ${p === statusData.defaultProvider ? 'selected' : ''}>${p}</option>`
  ).join('');

  const intervals = [5, 10, 15, 30, 60];
  const intOpts = intervals.map(i =>
    `<option value="${i}" ${i === statusData.heartbeatInterval ? 'selected' : ''}>${i} min</option>`
  ).join('');

  const pills = providers.map(p =>
    `<span class="provider-pill">${esc(p)}</span>`
  ).join('');

  area.innerHTML = `
    <div class="setting-group">
      <div class="setting-row">
        <div>
          <div class="setting-label">Default Provider</div>
          <div class="setting-desc">Used when no provider is specified for a topic or schedule</div>
        </div>
        <select class="form-select" id="set-provider">${provOpts}</select>
      </div>
      <div class="setting-row">
        <div>
          <div class="setting-label">Heartbeat Interval</div>
          <div class="setting-desc">How often the agent polls Telegram and runs due schedules</div>
        </div>
        <select class="form-select" id="set-interval">${intOpts}</select>
      </div>
    </div>

    <div class="setting-group">
      <div class="setting-row">
        <div class="setting-label">Poll Timeout</div>
        <span class="setting-value">${statusData.pollTimeout || 55}s</span>
      </div>
      <div class="setting-row">
        <div class="setting-label">Configured Providers</div>
        <div class="provider-pills">${pills || '<span class="setting-value">None</span>'}</div>
      </div>
      <div class="setting-row">
        <div class="setting-label">Active Topics</div>
        <span class="setting-value">${statusData.topicCount || 0}</span>
      </div>
      <div class="setting-row">
        <div class="setting-label">Scheduled Tasks</div>
        <span class="setting-value">${statusData.scheduleCount || 0}</span>
      </div>
    </div>

    <div style="margin-top:0.5rem">
      <button class="btn-primary" onclick="saveSettings()">Save Settings</button>
    </div>`;
}

async function saveSettings() {
  const defaultProvider = document.getElementById('set-provider').value;
  const heartbeatInterval = parseInt(document.getElementById('set-interval').value);
  await api('PUT', '/settings', { defaultProvider, heartbeatInterval });
  toast('Settings saved');
  loadStatus();
}

// ── Helpers ──

function esc(str) {
  if (!str) return '';
  const el = document.createElement('span');
  el.textContent = String(str);
  return el.innerHTML;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function fmtTime(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d)) return ts;
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleString('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

// ── Init ──

if (token) {
  api('GET', '/status').then(() => showApp()).catch(() => {
    localStorage.removeItem('admin_token');
    token = '';
  });
}
