/* ---------- Конфигурация ---------- */
const CATEGORIES = {
  'Строения': {
    color: '#ff7a45',
    weight: 5,          // ← сильно меньше остальных
    emoji: '🏚️',
    rare: true,
    colors: {
      'Белый':        '#f8fafc',
      'Бежевый':      '#e8d5b7',
      'Песочный':     '#d4b896',
      'Терракотовый': '#b8694a',
      'Красный':      '#b91c1c',
      'Коричневый':   '#7c4a2d',
      'Серый':        '#64748b',
      'Тёмно-серый':  '#334155',
      'Синий':        '#1e40af',
      'Зелёный':      '#166534',
    },
  },
  'Природа':       { color: '#4ade80', weight: 25, file: 'data/nature.json' },
  'Предметы':      { color: '#60a5fa', weight: 25, file: 'data/items.json' },
  'Интерактивное': { color: '#c084fc', weight: 25, file: 'data/interactive.json' },
  'Пропы':         { color: '#fbbf24', weight: 25, file: 'data/props.json' },
};
const CATEGORY_NAMES = Object.keys(CATEGORIES);
const WEIGHT_TOTAL   = CATEGORY_NAMES.reduce((s, n) => s + CATEGORIES[n].weight, 0);

const MONTH_NAMES = [
  'январь','февраль','март','апрель','май','июнь',
  'июль','август','сентябрь','октябрь','ноябрь','декабрь'
];

const DEADLINE_MS      = 12 * 60 * 60 * 1000;
const SPIN_DURATION_MS = 5000;
const REEL_DURATION_MS = 4000;
const REEL_ITEM_H      = 80;
const STORAGE_KEY      = 'roulette-active-task';
const SCORE_KEY        = 'roulette-my-score';

/* ---------- Состояние ---------- */
let categoryRotation = 0;
let categorySectors  = {};
let selectedCategory = null;
let activeTask       = null;
let timerInterval    = null;
let spinning         = false;

/* ---------- Утилиты ---------- */
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

