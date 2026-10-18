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

        rc.circle(
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

        // Draw the main line
        rc.line(this.x1, this.y1, this.x2, this.y2, options);

        // Calculate arrowhead
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

        // Draw a diamond by drawing 4 lines
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

        // Rough.js doesn't handle SVG paths perfectly, so we iterate through points
        // for a sketchy line effect. Note: Fabric paths are often complex,
        // for now we use the base render but could be improved.
        fabric.Path.prototype._render.call(this, ctx);
        ctx.restore();
    }
});

let canvas = null;
let currentTool = 'select';
let history = [];
let historyStep = -1;

// Viewport state for infinite canvas
let viewport = {
    zoom: 1,
    pan: { x: 0, y: 0 },
    isPanning: false,
    lastMousePos: { x: 0, y: 0 }
};

function initWhiteboard() {
    const canvasEl = document.getElementById('wb-canvas');
    if (!canvasEl) return;

    if (canvas) canvas.dispose();

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
    setupEvents();
    loadWhiteboard();

    setTimeout(resizeCanvas, 100);
    saveHistory();
}

function setupInfiniteCanvas() {
    // Zoom to cursor using mouse wheel
    canvas.on('mouse:wheel', function(opt) {
        const delta = opt.e.deltaY;
        let zoom = viewport.zoom;
        let nextZoom = zoom + (delta > 0 ? -0.001 : 0.001) * zoom;

        // Clamp zoom
        nextZoom = Math.min(Math.max(0.1, nextZoom), 5);

        // Zoom to cursor logic
        const pointer = canvas.getPointer(opt.e);
        const worldX = (pointer.x - viewport.pan.x * zoom) / zoom;
        const worldY = (pointer.y - viewport.pan.y * zoom) / zoom;

        viewport.zoom = nextZoom;
        viewport.pan.x = pointer.x / zoom - worldX / nextZoom; // Simplified for logic
        // Better logic: keep world point stationary
        // viewport.pan.x = (pointer.x - worldX * nextZoom) / nextZoom;

        // Correct Transform: [scaleX, skewY, skewX, scaleY, translateX, translateY]
        // We use the standard Fabric viewport transform
        updateViewportTransform();

        opt.e.preventDefault();
        opt.e.stopPropagation();
    });

    // Right-click or Space+Drag for panning
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

            // Pan in world coordinates
            canvas.relativePan(dx, dy);

            viewport.lastMousePos = { x: opt.e.clientX, y: opt.e.clientY };
        }
    });

    canvas.on('mouse:up', function(opt) {
        viewport.isPanning = false;
        canvas.setCursor('default');
    });
}

function updateViewportTransform() {
    // Fabric's setViewportTransform handles the matrix
    // For a simple zoom/pan, we can use setZoom and relativePan
    // But for a full "Excalidraw" feel, we track state
    canvas.setZoom(viewport.zoom);
    updateZoomUI();
}

function updateZoomUI() {
    const zoomEl = document.getElementById('wb-zoom-level');
    if (zoomEl) {
        zoomEl.innerText = `${Math.round(viewport.zoom * 100)}%`;
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

function saveHistory() {
    if (!canvas) return;
    const state = JSON.stringify(canvas.toJSON());

    if (historyStep < history.length - 1) {
        history = history.slice(0, historyStep + 1);
    }

    history.push(state);
    if (history.length > 50) history.shift();
    historyStep = history.length - 1;
}

function undo() {
    if (historyStep > 0) {
        historyStep--;
        canvas.loadFromJSON(history[historyStep], () => {
            canvas.renderAll();
        });
    }
}

function redo() {
    if (historyStep < history.length - 1) {
        historyStep++;
        canvas.loadFromJSON(history[historyStep], () => {
            canvas.renderAll();
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

    const colorPicker = document.getElementById('wb-color') || document.getElementById('wb-prop-stroke');
    const fontSizePicker = document.getElementById('wb-font-size');

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

    // Tool clicks
    Object.entries(tools).forEach(([tool, btn]) => {
        if(btn) btn.onclick = () => setTool(tool);
    });

    // Color and size handling (migrated to Properties Panel logic in next phase)
    if(colorPicker) {
        colorPicker.onchange = () => {
            const color = colorPicker.value;
            if (canvas.isDrawingMode) {
                canvas.freeDrawingBrush.color = color;
            }
            const activeObject = canvas.getActiveObject();
            if (activeObject) {
                activeObject.set('fill', color);
                activeObject.set('stroke', color);
                canvas.renderAll();
            }
        };
    }

    // --- Drag-to-Create Flow ---
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
        // Shortcuts
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const shortcuts = {
            'v': 'select',
            'p': 'pencil',
            'r': 'rect',
            'c': 'circle',
            'a': 'arrow',
            'd': 'diamond',
            't': 'text',
            'l': 'text-long'
        };
        const tool = shortcuts[e.key.toLowerCase()];
        if (tool) {
            e.preventDefault();
            setTool(tool);
        }
    });
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

    // Space key for panning
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
        if (confirm('Limpar todo o quadro?')) {
            canvas.clear();
            canvas.backgroundColor = '#ffffff';
            canvas.renderAll();
            saveHistory();
        }
    };

    canvas.on('object:modified', saveHistory);
    canvas.on('object:added', (e) => {
        if (e.target.type !== 'pencil') saveHistory();
    });

    window.addEventListener('resize', resizeCanvas);
}

async function saveWhiteboard() {
    if (!canvas) return;
    const data = JSON.stringify(canvas.toJSON());
    try {
        const response = await fetch('/api/vault/file?name=whiteboard.json', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
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
        const response = await fetch('/api/vault/file?name=whiteboard.json');
        const result = await response.json();
        if (result.ok && result.existe) {
            canvas.loadFromJSON(result.content, () => {
                canvas.renderAll();
                saveHistory();
            });
        }
    } catch (err) {
        console.log('Nenhum arquivo de quadro encontrado.');
    }
}

window.initWhiteboard = initWhiteboard;
