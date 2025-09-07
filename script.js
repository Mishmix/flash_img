/*
 * Основной скрипт для Nano‑Banana. Восстанавливает функциональность
 * исходного проекта: загрузка и отображение изображений, управление
 * вариантами, генерация новых изображений через API Gemini, перевод
 * RU→EN, режим A/B «Обработать фото» и базовая история. Добавлена
 * совместимость с модулем кроппера (cropper.js), который вставляет
 * кнопку ✂︎ и реализует обрезку активного изображения. Этот код
 * стремится быть понятным и достаточно компактным, избегая
 * асинхронных очередей из оригинального скрипта, но сохраняя
 * ключевые возможности.
 */

// Ссылки на элементы интерфейса. Все элементы берутся по id.
const els = {
  stage: document.getElementById('stage'),
  canvas: document.getElementById('canvas'),
  imgWrap: document.getElementById('imgLink'),
  imgView: document.getElementById('imgView'),
  inputGrid: document.getElementById('inputGrid'),
  dz: document.getElementById('dz'),
  fileInput: document.getElementById('fileInput'),
  openPickerBtn: document.getElementById('openPickerBtn'),
  prompt: document.getElementById('prompt'),
  translateToggle: document.getElementById('translateToggle'),
  arSelect: document.getElementById('arSelect'),
  perImageLabel: document.getElementById('perImageLabel'),
  perImageToggle: document.getElementById('perImageToggle'),
  sendBtn: document.getElementById('sendBtn'),
  varCount: document.getElementById('varCount'),
  magicBtn: document.getElementById('magicBtn'),
  processPhotoBtn: document.getElementById('processPhotoBtn'),
  openPresetsBtn: document.getElementById('openPresetsBtn'),
  closeBtn: document.getElementById('closeBtn'),
  resetBtn: document.getElementById('resetBtn'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  carouselNav: document.getElementById('carouselNav'),
  history: document.getElementById('history'),
  clearHistBtn: document.getElementById('clearHistBtn'),
  variantBadge: document.getElementById('variantBadge'),
  activeMeta: document.getElementById('activeMeta'),
  activePerPrompt: document.getElementById('activePerPrompt'),
  toast: document.getElementById('toast'),
};

// Состояние приложения. Храним список загруженных изображений, текущие
// результаты генерации и служебные флаги.
const MAX_INPUTS = 4;
let state = {
  inputs: [],       // массив объектов {id, dataURL, blob, w, h, mime, createdAt, perPrompt}
  activeId: null,  // id активного изображения
  outputs: [],     // массив результатов генерации {dataURL, mime, tag}
  currentIdx: 0,   // индекс выбранного варианта в outputs
  showResults: false, // показывать ли генерацию вместо входов
  generating: false,  // идёт ли генерация
  translateEnabled: true, // включён ли перевод RU→EN
};

// Константы для генерации. API‑ключ и модель сохранены из исходного проекта.
const API_KEY = 'AIzaSyDDDCRXfONeEiIirJEoE5BHvhCXVQTUvg8';
const MODEL_ID = 'gemini-2.5-flash-image-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent`;

// Предустановленные промты для режима «Обработать фото» (A и B). Они
// взяты из исходного проекта без изменений. Используются как строки
// JSON, поэтому мы сериализуем объекты в момент передачи в API.
const PRESET_PROMPT_1 = {
  "subject": {"type":"portrait","constraints":{"pose":"do_not_change","framing":"do_not_change","proportions":"do_not_change","expression":"do_not_change","body_position":"do_not_change","angle":"do_not_change","perspective":"do_not_change"}},
  "environment": {"integration_mode":"overlay_around_original","description":"Surround the existing portrait with a studio-like environment without moving or reposing the subject.","background":{"style":"seamless","color":"neutral_gray","gradient":"smooth"},"lighting_equipment":{"required":true,"visible":true,"types":["softbox","reflector"],"placement":["front","slightly_left","slightly_right"],"integration":"add_to_current_scene"}},
  "lighting": {"mode":"studio_soft_frontal","uniformity":"even","shadows":"none_under_eyes","white_balance":"daylight_D65","direction":"frontal","color_casts":"remove_all","integration":"override_original_light"},
  "skin": {"tone":{"normalized":true,"evened_out":true,"matched_to_environment":true,"natural":true,"realistic":true},"imperfections":"no_blotches_no_residual_casts"},
  "restrictions": {"identity":"preserve","pose":"preserve_exactly","framing":"preserve_exactly","expression":"preserve_exactly"},
  "output": {"style":"professional_studio_effect_applied_to_original","focus":"subject_face","changes":["lighting","skin_tone","environment_only"]}
};
const PRESET_PROMPT_2 = {
  "subject": {"type":"portrait","constraints":{"pose":"do_not_change","framing":"do_not_change","proportions":"do_not_change","expression":"do_not_change","body_position":"do_not_change","angle":"do_not_change","perspective":"do_not_change"}},
  "environment": {"integration_mode":"overlay_around_original","description":"Surround the existing portrait with a studio-like environment without moving or reposing the subject.","background":{"style":"seamless","color":"neutral_gray","gradient":"smooth"},"lighting_equipment":{"required":true,"visible":true,"types":["softbox","reflector"],"placement":["front","slightly_left","slightly_right"],"integration":"add_to_current_scene"}},
  "lighting": {"mode":"studio_soft_frontal","uniformity":"even","shadows":"none_under_eyes","white_balance":"daylight_D65","direction":"frontal","color_casts":"remove_all","integration":"override_original_light"},
  "skin": {"tone":{"normalized":true,"evened_out":true,"matched_to_environment":true,"natural":true,"realistic":true},"imperfections":"no_blotches_no_residual_casts"},
  "colorization": {"enabled":true,"mode":"restore_from_grayscale","result":"accurate_lifelike_colors","skin":"ideal_natural_tone","eyes":"clear_natural","teeth":"slightly_brightened"},
  "restrictions": {"identity":"preserve","pose":"preserve_exactly","framing":"preserve_exactly","expression":"preserve_exactly"},
  "output": {"style":"professional_studio_effect_applied_to_original","focus":"subject_face","changes":["lighting","skin_tone","environment_only","colorization"]}
};

// --- Утилиты ---

// Получение DPR для корректной отрисовки на canvas
function DPR() { return window.devicePixelRatio || 1; }

// Преобразование Blob → dataURL
function blobToDataURL(blob) {
  return new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });
}

