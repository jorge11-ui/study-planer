/**
 * Enhanced Whiteboard implementation using Fabric.js and Rough.js
 * Integrated into StudyJournal
 */

// --- Custom Rough.js Classes for Fabric.js ---

fabric.RoughRect = fabric.util.createClass(fabric.Rect, {
    type: 'RoughRect',
    _render: function(ctx) {
        const rc = rough.canvas(ctx);
        const options = {
            stroke: this.stroke || this.fill,
            strokeWidth: this.strokeWidth || 2,
            roughness: 1.5,
            fill: this.fill,
            fillStyle: 'hachure',
            fillWeight: 1
        };

        rc.rectangle(
            this.left,
            this.top,
            this.width * this.scaleX,
            this.height * this.scaleY,
            options
        );
    }
});

fabric.RoughCircle = fabric.util.createClass(fabric.Circle, {
    type: 'RoughCircle',
    _render: function(ctx) {
        const rc = rough.canvas(ctx);
        const options = {
            stroke: this.stroke || this.fill,
            strokeWidth: this.strokeWidth || 2,
            roughness: 1.5,
            fill: this.fill,
            fillStyle: 'hachure',
            fillWeight: 1
        };

        rc.ellipse(
            this.left + this.radius * this.scaleX,
            this.top + this.radius * this.scaleY,
            this.radius * 2 * this.scaleX,
            this.radius * 2 * this.scaleY,
            options
        );
    }
});

fabric.RoughArrow = fabric.util.createClass(fabric.Line, {
    type: 'RoughArrow',
    _render: function(ctx) {
        const rc = rough.canvas(ctx);
        const options = {
            stroke: this.stroke || this.fill,
            strokeWidth: this.strokeWidth || 2,
            roughness: 1.5
        };

        rc.line(this.x1, this.y1, this.x2, this.y2, options);

        const angle = Math.atan2(this.y2 - this.y1, this.x2 - this.x1);
        const arrowSize = 15;
        const head1x = this.x2 - arrowSize * Math.cos(angle - Math.PI / 6);
        const head1y = this.y2 - arrowSize * Math.sin(angle - Math.PI / 6);
        const head2x = this.x2 - arrowSize * Math.cos(angle + Math.PI / 6);
        const head2y = this.y2 - arrowSize * Math.sin(angle + Math.PI / 6);

        rc.line(this.x2, this.y2, head1x, head1y, options);
        rc.line(this.x2, this.y2, head2x, head2y, options);
    }
});

fabric.RoughDiamond = fabric.util.createClass(fabric.Rect, {
    type: 'RoughDiamond',
    _render: function(ctx) {
        const rc = rough.canvas(ctx);
        const options = {
            stroke: this.stroke || this.fill,
            strokeWidth: this.strokeWidth || 2,
            roughness: 1.5,
            fill: this.fill,
            fillStyle: 'hachure',
            fillWeight: 1
        };

        const w = this.width * this.scaleX;
        const h = this.height * this.scaleY;
        const cx = this.left + w / 2;
        const cy = this.top + h / 2;

        rc.line(cx, this.top, this.left + w, cy, options);
        rc.line(this.left + w, cy, cx, this.top + h, options);
        rc.line(cx, this.top + h, this.left, cy, options);
        rc.line(this.left, cy, cx, this.top, options);
    }
});

fabric.RoughPath = fabric.util.createClass(fabric.Path, {
    type: 'RoughPath',
    _render: function(ctx) {
        const rc = rough.canvas(ctx);
        const options = {
            stroke: this.stroke || this.fill,
            strokeWidth: this.strokeWidth || 2,
            roughness: 1.5
        };

        const points = this.path;
        if (!points || points.length < 2) return;

        ctx.save();
        ctx.translate(this.left, this.top);
        ctx.scale(this.scaleX, this.scaleY);
        fabric.Path.prototype._render.call(this, ctx);
        ctx.restore();
    }
});

