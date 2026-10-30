/* ---------- НАСТРОЙКА FIREBASE ---------- 
   Вставь сюда URL твоей базы данных (без слэша в конце). 
*/
const FIREBASE_URL = "https://d-model-roulette-default-rtdb.europe-west1.firebasedatabase.app"; 

/* =========================================================================
   ⚙️ ГЛАВНАЯ НАСТРОЙКА КАТЕГОРИЙ И ТАЙМЕРОВ
   ========================================================================= */
const CATEGORIES = {
  'Строения':      { color: '#ff7a45', weight: 50,  emoji: '🏚️', rare: true, 
      points: 6, noTexPoints: 3, minTime: 30, timer: 12, 
      colors: {
        'Белый': '#f8fafc', 'Бежевый': '#e8d5b7', 'Песочный': '#d4b896', 'Терракотовый': '#b8694a',
        'Красный': '#b91c1c', 'Коричневый': '#7c4a2d', 'Серый': '#64748b', 'Тёмно-серый': '#334155',
        'Синий': '#1e40af', 'Зелёный': '#166534',
      }
  },
  'Природа':       { color: '#4ade80', weight: 150, emoji: '🌿', file: 'data/nature.json', 
      points: 2, noTexPoints: 1, minTime: 5, timer: 12 
  },
  'Предметы':      { color: '#60a5fa', weight: 499, emoji: '📦', file: 'data/items.json', 
      points: 2, noTexPoints: 1, minTime: 5, timer: 12 
  },
  'Интерактивное': { color: '#c084fc', weight: 1,   emoji: '⚡', file: 'data/interactive.json', 
      points: 20, noTexPoints: 20, minTime: 60, timer: 24 
  },
  'Пропы':         { color: '#fbbf24', weight: 300, emoji: '🪑', file: 'data/props.json', 
      points: 2, noTexPoints: 1, minTime: 5, timer: 12 
  },
};

const CATEGORY_NAMES = Object.keys(CATEGORIES);
const WEIGHT_TOTAL = CATEGORY_NAMES.reduce((s, n) => s + CATEGORIES[n].weight, 0);
const MONTH_NAMES = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const SPIN_DURATION_MS = 5000;
const REEL_DURATION_MS = 4000;
const REEL_ITEM_H = 80;
const STORAGE_KEY = 'roulette-active-task';
const NAME_KEY = 'roulette-player-name';

/* ---------- Состояние ---------- */
let categoryRotation = 0;
let categorySectors = {};
let selectedCategory = null;
let activeTask = null;
let timerInterval = null;
let spinning = false;
let playerName = localStorage.getItem(NAME_KEY);

// Локальный кэш выполненных предметов (чтобы не дергать базу каждую секунду)
let completedTex = [];
let completedNotex = [];