// Отображение всплывающего уведомления внизу экрана
function showToast(message = 'Готово', ms = 2000) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), ms);
}

// Пересчитать размеры canvas и контейнера для результатов. Основано
// на размере окна и соотношении сторон первого изображения (если
// есть) либо выбранном соотношении через селектор.
function calcViewportSize() {
  const mainRect = document.querySelector('main').getBoundingClientRect();
  const winArea = window.innerWidth * window.innerHeight;
  const targetArea = winArea * 0.70;
  const availW = mainRect.width;
  const availH = mainRect.height - 8;
  // Вычисляем аспект для холста: если есть входные изображения,
  // берём среднее отношение; иначе берём выбранный AR из селектора
  let ar = 1;
  if (state.inputs.length === 1) {
    const i = state.inputs[0];
    ar = i.w / i.h;
  } else if (state.inputs.length > 1) {
    const sum = state.inputs.reduce((a, b) => a + (b.w / b.h), 0);
    ar = sum / state.inputs.length;
  } else {
    // Без входов: читаем из arSelect
    const arStr = els.arSelect ? els.arSelect.value || '1:1' : '1:1';
    const [aw, ah] = arStr.split(':').map(x => Math.max(parseFloat(x) || 1, 1e-6));
    ar = aw / ah;
  }
  let w = Math.sqrt(targetArea * ar);
  let h = w / ar;
  if (w > availW) { w = availW; h = w / ar; }
  if (h > availH) { h = availH; w = h * ar; }
  w = Math.max(160, Math.floor(w));
  h = Math.max(160, Math.floor(h));
  const dpr = DPR();
  els.canvas.style.width = w + 'px';
  els.canvas.style.height = h + 'px';
  els.canvas.width = Math.floor(w * dpr);
  els.canvas.height = Math.floor(h * dpr);
  els.imgWrap.style.width = w + 'px';
  els.imgWrap.style.height = h + 'px';
}

