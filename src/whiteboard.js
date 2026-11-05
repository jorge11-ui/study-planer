/**
 * StudyJournal whiteboard implementation using Fabric.js.
 * Integrated into StudyJournal
 */

// Retain these type names so older saved boards continue to load.

fabric.RoughRect = fabric.util.createClass(fabric.Rect, {
    type: 'RoughRect',
    _render: function(ctx) {
        fabric.Rect.prototype._render.call(this, ctx);
    }
});

fabric.RoughCircle = fabric.util.createClass(fabric.Circle, {
    type: 'RoughCircle',
    _render: function(ctx) {
        fabric.Circle.prototype._render.call(this, ctx);
    }
});

fabric.RoughArrow = fabric.util.createClass(fabric.Line, {
    type: 'RoughArrow',
    _render: function(ctx) {
        fabric.Line.prototype._render.call(this, ctx);
        const endX = this.x2 - this.pathOffset.x;
        const endY = this.y2 - this.pathOffset.y;
        const angle = Math.atan2(this.y2 - this.y1, this.x2 - this.x1);
        const size = 12;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - size * Math.cos(angle - Math.PI / 6), endY - size * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - size * Math.cos(angle + Math.PI / 6), endY - size * Math.sin(angle + Math.PI / 6));
        ctx.strokeStyle = this.stroke || this.fill || '#222222';
        ctx.lineWidth = this.strokeWidth || 2;
        ctx.stroke();
    }
});

fabric.RoughDiamond = fabric.util.createClass(fabric.Rect, {
    type: 'RoughDiamond',
    _render: function(ctx) {
        const w = this.width / 2;
        const h = this.height / 2;
        ctx.beginPath();
        ctx.moveTo(0, -h);
        ctx.lineTo(w, 0);
        ctx.lineTo(0, h);
        ctx.lineTo(-w, 0);
        ctx.closePath();
        if (this.fill) {
            ctx.fillStyle = this.fill;
            ctx.fill();
        }
        if (this.stroke) {
            ctx.strokeStyle = this.stroke;
            ctx.lineWidth = this.strokeWidth || 1;
            ctx.stroke();
        }
    }
});

fabric.RoughPath = fabric.util.createClass(fabric.Path, {
    type: 'RoughPath',
    _render: function(ctx) {
        fabric.Path.prototype._render.call(this, ctx);
    }
});

[fabric.RoughRect, fabric.RoughCircle, fabric.RoughArrow, fabric.RoughDiamond, fabric.RoughPath].forEach((Shape) => {
    Shape.fromObject = function(object, callback) {
        callback(new Shape(object));
    };
});

let canvas = null;
let currentTool = 'select';
let history = [];
let historyStep = -1;
let historyTimer = null;
let lastHistoryJSON = '';
let creatingBoardShape = false;
const WHITEBOARD_DRAFT_KEY = 'study-journal-whiteboard-draft';
let loadingBoard = false;
let draftSaveTimer = null;
let userChangedBoard = false;

let viewport = {
    zoom: 1,
    pan: { x: 0, y: 0 },
    isPanning: false,
    lastMousePos: { x: 0, y: 0 }
};

function initWhiteboard() {
    const canvasEl = document.getElementById('wb-canvas');
    if (!canvasEl) return;

    if (canvas) {
        resizeCanvas();
        return;
    }

    const container = canvasEl.parentElement;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    canvas = new fabric.Canvas('wb-canvas', {
        width: width,
        height: height,
        backgroundColor: null,
        isDrawingMode: false,
        preserveObjectStacking: true,
        stopContextMenu: true
    });

    setupInfiniteCanvas();
    setupTools();
    setupPropertiesPanel();
    setupEvents();
    loadWhiteboard();

    setTimeout(resizeCanvas, 100);
    saveHistory(false);
}

