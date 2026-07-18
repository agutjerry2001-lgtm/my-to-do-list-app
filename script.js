'use strict';

/* ==========================================================================
   FIELD NOTES — script.js
   Organized into: state & storage, rendering, task operations, filters/sort,
   subtasks, bulk actions, drag reorder, theme/accent, confetti, modal,
   toasts (incl. undo), and event wiring.
   ========================================================================== */

/* ---------- State ---------- */

const STORAGE_KEY = 'fieldnotes.tasks.v1';
const THEME_KEY = 'fieldnotes.theme.v1';
const ACCENT_KEY = 'fieldnotes.accent.v1';

let tasks = loadTasks();
let currentFilter = 'all';
let currentCategory = 'all';
let currentSort = 'created';
let currentSearch = '';
let dragSourceId = null;
let pendingDeleteId = null;
let reminderDismissed = false;
let wasAllComplete = tasks.length > 0 && tasks.every(t => t.completed);

/* ---------- DOM refs ---------- */

const els = {
  taskInput: document.getElementById('taskInput'),
  addTaskBtn: document.getElementById('addTaskBtn'),
  expandFormBtn: document.getElementById('expandFormBtn'),
  detailForm: document.getElementById('detailForm'),
  taskDesc: document.getElementById('taskDesc'),
  taskDue: document.getElementById('taskDue'),
  taskPriority: document.getElementById('taskPriority'),
  taskCategory: document.getElementById('taskCategory'),
  searchInput: document.getElementById('searchInput'),
  filterTabs: document.getElementById('filterTabs'),
  categoryFilter: document.getElementById('categoryFilter'),
  sortSelect: document.getElementById('sortSelect'),
  taskList: document.getElementById('taskList'),
  emptyState: document.getElementById('emptyState'),
  emptyMessage: document.getElementById('emptyMessage'),
  statTotal: document.getElementById('statTotal'),
  statActive: document.getElementById('statActive'),
  statDone: document.getElementById('statDone'),
  progressFill: document.getElementById('progressFill'),
  themeToggle: document.getElementById('themeToggle'),
  iconSun: document.getElementById('iconSun'),
  iconMoon: document.getElementById('iconMoon'),
  accentPicker: document.getElementById('accentPicker'),
  reminderBanner: document.getElementById('reminderBanner'),
  reminderText: document.getElementById('reminderText'),
  reminderDismiss: document.getElementById('reminderDismiss'),
  modalOverlay: document.getElementById('modalOverlay'),
  modalCancel: document.getElementById('modalCancel'),
  modalConfirm: document.getElementById('modalConfirm'),
  toastStack: document.getElementById('toastStack'),
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  markAllBtn: document.getElementById('markAllBtn'),
  clearCompletedBtn: document.getElementById('clearCompletedBtn'),
  confettiCanvas: document.getElementById('confettiCanvas'),
};

/* ==========================================================================
   STORAGE
   ========================================================================== */

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Backfill subtasks array for tasks saved before this feature existed.
    return parsed.map(t => ({ subtasks: [], ...t }));
  } catch (err) {
    console.error('Could not read saved tasks, starting fresh.', err);
    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (err) {
    console.error('Could not save tasks.', err);
    showToast('Storage is full — changes may not persist.');
  }
}

/* ==========================================================================
   TASK OPERATIONS
   ========================================================================== */

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function createTask({ title, description, due, priority, category }) {
  return {
    id: makeId(),
    title: title.trim(),
    description: (description || '').trim(),
    due: due || '',
    priority: priority || 'medium',
    category: category || 'general',
    completed: false,
    createdAt: Date.now(),
    subtasks: [],
  };
}

function addTask() {
  const title = els.taskInput.value.trim();
  if (!title) {
    shakeInput(els.taskInput);
    return;
  }

  const task = createTask({
    title,
    description: els.taskDesc.value,
    due: els.taskDue.value,
    priority: els.taskPriority.value,
    category: els.taskCategory.value,
  });

  tasks.unshift(task);
  saveTasks();
  resetAddForm();
  render();
  showToast('Task added.');
}

function toggleComplete(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  saveTasks();
  render();
  if (task.completed) showToast('Nice — marked complete.');
  checkCelebration();
}

function requestDelete(id) {
  pendingDeleteId = id;
  els.modalOverlay.hidden = false;
}

