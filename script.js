'use strict';

/* ==========================================================================
   Habit Tracker — логика приложения (vanilla JS)
   Данные: localStorage, ключ habit-tracker:v1
   ========================================================================== */

/* ------------------------------- Константы -------------------------------- */
const STORAGE_KEY = 'habit-tracker:v1';
const SCHEMA_VERSION = 1;
const DAY_MS = 86400000;
const MAX_NAME = 40;
const MAX_DESC = 120;
const DEFAULT_COLOR = '#6366f1';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const COLORS = [
  { name: 'Индиго', value: '#6366f1' },
  { name: 'Небесный', value: '#0ea5e9' },
  { name: 'Изумрудный', value: '#10b981' },
  { name: 'Янтарный', value: '#f59e0b' },
  { name: 'Розовый', value: '#ec4899' },
  { name: 'Алый', value: '#ef4444' },
  { name: 'Фиолетовый', value: '#8b5cf6' },
  { name: 'Бирюзовый', value: '#14b8a6' }
];
const COLOR_VALUES = COLORS.map((c) => c.value.toLowerCase());

const ICONS = {
  edit: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>'
};

/* ------------------------------ Утилиты дат -------------------------------- */
const pad2 = (n) => String(n).padStart(2, '0');

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + amount);
  return d;
}