function setupInfiniteCanvas() {
    canvas.on('mouse:wheel', function(opt) {
        const delta = opt.e.deltaY;
        const bounds = canvas.upperCanvasEl.getBoundingClientRect();
        const point = new fabric.Point(opt.e.clientX - bounds.left, opt.e.clientY - bounds.top);
        setZoom(canvas.getZoom() * Math.pow(0.999, delta), point);
        opt.e.preventDefault();
        opt.e.stopPropagation();
    });

    canvas.on('mouse:down', function(opt) {
        if (opt.e.button === 2 || opt.e.button === 1 || window.isSpacePressed || currentTool === 'hand') {
            viewport.isPanning = true;
            viewport.lastMousePos = { x: opt.e.clientX, y: opt.e.clientY };
            canvas.setCursor('grab');
        }
    });

    canvas.on('mouse:move', function(opt) {
        if (viewport.isPanning) {
            const dx = opt.e.clientX - viewport.lastMousePos.x;
            const dy = opt.e.clientY - viewport.lastMousePos.y;
            canvas.relativePan(dx, dy);
            viewport.lastMousePos = { x: opt.e.clientX, y: opt.e.clientY };
        }
    });

    canvas.on('mouse:up', function(opt) {
        viewport.isPanning = false;
        canvas.setCursor(currentTool === 'hand' ? 'grab' : 'default');
    });
}

function setZoom(value, point = null) {
    if (!canvas) return;
    const zoom = Math.min(Math.max(value, 0.1), 5);
    const bounds = canvas.upperCanvasEl.getBoundingClientRect();
    canvas.zoomToPoint(point || new fabric.Point(bounds.width / 2, bounds.height / 2), zoom);
    viewport.zoom = zoom;
    updateZoomUI();
}

function updateZoomUI() {
    const zoomEl = document.getElementById('wb-zoom-level');
    if (zoomEl) {
        zoomEl.innerText = `${Math.round(canvas.getZoom() * 100)}%`;
    }
}

function resizeCanvas() {
    if (!canvas) return;
    const container = document.getElementById('wb-canvas').parentElement;
    canvas.setDimensions({
        width: container.clientWidth,
        height: container.clientHeight
    });
    canvas.renderAll();
}

function saveHistory(persistDraft = true) {
    if (!canvas) return;
    const state = JSON.stringify(canvas.toJSON());
    if (state === lastHistoryJSON) return;
    if (historyStep < history.length - 1) {
        history = history.slice(0, historyStep + 1);
    }
    history.push(state);
    if (history.length > 50) history.shift();
    historyStep = history.length - 1;
    lastHistoryJSON = state;
    updateHistoryButtons();
    if (persistDraft) saveWhiteboardDraft();
}

function updateHistoryButtons() {
    const undoBtn = document.getElementById('wb-undo');
    const redoBtn = document.getElementById('wb-redo');
    if (undoBtn) undoBtn.disabled = historyStep <= 0;
    if (redoBtn) redoBtn.disabled = historyStep >= history.length - 1;
}

function saveWhiteboardDraft() {
    if (!canvas) return;
    if (loadingBoard) return;
    userChangedBoard = true;
    const status = document.getElementById('wb-save-status');
    if (status) status.textContent = 'A guardar rascunho…';
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
        try {
            localStorage.setItem(WHITEBOARD_DRAFT_KEY, JSON.stringify(canvas.toJSON()));
            if (status) status.textContent = 'Rascunho guardado neste dispositivo.';
        } catch (err) {
            console.warn('Não foi possível guardar o rascunho do quadro neste browser.', err);
            if (status) status.textContent = 'Não foi possível guardar neste dispositivo.';
        }
    }, 180);
}

function loadWhiteboardData(data) {
    if (!canvas || !data) return;
    loadingBoard = true;
    canvas.loadFromJSON(data, () => {
        setBoardGrid(boardGridVisible());
        canvas.renderAll();
        history = [];
        historyStep = -1;
        lastHistoryJSON = '';
        saveHistory(false);
        loadingBoard = false;
        updateHistoryButtons();
    });
}

