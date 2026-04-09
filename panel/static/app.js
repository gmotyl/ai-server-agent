// app.js — Admin panel SPA logic (zero dependencies)

let token = localStorage.getItem('admin_token') || '';
let providers = [];
let statusData = {};
let expandedTopic = null;

// --- API ---

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

// --- Auth ---

function doLogin() {
  const input = document.getElementById('token-input');
  token = input.value.trim();
  if (!token) return;
  localStorage.setItem('admin_token', token);
  api('GET', '/status').then(() => {
    showApp();
  }).catch(() => {
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

// Enter key on token input
document.getElementById('token-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

// --- Tabs ---

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// --- Toast ---

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2500);
}

// --- Icons ---

const ICONS = {
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z"/></svg>',
  edit: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Z"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25ZM3.613 5.5l.806 8.87A1.75 1.75 0 0 0 6.16 16h3.68a1.75 1.75 0 0 0 1.741-1.63L12.387 5.5Z"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z"/></svg>',
};

// --- Status ---

async function loadStatus() {
  statusData = await api('GET', '/status');
  providers = statusData.providers || [];
  document.getElementById('header-provider').textContent = statusData.defaultProvider;
  renderSettings();
}

// --- Topics ---

async function loadTopics() {
  const topics = await api('GET', '/topics');
  const tbody = document.getElementById('topics-body');

  if (topics.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No topics yet</td></tr>';
    return;
  }

  let html = '';
  for (const t of topics) {
    const statusClass = t.active ? 'status-active' : 'status-closed';
    const statusText = t.active ? 'active' : 'closed';
    const ts = t.lastActivity ? formatTime(t.lastActivity) : '-';

    html += `<tr>
      <td><span class="topic-link" onclick="toggleMessages('${t.id}')">${esc(t.label)}</span></td>
      <td><code>${esc(t.provider)}</code></td>
      <td class="hide-mobile">${t.messageCount}</td>
      <td>${ts}</td>
      <td><span class="${statusClass}">${statusText}</span></td>
      <td class="actions">`;

    if (t.active) {
      html += `<button class="btn btn-warn" onclick="closeTopic('${t.id}')" title="Close">${ICONS.close}</button>`;
    }
    html += `<button class="btn btn-danger" onclick="deleteTopic('${t.id}')" title="Delete">${ICONS.trash}</button>`;
    html += `</td></tr>`;

    // Message expansion row (hidden by default)
    html += `<tr class="messages-row" id="msgs-${t.id}" style="display:none">
      <td colspan="6"><div class="messages-wrap" id="msgs-content-${t.id}">Loading...</div></td>
    </tr>`;
  }
  tbody.innerHTML = html;
}

async function toggleMessages(topicId) {
  const row = document.getElementById(`msgs-${topicId}`);
  if (expandedTopic === topicId) {
    row.style.display = 'none';
    expandedTopic = null;
    return;
  }

  // Collapse previous
  if (expandedTopic) {
    const prev = document.getElementById(`msgs-${expandedTopic}`);
    if (prev) prev.style.display = 'none';
  }

  row.style.display = '';
  expandedTopic = topicId;

  const wrap = document.getElementById(`msgs-content-${topicId}`);
  wrap.innerHTML = 'Loading...';

  const messages = await api('GET', `/topics/${topicId}/messages`);
  if (messages.length === 0) {
    wrap.innerHTML = '<div class="empty-state">No messages</div>';
    return;
  }

  let html = '';
  for (const m of messages) {
    const cls = m.from === 'user' ? 'msg-user'
      : m.from === 'schedule' ? 'msg-schedule'
      : 'msg-assistant';
    html += `<div class="msg-meta">${esc(m.from)} &middot; ${formatTime(m.ts)}</div>`;
    html += `<div class="msg-bubble ${cls}">${esc(truncate(m.text, 1000))}</div>`;
  }
  wrap.innerHTML = html;
  wrap.scrollTop = wrap.scrollHeight;
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
  if (closed.length === 0) { toast('No closed topics'); return; }
  if (!confirm(`Delete ${closed.length} closed topic(s)?`)) return;
  for (const t of closed) {
    await api('DELETE', `/topics/${t.id}`);
  }
  toast(`Deleted ${closed.length} topics`);
  expandedTopic = null;
  loadTopics();
}

// --- Schedules ---

async function loadSchedules() {
  const schedules = await api('GET', '/schedules');
  const tbody = document.getElementById('schedules-body');

  // Heartbeat note
  const interval = statusData.heartbeatInterval || 30;
  document.getElementById('heartbeat-note').innerHTML =
    `Schedules run at heartbeat boundaries. Effective minimum interval: <strong>${interval} min</strong>`;

  if (schedules.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No scheduled tasks</td></tr>';
    return;
  }

  let html = '';
  for (const s of schedules) {
    const humanTime = cronToHuman(s.cron);
    const lastRun = s.lastRun ? s.lastRun.replace(/-/g, (m, i) => i > 9 ? ':' : '-') : '-';

    html += `<tr>
      <td>${esc(s.name)}</td>
      <td>
        <div>${esc(humanTime)}</div>
        <div style="font-size:0.72rem;color:var(--text-muted)">cron: ${esc(s.cron)}</div>
      </td>
      <td><code>${esc(s.provider || statusData.defaultProvider || 'default')}</code></td>
      <td class="hide-mobile"><code style="font-size:0.8rem">${esc(s.workdir || '/git')}</code></td>
      <td class="hide-mobile" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.prompt)}</td>
      <td class="hide-mobile" style="font-size:0.8rem">${esc(lastRun)}</td>
      <td class="actions">
        <button class="btn btn-green" onclick="runSchedule('${esc(s.name)}')" title="Run Now">${ICONS.play}</button>
        <button class="btn btn-blue" onclick="showEditSchedule('${esc(s.name)}')" title="Edit">${ICONS.edit}</button>
        <button class="btn btn-danger" onclick="deleteSchedule('${esc(s.name)}')" title="Delete">${ICONS.trash}</button>
      </td>
    </tr>`;
  }
  tbody.innerHTML = html;
}

async function runSchedule(name) {
  await api('POST', `/schedules/${encodeURIComponent(name)}/run`);
  toast(`Running '${name}'...`);
}

async function deleteSchedule(name) {
  if (!confirm(`Delete schedule '${name}'?`)) return;
  await api('DELETE', `/schedules/${encodeURIComponent(name)}`);
  toast('Schedule deleted');
  loadSchedules();
}

// --- Schedule Form ---

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function renderScheduleForm(schedule, isEdit) {
  const cron = parseCron(schedule?.cron || '0 8 * * *');
  const area = document.getElementById('schedule-form-area');

  let hourOpts = '';
  for (let h = 0; h < 24; h++) {
    const sel = h === cron.hour ? 'selected' : '';
    hourOpts += `<option value="${h}" ${sel}>${String(h).padStart(2, '0')}</option>`;
  }
  let minOpts = '';
  for (let m = 0; m < 60; m += 5) {
    const sel = m === cron.minute ? 'selected' : '';
    minOpts += `<option value="${m}" ${sel}>${String(m).padStart(2, '0')}</option>`;
  }
  // If current minute not in 5-min steps, add it
  if (cron.minute % 5 !== 0) {
    minOpts += `<option value="${cron.minute}" selected>${String(cron.minute).padStart(2, '0')}</option>`;
  }

  let dayChips = '';
  for (let i = 0; i < 7; i++) {
    const active = cron.days.includes(i + 1) ? 'active' : '';
    dayChips += `<div class="day-chip ${active}" onclick="toggleDay(this, ${i + 1})" data-day="${i + 1}">${DAY_LABELS[i]}</div>`;
  }
  const dayLabel = cron.days.length === 7 ? 'Every day' :
    cron.days.length === 5 && cron.days.join(',') === '1,2,3,4,5' ? 'Weekdays' :
    cron.days.map(d => DAYS[d - 1]).join(', ');

  let provOpts = '';
  for (const p of providers) {
    const sel = p === (schedule?.provider || '') ? 'selected' : '';
    provOpts += `<option value="${p}" ${sel}>${p}</option>`;
  }

  area.innerHTML = `
    <div class="schedule-form">
      <h3 style="color:var(--accent2);margin-bottom:0.8rem;font-size:1rem">${isEdit ? 'Edit' : 'Add'} Schedule</h3>
      <div class="form-grid">
        <label>Name</label>
        <input id="sf-name" value="${esc(schedule?.name || '')}" ${isEdit ? 'readonly style="opacity:0.6"' : ''}>

        <label>Time</label>
        <div class="time-picker">
          <select id="sf-hour">${hourOpts}</select>
          <span class="time-sep">:</span>
          <select id="sf-min">${minOpts}</select>
        </div>

        <label>Days</label>
        <div>
          <div class="day-chips" id="sf-days">${dayChips}</div>
          <span class="day-label" id="sf-day-label">${dayLabel}</span>
        </div>

        <label>Provider</label>
        <select id="sf-provider" style="width:200px">
          <option value="">Default (${esc(statusData.defaultProvider || 'claude')})</option>
          ${provOpts}
        </select>

        <label>Workdir</label>
        <input id="sf-workdir" value="${esc(schedule?.workdir || '/git')}" placeholder="/git/project">

        <label class="top">Prompt</label>
        <textarea id="sf-prompt" rows="3">${esc(schedule?.prompt || '')}</textarea>
      </div>
      <div class="mt-2 actions">
        <button class="btn btn-green" onclick="saveSchedule(${isEdit})">${isEdit ? 'Save Changes' : 'Create Schedule'}</button>
        <button class="btn btn-ghost" onclick="hideScheduleForm()">Cancel</button>
      </div>
    </div>`;
  area.dataset.editName = isEdit ? schedule.name : '';
}

function hideScheduleForm() {
  document.getElementById('schedule-form-area').innerHTML = '';
}

function showAddSchedule() {
  renderScheduleForm(null, false);
}

async function showEditSchedule(name) {
  const schedules = await api('GET', '/schedules');
  const s = schedules.find(x => x.name === name);
  if (s) renderScheduleForm(s, true);
}

function toggleDay(el, day) {
  el.classList.toggle('active');
  updateDayLabel();
}

function updateDayLabel() {
  const chips = document.querySelectorAll('#sf-days .day-chip.active');
  const days = Array.from(chips).map(c => parseInt(c.dataset.day));
  days.sort((a, b) => a - b);
  const label = days.length === 7 ? 'Every day' :
    days.length === 5 && days.join(',') === '1,2,3,4,5' ? 'Weekdays' :
    days.length === 0 ? 'No days selected' :
    days.map(d => DAYS[d - 1]).join(', ');
  document.getElementById('sf-day-label').textContent = label;
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

// --- Cron helpers ---

function parseCron(expr) {
  const parts = expr.split(/\s+/);
  const minute = parseInt(parts[0]) || 0;
  const hour = parseInt(parts[1]) || 0;
  let days;
  if (parts[4] === '*') {
    days = [1, 2, 3, 4, 5, 6, 7];
  } else {
    days = parts[4].split(',').map(Number).filter(d => d >= 1 && d <= 7);
  }
  return { minute, hour, days };
}

function buildCron(min, hour, days) {
  const dayStr = days.length === 7 ? '*' : days.join(',');
  return `${min} ${hour} * * ${dayStr}`;
}

function cronToHuman(expr) {
  const c = parseCron(expr);
  const time = `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
  if (c.days.length === 7) return `Daily at ${time}`;
  if (c.days.length === 5 && c.days.join(',') === '1,2,3,4,5') return `Weekdays at ${time}`;
  if (c.days.length === 2 && c.days.join(',') === '6,7') return `Weekends at ${time}`;
  return `${c.days.map(d => DAYS[d - 1]).join(', ')} at ${time}`;
}

// --- Settings ---

function renderSettings() {
  const area = document.getElementById('settings-area');
  let provOpts = '';
  for (const p of providers) {
    const sel = p === statusData.defaultProvider ? 'selected' : '';
    provOpts += `<option value="${p}" ${sel}>${p}</option>`;
  }

  const intervals = [5, 10, 15, 30, 60];
  let intOpts = '';
  for (const i of intervals) {
    const sel = i === statusData.heartbeatInterval ? 'selected' : '';
    intOpts += `<option value="${i}" ${sel}>${i} min</option>`;
  }

  let pills = '';
  for (const p of providers) {
    pills += `<span class="provider-pill" style="color:var(--accent);border-color:rgba(88,166,255,0.3)">${esc(p)}</span>`;
  }

  area.innerHTML = `
    <div class="settings-grid">
      <label>Default Provider</label>
      <select id="set-provider" style="width:200px">${provOpts}</select>

      <label>Heartbeat Interval</label>
      <div>
        <select id="set-interval" style="width:200px">${intOpts}</select>
        <div style="color:var(--text-muted);font-size:0.78rem;margin-top:0.3rem">Schedules run at heartbeat boundaries</div>
      </div>

      <label>Poll Timeout</label>
      <div><code>${statusData.pollTimeout || 55}s</code> <span style="color:var(--text-muted);font-size:0.8rem">(Telegram long poll)</span></div>

      <label>Providers</label>
      <div class="provider-pills">${pills}</div>

      <label>Active Topics</label>
      <span>${statusData.topicCount || 0}</span>

      <label>Scheduled Tasks</label>
      <span>${statusData.scheduleCount || 0}</span>
    </div>
    <div class="mt-3">
      <button class="btn btn-green" onclick="saveSettings()">Save Settings</button>
    </div>`;
}

async function saveSettings() {
  const defaultProvider = document.getElementById('set-provider').value;
  const heartbeatInterval = parseInt(document.getElementById('set-interval').value);
  await api('PUT', '/settings', { defaultProvider, heartbeatInterval });
  toast('Settings saved');
  loadStatus();
}

// --- Helpers ---

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function formatTime(ts) {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (isNaN(d)) return ts;
    return d.toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

// --- Init ---

if (token) {
  api('GET', '/status').then(() => showApp()).catch(() => {
    // Token expired or invalid
    localStorage.removeItem('admin_token');
    token = '';
  });
}
