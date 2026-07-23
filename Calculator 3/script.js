/* =========================================================
   AURUM CALCULATOR — script.js
   Vanilla JS, no dependencies.
   Sections:
   1. State
   2. Math engine (safe evaluator)
   3. Display rendering
   4. Input handling (buttons + keyboard)
   5. Memory
   6. History
   7. Themes & Settings
   8. Misc UI (fullscreen, copy, ripple, sound)
   ========================================================= */

(() => {
  'use strict';

  /* ---------------- 1. STATE ---------------- */

  const state = {
    expression: '',        // raw expression as typed (display symbols)
    result: '0',            // last computed / current shown result
    justEvaluated: false,   // true right after "=" so next digit starts fresh
    memory: 0,
    memoryActive: false,
    mode: 'standard',       // 'standard' | 'scientific'
    isDegree: true,
    history: [],
    historyFilter: '',
    undoStack: [],
    redoStack: [],
    settings: {
      theme: 'dark',
      accent: '#c98a3e',
      fontSize: 48,
      sound: false,
      haptic: false
    }
  };

  const STORAGE_KEYS = {
    history: 'aurum_history_v1',
    settings: 'aurum_settings_v1'
  };

  /* ---------------- DOM refs ---------------- */

  const el = {
    expression: document.getElementById('expression'),
    result: document.getElementById('result'),
    errorBanner: document.getElementById('errorBanner'),
    memIndicator: document.getElementById('memIndicator'),
    calcSlab: document.getElementById('calcSlab'),
    scientificPanel: document.getElementById('scientificPanel'),
    degRadBtn: document.getElementById('degRadBtn'),
    historyPanel: document.getElementById('historyPanel'),
    historyList: document.getElementById('historyList'),
    historySearch: document.getElementById('historySearch'),
    copyBtn: document.getElementById('copyBtn'),
    undoBtn: document.getElementById('undoBtn'),
    redoBtn: document.getElementById('redoBtn'),
    settingsOverlay: document.getElementById('settingsOverlay'),
    accentPicker: document.getElementById('accentPicker'),
    fontSizeSlider: document.getElementById('fontSizeSlider'),
    soundToggle: document.getElementById('soundToggle'),
    hapticToggle: document.getElementById('hapticToggle')
  };

  /* ---------------- 2. MATH ENGINE ---------------- */

  function factorial(n) {
    if (n < 0 || !Number.isFinite(n) || Math.floor(n) !== n) {
      throw new Error('Invalid factorial');
    }
    if (n > 170) throw new Error('Overflow');
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  function toRad(x) { return state.isDegree ? (x * Math.PI) / 180 : x; }
  function fromRad(x) { return state.isDegree ? (x * 180) / Math.PI : x; }

  // Helper namespace exposed to the evaluated expression via `with`.
  const helpers = {
    sin: (x) => Math.sin(toRad(x)),
    cos: (x) => Math.cos(toRad(x)),
    tan: (x) => Math.tan(toRad(x)),
    asin: (x) => fromRad(Math.asin(x)),
    acos: (x) => fromRad(Math.acos(x)),
    atan: (x) => fromRad(Math.atan(x)),
    log: (x) => Math.log10(x),
    ln: (x) => Math.log(x),
    sqrt: (x) => Math.sqrt(x),
    cbrt: (x) => Math.cbrt(x),
    abs: (x) => Math.abs(x),
    fact: (x) => factorial(x),
    pow: (x, y) => Math.pow(x, y),
    PI: Math.PI,
    E: Math.E,
    rnd: () => Math.random()
  };

  /**
   * Converts the human-friendly display expression into a JS-evaluable
   * string, then validates every remaining identifier is whitelisted
   * before handing it to `Function`. This avoids raw `eval` on
   * uncontrolled input while still supporting scientific functions.
   */
  function buildEvaluableExpression(raw) {
    let expr = raw
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/−/g, '-')
      .replace(/π/g, 'PI')
      .replace(/√\(/g, 'sqrt(')
      .replace(/∛\(/g, 'cbrt(')
      .replace(/\^/g, '**')
      .replace(/(\d+(?:\.\d+)?)%/g, '($1/100)')
      .replace(/\s*mod\s*/g, '%');

    // Strip whitespace for validation
    const stripped = expr.replace(/\s+/g, '');

    // Whitelist: digits, operators, parens, dot, comma, and known identifiers.
    const identifierWhitelist = /^(sin|cos|tan|asin|acos|atan|log|ln|sqrt|cbrt|abs|fact|pow|PI|E|rnd)$/;
    const tokens = stripped.match(/[A-Za-z]+/g) || [];
    for (const tok of tokens) {
      if (!identifierWhitelist.test(tok)) {
        throw new Error('Invalid syntax');
      }
    }
    if (/[^0-9A-Za-z+\-*/%().,\s]/.test(stripped.replace(/\*\*/g, ''))) {
      throw new Error('Invalid syntax');
    }

    return expr;
  }

  function evaluateExpression(raw) {
    if (!raw || !raw.trim()) return 0;
    const expr = buildEvaluableExpression(raw);

    const fn = new Function(
      'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
      'log', 'ln', 'sqrt', 'cbrt', 'abs', 'fact', 'pow', 'PI', 'E', 'rnd',
      `"use strict"; return (${expr});`
    );

    const value = fn(
      helpers.sin, helpers.cos, helpers.tan, helpers.asin, helpers.acos, helpers.atan,
      helpers.log, helpers.ln, helpers.sqrt, helpers.cbrt, helpers.abs, helpers.fact,
      helpers.pow, helpers.PI, helpers.E, helpers.rnd
    );

    if (typeof value !== 'number' || Number.isNaN(value)) throw new Error('NaN');
    if (!Number.isFinite(value)) throw new Error('Infinity');
    return value;
  }

  function formatNumber(n) {
    if (typeof n !== 'number' || Number.isNaN(n)) return 'Error';
    if (!Number.isFinite(n)) return n > 0 ? '∞' : '-∞';

    const abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
      return n.toExponential(6).replace(/e([+-])(\d)$/, 'e$1$2');
    }

    // Round to avoid floating point noise, then add thousands separators.
    const rounded = Math.round(n * 1e10) / 1e10;
    const [intPart, decPart] = rounded.toString().split('.');
    const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decPart ? `${withSeparators}.${decPart}` : withSeparators;
  }

  /* ---------------- 3. DISPLAY ---------------- */

  function render({ animate = false } = {}) {
    el.expression.textContent = state.expression;
    el.result.textContent = state.result;
    if (animate) {
      el.result.classList.remove('pop');
      void el.result.offsetWidth; // reflow to restart animation
      el.result.classList.add('pop');
    }
    el.memIndicator.classList.toggle('visible', state.memoryActive);
    el.undoBtn.disabled = state.undoStack.length === 0;
    el.redoBtn.disabled = state.redoStack.length === 0;
    document.documentElement.style.setProperty('--result-size', state.settings.fontSize + 'px');
  }

  function showError(message) {
    el.errorBanner.textContent = message;
    el.errorBanner.classList.add('show');
    el.result.classList.add('error-shake');
    state.result = 'Error';
    el.result.textContent = 'Error';
    setTimeout(() => el.result.classList.remove('error-shake'), 400);
    setTimeout(() => el.errorBanner.classList.remove('show'), 2500);
  }

  function clearError() {
    el.errorBanner.classList.remove('show');
  }

  /* ---------------- Undo/Redo snapshot ---------------- */

  function pushUndo() {
    state.undoStack.push(state.expression);
    if (state.undoStack.length > 50) state.undoStack.shift();
    state.redoStack.length = 0;
  }

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(state.expression);
    state.expression = state.undoStack.pop();
    state.justEvaluated = false;
    clearError();
    render();
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(state.expression);
    state.expression = state.redoStack.pop();
    render();
  }

  /* ---------------- 4. INPUT HANDLING ---------------- */

  function appendToExpression(str) {
    if (state.justEvaluated) {
      // Starting a fresh calculation after "="
      const isOperatorStart = /^[+\-×÷%^]/.test(str);
      state.expression = isOperatorStart ? state.result + str : str;
      state.justEvaluated = false;
    } else {
      pushUndo();
      state.expression += str;
    }
    clearError();
    render();
  }

  function handleDigit(d) {
    appendToExpression(d);
  }

  function handleDecimal() {
    // Prevent multiple decimals in the current number segment
    const segment = state.expression.split(/[+\-×÷%^()]/).pop();
    if (segment.includes('.')) return;
    appendToExpression(state.expression === '' || state.justEvaluated ? '0.' : '.');
  }

  function handleOperator(symbol) {
    if (state.expression === '' && !state.justEvaluated) return;
    if (state.justEvaluated) {
      state.expression = state.result;
      state.justEvaluated = false;
    }
    pushUndo();
    // Replace a trailing operator instead of stacking them
    if (/[+\-×÷%^]\s*$/.test(state.expression)) {
      state.expression = state.expression.slice(0, -1) + symbol;
    } else {
      state.expression += symbol;
    }
    clearError();
    render();
  }

  function handleFunction(name) {
    const map = {
      sin: 'sin(', cos: 'cos(', tan: 'tan(',
      asin: 'asin(', acos: 'acos(', atan: 'atan(',
      log: 'log(', ln: 'ln(', sqrt: '√(', cbrt: '∛(', abs: 'abs(',
    };
    if (state.justEvaluated) { state.expression = ''; state.justEvaluated = false; }
    pushUndo();
    state.expression += map[name];
    clearError();
    render();
  }

  function handleAction(action) {
    switch (action) {
      case 'ac':
        state.expression = '';
        state.result = '0';
        state.justEvaluated = false;
        clearError();
        render();
        break;
      case 'ce':
        pushUndo();
        state.expression = state.expression.replace(/(-?\d+\.?\d*|\.\d+)$/, '');
        render();
        break;
      case 'backspace':
        pushUndo();
        state.expression = state.expression.slice(0, -1);
        state.justEvaluated = false;
        render();
        break;
      case 'negate':
        toggleNegate();
        break;
      case 'decimal':
        handleDecimal();
        break;
      case 'percent':
        appendToExpression('%');
        break;
      case 'add': handleOperator('+'); break;
      case 'subtract': handleOperator('−'); break;
      case 'multiply': handleOperator('×'); break;
      case 'divide': handleOperator('÷'); break;
      case 'mod': appendModOperator(); break;
      case 'pow': handleOperator('^'); break;

      case 'square': wrapCurrent('', '^2'); break;
      case 'cube': wrapCurrent('', '^3'); break;
      case 'sqrt': handleFunction('sqrt'); break;
      case 'cbrt': handleFunction('cbrt'); break;
      case 'abs': handleFunction('abs'); break;
      case 'fact': appendFactorial(); break;
      case 'log': handleFunction('log'); break;
      case 'ln': handleFunction('ln'); break;
      case 'exp10': appendToExpression('10^('); break;
      case 'expe': appendToExpression('e^('); break;
      case 'sin': handleFunction('sin'); break;
      case 'cos': handleFunction('cos'); break;
      case 'tan': handleFunction('tan'); break;
      case 'asin': handleFunction('asin'); break;
      case 'acos': handleFunction('acos'); break;
      case 'atan': handleFunction('atan'); break;
      case 'pi': appendToExpression('π'); break;
      case 'euler': appendToExpression('e'); break;
      case 'rand': appendToExpression(String(Math.random().toFixed(8))); break;
      case 'paren-open': appendToExpression('('); break;
      case 'paren-close': appendToExpression(')'); break;
      case 'degrad': toggleDegRad(); break;

      case 'equals': compute(); break;

      case 'mc': memoryClear(); break;
      case 'mr': memoryRecall(); break;
      case 'ms': memorySet(); break;
      case 'mplus': memoryAdd(); break;
      case 'mminus': memorySubtract(); break;

      default: break;
    }
  }

  // "fact" needs special handling: append ! after the trailing number
  function appendFactorial() {
    if (state.justEvaluated) {
      state.expression = state.result + '!';
      state.justEvaluated = false;
    } else {
      pushUndo();
      state.expression += '!';
    }
    clearError();
    render();
  }

  function wrapCurrent(prefix, suffix) {
    // Wrap the trailing numeric segment: e.g. "12" -> "12^2"
    if (state.justEvaluated) {
      state.expression = state.result + suffix;
      state.justEvaluated = false;
    } else {
      pushUndo();
      state.expression += suffix;
    }
    clearError();
    render();
  }

  function appendModOperator() {
    if (state.expression === '' && !state.justEvaluated) return;
    if (state.justEvaluated) {
      state.expression = state.result;
      state.justEvaluated = false;
    }
    pushUndo();
    state.expression = state.expression.replace(/\s*mod\s*$/, '') + ' mod ';
    clearError();
    render();
  }

  function toggleNegate() {
    // Negate the trailing number segment
    const match = state.expression.match(/(-?\d+\.?\d*|\.\d+)$/);
    pushUndo();
    if (!match) {
      state.expression += '-';
    } else {
      const num = match[0];
      const start = state.expression.length - num.length;
      const negated = num.startsWith('-') ? num.slice(1) : '-' + num;
      state.expression = state.expression.slice(0, start) + negated;
    }
    render();
  }

  function toggleDegRad() {
    state.isDegree = !state.isDegree;
    el.degRadBtn.textContent = state.isDegree ? 'DEG' : 'RAD';
    playSound('toggle');
  }

  /* ---- Pre-processing: turn "!" and "e" tokens into engine-friendly form ---- */
  function preprocessForEval(expr) {
    let out = expr;
    // factorial: number followed by ! -> fact(number)
    out = out.replace(/(\d+(?:\.\d+)?)!/g, 'fact($1)');
    // bare Euler's number `e` (not part of identifier) -> E
    out = out.replace(/(^|[^A-Za-z])e($|[^A-Za-z])/g, '$1E$2');
    return out;
  }

  function compute() {
    if (!state.expression.trim()) return;
    try {
      const prepped = preprocessForEval(state.expression);
      const value = evaluateExpression(prepped);
      const formatted = formatNumber(value);
      addHistoryEntry(state.expression, formatted);
      state.result = formatted;
      state.justEvaluated = true;
      clearError();
      render({ animate: true });
      playSound('equals');
    } catch (err) {
      const msg = err && err.message ? err.message : 'Invalid syntax';
      showError(friendlyError(msg));
      playSound('error');
    }
  }

  function friendlyError(msg) {
    const map = {
      'Invalid syntax': 'Invalid expression',
      'NaN': 'Not a number',
      'Infinity': 'Division by zero',
      'Invalid factorial': 'Factorial needs a non-negative integer',
      'Overflow': 'Number too large'
    };
    return map[msg] || msg;
  }

  /* ---------------- 5. MEMORY ---------------- */

  function currentNumericResult() {
    const n = parseFloat(String(state.result).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function memoryClear() {
    state.memory = 0;
    state.memoryActive = false;
    render();
  }
  function memoryRecall() {
    if (!state.memoryActive) return;
    appendToExpression(formatNumber(state.memory));
  }
  function memorySet() {
    state.memory = currentNumericResult();
    state.memoryActive = true;
    render();
  }
  function memoryAdd() {
    state.memory += currentNumericResult();
    state.memoryActive = true;
    render();
  }
  function memorySubtract() {
    state.memory -= currentNumericResult();
    state.memoryActive = true;
    render();
  }

  /* ---------------- 6. HISTORY ---------------- */

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.history);
      state.history = raw ? JSON.parse(raw) : [];
    } catch {
      state.history = [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(state.history));
    } catch {
      /* storage unavailable — history stays in-memory only */
    }
  }

  function addHistoryEntry(expression, result) {
    const entry = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      expression,
      result,
      timestamp: Date.now()
    };
    state.history.unshift(entry);
    if (state.history.length > 200) state.history.pop();
    saveHistory();
    renderHistory();
  }

  function deleteHistoryEntry(id) {
    state.history = state.history.filter((h) => h.id !== id);
    saveHistory();
    renderHistory();
  }

  function clearAllHistory() {
    state.history = [];
    saveHistory();
    renderHistory();
  }

  function formatTimestamp(ts) {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function renderHistory() {
    const filter = state.historyFilter.trim().toLowerCase();
    const items = state.history.filter((h) =>
      !filter ||
      h.expression.toLowerCase().includes(filter) ||
      h.result.toLowerCase().includes(filter)
    );

    if (!items.length) {
      el.historyList.innerHTML = '<li class="history-empty">No calculations yet</li>';
      return;
    }

    el.historyList.innerHTML = items.map((h) => `
      <li class="history-item" data-id="${h.id}" tabindex="0" role="button" aria-label="Reuse calculation ${h.expression} equals ${h.result}">
        <div class="h-expr">${escapeHtml(h.expression)}</div>
        <div class="h-meta">
          <span class="h-result">${escapeHtml(h.result)}</span>
          <span class="h-time">${formatTimestamp(h.timestamp)}</span>
        </div>
        <div class="h-meta">
          <span></span>
          <button class="h-delete" data-delete-id="${h.id}" aria-label="Delete this entry">Delete</button>
        </div>
      </li>
    `).join('');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  el.historyList.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-delete-id]');
    if (delBtn) {
      deleteHistoryEntry(delBtn.dataset.deleteId);
      return;
    }
    const item = e.target.closest('.history-item[data-id]');
    if (item) {
      const entry = state.history.find((h) => h.id === item.dataset.id);
      if (entry) {
        pushUndo();
        state.expression = entry.expression;
        state.justEvaluated = false;
        clearError();
        render();
        toggleHistory(false);
      }
    }
  });

  el.historySearch.addEventListener('input', (e) => {
    state.historyFilter = e.target.value;
    renderHistory();
  });

  document.getElementById('clearHistory').addEventListener('click', clearAllHistory);

  function toggleHistory(force) {
    const open = force !== undefined ? force : !el.historyPanel.classList.contains('open');
    el.historyPanel.classList.toggle('open', open);
  }
  document.getElementById('historyToggle').addEventListener('click', () => toggleHistory());
  document.getElementById('closeHistory').addEventListener('click', () => toggleHistory(false));

  /* ---------------- 7. THEMES & SETTINGS ---------------- */

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.settings);
      if (raw) Object.assign(state.settings, JSON.parse(raw));
    } catch {
      /* use defaults */
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
    } catch {
      /* ignore */
    }
  }

  function applySettings() {
    document.documentElement.setAttribute('data-theme', state.settings.theme);
    document.documentElement.style.setProperty('--accent', state.settings.accent);
    document.documentElement.style.setProperty('--result-size', state.settings.fontSize + 'px');

    document.querySelectorAll('.theme-dot').forEach((dot) => {
      dot.classList.toggle('active', dot.dataset.theme === state.settings.theme);
    });

    el.accentPicker.value = state.settings.accent;
    el.fontSizeSlider.value = state.settings.fontSize;
    el.soundToggle.checked = state.settings.sound;
    el.hapticToggle.checked = state.settings.haptic;
  }

  document.querySelectorAll('.theme-dot').forEach((dot) => {
    dot.addEventListener('click', () => {
      state.settings.theme = dot.dataset.theme;
      saveSettings();
      applySettings();
    });
  });

  el.accentPicker.addEventListener('input', (e) => {
    state.settings.accent = e.target.value;
    document.documentElement.style.setProperty('--accent', e.target.value);
    saveSettings();
  });

  el.fontSizeSlider.addEventListener('input', (e) => {
    state.settings.fontSize = Number(e.target.value);
    document.documentElement.style.setProperty('--result-size', e.target.value + 'px');
    saveSettings();
  });

  el.soundToggle.addEventListener('change', (e) => {
    state.settings.sound = e.target.checked;
    saveSettings();
  });

  el.hapticToggle.addEventListener('change', (e) => {
    state.settings.haptic = e.target.checked;
    saveSettings();
  });

  document.getElementById('resetSettings').addEventListener('click', () => {
    state.settings = { theme: 'dark', accent: '#c98a3e', fontSize: 48, sound: false, haptic: false };
    saveSettings();
    applySettings();
  });

  function toggleSettings(force) {
    const open = force !== undefined ? force : !el.settingsOverlay.classList.contains('open');
    el.settingsOverlay.classList.toggle('open', open);
  }
  document.getElementById('settingsBtn').addEventListener('click', () => toggleSettings());
  document.getElementById('closeSettings').addEventListener('click', () => toggleSettings(false));
  el.settingsOverlay.addEventListener('click', (e) => {
    if (e.target === el.settingsOverlay) toggleSettings(false);
  });

  /* ---------------- 8. MISC UI ---------------- */

  // Fullscreen
  document.getElementById('fullscreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  // Copy result
  el.copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(String(state.result));
      el.copyBtn.textContent = 'Copied';
      el.copyBtn.classList.add('copied');
      setTimeout(() => {
        el.copyBtn.textContent = 'Copy';
        el.copyBtn.classList.remove('copied');
      }, 1200);
    } catch {
      /* clipboard blocked — fail silently */
    }
  });

  el.undoBtn.addEventListener('click', undo);
  el.redoBtn.addEventListener('click', redo);

  // Mode switch (standard / scientific)
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      state.mode = btn.dataset.mode;
      el.scientificPanel.classList.toggle('open', state.mode === 'scientific');
    });
  });

  // Ripple + press animation + main click handler for all keys
  document.querySelectorAll('.key').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      spawnRipple(btn, e);
      playSound('key');
      triggerHaptic();
      const action = btn.dataset.action;
      if (/^[0-9]$/.test(action)) {
        handleDigit(action);
      } else if (action) {
        handleAction(action);
      }
    });
  });

  function spawnRipple(btn, e) {
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = size + 'px';
    const x = (e.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2;
    const y = (e.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2;
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 520);
  }

  function triggerHaptic() {
    if (state.settings.haptic && navigator.vibrate) navigator.vibrate(12);
  }

  // Lightweight synthesized click sound (no external assets needed)
  let audioCtx = null;
  function playSound(kind) {
    if (!state.settings.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const freq = { key: 440, equals: 660, toggle: 520, error: 180 }[kind] || 440;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.05;
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);
      osc.stop(audioCtx.currentTime + 0.09);
    } catch {
      /* audio unavailable */
    }
  }

  /* ---------------- Keyboard support ---------------- */

  const KEY_MAP = {
    '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide',
    '%': 'percent', '(': 'paren-open', ')': 'paren-close',
    'Enter': 'equals', '=': 'equals',
    'Backspace': 'backspace', 'Delete': 'ce', 'Escape': 'ac',
    '.': 'decimal'
  };

  window.addEventListener('keydown', (e) => {
    // Don't hijack typing inside the history search field
    if (e.target === el.historySearch) return;

    if (/^[0-9]$/.test(e.key)) {
      handleDigit(e.key);
      flashKey(e.key);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    }
    if (KEY_MAP[e.key]) {
      e.preventDefault();
      handleAction(KEY_MAP[e.key]);
      flashKey(e.key);
    }
  });

  function flashKey(key) {
    const btn = document.querySelector(`.key[data-action="${cssEscape(key)}"]`) ||
                Array.from(document.querySelectorAll('.key')).find((b) => b.dataset.action === KEY_MAP[key]);
    if (btn) {
      btn.classList.add('pressed');
      setTimeout(() => btn.classList.remove('pressed'), 130);
    }
  }
  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s;
  }

  /* ---------------- Init ---------------- */

  function init() {
    loadSettings();
    loadHistory();
    applySettings();
    renderHistory();
    render();
    el.degRadBtn.textContent = state.isDegree ? 'DEG' : 'RAD';
  }

  init();
})();