function undo() {
    if (historyStep > 0) {
        historyStep--;
        loadingBoard = true;
        canvas.loadFromJSON(history[historyStep], () => {
            canvas.renderAll();
            loadingBoard = false;
            lastHistoryJSON = history[historyStep];
            updateHistoryButtons();
            saveWhiteboardDraft();
        });
    }
}

function redo() {
    if (historyStep < history.length - 1) {
        historyStep++;
        loadingBoard = true;
        canvas.loadFromJSON(history[historyStep], () => {
            canvas.renderAll();
            loadingBoard = false;
            lastHistoryJSON = history[historyStep];
            updateHistoryButtons();
            saveWhiteboardDraft();
        });
    }
}

function setupTools() {
    const tools = {
        'select': document.getElementById('wb-tool-select'),
        'hand': document.getElementById('wb-tool-hand'),
        'pencil': document.getElementById('wb-tool-pencil'),
        'text': document.getElementById('wb-tool-text'),
        'text-long': document.getElementById('wb-tool-text-long'),
        'rect': document.getElementById('wb-tool-rect'),
        'circle': document.getElementById('wb-tool-circle'),
        'arrow': document.getElementById('wb-tool-arrow'),
        'diamond': document.getElementById('wb-tool-diamond'),
        'erase': document.getElementById('wb-tool-erase'),
    };
    const colorPicker = document.getElementById('wb-prop-stroke');

    const setTool = (tool) => {
        currentTool = tool;
        canvas.isDrawingMode = (tool === 'pencil');
        canvas.selection = tool === 'select';
        canvas.skipTargetFind = !['select', 'erase'].includes(tool);
        canvas.defaultCursor = tool === 'erase' ? 'not-allowed' : (tool === 'select' ? 'default' : 'crosshair');

        Object.entries(tools).forEach(([name, btn]) => {
            if (!btn) return;
            btn.classList.remove('bg-surface-3', 'text-fg', 'ring-2', 'ring-brand');
            btn.setAttribute('aria-pressed', String(name === tool));
        });

        const activeBtn = tools[tool];
        if (activeBtn) activeBtn.classList.add('bg-surface-3', 'text-fg', 'ring-2', 'ring-brand');

        if (tool === 'pencil') {
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.width = Number(document.getElementById('wb-prop-width')?.value || 3);
            canvas.freeDrawingBrush.color = colorPicker?.value || '#4f46e5';
        }
        if (tool === 'hand') canvas.defaultCursor = 'grab';
    };

    Object.entries(tools).forEach(([tool, btn]) => {
        if (btn) btn.onclick = () => setTool(tool);
    });
    setTool('select');
    window.setWhiteboardTool = setTool;

    let isCreating = false;
    let startPointer = { x: 0, y: 0 };
    let activeShape = null;

    canvas.on('mouse:down', (options) => {
        if (currentTool === 'erase') {
            if (options.target) {
                canvas.remove(options.target);
                canvas.discardActiveObject();
                saveHistory();
            }
            return;
        }
        if (currentTool === 'select' || currentTool === 'pencil') return;
        if (options.target) return;

        isCreating = true;
        startPointer = canvas.getPointer(options.e);
        const color = colorPicker?.value || '#4f46e5';

        if (currentTool === 'rect') {
            activeShape = new fabric.RoughRect({
                left: startPointer.x, top: startPointer.y, width: 0, height: 0, fill: color, stroke: color, opacity: 0.7
            });
        } else if (currentTool === 'circle') {
            activeShape = new fabric.Circle({
                left: startPointer.x, top: startPointer.y, radius: 0, fill: color, stroke: color, opacity: 0.7
            });
        } else if (currentTool === 'arrow') {
            activeShape = new fabric.RoughArrow({
                x1: startPointer.x, y1: startPointer.y, x2: startPointer.x, y2: startPointer.y, stroke: color
            });
        } else if (currentTool === 'diamond') {
            activeShape = new fabric.RoughDiamond({
                left: startPointer.x, top: startPointer.y, width: 0, height: 0, fill: color, stroke: color, opacity: 0.7
            });
        } else if (currentTool === 'text') {
            const text = new fabric.IText('Texto...', {
                left: startPointer.x, top: startPointer.y, fontSize: 24, fontFamily: 'Comic Mono', fill: color
            });
            canvas.add(text);
            canvas.setActiveObject(text);
            setTool('select');
            text.enterEditing();
            text.selectAll();
            return;
        } else if (currentTool === 'text-long') {
            const text = new fabric.Textbox('Texto longo...', {
                left: startPointer.x, top: startPointer.y, width: 200, fontSize: 24, fontFamily: 'Comic Mono', fill: color
            });
            canvas.add(text);
            canvas.setActiveObject(text);
            setTool('select');
            text.enterEditing();
            text.selectAll();
            return;
        }

        if (activeShape) {
            creatingBoardShape = true;
            canvas.add(activeShape);
            canvas.setActiveObject(activeShape);
        }
    });

    canvas.on('mouse:move', (options) => {
        if (!isCreating || !activeShape) return;

        const pointer = canvas.getPointer(options.e);
        const dx = pointer.x - startPointer.x;
        const dy = pointer.y - startPointer.y;

        if (activeShape.type === 'RoughRect' || activeShape.type === 'RoughDiamond') {
            activeShape.set({
                left: Math.min(startPointer.x, pointer.x),
                top: Math.min(startPointer.y, pointer.y),
                width: Math.abs(dx),
                height: Math.abs(dy)
            });
        } else if (activeShape.type === 'circle') {
            const diameter = Math.min(Math.abs(dx), Math.abs(dy));
            activeShape.set({
                left: Math.min(startPointer.x, pointer.x) + (Math.abs(dx) - diameter) / 2,
                top: Math.min(startPointer.y, pointer.y) + (Math.abs(dy) - diameter) / 2,
                radius: diameter / 2
            });
        } else if (activeShape.type === 'RoughArrow') {
            activeShape.set({ x2: pointer.x, y2: pointer.y });
        }
        canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
        if (isCreating) {
            isCreating = false;
            creatingBoardShape = false;
            if (activeShape && Math.hypot(activeShape.width || 0, activeShape.height || 0) < 3) canvas.remove(activeShape);
            activeShape = null;
            saveHistory();
        }
    });

    window.addEventListener('keydown', (e) => {
        if (document.getElementById('view-whiteboard')?.hidden) return;
        const editing = e.target instanceof HTMLElement && (
            e.target.matches('input, textarea, select, [contenteditable="true"]') || e.target.isContentEditable
        );
        if (editing) return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) redo(); else undo();
            return;
        }
        if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
        if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
        if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveWhiteboard(); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            const activeObject = canvas.getActiveObject();
            if (activeObject && (activeObject.type === 'textbox' || activeObject.type === 'i-text') && activeObject.isEditing) return;
            const activeObjects = canvas.getActiveObjects();
            if (activeObjects.length) {
                canvas.remove(...activeObjects);
                canvas.discardActiveObject();
                saveHistory();
            }
        }
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        const shortcuts = {
            'v': 'select', 'p': 'pencil', 'r': 'rect', 'c': 'circle',
            'a': 'arrow', 'd': 'diamond', 'e': 'erase', 'h': 'hand', 't': 'text', 'l': 'text-long'
        };
        const tool = shortcuts[e.key.toLowerCase()];
        if (tool) {
            e.preventDefault();
            setTool(tool);
        }
    });
}