// Очистить холст
function clearCanvas() {
  const ctx = els.canvas.getContext('2d');
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
}

// Нарисовать bitmap на холсте, вписывая его по центру
function drawBitmap(bmp) {
  const ctx = els.canvas.getContext('2d');
  const dpr = DPR();
  const cssW = parseInt(els.canvas.style.width) || els.canvas.width / dpr;
  const cssH = parseInt(els.canvas.style.height) || els.canvas.height / dpr;
  els.canvas.width = Math.floor(cssW * dpr);
  els.canvas.height = Math.floor(cssH * dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  const scale = Math.min(els.canvas.width / bmp.width, els.canvas.height / bmp.height);
  const dw = Math.max(1, Math.floor(bmp.width * scale));
  const dh = Math.max(1, Math.floor(bmp.height * scale));
  const dx = Math.floor((els.canvas.width - dw) / 2);
  const dy = Math.floor((els.canvas.height - dh) / 2);
  ctx.drawImage(bmp, dx, dy, dw, dh);
}

// Установить изображение результата в ссылку и элемент img. Когда
// передаётся пустая строка, ссылки очищаются.
function setResultImg(dataURL) {
  els.imgView.src = dataURL || '';
  if (dataURL) {
    els.imgWrap.href = dataURL;
    els.imgWrap.download = state.outputs.length ? `variant-${state.currentIdx + 1}.png` : 'source.png';
  } else {
    els.imgWrap.href = '#';
  }
}

// Перерисовать текущий экран: либо показываем входные
// миниатюры, либо выбранный вариант генерации.
async function redrawCurrent() {
  const showResult = state.showResults && state.outputs.length > 0;
  els.inputGrid.classList.toggle('show', !showResult && state.inputs.length > 0);
  // Если показываем входные, очищаем холст
  if (!showResult) {
    setResultImg('');
    clearCanvas();
    renderInputGrid();
    updateVariantBadge();
    toggleCarousel();
    updateDropzoneVisibility();
    return;
  }
  const out = state.outputs[state.currentIdx];
  const url = out?.dataURL;
  setResultImg(url);
  if (!url) return;
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  drawBitmap(bmp);
  updateVariantBadge();
  toggleCarousel();
  updateDropzoneVisibility();
}

// Обновить бейдж с номером варианта (и тегом A/B)
function updateVariantBadge() {
  const show = (state.outputs.length > 1 && state.showResults);
  els.variantBadge.classList.toggle('hidden', !show);
  if (show) {
    const out = state.outputs[state.currentIdx];
    const tag = out?.tag;
    els.variantBadge.textContent = tag ? `${tag} · ${state.currentIdx + 1}/${state.outputs.length}` : `Вариант ${state.currentIdx + 1} / ${state.outputs.length}`;
  }
}

// Показать/скрыть навигацию по вариантам
function toggleCarousel() {
  const show = (state.outputs.length > 1 && state.showResults);
  els.carouselNav.classList.toggle('active', show);
}

// Отрисовать сетку загруженных изображений
function renderInputGrid() {
  const grid = els.inputGrid;
  grid.innerHTML = '';
  const n = state.inputs.length;
  grid.className = 'input-grid';
  if (n > 0) grid.classList.add('show');
  grid.classList.add(`grid-${Math.min(Math.max(n, 1), 4)}`);
  state.inputs.forEach((it, idx) => {
    const tile = document.createElement('div');
    tile.className = `tile i${idx} grid-${n}` + (state.activeId === it.id ? ' active' : '');
    const img = document.createElement('img');
    img.src = it.dataURL;
    img.alt = `Изображение ${idx + 1}`;
    tile.appendChild(img);
    // кнопка удаления
    const btn = document.createElement('button');
    btn.className = 'close';
    btn.title = 'Удалить';
    btn.textContent = '×';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeInput(it.id);
    });
    tile.addEventListener('click', () => setActive(it.id));
    tile.appendChild(btn);
    grid.appendChild(tile);
  });
  updateActiveDetails();
  updatePerImageVisibility();
}