/** Локальный ключ даты (без UTC-сдвигов): YYYY-MM-DD */
function keyOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dateOfKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Понедельник недели, к которой относится дата */
function startOfWeek(date) {
  const d = startOfDay(date);
  const shift = (d.getDay() + 6) % 7;
  return addDays(d, -shift);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function rangeDays(start, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(addDays(start, i));
  return out;
}

function isValidKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function formatFull(date) {
  return `${date.getDate()} ${MONTHS_GEN[date.getMonth()]} ${date.getFullYear()}`;
}

/** «13 — 19 октября 2026», «30 сентября — 6 октября 2026», «29 декабря 2025 — 4 января 2026» */
function formatWeekRange(start) {
  const end = addDays(start, 6);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getDate()} — ${end.getDate()} ${MONTHS_GEN[end.getMonth()]} ${end.getFullYear()}`;
  }
  if (sameYear) {
    return `${start.getDate()} ${MONTHS_GEN[start.getMonth()]} — ${end.getDate()} ${MONTHS_GEN[end.getMonth()]} ${end.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTHS_GEN[start.getMonth()]} ${start.getFullYear()} — ${end.getDate()} ${MONTHS_GEN[end.getMonth()]} ${end.getFullYear()}`;
}

function plural(n, forms) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
}

/* ------------------------------ Разное ------------------------------------- */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uid() {
  return 'h_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function pluralize(n, forms) { return plural(n, forms); }

/* ------------------------------ Состояние ---------------------------------- */
const state = {
  habits: [],
  weekOffset: 0,      // 0 = текущая неделя, -1 = прошлая, +1 = следующая
  filter: 'all',      // all | active | today
  editingId: null,
  pendingDeleteId: null,
  lastFocused: null,
  lastToggled: null   // { id, date } — чтобы вернуть фокус после перерисовки
};

/* --------------------------- Проверка хранилища ---------------------------- */
const STORAGE_OK = (() => {
  try {
    const probe = '__habit_tracker_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch (e) {
    return false;
  }
})();

/* ------------------------------ Хранилище ---------------------------------- */
function normalizeCompletions(raw) {
  const result = {};
  if (Array.isArray(raw)) {
    raw.forEach((key) => { if (isValidKey(key)) result[key] = true; });
  } else if (raw && typeof raw === 'object') {
    Object.keys(raw).forEach((key) => {
      if (raw[key] && isValidKey(key)) result[key] = true;
    });
  }
  return result;
}

function normalizeHabit(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) return null;

  const color = typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color)
    ? raw.color.toLowerCase()
    : DEFAULT_COLOR;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
    name: name.slice(0, MAX_NAME),
    description: typeof raw.description === 'string' ? raw.description.trim().slice(0, MAX_DESC) : '',
    color,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    completions: normalizeCompletions(raw.completions)
  };
}

function loadHabits() {
  if (!STORAGE_OK) return [];
  let raw = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return [];
  }
  if (!raw) return [];

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn('Повреждённые данные в localStorage — начинаем с чистого списка.');
    return [];
  }

  const list = Array.isArray(parsed) ? parsed
    : (parsed && Array.isArray(parsed.habits) ? parsed.habits : []);

  return list.map(normalizeHabit).filter(Boolean);
}

function saveHabits() {
  if (!STORAGE_OK) {
    toast('Браузер блокирует localStorage — изменения не сохранятся.', 'error', 5000);
    return false;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: SCHEMA_VERSION,
      habits: state.habits
    }));
    return true;
  } catch (e) {
    toast('Не удалось сохранить данные (хранилище заполнено или недоступно).', 'error', 5000);
    return false;
  }
}

/* ------------------------------- DOM --------------------------------------- */
const el = {
  board: document.getElementById('board'),
  listWrap: document.getElementById('listWrap'),
  list: document.getElementById('habitList'),
  listEmpty: document.getElementById('listEmpty'),
  listEmptyTitle: document.getElementById('listEmptyTitle'),
  listEmptyText: document.getElementById('listEmptyText'),
  resetFilterBtn: document.getElementById('resetFilterBtn'),
  emptyState: document.getElementById('emptyState'),
  emptyAddBtn: document.getElementById('emptyAddBtn'),
  addHabitBtn: document.getElementById('addHabitBtn'),
  fabBtn: document.getElementById('fabBtn'),

  weekRange: document.getElementById('weekRange'),
  weekHint: document.getElementById('weekHint'),
  prevWeek: document.getElementById('prevWeek'),
  nextWeek: document.getElementById('nextWeek'),
  todayBtn: document.getElementById('todayBtn'),
  futureNote: document.getElementById('futureNote'),

  filters: document.querySelector('.filters'),
  statTotal: document.getElementById('statTotal'),
  statToday: document.getElementById('statToday'),
  statWeek: document.getElementById('statWeek'),
  statStreak: document.getElementById('statStreak'),

  weekOverview: document.getElementById('weekOverview'),
  weekOverviewRing: document.getElementById('weekOverviewRing'),
  weekOverviewSub: document.getElementById('weekOverviewSub'),
  weekOverviewBar: document.querySelector('.week-overview__bar'),
  weekOverviewLegend: document.getElementById('weekOverviewLegend'),

  habitModal: document.getElementById('habitModal'),
  habitModalTitle: document.getElementById('habitModalTitle'),
  habitForm: document.getElementById('habitForm'),
  habitName: document.getElementById('habitName'),
  habitDesc: document.getElementById('habitDesc'),
  nameError: document.getElementById('nameError'),
  nameCounter: document.getElementById('nameCounter'),
  descCounter: document.getElementById('descCounter'),
  colorSwatches: document.getElementById('colorSwatches'),
  habitSubmitBtn: document.getElementById('habitSubmitBtn'),

  confirmModal: document.getElementById('confirmModal'),
  confirmText: document.getElementById('confirmText'),
  confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),

  toasts: document.getElementById('toasts')
};

/* ------------------------------ Поиск данных ------------------------------- */
function getHabit(id) {
  return state.habits.find((h) => h.id === id) || null;
}

const todayKey = () => keyOf(new Date());

function isCompleted(habit, key) {
  return Boolean(habit.completions[key]);
}

/* ------------------------------ Подсчёты ----------------------------------- */
/** Текущая серия: считаем назад от сегодня (или от вчера, если сегодня не отмечено). */
function currentStreak(completions) {
  let streak = 0;
  let cursor = new Date();
  if (!completions[keyOf(cursor)]) cursor = addDays(cursor, -1);
  while (completions[keyOf(cursor)]) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Рекордная серия за всё время. */
function bestStreak(completions) {
  const keys = Object.keys(completions).filter((k) => completions[k] && isValidKey(k)).sort();
  if (!keys.length) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < keys.length; i += 1) {
    const diff = Math.round((dateOfKey(keys[i]) - dateOfKey(keys[i - 1])) / DAY_MS);
    run = diff === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

function weekStats(habit, weekDates) {
  const completed = weekDates.filter((d) => isCompleted(habit, keyOf(d))).length;
  const total = weekDates.length;
  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0
  };
}

/* ------------------------------ Навигация ---------------------------------- */
function getWeekStart() {
  return addDays(startOfWeek(new Date()), state.weekOffset * 7);
}

function setWeekOffset(offset) {
  state.weekOffset = offset;
  render();
}

function weekHintText(offset) {
  if (offset === 0) return 'Текущая неделя';
  if (offset === -1) return 'Прошлая неделя';
  if (offset === 1) return 'Следующая неделя';
  if (offset < 0) {
    const n = Math.abs(offset);
    return `${n} ${pluralize(n, ['неделю', 'недели', 'недель'])} назад`;
  }
  const n = offset;
  return `через ${n} ${pluralize(n, ['неделю', 'недели', 'недель'])}`;
}

/* ------------------------------- Фильтры ----------------------------------- */
function matchesFilter(habit) {
  if (state.filter === 'active') return !isCompleted(habit, todayKey());
  if (state.filter === 'today') return isCompleted(habit, todayKey());
  return true;
}

/* ------------------------------- Отрисовка --------------------------------- */
function renderWeekLabel(weekStart) {
  el.weekRange.textContent = formatWeekRange(weekStart);
  el.weekHint.textContent = weekHintText(state.weekOffset);
  el.todayBtn.disabled = state.weekOffset === 0;
  const weekIsFuture = weekStart.getTime() > startOfDay(new Date()).getTime();
  el.futureNote.hidden = !weekIsFuture;
}

function renderStats(weekDates) {
  const total = state.habits.length;
  const doneToday = state.habits.filter((h) => isCompleted(h, todayKey())).length;
  const streak = state.habits.reduce((max, h) => Math.max(max, bestStreak(h.completions)), 0);

  let possible = 0;
  let done = 0;
  state.habits.forEach((h) => {
    const s = weekStats(h, weekDates);
    possible += s.total;
    done += s.completed;
  });
  const weekPercent = possible ? Math.round((done / possible) * 100) : 0;

  el.statTotal.textContent = String(total);
  el.statToday.textContent = `${doneToday} / ${total}`;
  el.statWeek.textContent = `${weekPercent}%`;
  el.statStreak.textContent = String(streak);
}

/** Общий индикатор недели: кольцо, полоса и легенда, сегментированные по привычкам. */
function renderWeekOverview(weekDates) {
  const n = state.habits.length;
  if (!n) return;
  const possible = n * weekDates.length;
  let done = 0;
  const segments = state.habits.map((h) => {
    const s = weekStats(h, weekDates);
    done += s.completed;
    return { color: h.color, name: h.name, completed: s.completed, total: s.total };
  });
  const percent = possible ? Math.round((done / possible) * 100) : 0;

  // сегментированное кольцо: доля каждой привычки своим цветом
  // нулевые сегменты не рисуем, чтобы избежать пустых стопов градиента
  const ringSegs = segments.filter((seg) => seg.completed > 0);
  let acc = 0;
  const ringStops = ringSegs.map((seg) => {
    const p = possible ? (seg.completed / possible) * 100 : 0;
    const from = acc;
    acc += p;
    return `${seg.color} ${from.toFixed(2)}% ${acc.toFixed(2)}%`;
  }).join(', ');
  el.weekOverviewRing.style.background = ringStops
    ? `conic-gradient(${ringStops}, #eef0f8 ${acc.toFixed(2)}% 100%)`
    : 'conic-gradient(#eef0f8 0 100%)';
  el.weekOverviewRing.dataset.pct = String(percent);
  el.weekOverviewRing.setAttribute('aria-valuenow', String(percent));
  el.weekOverviewRing.title = `Общий прогресс за неделю: ${percent}%`;

  // полоса: цветные сегменты по привычкам
  el.weekOverviewBar.innerHTML = segments.map((seg) => {
    const p = possible ? (seg.completed / possible) * 100 : 0;
    return `<span class="week-overview__seg" style="flex-basis:${p}%;background:${seg.color}" title="${escapeHtml(seg.name)}: ${seg.completed} из ${seg.total}"></span>`;
  }).join('');

  const daysWord = pluralize(weekDates.length, ['день', 'дня', 'дней']);
  el.weekOverviewSub.textContent = `${done} из ${possible} отметок · максимум ${weekDates.length} ${daysWord} на привычку`;

  el.weekOverviewLegend.innerHTML = segments.map((seg) =>
    `<li><span class="week-overview__dot" style="background:${seg.color}"></span>` +
    `<span class="week-overview__dot-name">${escapeHtml(seg.name)}</span>` +
    `<strong>${seg.completed}/${seg.total}</strong></li>`
  ).join('');
}

function renderFilterCounts() {
  const total = state.habits.length;
  const done = state.habits.filter((h) => isCompleted(h, todayKey())).length;
  const counts = { all: total, active: total - done, today: done };
  el.filters.querySelectorAll('[data-count]').forEach((node) => {
    node.textContent = String(counts[node.dataset.count] ?? 0);
  });
  el.filters.querySelectorAll('[data-filter]').forEach((chip) => {
    const active = chip.dataset.filter === state.filter;
    chip.classList.toggle('is-active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
}

function dayCell(habit, date, today) {
  const key = keyOf(date);
  const weekday = WEEKDAYS[(date.getDay() + 6) % 7];
  const completed = isCompleted(habit, key);
  const future = key > todayKey();
  const isToday = isSameDay(date, today);

  const classes = ['day'];
  if (completed) classes.push('is-completed');
  if (isToday) classes.push('is-today');
  if (!completed && !isToday && !future) classes.push('is-past');

  let label = `${weekday}, ${formatFull(date)}`;
  if (future) label += ' — будущий день, отметить нельзя';
  else label += completed ? ' — выполнено, нажмите, чтобы снять отметку'
    : ' — не выполнено, нажмите, чтобы отметить';

  return `<button type="button" class="${classes.join(' ')}"
      data-action="toggle-day" data-id="${escapeHtml(habit.id)}" data-date="${key}"
      ${future ? 'disabled' : ''} aria-pressed="${completed}" aria-label="${escapeHtml(label)}"
      title="${escapeHtml(label)}">
      <span class="day__name">${weekday}</span>
      <span class="day__dot" aria-hidden="true">${date.getDate()}</span>
    </button>`;
}

function habitCard(habit, weekDates) {
  const today = new Date();
  const stats = weekStats(habit, weekDates);
  const streak = currentStreak(habit.completions);
  const record = bestStreak(habit.completions);
  const doneToday = isCompleted(habit, todayKey());

  const streakText = streak > 0
    ? `Серия: ${streak} ${pluralize(streak, ['день', 'дня', 'дней'])}`
    : 'Серия: 0 дней';

  const desc = habit.description
    ? `<p class="habit-card__desc">${escapeHtml(habit.description)}</p>`
    : '';

  return `<li class="habit-card" style="--habit-color:${habit.color}">
    <div class="habit-card__head">
      <div class="habit-card__titles">
        <h3 class="habit-card__title">${escapeHtml(habit.name)}</h3>
        ${desc}
      </div>
      <div class="habit-card__actions">
        <button type="button" class="icon-btn icon-btn--plain" data-action="edit" data-id="${escapeHtml(habit.id)}"
          aria-label="Редактировать привычку «${escapeHtml(habit.name)}»" title="Редактировать">${ICONS.edit}</button>
        <button type="button" class="icon-btn icon-btn--plain icon-btn--danger" data-action="delete" data-id="${escapeHtml(habit.id)}"
          aria-label="Удалить привычку «${escapeHtml(habit.name)}»" title="Удалить">${ICONS.trash}</button>
      </div>
    </div>

    <div class="habit-card__metabar">
      <span class="pill ${doneToday ? 'pill--done' : ''}">
        <span aria-hidden="true">${doneToday ? '✓' : '○'}</span>
        ${doneToday ? 'Сегодня выполнено' : 'Сегодня не выполнено'}
      </span>
      <span class="pill ${streak > 0 ? 'pill--streak' : ''}" title="Текущая серия: ${escapeHtml(streakText)} • Рекорд: ${record}">
        <span aria-hidden="true">🔥</span> ${escapeHtml(streakText)}
      </span>
    </div>

    <div class="habit-card__progress-row">
      <span class="habit-card__progress-label">Выполнено за неделю</span>
      <span class="habit-card__progress-value">${stats.completed} из ${stats.total} · ${stats.percent}%</span>
    </div>
    <div class="progress" role="progressbar" aria-valuenow="${stats.percent}" aria-valuemin="0" aria-valuemax="100"
      aria-label="Прогресс за неделю: ${stats.percent}%">
      <div class="progress__bar" style="width:${stats.percent}%"></div>
    </div>

    <div class="week" role="group" aria-label="Отметки за неделю">
      ${weekDates.map((d) => dayCell(habit, d, today)).join('')}
    </div>
  </li>`;
}

function renderList(weekDates) {
  const filtered = state.habits.filter(matchesFilter);

  el.list.innerHTML = filtered.map((h) => habitCard(h, weekDates)).join('');
  el.listEmpty.hidden = filtered.length > 0;

  if (!filtered.length) {
    if (state.filter === 'today') {
      el.listEmptyTitle.textContent = 'Сегодня ещё ничего не выполнено';
      el.listEmptyText.textContent = 'Отметьте привычку в недельной сетке — она появится здесь.';
    } else if (state.filter === 'active') {
      el.listEmptyTitle.textContent = 'Все привычки выполнены сегодня';
      el.listEmptyText.textContent = 'Отличная работа! Загляните в раздел «Выполнено сегодня».';
    } else {
      el.listEmptyTitle.textContent = 'Ничего не найдено';
      el.listEmptyText.textContent = 'Попробуйте изменить фильтр.';
    }
  }
}

function render() {
  const weekStart = getWeekStart();
  const weekDates = rangeDays(weekStart, 7);
  const hasHabits = state.habits.length > 0;

  el.board.hidden = !hasHabits;
  el.listWrap.hidden = !hasHabits;
  el.emptyState.hidden = hasHabits;

  renderWeekLabel(weekStart);
  if (!hasHabits) {
    el.list.innerHTML = '';
    return;
  }

  renderStats(weekDates);
  renderFilterCounts();
  renderWeekOverview(weekDates);
  renderList(weekDates);
}

/* ------------------------------ Уведомления -------------------------------- */
function toast(message, type = 'info', duration = 3200) {
  if (!el.toasts) return;
  const icon = type === 'success' ? '✓' : type === 'error' ? '!' : 'i';
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.innerHTML = `<span class="toast__icon" aria-hidden="true">${icon}</span><span>${escapeHtml(message)}</span>`;
  el.toasts.appendChild(node);

  while (el.toasts.children.length > 4) el.toasts.removeChild(el.toasts.firstElementChild);

  window.setTimeout(() => {
    node.classList.add('toast--out');
    window.setTimeout(() => node.remove(), 220);
  }, duration);
}

/* -------------------------------- Модалки ---------------------------------- */
function openModal(modal) {
  state.lastFocused = document.activeElement;
  modal.hidden = false;
  const panel = modal.querySelector('.modal__panel');
  const focusable = panel.querySelector('input:not([type="radio"]), textarea, select, button');
  if (focusable) window.setTimeout(() => focusable.focus(), 30);
}

function closeModal(modal) {
  modal.hidden = true;
  if (state.lastFocused && typeof state.lastFocused.focus === 'function') {
    state.lastFocused.focus();
  }
  state.lastFocused = null;
}

function anyModalOpen() {
  return !el.habitModal.hidden || !el.confirmModal.hidden;
}

function trapFocus(event, modal) {
  if (event.key !== 'Tab') return;
  const panel = modal.querySelector('.modal__panel');
  const nodes = Array.from(panel.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])'
  )).filter((n) => n.offsetParent !== null || n === document.activeElement);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ------------------------- Форма привычки ---------------------------------- */
function renderSwatches(selected) {
  el.colorSwatches.innerHTML = COLORS.map((c) => {
    const checked = c.value === selected ? 'checked' : '';
    return `<label class="swatch" title="${c.name}">
      <input type="radio" name="color" value="${c.value}" ${checked} />
      <span class="swatch__dot" style="--swatch:${c.value}"></span>
      <span class="sr-only">${c.name}</span>
    </label>`;
  }).join('');
}

function updateDescCounter() {
  el.descCounter.textContent = `${el.habitDesc.value.length} / ${MAX_DESC}`;
}

function updateNameCounter() {
  const len = el.habitName.value.length;
  el.nameCounter.textContent = `${len} / ${MAX_NAME}`;
  el.nameCounter.classList.toggle('field__counter--warn', len >= MAX_NAME - 5);
}

function clearFieldError() {
  el.nameError.textContent = '';
  el.habitName.classList.remove('is-invalid');
  el.habitName.removeAttribute('aria-invalid');
}

function showFieldError(message) {
  el.nameError.textContent = message;
  el.habitName.classList.add('is-invalid');
  el.habitName.setAttribute('aria-invalid', 'true');
  el.habitName.focus();
}

function openHabitModal(habit) {
  state.editingId = habit ? habit.id : null;
  el.habitModalTitle.textContent = habit ? 'Редактировать привычку' : 'Новая привычка';
  el.habitSubmitBtn.textContent = habit ? 'Сохранить изменения' : 'Добавить привычку';
  el.habitName.value = habit ? habit.name : '';
  el.habitDesc.value = habit ? habit.description : '';
  clearFieldError();
  updateNameCounter();
  updateDescCounter();
  renderSwatches(habit ? habit.color : COLORS[0].value);
  openModal(el.habitModal);
}

function validateName(name, editingId) {
  if (!name) return 'Введите название привычки.';
  if (name.length < 2) return 'Название должно содержать минимум 2 символа.';
  if (name.length > MAX_NAME) return `Название не длиннее ${MAX_NAME} символов.`;
  const duplicate = state.habits.some(
    (h) => h.id !== editingId && h.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) return 'Привычка с таким названием уже существует.';
  return '';
}

function submitHabitForm(event) {
  event.preventDefault();

  const name = el.habitName.value.trim().replace(/\s+/g, ' ');
  const description = el.habitDesc.value.trim().replace(/\s+/g, ' ').slice(0, MAX_DESC);
  const checked = el.habitForm.querySelector('input[name="color"]:checked');
  const color = checked ? checked.value.toLowerCase() : DEFAULT_COLOR;

  const error = validateName(name, state.editingId);
  if (error) {
    showFieldError(error);
    return;
  }
  clearFieldError();

  if (state.editingId) {
    const habit = getHabit(state.editingId);
    if (!habit) {
      toast('Привычка не найдена — возможно, она уже удалена.', 'error');
      closeModal(el.habitModal);
      return;
    }
    habit.name = name;
    habit.description = description;
    habit.color = COLOR_VALUES.includes(color) ? color : habit.color;
    if (saveHabits()) {
      closeModal(el.habitModal);
      render();
      toast(`Привычка «${name}» обновлена.`, 'success');
    }
  } else {
    const habit = {
      id: uid(),
      name,
      description,
      color: COLOR_VALUES.includes(color) ? color : DEFAULT_COLOR,
      createdAt: new Date().toISOString(),
      completions: {}
    };
    state.habits.unshift(habit);
    if (saveHabits()) {
      state.weekOffset = 0; // показываем текущую неделю, чтобы новая привычка была рядом с «сегодня»
      state.filter = 'all'; // и сбрасываем фильтр, чтобы привычка сразу была видна
      closeModal(el.habitModal);
      render();
      toast(`Привычка «${name}» добавлена.`, 'success');
    } else {
      state.habits.shift();
    }
  }
}

/* -------------------------------- Удаление --------------------------------- */
function openConfirmModal(habit) {
  state.pendingDeleteId = habit.id;
  el.confirmText.textContent = `Привычка «${habit.name}» и все отметки о её выполнении будут удалены. Это действие нельзя отменить.`;
  openModal(el.confirmModal);
}

function confirmDelete() {
  const habit = getHabit(state.pendingDeleteId);
  state.pendingDeleteId = null;
  closeModal(el.confirmModal);
  if (!habit) return;

  const index = state.habits.indexOf(habit);
  state.habits.splice(index, 1);
  if (saveHabits()) {
    render();
    toast(`Привычка «${habit.name}» удалена.`, 'success');
  } else {
    state.habits.splice(index, 0, habit);
  }
}

/* ------------------------------- Действия ---------------------------------- */
function toggleDay(id, key) {
  const habit = getHabit(id);
  if (!habit) {
    toast('Привычка не найдена.', 'error');
    return;
  }
  if (!isValidKey(key)) {
    toast('Некорректная дата.', 'error');
    return;
  }
  if (key > todayKey()) {
    toast('Нельзя отметить будущий день.', 'error');
    return;
  }

  const wasCompleted = isCompleted(habit, key);
  if (wasCompleted) delete habit.completions[key];
  else habit.completions[key] = true;

  if (!saveHabits()) {
    // откат изменения
    if (wasCompleted) habit.completions[key] = true;
    else delete habit.completions[key];
    return;
  }

  state.lastToggled = { id, date: key };
  render();
  restoreToggledFocus();

  if (wasCompleted) toast('Отметка снята.', 'info', 1800);
  else toast('Выполнение отмечено. Так держать!', 'success', 1800);
}

function restoreToggledFocus() {
  const target = state.lastToggled;
  state.lastToggled = null;
  if (!target) return;
  const buttons = el.list.querySelectorAll('[data-action="toggle-day"]');
  for (let i = 0; i < buttons.length; i += 1) {
    const btn = buttons[i];
    if (btn.dataset.id === target.id && btn.dataset.date === target.date) {
      btn.focus();
      return;
    }
  }
}

/* -------------------------------- События ---------------------------------- */
function bindEvents() {
  // Добавление
  el.addHabitBtn.addEventListener('click', () => openHabitModal(null));
  el.emptyAddBtn.addEventListener('click', () => openHabitModal(null));
  el.fabBtn.addEventListener('click', () => openHabitModal(null));

  // Форма
  el.habitForm.addEventListener('submit', submitHabitForm);
  el.habitName.addEventListener('input', () => {
    // название — одна строка: переносы строк заменяем пробелом
    if (el.habitName.value.indexOf('\n') !== -1) {
      el.habitName.value = el.habitName.value.replace(/\n/g, ' ');
    }
    clearFieldError();
    updateNameCounter();
  });
  el.habitName.addEventListener('blur', () => {
    const raw = el.habitName.value.trim().replace(/\s+/g, ' ');
    if (!raw) {
      clearFieldError();
      return;
    }
    const error = validateName(raw, state.editingId);
    if (error) showFieldError(error);
    else clearFieldError();
  });
  el.habitDesc.addEventListener('input', updateDescCounter);

  // Навигация по неделям
  el.prevWeek.addEventListener('click', () => setWeekOffset(state.weekOffset - 1));
  el.nextWeek.addEventListener('click', () => setWeekOffset(state.weekOffset + 1));
  el.todayBtn.addEventListener('click', () => setWeekOffset(0));

  // Фильтры
  el.filters.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    state.filter = chip.dataset.filter;
    renderFilterCounts();
    renderList(rangeDays(getWeekStart(), 7));
  });

  el.resetFilterBtn.addEventListener('click', () => {
    state.filter = 'all';
    render();
  });

  // Действия над привычками (делегирование)
  el.list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id, date } = button.dataset;
    if (action === 'toggle-day') toggleDay(id, date);
    else if (action === 'edit') {
      const habit = getHabit(id);
      if (habit) openHabitModal(habit);
      else toast('Привычка не найдена.', 'error');
    } else if (action === 'delete') {
      const habit = getHabit(id);
      if (habit) openConfirmModal(habit);
      else toast('Привычка не найдена.', 'error');
    }
  });

  // Кнопка подтверждения удаления
  el.confirmDeleteBtn.addEventListener('click', confirmDelete);

  // Закрытие модалок
  document.querySelectorAll('[data-close]').forEach((node) => {
    node.addEventListener('click', () => {
      const which = node.dataset.close;
      if (which === 'habit') closeModal(el.habitModal);
      if (which === 'confirm') {
        state.pendingDeleteId = null;
        closeModal(el.confirmModal);
      }
    });
  });

  // Клавиатура: Escape + ловушка фокуса
  document.addEventListener('keydown', (event) => {
    if (!anyModalOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!el.confirmModal.hidden) {
        state.pendingDeleteId = null;
        closeModal(el.confirmModal);
      } else if (!el.habitModal.hidden) {
        closeModal(el.habitModal);
      }
      return;
    }
    if (!el.habitModal.hidden) trapFocus(event, el.habitModal);
    else if (!el.confirmModal.hidden) trapFocus(event, el.confirmModal);
  });

  // Синхронизация между вкладками
  window.addEventListener('storage', (event) => {
    if (event.key && event.key !== STORAGE_KEY) return;
    state.habits = loadHabits();
    render();
    toast('Данные обновлены в другой вкладке.', 'info');
  });
}

/* --------------------------------- Старт ----------------------------------- */
function init() {
  state.habits = loadHabits();
  persistNormalized();
  renderSwatches(COLORS[0].value);
  bindEvents();
  render();

  if (!STORAGE_OK) {
    toast('localStorage недоступен: привычки не будут сохраняться после перезагрузки.', 'error', 6000);
  }
}

/** Если в хранилище лежали повреждённые/устаревшие данные — перезаписываем нормализованными. */
function persistNormalized() {
  if (!STORAGE_OK) return;
  try {
    const clean = JSON.stringify({ version: SCHEMA_VERSION, habits: state.habits });
    if (window.localStorage.getItem(STORAGE_KEY) !== clean) {
      window.localStorage.setItem(STORAGE_KEY, clean);
    }
  } catch (e) {
    /* хранилище недоступно — молча пропускаем */
  }
}

init();
