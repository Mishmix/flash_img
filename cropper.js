/*
 * cropper.js
 *
 * This module injects a cropping tool into the existing nano‑banana UI.
 * When the user has an active uploaded image, a new ✂︎ button appears in the
 * top‑left corner of the stage. Clicking the button opens a modal with a
 * canvas and adjustable selection rectangle. Users can drag the selection
 * area or its handles to choose the crop region, zoom in/out with the mouse
 * wheel, and choose to lock aspect ratio. Upon applying, the selected
 * portion replaces the current active input image in `state.inputs`, and
 * the UI updates accordingly. Cancelling closes the modal without changes.
 */

(() => {
  // Helper to wait until the global UI is ready (state and els defined)
  const waitForGlobals = () => new Promise(resolve => {
    const tick = () => {
      // Wait until script.js has defined state and els and we have an active grid
      if (typeof state !== 'undefined' && typeof els !== 'undefined') {
        resolve();
      } else {
        setTimeout(tick, 60);
      }
    };
    tick();
  });

  // Shortcuts for device pixel ratio and clamping
  const DPR = () => window.devicePixelRatio || 1;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Internal cropping state
  const C = {
    img: null,        // ImageBitmap of the active input
    imgW: 0,
    imgH: 0,
    viewScale: 1,
    viewDx: 0,
    viewDy: 0,
    sel: { x: 0, y: 0, w: 0, h: 0 },
    dragging: false,
    dragKind: 'move',
    start: { x: 0, y: 0, sel: null },
    lockAR: false,
    ar: 'free',
  };

  // Utility to get cropping modal elements
  function getCropEls() {
    return {
      modal: document.getElementById('cropModal'),
      canvas: document.getElementById('cropCanvas'),
      overlay: document.getElementById('cropOverlay'),
      btnApply: document.getElementById('cropApply'),
      btnCancel: document.getElementById('cropCancel'),
      lockAR: document.getElementById('cropLockAR'),
      arSel: document.getElementById('cropAR'),
      handles: [...document.querySelectorAll('#cropModal .cr-h')],
    };
  }

  // Create or reuse the crop button in the top‑left panel
  function ensureCropButton() {
    const host = document.querySelector('.top-left');
    if (!host) return;
    if (document.getElementById('cropOpenBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'cropOpenBtn';
    btn.textContent = '✂︎ Кадрировать';
    btn.title = 'Обрезать активное изображение';
    btn.addEventListener('click', openCropForActive);
    host.appendChild(btn);
    updateCropButtonState();
  }

  // Enable/disable crop button based on whether an active input is selected
  function updateCropButtonState() {
    const btn = document.getElementById('cropOpenBtn');
    if (!btn) return;
    const hasActive = !!state.activeId && state.inputs.some(x => x.id === state.activeId);
    btn.disabled = !hasActive || state.generating;
  }

  // Fit cropping canvas to its container
  function fitCropCanvas(cv) {
    const box = cv.parentElement.getBoundingClientRect();
    const dpr = DPR();
    cv.style.width = box.width + 'px';
    cv.style.height = box.height + 'px';
    cv.width = Math.max(2, Math.floor(box.width * dpr));
    cv.height = Math.max(2, Math.floor(box.height * dpr));
  }

  // Layout the image to fit the canvas and compute view scale and offsets
  function layoutImage(cv) {
    if (!C.img) return;
    const vw = cv.width;
    const vh = cv.height;
    const scale = Math.min(vw / C.imgW, vh / C.imgH);
    C.viewScale = scale;
    C.viewDx = Math.floor((vw - C.imgW * scale) / 2);
    C.viewDy = Math.floor((vh - C.imgH * scale) / 2);
  }

  // Draw the image onto the cropping canvas
  function drawScene(cv) {
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (!C.img) return;
    const dw = Math.floor(C.imgW * C.viewScale);
    const dh = Math.floor(C.imgH * C.viewScale);
    ctx.drawImage(C.img, C.viewDx, C.viewDy, dw, dh);
  }

  // Update overlay position and handle positions
  function paintOverlay() {
    const { overlay } = getCropEls();
    const toCSS = px => `${px / DPR()}px`;
    const { x, y, w, h } = C.sel;
    overlay.style.left = toCSS(x);
    overlay.style.top = toCSS(y);
    overlay.style.width = toCSS(w);
    overlay.style.height = toCSS(h);
    const parentStyle = overlay.parentElement.style;
    parentStyle.setProperty('--x', toCSS(x));
    parentStyle.setProperty('--y', toCSS(y));
    parentStyle.setProperty('--x2', toCSS(x + w));
    parentStyle.setProperty('--y2', toCSS(y + h));
    parentStyle.setProperty('--xMid', toCSS(x + w / 2));
    parentStyle.setProperty('--yMid', toCSS(y + h / 2));
  }

  // Convert mouse event to canvas coordinates (device pixels)
  function canvasCoords(cv, e) {
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * DPR();
    const y = (e.clientY - r.top) * DPR();
    return { x, y };
  }

  // Rectangle of view area where image is drawn (in canvas px)
  function viewRect() {
    return {
      x: C.viewDx,
      y: C.viewDy,
      w: Math.floor(C.imgW * C.viewScale),
      h: Math.floor(C.imgH * C.viewScale),
    };
  }

  // Ensure selection stays within image bounds
  function clampSelection() {
    const vr = viewRect();
    C.sel.x = clamp(C.sel.x, vr.x, vr.x + vr.w - 2);
    C.sel.y = clamp(C.sel.y, vr.y, vr.y + vr.h - 2);
    C.sel.w = clamp(C.sel.w, 2, vr.w - (C.sel.x - vr.x));
    C.sel.h = clamp(C.sel.h, 2, vr.h - (C.sel.y - vr.y));
  }

  // Convert selection rectangle from canvas px to source image px
  function selectionToSourceRect() {
    const sx = (C.sel.x - C.viewDx) / C.viewScale;
    const sy = (C.sel.y - C.viewDy) / C.viewScale;
    const sw = C.sel.w / C.viewScale;
    const sh = C.sel.h / C.viewScale;
    const x = Math.max(0, Math.floor(sx));
    const y = Math.max(0, Math.floor(sy));
    const w = Math.max(1, Math.min(C.imgW - x, Math.floor(sw)));
    const h = Math.max(1, Math.min(C.imgH - y, Math.floor(sh)));
    return { x, y, w, h };
  }

  // Initialize selection rectangle with 70% of image area
  function initSelection() {
    const vr = viewRect();
    const w = Math.floor(vr.w * 0.7);
    const h = Math.floor(vr.h * 0.7);
    C.sel.w = w;
    C.sel.h = h;
    C.sel.x = Math.floor(vr.x + (vr.w - w) / 2);
    C.sel.y = Math.floor(vr.y + (vr.h - h) / 2);
    applyAspectIfLocked();
    clampSelection();
  }

  // Parse aspect ratio string (e.g. "4:5")
  function parseAR(str) {
    if (!str || str === 'free') return null;
    const [a, b] = str.split(':').map(v => Math.max(parseFloat(v) || 1, 1));
    return a / b;
  }

  // Apply aspect ratio if locked
  function applyAspectIfLocked(kind) {
    if (!C.lockAR) return;
    const targetAR = parseAR(C.ar) || (C.sel.w / C.sel.h);
    if (!Number.isFinite(targetAR)) return;
    const cx = C.sel.x + C.sel.w / 2;
    const cy = C.sel.y + C.sel.h / 2;
    let w = C.sel.w;
    let h = Math.round(w / targetAR);
    if (h > C.sel.h && kind && /n|s/.test(kind)) {
      h = C.sel.h;
      w = Math.round(h * targetAR);
    } else if (h > viewRect().h) {
      h = viewRect().h;
      w = Math.round(h * targetAR);
    }
    C.sel.w = w;
    C.sel.h = h;
    C.sel.x = Math.round(cx - w / 2);
    C.sel.y = Math.round(cy - h / 2);
  }

  // Bind mouse interactions for moving/resizing the selection
  function bindInteractions() {
    const { canvas, overlay, handles } = getCropEls();
    // Generic handler for mousedown / touchstart
    const startDrag = kind => e => {
      e.preventDefault();
      C.dragKind = kind || 'move';
      C.dragging = true;
      const p = canvasCoords(canvas, e.touches?.[0] || e);
      C.start.x = p.x;
      C.start.y = p.y;
      C.start.sel = { ...C.sel };
    };
    // Handler for mousemove / touchmove
    const onMove = e => {
      if (!C.dragging) return;
      const p = canvasCoords(canvas, e.touches?.[0] || e);
      const dx = p.x - C.start.x;
      const dy = p.y - C.start.y;
      const { x, y, w, h } = C.start.sel;
      const k = C.dragKind;
      if (k === 'move') {
        C.sel.x = x + dx;
        C.sel.y = y + dy;
      } else {
        let nx = x;
        let ny = y;
        let nw = w;
        let nh = h;
        if (k.includes('e')) nw = clamp(w + dx, 2, viewRect().w);
        if (k.includes('s')) nh = clamp(h + dy, 2, viewRect().h);
        if (k.includes('w')) { nx = x + dx; nw = clamp(w - dx, 2, viewRect().w); }
        if (k.includes('n')) { ny = y + dy; nh = clamp(h - dy, 2, viewRect().h); }
        C.sel.x = nx;
        C.sel.y = ny;
        C.sel.w = nw;
        C.sel.h = nh;
        if (C.lockAR) applyAspectIfLocked(k);
      }
      clampSelection();
      paintOverlay();
    };
    const endDrag = () => { C.dragging = false; };
    overlay.addEventListener('mousedown', startDrag('move'));
    overlay.addEventListener('touchstart', startDrag('move'), { passive: false });
    handles.forEach(h => {
      const dir = h.getAttribute('data-dir');
      h.addEventListener('mousedown', startDrag(dir));
      h.addEventListener('touchstart', startDrag(dir), { passive: false });
    });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchend', endDrag);
  }

  // Bind mouse wheel for zooming
  function bindZoom() {
    const { canvas } = getCropEls();
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const prev = C.viewScale;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const next = clamp(prev * delta, 0.1, 5);
      const p = canvasCoords(canvas, e);
      const imgX = (p.x - C.viewDx) / prev;
      const imgY = (p.y - C.viewDy) / prev;
      C.viewScale = next;
      const dw = Math.floor(C.imgW * next);
      const dh = Math.floor(C.imgH * next);
      C.viewDx = Math.floor(p.x - imgX * next);
      C.viewDy = Math.floor(p.y - imgY * next);
      const cvw = canvas.width;
      const cvh = canvas.height;
      C.viewDx = clamp(C.viewDx, cvw - dw, 0);
      C.viewDy = clamp(C.viewDy, cvh - dh, 0);
      drawScene(canvas);
      clampSelection();
      paintOverlay();
    }, { passive: false });
  }

  // Open the cropping modal for the current active image
  async function openCropForActive() {
    // Find the active input or fallback to the first input
    const item = state.inputs.find(x => x.id === state.activeId) || state.inputs[0];
    if (!item) {
      if (typeof toast === 'function') toast('Нет активного изображения');
      return;
    }
    const { modal, canvas, btnApply, btnCancel, lockAR, arSel } = getCropEls();
    // Load the image into an ImageBitmap
    const blob = item.blob || await (await fetch(item.dataURL)).blob();
    C.img = await createImageBitmap(blob);
    C.imgW = C.img.width;
    C.imgH = C.img.height;
    C.lockAR = !!lockAR.checked;
    C.ar = arSel.value || 'free';
    // Show modal
    modal.style.display = 'grid';
    // Fit canvas and draw image
    fitCropCanvas(canvas);
    layoutImage(canvas);
    drawScene(canvas);
    initSelection();
    paintOverlay();
    // Sync AR controls
    function onARChange() {
      C.ar = arSel.value || 'free';
      C.lockAR = lockAR.checked;
      applyAspectIfLocked();
      clampSelection();
      paintOverlay();
    }
    arSel.addEventListener('change', onARChange);
    lockAR.addEventListener('change', onARChange);
    // Keyboard shortcuts
    function onKey(e) {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    }
    document.addEventListener('keydown', onKey);
    // Cancel/apply buttons
    btnCancel.onclick = () => close(false);
    btnApply.onclick = () => close(true);
    async function close(apply) {
      // Clean up listeners
      document.removeEventListener('keydown', onKey);
      arSel.removeEventListener('change', onARChange);
      lockAR.removeEventListener('change', onARChange);
      modal.style.display = 'none';
      if (!apply) return;
      // Crop the selected region
      const src = selectionToSourceRect();
      const off = ('OffscreenCanvas' in window)
        ? new OffscreenCanvas(src.w, src.h)
        : Object.assign(document.createElement('canvas'), { width: src.w, height: src.h });
      if (!('width' in off)) {
        off.width = src.w;
        off.height = src.h;
      }
      const ctx = off.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(C.img, src.x, src.y, src.w, src.h, 0, 0, src.w, src.h);
      const outBlob = off.convertToBlob
        ? await off.convertToBlob({ type: 'image/png', quality: .98 })
        : await new Promise(res => off.toBlob(res, 'image/png', .98));
      // Convert back to data URL
      const outDataURL = await (async () => {
        if (window.blobToDataURL) return window.blobToDataURL(outBlob);
        return new Promise(res => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.readAsDataURL(outBlob);
        });
      })();
      const bmp = await createImageBitmap(outBlob);
      // Update the item in state.inputs
      Object.assign(item, {
        dataURL: outDataURL,
        blob: outBlob,
        w: bmp.width,
        h: bmp.height,
        mime: outBlob.type || 'image/png',
        createdAt: Date.now(),
      });
      // Propagate updates to UI
      if (typeof renderInputGrid === 'function') renderInputGrid();
      if (typeof setActive === 'function') setActive(item.id);
      if (typeof calcViewportSize === 'function') calcViewportSize();
      if (typeof redrawCurrent === 'function') redrawCurrent();
      if (typeof toast === 'function') toast('Изображение обрезано');
    }
  }

  // Convert event coordinates into canvas device coordinates
  function canvasCoords(cv, e) {
    const rect = cv.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * DPR(),
      y: (e.clientY - rect.top) * DPR(),
    };
  }

  // Initialize the cropper once globals are ready
  async function init() {
    await waitForGlobals();
    ensureCropButton();
    bindInteractions();
    bindZoom();
    // Observe DOM mutations and update crop button state
    const mo = new MutationObserver(() => updateCropButtonState());
    mo.observe(document.body, { childList: true, subtree: true });
    // Periodic update as a fallback
    setInterval(updateCropButtonState, 500);
    // Resize event to redraw cropping view if modal open
    window.addEventListener('resize', () => {
      const { canvas, modal } = getCropEls();
      if (modal.style.display === 'grid') {
        fitCropCanvas(canvas);
        layoutImage(canvas);
        drawScene(canvas);
        clampSelection();
        paintOverlay();
      }
    });
  }
  init();
})();