// Обновить отображение деталей активного изображения и поля пер‑промта
function updateActiveDetails() {
  const it = state.inputs.find(x => x.id === state.activeId);
  if (it) {
    els.activeMeta.textContent = `Активное: ${it.w}×${it.h}, ${it.mime || 'image'}, загружено ${new Date(it.createdAt).toLocaleString()}`;
    // Персональный промт
    if (els.perImageToggle.checked && state.inputs.length > 1) {
      els.activePerPrompt.classList.remove('hidden');
      els.activePerPrompt.value = it.perPrompt || '';
    } else {
      els.activePerPrompt.classList.add('hidden');
    }
  } else {
    els.activeMeta.textContent = 'Нет активного изображения';
    els.activePerPrompt.classList.add('hidden');
  }
}

// Обновить видимость переключателя «персональные промты»
function updatePerImageVisibility() {
  const show = state.inputs.length > 1;
  els.perImageLabel.classList.toggle('hidden', !show);
  if (!show) {
    els.perImageToggle.checked = false;
    els.activePerPrompt.classList.add('hidden');
  }
}

// Установить активное изображение по id
function setActive(id) {
  state.activeId = id;
  renderInputGrid();
}

// Удалить изображение из inputs
function removeInput(id) {
  const idx = state.inputs.findIndex(x => x.id === id);
  if (idx >= 0) state.inputs.splice(idx, 1);
  if (state.activeId === id) state.activeId = state.inputs[0]?.id || null;
  if (state.inputs.length === 0) els.dz.classList.remove('hide');
  renderInputGrid();
  redrawCurrent();
  updateDropzoneVisibility();
}

// Добавить файл в inputs
async function addInputFile(file) {
  const blob = file instanceof Blob ? file : new Blob([file], { type: file.type || 'image/png' });
  const dataURL = await blobToDataURL(blob);
  // Проверить дубликаты по DataURL
  if (state.inputs.some(x => x.dataURL === dataURL)) return;
  const bmp = await createImageBitmap(blob);
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  state.inputs.push({ id, dataURL, blob, w: bmp.width, h: bmp.height, mime: blob.type, createdAt: Date.now(), perPrompt: '' });
  setActive(id);
  calcViewportSize();
  redrawCurrent();
}

// Загрузчики файлов (DND, picker, paste)
function setupLoaders() {
  async function handleFiles(files) {
    const imgs = [...files].filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;
    const space = MAX_INPUTS - state.inputs.length;
    if (space <= 0) {
      showToast('Можно загрузить до 4 изображений');
      return;
    }
    for (const f of imgs.slice(0, space)) {
      await addInputFile(f);
    }
    if (state.inputs.length > 0) els.dz.classList.add('hide');
    renderInputGrid();
    updateDropzoneVisibility();
  }
  // Открытие файлового диалога
  els.dz.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', e => {
    handleFiles(e.target.files || []);
    e.target.value = '';
  });
  // Drag&Drop
  els.stage.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
  els.stage.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  });
  // Paste
  window.addEventListener('paste', async e => {
    const items = [...(e.clipboardData?.items || [])].filter(i => i.type.startsWith('image/'));
    if (items.length) {
      const files = await Promise.all(items.map(i => i.getAsFile()));
      handleFiles(files);
    }
  });
}

// Обновление видимости Dropzone в зависимости от состояния
function updateDropzoneVisibility() {
  const noInputs = state.inputs.length === 0;
  const noResults = state.outputs.length === 0;
  const show = noInputs && noResults && !state.generating;
  els.dz.classList.toggle('hide', !show);
}

// Очистить всё: входы, выходы, холст
function clearScene() {
  state.inputs = [];
  state.activeId = null;
  state.outputs = [];
  state.currentIdx = 0;
  state.showResults = false;
  clearCanvas();
  setResultImg('');
  els.dz.classList.remove('hide');
  renderInputGrid();
  updateDropzoneVisibility();
  updateVariantBadge();
}