function confirmDelete() {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  closeModal();

  const index = tasks.findIndex(t => t.id === id);
  if (index === -1) return;
  const [removed] = tasks.splice(index, 1);
  saveTasks();
  render();
  checkCelebration();

  showUndoToast('Task removed.', () => {
    tasks.splice(index, 0, removed);
    saveTasks();
    render();
  });
}

function closeModal() {
  els.modalOverlay.hidden = true;
  pendingDeleteId = null;
}

function startEdit(id) {
  document.querySelectorAll('.task-item.editing').forEach(el => el.classList.remove('editing'));
  const row = document.querySelector(`[data-id="${id}"]`);
  if (!row) return;
  row.classList.add('editing');
  const input = row.querySelector('.edit-input');
  input.value = tasks.find(t => t.id === id).title;
  input.focus();
  input.select();
}

function commitEdit(id, newTitle) {
  const trimmed = newTitle.trim();
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  if (trimmed) {
    task.title = trimmed;
    saveTasks();
  }
  render();
}

/* ==========================================================================
   SUBTASKS / CHECKLIST
   ========================================================================== */

function addSubtask(taskId, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  task.subtasks.push({ id: makeId(), text: trimmed, done: false });
  saveTasks();
  render();
  // Re-open the panel after re-render since render() rebuilds the list.
  const panel = document.querySelector(`[data-id="${taskId}"] .subtask-panel`);
  if (panel) panel.hidden = false;
  const input = document.querySelector(`[data-id="${taskId}"] .subtask-input`);
  if (input) input.focus();
}

function toggleSubtask(taskId, subId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  const sub = task.subtasks.find(s => s.id === subId);
  if (!sub) return;
  sub.done = !sub.done;
  saveTasks();
  render();
  const panel = document.querySelector(`[data-id="${taskId}"] .subtask-panel`);
  if (panel) panel.hidden = false;
}

function removeSubtask(taskId, subId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;
  task.subtasks = task.subtasks.filter(s => s.id !== subId);
  saveTasks();
  render();
  const panel = document.querySelector(`[data-id="${taskId}"] .subtask-panel`);
  if (panel) panel.hidden = false;
}

/* ==========================================================================
   BULK ACTIONS
   ========================================================================== */

function markAllDone() {
  if (tasks.length === 0) return;
  const snapshot = tasks.map(t => ({ ...t }));
  const anyChanged = tasks.some(t => !t.completed);
  if (!anyChanged) {
    showToast('Everything is already done.');
    return;
  }
  tasks.forEach(t => { t.completed = true; });
  saveTasks();
  render();
  showUndoToast('All tasks marked done.', () => {
    tasks = snapshot;
    saveTasks();
    render();
  });
  checkCelebration();
}

function clearCompleted() {
  const completedCount = tasks.filter(t => t.completed).length;
  if (completedCount === 0) {
    showToast('No completed tasks to clear.');
    return;
  }
  const snapshot = tasks.map(t => ({ ...t }));
  tasks = tasks.filter(t => !t.completed);
  saveTasks();
  render();
  showUndoToast(`Cleared ${completedCount} completed task(s).`, () => {
    tasks = snapshot;
    saveTasks();
    render();
  });
}

/* ==========================================================================
   FILTER / SORT / SEARCH
   ========================================================================== */

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function getVisibleTasks() {
  let list = tasks.slice();

  // Status / priority tab filter
  if (currentFilter === 'active') list = list.filter(t => !t.completed);
  else if (currentFilter === 'completed') list = list.filter(t => t.completed);
  else if (['high', 'medium', 'low'].includes(currentFilter)) {
    list = list.filter(t => t.priority === currentFilter);
  }

  // Category filter
  if (currentCategory !== 'all') {
    list = list.filter(t => t.category === currentCategory);
  }

  // Search
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    list = list.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q)
    );
  }

  // Sort
  if (currentSort === 'created') list.sort((a, b) => b.createdAt - a.createdAt);
  else if (currentSort === 'due') {
    list.sort((a, b) => {
      if (!a.due && !b.due) return 0;
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    });
  } else if (currentSort === 'alpha') {
    list.sort((a, b) => a.title.localeCompare(b.title));
  } else if (currentSort === 'priority') {
    list.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  }

  return list;
}

/* ==========================================================================
   RENDERING
   ========================================================================== */

function render() {
  renderStats();
  renderReminder();
  renderList();
}