let canvas = null;
let currentTool = 'select';
let history = [];
let historyStep = -1;
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
        backgroundColor: '#ffffff',
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
        if (opt.e.button === 2 || (window.isSpacePressed)) {
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
        canvas.setCursor('default');
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
    if (historyStep < history.length - 1) {
        history = history.slice(0, historyStep + 1);
    }
    history.push(state);
    if (history.length > 50) history.shift();
    historyStep = history.length - 1;
    if (persistDraft) saveWhiteboardDraft();
}

function saveWhiteboardDraft() {
    if (!canvas) return;
    if (loadingBoard) return;
    userChangedBoard = true;
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
        try {
            localStorage.setItem(WHITEBOARD_DRAFT_KEY, JSON.stringify(canvas.toJSON()));
        } catch (err) {
            console.warn('Não foi possível guardar o rascunho do quadro neste browser.', err);
        }
    }, 180);
}

function loadWhiteboardData(data) {
    if (!canvas || !data) return;
    loadingBoard = true;
    canvas.loadFromJSON(data, () => {
        canvas.renderAll();
        history = [];
        historyStep = -1;
        saveHistory(false);
        loadingBoard = false;
    });
}

function undo() {
    if (historyStep > 0) {
        historyStep--;
        loadingBoard = true;
        canvas.loadFromJSON(history[historyStep], () => {
            canvas.renderAll();
            loadingBoard = false;
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
            saveWhiteboardDraft();
        });
    }
}