// Навигация по результатам
function setupNav() {
  els.prevBtn.addEventListener('click', () => setIndex(state.currentIdx - 1));
  els.nextBtn.addEventListener('click', () => setIndex(state.currentIdx + 1));
  // клавиатура
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' && state.outputs.length > 1 && state.showResults) setIndex(state.currentIdx - 1);
    else if (e.key === 'ArrowRight' && state.outputs.length > 1 && state.showResults) setIndex(state.currentIdx + 1);
    else if (e.key === 'Escape') clearScene();
    else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') onSend();
  });
}

function setIndex(i) {
  if (!state.outputs.length) return;
  state.currentIdx = ((i % state.outputs.length) + state.outputs.length) % state.outputs.length;
  redrawCurrent();
}

// --- Перевод RU→EN ---

// Инициализация переключателя перевода. Состояние хранится в
// localStorage под ключом TR_TOGGLE_KEY.
const TR_TOGGLE_KEY = 'nb_translate_enabled_v1';
function initTranslateToggle() {
  try {
    const raw = localStorage.getItem(TR_TOGGLE_KEY);
    state.translateEnabled = raw == null ? true : (raw === '1');
  } catch {
    state.translateEnabled = true;
  }
  els.translateToggle.checked = !!state.translateEnabled;
  els.translateToggle.addEventListener('change', () => {
    state.translateEnabled = !!els.translateToggle.checked;
    try {
      localStorage.setItem(TR_TOGGLE_KEY, state.translateEnabled ? '1' : '0');
    } catch {}
    els.prompt.placeholder = state.translateEnabled ? 'Промт (RU/EN). Переведём на английский автоматически…' : 'Промт (RU/EN). Без авто‑перевода.';
  });
  els.prompt.placeholder = state.translateEnabled ? 'Промт (RU/EN). Переведём на английский автоматически…' : 'Промт (RU/EN). Без авто‑перевода.';
}

// Разбивка длинного текста на части для перевода
function splitSmart(text, max = 450) {
  const t = text.toString();
  if (t.length <= max) return [t];
  const res = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(i + max, t.length);
    const slice = t.slice(i, end);
    let cut = -1;
    const prefer = /[\n\.\!\?;:,]/g;
    let m;
    while ((m = prefer.exec(slice)) !== null) {
      cut = m.index;
    }
    if (cut < 0) {
      const w = slice.lastIndexOf(' ');
      if (w > 0) cut = w;
    }
    if (cut < 0) {
      res.push(slice);
      i = end;
    } else {
      res.push(slice.slice(0, cut + 1));
      i += cut + 1;
    }
  }
  return res;
}