function renderStats() {
  const total = tasks.length;
  const done = tasks.filter(t => t.completed).length;
  const active = total - done;

  els.statTotal.textContent = total;
  els.statActive.textContent = active;
  els.statDone.textContent = done;
  els.progressFill.style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function renderReminder() {
  const today = todayStr();
  const dueToday = tasks.filter(t => t.due === today && !t.completed);

  if (dueToday.length === 0 || reminderDismissed) {
    els.reminderBanner.hidden = true;
    return;
  }

  els.reminderText.textContent = dueToday.length === 1
    ? `"${dueToday[0].title}" is due today.`
    : `${dueToday.length} tasks are due today.`;
  els.reminderBanner.hidden = false;
}

function renderList() {
  const visible = getVisibleTasks();
  els.taskList.innerHTML = '';

  if (tasks.length === 0) {
    els.emptyMessage.textContent = "A blank page. Write your first task above.";
    els.emptyState.hidden = false;
  } else if (visible.length === 0) {
    els.emptyMessage.textContent = "Nothing matches here — try another filter or search.";
    els.emptyState.hidden = false;
  } else {
    els.emptyState.hidden = true;
  }

  const today = todayStr();

  visible.forEach(task => {
    const li = document.createElement('li');
    li.className = 'task-item' + (task.completed ? ' completed' : '');
    li.dataset.id = task.id;
    li.draggable = true;

    const overdue = task.due && task.due < today && !task.completed;
    const dueToday = task.due === today && !task.completed;
    const subtasks = task.subtasks || [];
    const subDone = subtasks.filter(s => s.done).length;

    li.innerHTML = `
      <button class="check-btn" aria-label="Toggle complete" title="Mark complete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </button>
      <div class="task-body">
        <div class="task-title-row">
          <span class="task-title">${escapeHtml(task.title)}</span>
          ${subtasks.length ? `<span class="pill subtask-progress">${subDone}/${subtasks.length}</span>` : ''}
        </div>
        <input type="text" class="edit-input" maxlength="120">
        ${task.description ? `<p class="task-desc">${escapeHtml(task.description)}</p>` : ''}
        <div class="task-meta">
          <span class="pill pill-priority-${task.priority}">${task.priority}</span>
          <span class="pill pill-category">${escapeHtml(task.category)}</span>
          ${task.due ? `<span class="pill pill-due${overdue ? ' overdue' : ''}${dueToday ? ' today' : ''}">${overdue ? 'overdue · ' : dueToday ? 'due today' : 'due '}${dueToday ? '' : formatDate(task.due)}</span>` : ''}
        </div>
        <div class="subtask-panel" hidden>
          <ul class="subtask-list">
            ${subtasks.map(s => `
              <li class="subtask-row${s.done ? ' done' : ''}" data-sub-id="${s.id}">
                <button class="subtask-check" aria-label="Toggle subtask">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                </button>
                <span class="subtask-text">${escapeHtml(s.text)}</span>
                <button class="subtask-remove" aria-label="Remove subtask">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </li>`).join('')}
          </ul>
          <div class="subtask-add-row">
            <input type="text" class="subtask-input" placeholder="Add a subtask…" maxlength="80">
            <button class="subtask-add-btn" type="button">Add</button>
          </div>
        </div>
      </div>
      <div class="task-actions">
        <button class="checklist-btn${subtasks.length ? ' has-subtasks' : ''}" aria-label="Toggle checklist" title="Subtasks">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>
        </button>
        <button class="edit-btn" aria-label="Edit task" title="Edit">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
        </button>
        <button class="delete-btn" aria-label="Delete task" title="Delete">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
        </button>
      </div>
    `;

    // Row-level events
    li.querySelector('.check-btn').addEventListener('click', () => toggleComplete(task.id));
    li.querySelector('.delete-btn').addEventListener('click', () => requestDelete(task.id));
    li.querySelector('.edit-btn').addEventListener('click', () => startEdit(task.id));

    const editInput = li.querySelector('.edit-input');
    editInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { commitEdit(task.id, editInput.value); }
      if (e.key === 'Escape') { render(); }
    });
    editInput.addEventListener('blur', () => commitEdit(task.id, editInput.value));

    // Checklist / subtasks
    const panel = li.querySelector('.subtask-panel');
    li.querySelector('.checklist-btn').addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) panel.querySelector('.subtask-input').focus();
    });
    panel.querySelectorAll('.subtask-check').forEach(btn => {
      btn.addEventListener('click', () => {
        const subId = btn.closest('.subtask-row').dataset.subId;
        toggleSubtask(task.id, subId);
      });
    });
    panel.querySelectorAll('.subtask-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const subId = btn.closest('.subtask-row').dataset.subId;
        removeSubtask(task.id, subId);
      });
    });
    const subInput = panel.querySelector('.subtask-input');
    const commitSubtask = () => { addSubtask(task.id, subInput.value); };
    panel.querySelector('.subtask-add-btn').addEventListener('click', commitSubtask);
    subInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') commitSubtask();
    });

    // Drag & drop reorder
    li.addEventListener('dragstart', () => {
      dragSourceId = task.id;
      requestAnimationFrame(() => li.classList.add('dragging'));
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    li.addEventListener('dragover', e => {
      e.preventDefault();
      li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', e => {
      e.preventDefault();
      li.classList.remove('drag-over');
      reorderTasks(dragSourceId, task.id);
    });

    els.taskList.appendChild(li);
  });
}