function setupPropertiesPanel() {
    const panel = document.getElementById('wb-prop-panel');
    const strokeInput = document.getElementById('wb-prop-stroke');
    const strokeHex = document.getElementById('wb-prop-stroke-hex');
    const fillInput = document.getElementById('wb-prop-fill');
    const widthInput = document.getElementById('wb-prop-width');
    const widthVal = document.getElementById('wb-prop-width-val');
    const opacityInput = document.getElementById('wb-prop-opacity');
    const opacityVal = document.getElementById('wb-prop-opacity-val');
    const deleteBtn = document.getElementById('wb-prop-delete');
    const noFillBtn = document.getElementById('wb-prop-no-fill');
    document.getElementById('wb-prop-close')?.addEventListener('click', () => {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
    });

    canvas.on('selection:created', updatePanel);
    canvas.on('selection:updated', updatePanel);
    canvas.on('selection:cleared', () => {
        if (panel) panel.classList.add('hidden');
    });

    function updatePanel() {
        const obj = canvas.getActiveObject();
        if (!obj) return;

        if (panel) panel.classList.remove('hidden');

        // Update UI to match object
        if (strokeInput) strokeInput.value = obj.stroke || obj.fill || '#000000';
        if (strokeHex) strokeHex.value = obj.stroke || obj.fill || '#000000';
        if (fillInput) fillInput.value = obj.fill || '#ffffff';
        if (widthInput) widthInput.value = obj.strokeWidth || 2;
        if (widthVal) widthVal.innerText = obj.strokeWidth || 2;
        if (opacityInput) opacityInput.value = Math.round((obj.opacity ?? 1) * 100);
        if (opacityVal) opacityVal.innerText = Math.round((obj.opacity ?? 1) * 100);
    }

    if (strokeInput) {
        strokeInput.oninput = () => {
            const val = strokeInput.value;
            if (strokeHex) strokeHex.value = val;
            if (canvas.isDrawingMode && canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = val;
            const obj = canvas.getActiveObject();
            if (obj) {
                obj.set({ stroke: val, fill: obj.fill === undefined ? val : obj.fill });
                canvas.renderAll();
                saveWhiteboardDraft();
            }
        };
        strokeInput.onchange = () => saveHistory();
    }

    if (strokeHex) {
        strokeHex.oninput = () => {
            const val = strokeHex.value;
            if (strokeInput) strokeInput.value = val;
            const obj = canvas.getActiveObject();
            if (obj && /^#[0-9a-f]{6}$/i.test(val)) {
                obj.set({ stroke: val });
                canvas.renderAll();
                saveWhiteboardDraft();
            }
        };
        strokeHex.onchange = () => saveHistory();
    }

    if (fillInput) {
        fillInput.oninput = () => {
            const val = fillInput.value;
            const obj = canvas.getActiveObject();
            if (obj) {
                obj.set({ fill: val });
                canvas.renderAll();
                saveWhiteboardDraft();
            }
        };
        fillInput.onchange = () => saveHistory();
    }

    if (noFillBtn) {
        noFillBtn.onclick = () => {
            const obj = canvas.getActiveObject();
            if (obj) {
                obj.set({ fill: null });
                canvas.renderAll();
                saveHistory();
            }
        };
    }

    if (widthInput) {
        widthInput.oninput = () => {
            const val = parseInt(widthInput.value);
            if (widthVal) widthVal.innerText = val;
            if (canvas.isDrawingMode && canvas.freeDrawingBrush) canvas.freeDrawingBrush.width = val;
            const obj = canvas.getActiveObject();
            if (obj) {
                obj.set({ strokeWidth: val });
                canvas.renderAll();
                saveWhiteboardDraft();
            }
        };
        widthInput.onchange = () => saveHistory();
    }

    if (opacityInput) {
        opacityInput.oninput = () => {
            const val = parseInt(opacityInput.value) / 100;
            if (opacityVal) opacityVal.innerText = Math.round(val * 100);
            const obj = canvas.getActiveObject();
            if (obj) {
                obj.set({ opacity: val });
                canvas.renderAll();
                saveWhiteboardDraft();
            }
        };
        opacityInput.onchange = () => saveHistory();
    }

    if (deleteBtn) {
        deleteBtn.onclick = () => {
            const activeObjects = canvas.getActiveObjects();
            canvas.remove(...activeObjects);
            canvas.discardActiveObject();
            saveHistory();
        };
    }
}

function duplicateSelection() {
    if (!canvas) return;
    const selected = canvas.getActiveObjects();
    if (!selected.length) return;
    canvas.discardActiveObject();
    loadingBoard = true;
    let pending = selected.length;
    const copies = [];
    selected.forEach((object) => object.clone((copy) => {
        copy.set({ left: (object.left || 0) + 24, top: (object.top || 0) + 24, evented: true });
        canvas.add(copy);
        copies.push(copy);
        pending -= 1;
        if (!pending) {
            loadingBoard = false;
            const active = copies.length > 1 ? new fabric.ActiveSelection(copies, { canvas }) : copies[0];
            canvas.setActiveObject(active);
            window.setWhiteboardTool?.('select');
            canvas.requestRenderAll();
            saveHistory();
        }
    }, ['selectable', 'evented']));
}

function fitContent() {
    if (!canvas) return;
    const objects = canvas.getObjects();
    if (!objects.length) {
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        viewport.zoom = 1;
        updateZoomUI();
        return;
    }
    const boxes = objects.map((object) => object.getBoundingRect(true, true));
    const left = Math.min(...boxes.map((box) => box.left));
    const top = Math.min(...boxes.map((box) => box.top));
    const right = Math.max(...boxes.map((box) => box.left + box.width));
    const bottom = Math.max(...boxes.map((box) => box.top + box.height));
    const padding = 48;
    const zoom = Math.min(
        (canvas.getWidth() - padding * 2) / Math.max(1, right - left),
        (canvas.getHeight() - padding * 2) / Math.max(1, bottom - top),
        5
    );
    const safeZoom = Math.max(0.1, zoom);
    const x = canvas.getWidth() / 2 - ((left + right) / 2) * safeZoom;
    const y = canvas.getHeight() / 2 - ((top + bottom) / 2) * safeZoom;
    canvas.setViewportTransform([safeZoom, 0, 0, safeZoom, x, y]);
    viewport.zoom = safeZoom;
    updateZoomUI();
}

function setBoardGrid(visible) {
    if (!canvas) return;
    canvas.backgroundColor = null;
    const surface = document.getElementById('wb-canvas')?.parentElement;
    surface?.classList.toggle('bg-dot-grid', visible);
    canvas.requestRenderAll();
}

function boardGridVisible() {
    try { return localStorage.getItem('study-journal-whiteboard-grid') !== 'false'; }
    catch { return true; }
}

function setupEvents() {
    window.addEventListener('paste', (e) => {
        if (document.getElementById('view-whiteboard')?.hidden) return;
        const items = e.clipboardData?.items;
        if (!items || e.target.matches?.('input, textarea, [contenteditable="true"]')) return;
        for (const item of items) {
            if (item.type.indexOf('image') !== -1) {
                const blob = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    fabric.Image.fromURL(event.target.result, (img) => {
                        img.scaleToWidth(200);
                        const center = canvas.getVpCenter();
                        img.set({ left: center.x - img.getScaledWidth() / 2, top: center.y - img.getScaledHeight() / 2 });
                        canvas.add(img);
                        canvas.setActiveObject(img);
                        window.setWhiteboardTool?.('select');
                        saveHistory();
                    });
                };
                reader.readAsDataURL(blob);
            }
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            if (document.getElementById('view-whiteboard')?.hidden) return;
            if (e.target instanceof HTMLElement && e.target.matches('input, textarea, [contenteditable="true"]')) return;
            window.isSpacePressed = true;
            canvas.setCursor('grab');
            e.preventDefault();
        }
    });
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            window.isSpacePressed = false;
            if (!document.getElementById('view-whiteboard')?.hidden) canvas.setCursor(currentTool === 'hand' ? 'grab' : 'default');
        }
    });
    window.addEventListener('blur', () => {
        window.isSpacePressed = false;
        canvas?.setCursor(currentTool === 'hand' ? 'grab' : 'default');
    });

    const undoBtn = document.getElementById('wb-undo');
    if (undoBtn) undoBtn.onclick = undo;
    const redoBtn = document.getElementById('wb-redo');
    if (redoBtn) redoBtn.onclick = redo;
    const zoomIn = document.getElementById('wb-zoom-in');
    const zoomOut = document.getElementById('wb-zoom-out');
    const zoomReset = document.getElementById('wb-zoom-reset');
    if (zoomIn) zoomIn.onclick = () => setZoom(canvas.getZoom() * 1.2);
    if (zoomOut) zoomOut.onclick = () => setZoom(canvas.getZoom() / 1.2);
    if (zoomReset) zoomReset.onclick = () => {
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        viewport.zoom = 1;
        updateZoomUI();
    };
    document.getElementById('wb-fit-content')?.addEventListener('click', fitContent);

    const gridToggle = document.getElementById('wb-grid-toggle');
    if (gridToggle) {
        let visible = boardGridVisible();
        setBoardGrid(visible);
        gridToggle.setAttribute('aria-pressed', String(visible));
        gridToggle.classList.toggle('bg-surface-3', visible);
        gridToggle.onclick = () => {
            visible = !visible;
            setBoardGrid(visible);
            gridToggle.setAttribute('aria-pressed', String(visible));
            gridToggle.classList.toggle('bg-surface-3', visible);
            try { localStorage.setItem('study-journal-whiteboard-grid', String(visible)); } catch { /* só persiste nesta sessão */ }
        };
    }

    const imageInput = document.getElementById('wb-image-file');
    document.getElementById('wb-image-add')?.addEventListener('click', () => imageInput?.click());
    imageInput?.addEventListener('change', () => {
        const file = imageInput.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => fabric.Image.fromURL(reader.result, (img) => {
            const maxWidth = canvas.getWidth() * 0.65;
            const maxHeight = canvas.getHeight() * 0.65;
            const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
            img.set({ scaleX: scale, scaleY: scale });
            const center = canvas.getVpCenter();
            img.set({ left: center.x - img.getScaledWidth() / 2, top: center.y - img.getScaledHeight() / 2 });
            canvas.add(img);
            canvas.setActiveObject(img);
            window.setWhiteboardTool?.('select');
            canvas.requestRenderAll();
            saveHistory();
            imageInput.value = '';
        });
        reader.readAsDataURL(file);
    });

    document.getElementById('wb-duplicate')?.addEventListener('click', duplicateSelection);

    const exportBtn = document.getElementById('wb-export');
    if (exportBtn) exportBtn.onclick = () => {
        try {
            const background = canvas.backgroundColor;
            canvas.backgroundColor = '#ffffff';
            canvas.renderAll();
            const link = document.createElement('a');
            link.download = `quadro-${new Date().toISOString().slice(0, 10)}.png`;
            link.href = canvas.toDataURL({ format: 'png', quality: 1, multiplier: 2 });
            link.click();
            canvas.backgroundColor = background;
            canvas.renderAll();
            setBoardStatus('Imagem PNG descarregada.');
        } catch {
            canvas.backgroundColor = null;
            canvas.renderAll();
            setBoardStatus('Não foi possível exportar a imagem.');
        }
    };

    const saveBtn = document.getElementById('wb-save');
    if(saveBtn) saveBtn.onclick = saveWhiteboard;

    const clearBtn = document.getElementById('wb-clear');
    if(clearBtn) clearBtn.onclick = () => {
        if (confirm('Criar um quadro em branco? O rascunho atual será substituído.')) {
            canvas.clear();
            setBoardGrid(boardGridVisible());
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            viewport.zoom = 1;
            updateZoomUI();
            canvas.renderAll();
            saveHistory();
            try { localStorage.setItem(WHITEBOARD_DRAFT_KEY, JSON.stringify(canvas.toJSON())); } catch { /* o quadro continua disponível até sair da página */ }
            setBoardStatus('Quadro novo criado.');
        }
    };

    canvas.on('object:modified', () => { if (!loadingBoard) saveHistory(); });
    canvas.on('object:added', (e) => {
        if (loadingBoard || creatingBoardShape) return;
        if (canvas.isDrawingMode) saveWhiteboardDraft();
        else saveHistory();
    });
    canvas.on('object:removed', () => { if (!loadingBoard) saveWhiteboardDraft(); });
    canvas.on('path:created', () => { if (!loadingBoard) saveHistory(); });
    canvas.on('text:changed', () => {
        if (loadingBoard) return;
        clearTimeout(historyTimer);
        historyTimer = setTimeout(() => saveHistory(), 300);
    });
    canvas.on('editing:exited', () => saveHistory());

    window.addEventListener('resize', resizeCanvas);
}