// Перевод одной части текста через MyMemory API
async function translateChunkMyMemory(ch) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(ch)}&langpair=ru|en`;
  const r = await fetch(url, { method: 'GET' });
  if (!r.ok) throw new Error('translate http ' + r.status);
  const j = await r.json();
  const s = (j?.responseData?.translatedText || '').toString();
  if (!s) throw new Error('translate empty');
  return s;
}

// Перевод полного текста RU→EN с разбивкой
async function translateRuToEn(text) {
  const src = (text || '').toString();
  if (!src.trim()) return '';
  const chunks = splitSmart(src, 450);
  const out = [];
  for (const ch of chunks) {
    try {
      out.push(await translateChunkMyMemory(ch));
    } catch {
      out.push('[ru] ' + ch);
    }
  }
  return out.join('');
}

// Перевести список строк (персональные промты) RU→EN
async function translateListRuToEn(list) {
  const results = [];
  for (const s of list) {
    results.push(await translateRuToEn(s || ''));
  }
  return results;
}

// --- Вызов Gemini API ---

// Извлечь изображения из ответа API Gemini
function extractImages(json) {
  const out = [];
  for (const c of (json?.candidates || [])) {
    const parts = c?.content?.parts || [];
    for (const p of parts) {
      const inline = p.inlineData || p.inline_data;
      if (inline?.data) {
        const mime = inline.mimeType || inline.mime_type || 'image/png';
        out.push({ dataURL: `data:${mime};base64,${inline.data}`, mime });
      }
    }
  }
  return out;
}

// Отправка единственного запроса к Gemini с общим промтом и набором входных изображений
async function callGeminiSingle({ globalPromptEN, perImage = false, perPromptsEN = [] }) {
  const parts = [];
  const gp = (globalPromptEN || '').trim();
  if (gp) parts.push({ text: gp });
  // Персональные промты + изображения
  if (perImage && state.inputs.length) {
    state.inputs.forEach((it, idx) => {
      const pEN = (perPromptsEN[idx] || '').trim();
      if (pEN) parts.push({ text: `Image ${idx + 1}: ${pEN}` });
      parts.push({ inline_data: { mime_type: it.mime || 'image/png', data: (it.dataURL.split(',')[1] || '') } });
    });
  } else if (state.inputs.length) {
    state.inputs.forEach(it => {
      parts.push({ inline_data: { mime_type: it.mime || 'image/png', data: (it.dataURL.split(',')[1] || '') } });
    });
  } else {
    if (!gp) throw new Error('EMPTY_REQUEST');
  }
  const safety = [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT',
  ].map(c => ({ category: c, threshold: 'BLOCK_NONE' }));
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'], seed: Math.floor(Math.random() * 2 ** 31) },
    safetySettings: safety,
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Gemini HTTP ' + res.status);
  const j = await res.json();
  const outs = extractImages(j);
  return outs;
}

// Вызов Gemini для одного изображения с текстовым промтом (используется в A/B режиме)
async function callGeminiWithPromptAndDataURL({ promptText, dataURL }) {
  const parts = [];
  if (promptText && String(promptText).trim()) parts.push({ text: String(promptText) });
  parts.push({ inline_data: { mime_type: 'image/png', data: (dataURL.split(',')[1] || '') } });
  const safety = [
    'HARM_CATEGORY_HARASSMENT',
    'HARM_CATEGORY_HATE_SPEECH',
    'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    'HARM_CATEGORY_DANGEROUS_CONTENT',
  ].map(c => ({ category: c, threshold: 'BLOCK_NONE' }));
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'], seed: Math.floor(Math.random() * 2 ** 31) },
    safetySettings: safety,
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Gemini HTTP ' + res.status);
  const j = await res.json();
  const outs = extractImages(j);
  return outs;
}

// --- Генерация ---

// Обработка клика по кнопке «Отправить». Переводит промт при
// необходимости, затем вызывает Gemini для генерации нужного
// количества вариантов. Сохраняет результаты в state.outputs.
async function onSend() {
  if (state.generating) return;
  const promptRU = (els.prompt.value || '').trim();
  const total = Math.min(Math.max(parseInt(els.varCount.value) || 1, 1), 10);
  if (!promptRU && state.inputs.length === 0) {
    showToast('Добавь промт или загрузки');
    return;
  }
  let promptEN = promptRU;
  let perPromptsEN = [];
  // Персональные промты на RU
  const perPromptsRU = state.inputs.map(x => x.perPrompt || '');
  if (state.translateEnabled) {
    if (promptEN) {
      try {
        promptEN = await translateRuToEn(promptRU);
        showToast(`EN: ${promptEN}`, 2000);
      } catch (e) {
        console.warn('translate error', e);
        promptEN = promptRU;
      }
    }
    if (els.perImageToggle.checked && state.inputs.length) {
      try {
        perPromptsEN = await translateListRuToEn(perPromptsRU);
      } catch (e) {
        console.warn('translate list error', e);
        perPromptsEN = perPromptsRU;
      }
    }
  } else {
    // Без перевода: если нет входных изображений, добавляем текст про AR
    if (state.inputs.length === 0) {
      const arText = els.arSelect.value || '1:1';
      if (promptEN) promptEN += `\nThe image should be in a ${arText} aspect ratio.`;
    }
  }
  // Подготовка генерации
  state.generating = true;
  state.outputs = [];
  state.currentIdx = 0;
  state.showResults = false;
  updateDropzoneVisibility();
  showToast('Генерируем…', 800);
  // Генерация последовательно total раз
  for (let i = 0; i < total; i++) {
    try {
      const outs = await callGeminiSingle({ globalPromptEN: promptEN, perImage: els.perImageToggle.checked, perPromptsEN });
      if (outs && outs.length) {
        for (const img of outs) {
          state.outputs.push(img);
        }
      }
    } catch (e) {
      console.warn('gen error', e);
    }
  }
  state.generating = false;
  if (state.outputs.length) {
    state.showResults = true;
    showToast('Готово', 1200);
  } else {
    showToast('Модель не вернула изображения. Уточни промт или добавь картинку.', 3000);
  }
  redrawCurrent();
}

// --- A/B обработка фото ---

// Преобразовать изображение в градации серого (используется в варианте B)
async function toGrayscaleDataURL(srcDataURL) {
  const blob = await (await fetch(srcDataURL)).blob();
  const bmp = await createImageBitmap(blob);
  const W = bmp.width, H = bmp.height;
  const off = ('OffscreenCanvas' in window) ? new OffscreenCanvas(W, H) : document.createElement('canvas');
  if (!('width' in off)) { off.width = W; off.height = H; }
  const ctx = off.getContext('2d');
  ctx.drawImage(bmp, 0, 0, W, H);
  const imgData = ctx.getImageData(0, 0, W, H);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(imgData, 0, 0);
  const outBlob = off.convertToBlob ? await off.convertToBlob({ type: 'image/png', quality: 0.96 }) : await new Promise(r => off.toBlob(r, 'image/png', 0.96));
  return await blobToDataURL(outBlob);
}

// Обработать фото кнопкой «Обработать фото» (режим A/B)
async function onProcessPhoto() {
  if (state.generating) return;
  if (state.inputs.length === 0) {
    showToast('Добавь фото для обработки', 2200);
    return;
  }
  const base = state.inputs[0];
  const baseDataURL = base.dataURL;
  let bwDataURL;
  try {
    bwDataURL = await toGrayscaleDataURL(baseDataURL);
  } catch (e) {
    console.warn('bw error', e);
    bwDataURL = baseDataURL;
  }
  const n = Math.min(Math.max(parseInt(els.varCount.value) || 1, 1), 10);
  state.generating = true;
  state.outputs = [];
  state.currentIdx = 0;
  state.showResults = false;
  updateDropzoneVisibility();
  showToast('Генерируем A/B…', 800);
  for (let i = 0; i < n; i++) {
    // A: исходник + PRESET_PROMPT_1
    try {
      const outsA = await callGeminiWithPromptAndDataURL({ promptText: JSON.stringify(PRESET_PROMPT_1), dataURL: baseDataURL });
      outsA.forEach(img => {
        state.outputs.push({ ...img, tag: `A${i + 1}` });
      });
    } catch (e) {
      console.warn('process A error', e);
    }
    // B: ч/б + PRESET_PROMPT_2
    try {
      const outsB = await callGeminiWithPromptAndDataURL({ promptText: JSON.stringify(PRESET_PROMPT_2), dataURL: bwDataURL });
      outsB.forEach(img => {
        state.outputs.push({ ...img, tag: `B${i + 1}` });
      });
    } catch (e) {
      console.warn('process B error', e);
    }
  }
  state.generating = false;
  if (state.outputs.length) {
    state.showResults = true;
    showToast('Готово', 1200);
  } else {
    showToast('Не удалось получить изображения. Проверь входное фото или попробуй ещё раз.', 3000);
  }
  redrawCurrent();
}

// --- Настройка событий и инициализация ---

function setupUI() {
  calcViewportSize();
  setupLoaders();
  renderInputGrid();
  updateDropzoneVisibility();
  initTranslateToggle();
  setupNav();
  // Обработчики
  els.sendBtn.addEventListener('click', onSend);
  els.closeBtn.addEventListener('click', clearScene);
  els.resetBtn.addEventListener('click', clearScene);
  els.processPhotoBtn.addEventListener('click', onProcessPhoto);
  els.perImageToggle.addEventListener('change', updateActiveDetails);
  els.activePerPrompt?.addEventListener('input', e => {
    if (!state.activeId) return;
    const it = state.inputs.find(x => x.id === state.activeId);
    if (it) {
      it.perPrompt = e.target.value;
    }
  });
  // Пересчёт размеров при изменении окна
  window.addEventListener('resize', () => {
    calcViewportSize();
    redrawCurrent();
  });
}

// Запуск
setupUI();