function reorderTasks(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  const sourceIndex = tasks.findIndex(t => t.id === sourceId);
  const targetIndex = tasks.findIndex(t => t.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1) return;

  const [moved] = tasks.splice(sourceIndex, 1);
  tasks.splice(targetIndex, 0, moved);
  saveTasks();
  render();
}

/* ==========================================================================
   HELPERS
   ========================================================================== */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(isoStr) {
  const d = new Date(isoStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function resetAddForm() {
  els.taskInput.value = '';
  els.taskDesc.value = '';
  els.taskDue.value = '';
  els.taskPriority.value = 'medium';
  els.taskCategory.value = 'general';
  els.detailForm.hidden = true;
  els.expandFormBtn.setAttribute('aria-expanded', 'false');
  els.taskInput.focus();
}

function shakeInput(el) {
  el.style.animation = 'none';
  // eslint-disable-next-line no-unused-expressions
  el.offsetHeight; // force reflow to restart animation
  el.style.animation = 'shake 0.3s ease';
}

// Small shake keyframes injected once (kept out of the main stylesheet since
// it's a one-off validation cue rather than a reusable component style).
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `@keyframes shake { 0%,100%{transform:translateX(0);} 25%{transform:translateX(-4px);} 75%{transform:translateX(4px);} }`;
document.head.appendChild(shakeStyle);

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ==========================================================================
   TOASTS (including the undo variant)
   ========================================================================== */

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  els.toastStack.appendChild(toast);
  toast.addEventListener('animationend', e => {
    if (e.animationName === 'toastOut') toast.remove();
  });
}

function showUndoToast(message, undoFn, duration = 5000) {
  const toast = document.createElement('div');
  toast.className = 'toast toast-action toast-persist';

  const text = document.createElement('span');
  text.textContent = message;

  const btn = document.createElement('button');
  btn.className = 'toast-undo';
  btn.type = 'button';
  btn.textContent = 'Undo';

  let settled = false;
  const dismiss = () => {
    if (settled) return;
    settled = true;
    toast.classList.add('toast-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  btn.addEventListener('click', () => {
    if (settled) return;
    settled = true;
    undoFn();
    toast.remove();
  });

  toast.appendChild(text);
  toast.appendChild(btn);
  els.toastStack.appendChild(toast);
  setTimeout(dismiss, duration);
}

/* ==========================================================================
   CELEBRATION (confetti when everything is done)
   ========================================================================== */

function checkCelebration() {
  const allDone = tasks.length > 0 && tasks.every(t => t.completed);
  if (allDone && !wasAllComplete) {
    showToast('All tasks complete — nice work!');
    if (!prefersReducedMotion()) fireConfetti();
  }
  wasAllComplete = allDone;
}

function fireConfetti() {
  const canvas = els.confettiCanvas;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.classList.add('active');

  const colors = ['#E0562F', '#C98A2C', '#5C8A66', '#2F4A7A', '#7A4B79'];
  const particles = Array.from({ length: 140 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.4,
    size: 4 + Math.random() * 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    speedY: 2.5 + Math.random() * 3,
    speedX: -2 + Math.random() * 4,
    rot: Math.random() * 360,
    rotSpeed: -8 + Math.random() * 16,
  }));

  let frame = 0;
  const maxFrames = 130;

  function tick() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.speedX;
      p.y += p.speedY;
      p.rot += p.rotSpeed;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rot * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.6);
      ctx.restore();
    });
    if (frame < maxFrames) {
      requestAnimationFrame(tick);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.remove('active');
    }
  }
  tick();
}