function setBoardStatus(message, isError = false) {
    const status = document.getElementById('wb-save-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('text-subject-rose', isError);
    status.classList.toggle('text-muted', !isError);
}

async function saveWhiteboard() {
    if (!canvas) return;
    const button = document.getElementById('wb-save');
    if (button) button.disabled = true;
    clearTimeout(draftSaveTimer);
    const data = JSON.stringify(canvas.toJSON());
    let localSaved = false;
    try {
        localStorage.setItem(WHITEBOARD_DRAFT_KEY, data);
        localSaved = true;
    } catch { /* tenta guardar no servidor */ }
    setBoardStatus('A guardar o quadro…');
    try {
        const response = await fetch('/api/vault/file?name=whiteboard.json', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(window.ContaSync?.requestHeaders?.() || {}) },
            body: JSON.stringify({ content: data })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) throw new Error('Servidor indisponível');
        setBoardStatus('Quadro guardado na pasta.');
    } catch {
        setBoardStatus(localSaved
            ? 'Guardado neste dispositivo; não foi possível sincronizar com a pasta.'
            : 'Não foi possível guardar o quadro.', true);
    } finally {
        if (button) button.disabled = false;
    }
}

async function loadWhiteboard() {
    if (!canvas) return;
    try {
        let draft = null;
        try { draft = localStorage.getItem(WHITEBOARD_DRAFT_KEY); } catch { /* usa a cópia remota */ }
        if (draft) {
            try {
                loadWhiteboardData(JSON.parse(draft));
                return;
            } catch { /* um rascunho inválido não impede recuperar a cópia remota */ }
        }
    } catch (err) {
        console.warn('O rascunho local do quadro não pôde ser lido.', err);
    }
    try {
        const response = await fetch('/api/vault/file?name=whiteboard.json', { headers: window.ContaSync?.requestHeaders?.() || {} });
        const result = await response.json();
        if (userChangedBoard) return;
        // Se o utilizador começou a desenhar enquanto o servidor respondia,
        // o rascunho local mais recente tem prioridade sobre a cópia remota.
        const draft = localStorage.getItem(WHITEBOARD_DRAFT_KEY);
        if (draft) {
            loadWhiteboardData(JSON.parse(draft));
            return;
        }
        if (result.ok && result.existe) {
            loadWhiteboardData(result.content);
            try { localStorage.setItem(WHITEBOARD_DRAFT_KEY, JSON.stringify(result.content)); } catch { /* usa a cópia do servidor na próxima abertura */ }
        }
    } catch (err) {
        console.log('Nenhum arquivo de quadro encontrado.');
    }
}

window.initWhiteboard = initWhiteboard;