/* ---------- Утилиты ---------- */
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function formatTime(ms) {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 3600)).padStart(2, '0')}:${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function getMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthKeyToLabel(key) {
  if (!key || !key.includes('-')) return key || '—';
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1] || m} ${y}`;
}

function weightedCategory() {
  let r = Math.random() * WEIGHT_TOTAL;
  for (const name of CATEGORY_NAMES) {
    r -= CATEGORIES[name].weight;
    if (r <= 0) return name;
  }
  return CATEGORY_NAMES[CATEGORY_NAMES.length - 1];
}

/* ---------- Leaderboard API ---------- */
async function fetchScores() {
  if (!FIREBASE_URL) return {};
  try {
    const res = await fetch(`${FIREBASE_URL}/scores/${getMonthKey()}.json`);
    return await res.json() || {};
  } catch (e) { console.error('Firebase error:', e); return {}; }
}

async function updateScore(points) {
  if (!playerName || !FIREBASE_URL) return;
  try {
    const currentDB = await fetchScores();
    const currentScore = currentDB[playerName] || 0;
    await fetch(`${FIREBASE_URL}/scores/${getMonthKey()}/${playerName}.json`, {
      method: 'PUT',
      body: JSON.stringify(currentScore + points)
    });
    $('my-score-val').textContent = currentScore + points;
    loadLeaderboard();
  } catch (e) { console.error('Failed to sync score', e); }
}

async function loadLeaderboard() {
  $('current-month-label').textContent = monthKeyToLabel(getMonthKey());
  const scores = await fetchScores();
  if (playerName) {
     $('my-score-val').textContent = scores[playerName] || 0;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  $('leaderboard-list').innerHTML = sorted.map(([name, score], i) =>
    `<li class="${i === 0 ? 'top' : ''}">
       <span>${i === 0 ? '👑 ' : ''}${escapeHtml(name)}</span>
       <span class="score">${score}</span>
     </li>`
  ).join('') || '<li>Пока пусто</li>';
}

/* ---------- Списки выполненных (Firebase) ---------- */
async function fetchCompleted() {
  if (!FIREBASE_URL) return;
  try {
    const [resTex, resNotex] = await Promise.all([
      fetch(`${FIREBASE_URL}/completed/tex.json`),
      fetch(`${FIREBASE_URL}/completed/notex.json`)
    ]);
    const texData = await resTex.json() || {};
    const notexData = await resNotex.json() || {};
    
    // Преобразуем объект {"Имя предмета": true} в массив строк
    completedTex = Object.keys(texData);
    completedNotex = Object.keys(notexData);
  } catch (e) {
    console.error('Error fetching completed:', e);
  }
}

async function markCompleted(itemName, noTexture) {
  if (!FIREBASE_URL) return;
  const path = noTexture ? 'notex' : 'tex';
  try {
    // Используем имя предмета как ключ, чтобы избежать дубликатов
    await fetch(`${FIREBASE_URL}/completed/${path}/${encodeURIComponent(itemName)}.json`, {
      method: 'PUT',
      body: JSON.stringify(true)
    });
  } catch (e) {
    console.error('Failed to mark completed:', e);
  }
}

async function resetCompleted() {
  if (!confirm('Вы уверены? Все выполненные предметы вернутся в пул (для всех участников).')) return;
  if (!FIREBASE_URL) return;
  
  try {
    await Promise.all([
      fetch(`${FIREBASE_URL}/completed/tex.json`, { method: 'DELETE' }),
      fetch(`${FIREBASE_URL}/completed/notex.json`, { method: 'DELETE' })
    ]);
    completedTex = [];
    completedNotex = [];
    renderCompletedLists();
  } catch (e) {
    alert('Ошибка при сбросе списков');
  }
}

function renderCompletedLists() {
  $('completed-tex-list').innerHTML = completedTex.map(name => `<li>${escapeHtml(name)}</li>`).join('') || '<li style="color:#6b7280">Пусто</li>';
  $('completed-notex-list').innerHTML = completedNotex.map(name => `<li>${escapeHtml(name)}</li>`).join('') || '<li style="color:#6b7280">Пусто</li>';
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
  const jitter = (Math.random() - 0.5) * Math.max(0, s.span - 4); 
  
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
  // Перед выбором предметов обновляем списки из базы (вдруг друг что-то сделал)
  await fetchCompleted();

  const cfg = CATEGORIES[category];
  let items = [];
  
  if (cfg.colors) {
    items = Object.entries(cfg.colors).map(([name, hex]) => ({ name, hex, isColor: true }));
  } else {
    const res = await fetch(cfg.file + '?t=' + Date.now());
    if (!res.ok) throw new Error(`Ошибка загрузки`);
    const data = await res.json();
    const names = (Array.isArray(data) ? data : (data.items || []));
    items = names.map(name => ({ name, isColor: false }));
  }

  // Фильтруем уже выполненные
  return items.filter(item => 
    !completedTex.includes(item.name) && !completedNotex.includes(item.name)
  );
}

function renderItem(item) {
  if (item.isColor) return `<div class="reel-item color-item"><span class="swatch" style="background:${item.hex}"></span><span>${escapeHtml(item.name)} дом</span></div>`;
  return `<div class="reel-item">${escapeHtml(item.name)}</div>`;
}

async function spinItem() {
  if (spinning) return;
  spinning = true;
  $('spin-item').disabled = true;

  try {
    let items = await getItems(selectedCategory);

    if (items.length === 0) {
      alert('В этой категории больше не осталось доступных предметов! (Все сделаны)');
      spinning = false;
      $('spin-item').disabled = false;
      return;
    }

    const winner = items[Math.floor(Math.random() * items.length)];
    const VISUAL_SPINS = 30;
    const track = [];
    for (let i = 0; i < VISUAL_SPINS; i++) track.push(items[Math.floor(Math.random() * items.length)]);
    track.push(winner);

    const trackEl = $('reel-track');
    trackEl.innerHTML = track.map(renderItem).join('');
    trackEl.style.transition = 'none';
    trackEl.style.transform = 'translateY(0)';
    void trackEl.offsetHeight;

    const targetY = (1 - (track.length - 1)) * REEL_ITEM_H;
    requestAnimationFrame(() => {
      trackEl.style.transition = `transform ${REEL_DURATION_MS}ms cubic-bezier(0.12, 0.75, 0.2, 1)`;
      trackEl.style.transform = `translateY(${targetY}px)`;
    });

    await new Promise(resolve => {
      trackEl.addEventListener('transitionend', resolve, { once: true });
      setTimeout(resolve, REEL_DURATION_MS + 200);
    });

    startTask(selectedCategory, winner);
  } catch (e) {
    alert(e.message);
  } finally {
    spinning = false;
    $('spin-item').disabled = false;
  }
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
  const item = activeTask.itemData;
  $('result-item').innerHTML = item.isColor 
    ? `<span class="swatch swatch-lg" style="background:${item.hex}"></span>${escapeHtml(item.name)} дом` 
    : escapeHtml(item.name);

  $('result-rare').classList.toggle('hidden', !CATEGORIES[activeTask.category].rare);
  
  const rerollBtn = $('reroll-btn');
  if (activeTask.category === 'Интерактивное') {
    rerollBtn.classList.remove('hidden');
  } else {
    rerollBtn.classList.add('hidden');
  }

  updateTimerDisplay();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

/* ---------- ЛОГИКА ТАЙМЕРА И КНОПОК ---------- */
function updateTimerDisplay() {
  const timerEl = $('timer');
  const labelEl = $('timer-label');
  if (!activeTask) return;

  const now = Date.now();
  const remaining = activeTask.deadline - now;
  const elapsed = now - activeTask.startTime;
  
  const catCfg = CATEGORIES[activeTask.category];
  const minMs = (catCfg.minTime || 0) * 60 * 1000; 
  const isReady = elapsed >= minMs;

  $('done-btn').disabled = !isReady;
  $('done-notex-btn').disabled = !isReady;

  if (!isReady) {
    const left = formatTime(minMs - elapsed);
    $('done-btn').textContent = `ЖДИТЕ: ${left}`;
    $('done-notex-btn').textContent = `ЖДИТЕ: ${left}`;
  } else {
    $('done-btn').textContent = `✓ ГОТОВО (С ТЕКСТУРАМИ)`;
    $('done-notex-btn').textContent = `✓ ГОТОВО (БЕЗ ТЕКСТУР)`;
  }

  timerEl.classList.remove('warning', 'danger', 'expired');

  if (remaining <= 0) {
    timerEl.textContent = '00:00:00';
    timerEl.classList.add('expired');
    labelEl.textContent = 'ПРОВАЛ';
    $('done-btn').disabled = true;
    $('done-notex-btn').disabled = true;
    $('reroll-btn').classList.add('hidden');
    
    if (!activeTask.expired) {
      activeTask.expired = true;
      saveActiveTask(activeTask);
      updateScore(-1);
      alert('Время вышло! Вы получаете -1 балл.');
      resetRoulette();
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
  const hours = CATEGORIES[category].timer || 12;
  activeTask = { 
    category, 
    itemData, 
    startTime: Date.now(),
    deadline: Date.now() + hours * 60 * 60 * 1000, 
    expired: false 
  };
  saveActiveTask(activeTask);
  showResultStage();
}

function saveActiveTask(task) {
  if (!task) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(task));
}

async function completeTask(noTexture = false) {
  if (!activeTask) return;
  const cat = CATEGORIES[activeTask.category];
  const points = noTexture ? cat.noTexPoints : cat.points;

  // 1. Сохраняем в Firebase
  await markCompleted(activeTask.itemData.name, noTexture);
  
  // 2. Обновляем локальный кэш и UI
  await fetchCompleted();
  renderCompletedLists();

  // 3. Начисляем очки
  updateScore(points);
  
  alert(`✓ Отлично! Вы получаете +${points} балл(ов).\nМодель добавлена в общий список выполненных.`);
  resetRoulette();
}

function rerollTask() {
  if (!activeTask) return;
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
  $('reel-track').innerHTML = '<div class="reel-item">- - -</div><div class="reel-item">ЖМИ КРУТИТЬ</div><div class="reel-item">- - -</div>';
  $('reel-track').style.transform = 'translateY(0)';
}

/* ---------- Инициализация ---------- */
async function init() {
  try {
    if (!playerName) {
      playerName = prompt('Введите ваше имя для таблицы лидеров:');
      if (playerName) localStorage.setItem(NAME_KEY, playerName);
      else playerName = 'Аноним';
    }

    buildCategoryWheel();
    
    // Загружаем выполненные из базы при старте
    await fetchCompleted();
    renderCompletedLists();
    
    $('spin-category').addEventListener('click', spinCategory);
    $('spin-item').addEventListener('click', spinItem);
    $('done-btn').addEventListener('click', () => completeTask(false));
    $('done-notex-btn').addEventListener('click', () => completeTask(true));
    $('reroll-btn').addEventListener('click', rerollTask);
    $('reset-completed-btn').addEventListener('click', resetCompleted);

    try {
      await loadLeaderboard();
    } catch (e) {
      console.warn('Лидерборд не загрузился:', e);
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        activeTask = JSON.parse(saved);
        showResultStage();
      } catch {}
    }
  } catch (e) {
    console.error('Критическая ошибка инициализации:', e);
  }
}

init();