function setupTools() {
    const tools = {
        'select': document.getElementById('wb-tool-select'),
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

        Object.values(tools).forEach(btn => {
            if(!btn) return;
            btn.classList.remove('bg-surface-3', 'text-fg', 'ring-2', 'ring-brand');
        });

        const activeBtn = tools[tool];
        if (activeBtn) activeBtn.classList.add('bg-surface-3', 'text-fg', 'ring-2', 'ring-brand');

        if (tool === 'pencil') {
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.width = 3;
            canvas.freeDrawingBrush.color = colorPicker?.value || '#4f46e5';
        }
    };

    Object.entries(tools).forEach(([tool, btn]) => {
        if(btn) btn.onclick = () => setTool(tool);
    });

    let isCreating = false;
    let startPointer = { x: 0, y: 0 };
    let activeShape = null;

    canvas.on('mouse:down', (options) => {
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
            activeShape = new fabric.RoughCircle({
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
            return;
        } else if (currentTool === 'text-long') {
            const text = new fabric.Textbox('Texto longo...', {
                left: startPointer.x, top: startPointer.y, width: 200, fontSize: 24, fontFamily: 'Comic Mono', fill: color
            });
            canvas.add(text);
            canvas.setActiveObject(text);
            setTool('select');
            return;
        }

        if (activeShape) {
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
        } else if (activeShape.type === 'RoughCircle') {
            const radius = Math.sqrt(dx*dx + dy*dy) / 2;
            activeShape.set({
                left: Math.min(startPointer.x, pointer.x),
                top: Math.min(startPointer.y, pointer.y),
                radius: radius
            });
        } else if (activeShape.type === 'RoughArrow') {
            activeShape.set({ x2: pointer.x, y2: pointer.y });
        }
        canvas.renderAll();
    });

    canvas.on('mouse:up', () => {
        if (isCreating) {
            isCreating = false;
            activeShape = null;
            saveHistory();
        }
    });

    window.addEventListener('keydown', (e) => {
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
            'a': 'arrow', 'd': 'diamond', 't': 'text', 'l': 'text-long'
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
            const obj = canvas.getActiveObject();
            if (obj) {
                obj.set({ stroke: val, fill: obj.fill === undefined ? val : obj.fill });
                canvas.renderAll();
                saveHistory();
            }
        };
    }

    if (strokeHex) {
        strokeHex.oninput = () => {
            const val = strokeHex.value;
            if (strokeInput) strokeInput.value = val;
            const obj = canvas.getActiveObject();
            if (obj) {
                obj.set({ stroke: val });
                canvas.renderAll();
                saveHistory();
            }
        };
    }

    if (fillInput) {
        fillInput.oninput = () => {
            const val = fillInput.value;
            const obj = canvas.getActiveObject();
            if (obj) {
                obj.set({ fill: val });
                canvas.renderAll();
                saveHistory();
            }
        };
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
            const obj = canvas.getActiveObject();
            if (obj) {
                obj.set({ strokeWidth: val });
                canvas.renderAll();
                saveHistory();
            }
        };
    }

    if (opacityInput) {
        opacityInput.oninput = () => {
            const val = parseInt(opacityInput.value) / 100;
            if (opacityVal) opacityVal.innerText = Math.round(val * 100);
            const obj = canvas.getActiveObject();
            if (obj) {
                obj.set({ opacity: val });
                canvas.renderAll();
                saveHistory();
            }
        };
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

function setupEvents() {
    window.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (const item of items) {
            if (item.type.indexOf('image') !== -1) {
                const blob = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    fabric.Image.fromURL(event.target.result, (img) => {
                        img.scaleToWidth(200);
                        canvas.add(img);
                        canvas.centerObject(img);
                        canvas.setActiveObject(img);
                        saveHistory();
                    });
                };
                reader.readAsDataURL(blob);
            }
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            window.isSpacePressed = true;
            canvas.setCursor('grab');
        }
    });
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            window.isSpacePressed = false;
            canvas.setCursor('default');
        }
    });

    const undoBtn = document.getElementById('wb-undo');
    if(undoBtn) undoBtn.onclick = undo;
    const redoBtn = document.getElementById('wb-redo');
    if(redoBtn) redoBtn.onclick = redo;
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

    const exportBtn = document.getElementById('wb-export');
    if(exportBtn) exportBtn.onclick = () => {
        const dataURL = canvas.toDataURL({ format: 'png', quality: 1 });
        const link = document.createElement('a');
        link.download = 'study-whiteboard.png';
        link.href = dataURL;
        link.click();
    };

    const saveBtn = document.getElementById('wb-save');
    if(saveBtn) saveBtn.onclick = saveWhiteboard;

    const clearBtn = document.getElementById('wb-clear');
    if(clearBtn) clearBtn.onclick = () => {
        if (confirm('Criar um quadro em branco? O rascunho atual será substituído.')) {
            canvas.clear();
            canvas.backgroundColor = '#ffffff';
            canvas.renderAll();
            saveHistory();
            try { localStorage.setItem(WHITEBOARD_DRAFT_KEY, JSON.stringify(canvas.toJSON())); } catch { /* o quadro continua disponível até sair da página */ }
        }
    };

    canvas.on('object:modified', () => { if (!loadingBoard) saveHistory(); });
    canvas.on('object:added', (e) => {
        if (loadingBoard) return;
        if (canvas.isDrawingMode) saveWhiteboardDraft();
        else saveHistory();
    });
    canvas.on('object:removed', () => { if (!loadingBoard) saveWhiteboardDraft(); });
    canvas.on('path:created', () => { if (!loadingBoard) saveHistory(); });

    window.addEventListener('resize', resizeCanvas);
}

async function saveWhiteboard() {
    if (!canvas) return;
    const data = JSON.stringify(canvas.toJSON());
    try { localStorage.setItem(WHITEBOARD_DRAFT_KEY, data); } catch { /* guardar no servidor continua disponível */ }
    try {
        const response = await fetch('/api/vault/file?name=whiteboard.json', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(window.ContaSync?.requestHeaders?.() || {}) },
            body: JSON.stringify({ content: data })
        });
        if (response.ok) alert('Quadro guardado com sucesso!');
        else throw new Error('Erro no servidor');
    } catch (err) {
        alert('Erro ao guardar: ' + err.message);
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