function formatTime(ms) {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthKeyToLabel(key) {
  if (!key || !key.includes('-')) return key || '—';
  const [y, m] = key.split('-');
  const idx = parseInt(m, 10) - 1;
  return `${MONTH_NAMES[idx] || m} ${y}`;
}

function weightedCategory() {
  let r = Math.random() * WEIGHT_TOTAL;
  for (const name of CATEGORY_NAMES) {
    r -= CATEGORIES[name].weight;
    if (r <= 0) return name;
  }
  return CATEGORY_NAMES[CATEGORY_NAMES.length - 1];
}

/* ---------- Колесо ---------- */
function buildCategoryWheel() {
  const wheel = $('category-wheel');
  wheel.innerHTML = '';

  const stops = [];
  let acc = 0;
  categorySectors = {};

  CATEGORY_NAMES.forEach(name => {
    const span = CATEGORIES[name].weight / WEIGHT_TOTAL * 360;
    const start = acc;
    const end = acc + span;
    categorySectors[name] = { start, end, center: (start + end) / 2, span };
    stops.push(`${CATEGORIES[name].color} ${start}deg ${end}deg`);
    acc = end;
  });
  wheel.style.background = `conic-gradient(from 0deg, ${stops.join(', ')})`;

  CATEGORY_NAMES.forEach(name => {
    const s = categorySectors[name];
    const label = document.createElement('div');
    label.className = 'wheel-label';
    label.style.transform = `rotate(${s.center}deg)`;
    const span = document.createElement('span');
    span.style.transform = `rotate(${-s.center}deg)`;
    if (s.span < 40) {
      span.textContent = CATEGORIES[name].emoji || '•';
      span.classList.add('wheel-emoji');
    } else {
      span.textContent = name;
    }
    label.appendChild(span);
    wheel.appendChild(label);
  });

  buildLegend();
}

function buildLegend() {
  $('legend').innerHTML = CATEGORY_NAMES.map(name => {
    const pct = (CATEGORIES[name].weight / WEIGHT_TOTAL * 100).toFixed(1);
    return `<span class="legend-item">
      <span class="legend-dot" style="background:${CATEGORIES[name].color}"></span>
      ${escapeHtml(name)} <span class="legend-pct">${pct}%</span>
    </span>`;
  }).join('');
}

function spinCategory() {
  if (spinning) return;
  spinning = true;
  $('spin-category').disabled = true;

  const winner = weightedCategory();
  const s = categorySectors[winner];

  const maxJitter = Math.max(0, s.span / 2 - 8);
  const jitter = (Math.random() - 0.5) * 2 * maxJitter;

  const targetMod  = ((-s.center + jitter) % 360 + 360) % 360;
  const currentMod = ((categoryRotation % 360) + 360) % 360;
  let delta = targetMod - currentMod;
  if (delta < 0) delta += 360;

  categoryRotation += 5 * 360 + delta;
  const wheel = $('category-wheel');
  wheel.style.transform = `rotate(${categoryRotation}deg)`;

  if (CATEGORIES[winner].rare) {
    wheel.classList.add('rare-win');
    setTimeout(() => wheel.classList.remove('rare-win'), 3200);
  }

  setTimeout(() => {
    spinning = false;
    selectedCategory = winner;
    showItemStage();
  }, SPIN_DURATION_MS);
}

/* ---------- Вторая рулетка ---------- */
async function getItems(category) {
  const cfg = CATEGORIES[category];
  if (cfg.colors) {
    return Object.entries(cfg.colors).map(([name, hex]) => ({
      name, hex, isColor: true,
    }));
  }
  const res = await fetch(cfg.file + '?t=' + Date.now());
  if (!res.ok) throw new Error(`Не удалось загрузить ${category}`);
  const data = await res.json();
  const arr = Array.isArray(data) ? data : (data.items || []);
  return arr.map(name => ({ name, isColor: false }));
}

function renderItem(item) {
  if (item.isColor) {
    return `<div class="reel-item color-item">
      <span class="swatch" style="background:${item.hex}"></span>
      <span>${escapeHtml(item.name)} дом</span>
    </div>`;
  }
  return `<div class="reel-item">${escapeHtml(item.name)}</div>`;
}

async function spinItem() {
  if (spinning) return;
  spinning = true;
  $('spin-item').disabled = true;

  let items;
  try {
    items = await getItems(selectedCategory);
  } catch (e) {
    alert('Ошибка загрузки: ' + e.message);
    spinning = false;
    $('spin-item').disabled = false;
    return;
  }
  if (!items.length) {
    alert('Список пуст');
    spinning = false;
    $('spin-item').disabled = false;
    return;
  }

  const winner = items[Math.floor(Math.random() * items.length)];

  const VISUAL_SPINS = 30;
  const track = [];
  for (let i = 0; i < VISUAL_SPINS; i++) {
    track.push(items[Math.floor(Math.random() * items.length)]);
  }
  track.push(winner);

  const trackEl = $('reel-track');
  trackEl.innerHTML = track.map(renderItem).join('');

  trackEl.style.transition = 'none';
  trackEl.style.transform = 'translateY(0)';
  void trackEl.offsetHeight;

  const winnerIdx = track.length - 1;
  const targetY = (1 - winnerIdx) * REEL_ITEM_H;
  requestAnimationFrame(() => {
    trackEl.style.transition = `transform ${REEL_DURATION_MS}ms cubic-bezier(0.12, 0.75, 0.2, 1)`;
    trackEl.style.transform = `translateY(${targetY}px)`;
  });

  await new Promise(resolve => {
    let done = false;
    const end = () => { if (!done) { done = true; resolve(); } };
    trackEl.addEventListener('transitionend', end, { once: true });
    setTimeout(end, REEL_DURATION_MS + 200);
  });

  startTask(selectedCategory, winner);
}

/* ---------- Этапы ---------- */
function showItemStage() {
  $('stage-category').classList.add('hidden');
  $('stage-item').classList.remove('hidden');
  const badge = $('current-category');
  badge.textContent = selectedCategory;
  badge.style.background = CATEGORIES[selectedCategory].color;
  badge.style.boxShadow = `0 0 20px ${CATEGORIES[selectedCategory].color}80`;
  $('spin-item').disabled = false;
}

function showResultStage() {
  $('stage-category').classList.add('hidden');
  $('stage-item').classList.add('hidden');
  $('stage-result').classList.remove('hidden');

  $('result-category').textContent = activeTask.category;

  const itemEl = $('result-item');
  const item = activeTask.itemData;
  if (item.isColor) {
    itemEl.innerHTML = `<span class="swatch swatch-lg" style="background:${item.hex}"></span>${escapeHtml(item.name)} дом`;
  } else {
    itemEl.textContent = item.name;
  }

  $('result-rare').classList.toggle('hidden', !CATEGORIES[activeTask.category].rare);

  updateTimerDisplay();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

function updateTimerDisplay() {
  const timerEl = $('timer');
  const labelEl = $('timer-label');
  if (!activeTask) return;

  const remaining = activeTask.deadline - Date.now();
  timerEl.classList.remove('warning', 'danger', 'expired');

  if (remaining <= 0) {
    timerEl.textContent = '00:00:00';
    timerEl.classList.add('expired');
    labelEl.textContent = 'провалено';
    if (!activeTask.expired) {
      activeTask.expired = true;
      saveActiveTask(activeTask);
    }
    return;
  }

  timerEl.textContent = formatTime(remaining);
  labelEl.textContent = 'до дедлайна';

  const h = remaining / 3600000;
  if (h < 1) timerEl.classList.add('danger');
  else if (h < 3) timerEl.classList.add('warning');
}

/* ---------- Задача ---------- */
function startTask(category, itemData) {
  activeTask = {
    category,
    itemData,
    deadline: Date.now() + DEADLINE_MS,
    expired: false,
  };
  saveActiveTask(activeTask);
  showResultStage();
}

function saveActiveTask(task) {
  if (!task) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(task));
}

function loadActiveTask() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function completeTask() {
  if (!activeTask) return;
  const month = getMonthKey();
  const raw = localStorage.getItem(SCORE_KEY);
  let score = { month, count: 0 };
  if (raw) { try { score = JSON.parse(raw); } catch {} }
  if (score.month !== month) score = { month, count: 0 };
  score.count += 1;
  localStorage.setItem(SCORE_KEY, JSON.stringify(score));

  alert(`✓ Готово! Ваш счёт за месяц: ${score.count}\nНе забудьте обновить leaderboard.json на GitHub.`);
  resetRoulette();
}

function resetRoulette() {
  localStorage.removeItem(STORAGE_KEY);
  activeTask = null;
  selectedCategory = null;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  $('stage-result').classList.add('hidden');
  $('stage-item').classList.add('hidden');
  $('stage-category').classList.remove('hidden');
  $('spin-category').disabled = false;
  $('spin-item').disabled = false;
  $('reel-track').innerHTML = '';
  $('reel-track').style.transform = 'translateY(0)';
}

/* ---------- Лидерборд и история ---------- */
function renderPlayers(players) {
  const sorted = [...(players || [])].sort((a, b) => b.score - a.score);
  return sorted.map((p, i) =>
    `<li class="${i === 0 ? 'top' : ''}">
       <span>${i === 0 ? '👑 ' : ''}${escapeHtml(p.name)}</span>
       <span class="score">${p.score}</span>
     </li>`
  ).join('') || '<li>Пока пусто</li>';
}

async function loadLeaderboard() {
  try {
    const res = await fetch('leaderboard.json?t=' + Date.now());
    const data = await res.json();

    // Текущий месяц
    const current = data.current || { month: getMonthKey(), players: [] };
    $('current-month-label').textContent = monthKeyToLabel(current.month);
    $('leaderboard-list').innerHTML = renderPlayers(current.players);

    // Архив
    const history = data.history || [];
    const historyEl = $('history-list');
    if (!history.length) {
      historyEl.innerHTML = '<p class="history-empty">Пока нет прошлых месяцев</p>';
    } else {
      const sorted = [...history].sort((a, b) =>
        (b.month || '').localeCompare(a.month || '')
      );
      historyEl.innerHTML = sorted.map(h => `
        <div class="history-month">
          <h3>${monthKeyToLabel(h.month)}</h3>
          <ul>${renderPlayers(h.players)}</ul>
        </div>
      `).join('');
    }
  } catch (e) {
    $('leaderboard-list').innerHTML = '<li style="color:#6b7280">Не удалось загрузить лидерборд</li>';
    $('history-list').innerHTML = '';
  }
}

/* ---------- Инициализация ---------- */
function init() {
  buildCategoryWheel();
  $('spin-category').addEventListener('click', spinCategory);
  $('spin-item').addEventListener('click', spinItem);
  $('done-btn').addEventListener('click', completeTask);
  $('restart-btn').addEventListener('click', resetRoulette);

  loadLeaderboard();

  const saved = loadActiveTask();
  if (saved) {
    activeTask = saved;
    showResultStage();
  }
}

init();