/* ==========================================================================
   THEME + ACCENT
   ========================================================================== */

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  els.iconSun.style.display = theme === 'dark' ? 'none' : 'block';
  els.iconMoon.style.display = theme === 'dark' ? 'block' : 'none';
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

function toggleTheme() {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

function applyAccent(accent) {
  document.body.dataset.accent = accent;
  localStorage.setItem(ACCENT_KEY, accent);
  document.querySelectorAll('.accent-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.accent === accent);
  });
}

function initAccent() {
  const saved = localStorage.getItem(ACCENT_KEY) || 'ink';
  applyAccent(saved);
}

/* ==========================================================================
   IMPORT / EXPORT
   ========================================================================== */

function exportTasks() {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `field-notes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Tasks exported.');
}

function importTasks(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed)) throw new Error('Not a list');
      const valid = parsed.filter(t => t && typeof t.title === 'string');
      tasks = [...valid.map(normalizeImported), ...tasks];
      saveTasks();
      render();
      showToast(`Imported ${valid.length} task(s).`);
    } catch (err) {
      console.error(err);
      showToast('That file could not be read as tasks.');
    }
  };
  reader.readAsText(file);
}

function normalizeImported(t) {
  return {
    id: makeId(),
    title: String(t.title).trim(),
    description: typeof t.description === 'string' ? t.description : '',
    due: typeof t.due === 'string' ? t.due : '',
    priority: ['low', 'medium', 'high'].includes(t.priority) ? t.priority : 'medium',
    category: typeof t.category === 'string' ? t.category : 'general',
    completed: Boolean(t.completed),
    createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
    subtasks: Array.isArray(t.subtasks)
      ? t.subtasks.filter(s => s && typeof s.text === 'string').map(s => ({ id: makeId(), text: s.text, done: Boolean(s.done) }))
      : [],
  };
}

/* ==========================================================================
   EVENT WIRING
   ========================================================================== */

els.addTaskBtn.addEventListener('click', addTask);

els.taskInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') addTask();
  if (e.key === 'Escape') resetAddForm();
});

els.expandFormBtn.addEventListener('click', () => {
  const isHidden = els.detailForm.hidden;
  els.detailForm.hidden = !isHidden;
  els.expandFormBtn.setAttribute('aria-expanded', String(isHidden));
});

els.searchInput.addEventListener('input', e => {
  currentSearch = e.target.value;
  renderList();
});
els.searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    els.searchInput.value = '';
    currentSearch = '';
    renderList();
    els.searchInput.blur();
  }
});

els.filterTabs.addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  renderList();
});

els.categoryFilter.addEventListener('change', e => {
  currentCategory = e.target.value;
  renderList();
});

els.sortSelect.addEventListener('change', e => {
  currentSort = e.target.value;
  renderList();
});

els.themeToggle.addEventListener('click', toggleTheme);

els.accentPicker.addEventListener('click', e => {
  const btn = e.target.closest('.accent-dot');
  if (!btn) return;
  applyAccent(btn.dataset.accent);
});

els.reminderDismiss.addEventListener('click', () => {
  reminderDismissed = true;
  els.reminderBanner.hidden = true;
});

els.modalCancel.addEventListener('click', closeModal);
els.modalOverlay.addEventListener('click', e => {
  if (e.target === els.modalOverlay) closeModal();
});
els.modalConfirm.addEventListener('click', confirmDelete);

els.markAllBtn.addEventListener('click', markAllDone);
els.clearCompletedBtn.addEventListener('click', clearCompleted);

els.exportBtn.addEventListener('click', exportTasks);
els.importBtn.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) importTasks(file);
  e.target.value = '';
});

// Global keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !els.modalOverlay.hidden) closeModal();
});

window.addEventListener('resize', () => {
  if (els.confettiCanvas.classList.contains('active')) {
    els.confettiCanvas.width = window.innerWidth;
    els.confettiCanvas.height = window.innerHeight;
  }
});

/* ==========================================================================
   INIT
   ========================================================================== */

function init() {
  initTheme();
  initAccent();
  render();
}

init();