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

        // Calculate coordinates based on current scale and position
        // Fabric's left/top are the top-left corner
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

        // Rough.js circle takes centerX, centerY, width, height
        rc.circle(
            this.left + this.radius * this.scaleX,
            this.top + this.radius * this.scaleY,
            this.radius * 2 * this.scaleX,
            this.radius * 2 * this.scaleY,
            options
        );
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

        // Rough.js doesn't support complex SVG paths directly in a simple way,
        // so we simulate the path by drawing a series of sketchy lines
        // between the points of the Fabric path.
        const points = this.path;
        if (!points || points.length < 2) return;

        // We simplify the path for Rough.js by using linear segments
        // Note: this is a simplified approximation of the SVG path
        // For a true Rough.js path, we would need to parse the path data
        ctx.save();
        ctx.translate(this.left, this.top);
        ctx.scale(this.scaleX, this.scaleY);

        // Since parsing Fabric paths is complex, we use the standard render
        // for the pencil but apply a "rough" overlay or just use the
        // standard path ifRough.js doesn't support it.
        // For now, we fallback to standard path render but mark it as RoughPath
        // to maintain serialization.
        fabric.Path.prototype._render.call(this, ctx);
        ctx.restore();
    }
});

let canvas = null;
let currentTool = 'select';
let history = [];
let historyStep = -1;

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
        preserveObjectStacking: true
    });

    createGrid();
    setupTools();
    setupEvents();
    loadWhiteboard();

    setTimeout(resizeCanvas, 100);
    saveHistory(); // Initial state
}

function createGrid() {
    const canvasNode = document.querySelector('.canvas-container');
    if (canvasNode) {
        canvasNode.style.backgroundImage = `
            linear-gradient(to right, #f0f0f0 1px, transparent 1px),
            linear-gradient(to bottom, #f0f0f0 1px, transparent 1px)
        `;
        canvasNode.style.backgroundSize = `40px 40px`;
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
    
    // If we are in the middle of the history and make a change, discard the "future"
    if (historyStep < history.length - 1) {
        history = history.slice(0, historyStep + 1);
    }
    
    history.push(state);
    if (history.length > 50) history.shift(); // Limit history to 50 steps
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
    const pencilBtn = document.getElementById('wb-tool-pencil');
    const textBtn = document.getElementById('wb-tool-text');
    const rectBtn = document.getElementById('wb-tool-rect');
    const circleBtn = document.getElementById('wb-tool-circle');
    const eraseBtn = document.getElementById('wb-tool-erase');
    const colorPicker = document.getElementById('wb-color');
    const fontSizePicker = document.getElementById('wb-font-size');

    const setTool = (tool) => {
        currentTool = tool;
        canvas.isDrawingMode = (tool === 'pencil');
        
        [pencilBtn, textBtn, rectBtn, circleBtn, eraseBtn].forEach(btn => {
            if(!btn) return;
            btn.classList.remove('bg-surface-3', 'text-fg', 'ring-2', 'ring-brand');
        });

        const activeBtn = tool === 'pencil' ? pencilBtn : tool === 'text' ? textBtn : tool === 'rect' ? rectBtn : tool === 'circle' ? circleBtn : eraseBtn;
        if (activeBtn) activeBtn.classList.add('bg-surface-3', 'text-fg', 'ring-2', 'ring-brand');

        if (tool === 'pencil') {
            canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
            canvas.freeDrawingBrush.width = 3;
            canvas.freeDrawingBrush.color = colorPicker.value;
        }
    };

    if(pencilBtn) pencilBtn.onclick = () => setTool('pencil');
    if(textBtn) textBtn.onclick = () => setTool('text');
    if(rectBtn) rectBtn.onclick = () => setTool('rect');
    if(circleBtn) circleBtn.onclick = () => setTool('circle');
    if(eraseBtn) eraseBtn.onclick = () => setTool('select');

    if(colorPicker) {
        colorPicker.onchange = () => {
            const color = colorPicker.value;
            if (canvas.isDrawingMode) {
                canvas.freeDrawingBrush.color = color;
            }
            const activeObject = canvas.getActiveObject();
            if (activeObject) {
                activeObject.set('fill', color);
                canvas.renderAll();
            }
        };
    }

    if(fontSizePicker) {
        fontSizePicker.onchange = () => {
            const size = Number(fontSizePicker.value);
            const activeObject = canvas.getActiveObject();
            if (activeObject && (activeObject.type === 'textbox' || activeObject.type === 'i-text')) {
                activeObject.set('fontSize', size);
                canvas.renderAll();
                saveHistory();
            }
        };
    }

    canvas.on('mouse:down', (options) => {
        if (currentTool === 'select' || currentTool === 'pencil') return;
        if (options.target) return;

        const pointer = canvas.getPointer(options.e);
        const color = colorPicker?.value || '#4f46e5';
        const size = Number(fontSizePicker?.value || 24);

        if (currentTool === 'text') {
            // Switching back to IText for "Scale-to-Resize" behavior
            // This allows the user to change the font size by dragging the corners
            const text = new fabric.IText('Clique para escrever...', {
                left: pointer.x,
                top: pointer.y,
                fontSize: size,
                fontFamily: 'sans-serif',
                fill: color,
                textAlign: 'left'
            });
            canvas.add(text);
            canvas.setActiveObject(text);
            setTool('select');
        } else if (currentTool === 'rect') {
            const rect = new fabric.RoughRect({
                left: pointer.x, top: pointer.y, width: 100, height: 100, fill: color, opacity: 0.7
            });
            canvas.add(rect);
            canvas.setActiveObject(rect);
            setTool('select');
        } else if (currentTool === 'circle') {
            const circle = new fabric.RoughCircle({
                left: pointer.x, top: pointer.y, radius: 50, fill: color, opacity: 0.7
            });
            canvas.add(circle);
            canvas.setActiveObject(circle);
            setTool('select');
        }
        saveHistory();
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            const activeObject = canvas.getActiveObject();
            // Only block deletion if we are actively typing inside the text
            if (activeObject && (activeObject.type === 'textbox' || activeObject.type === 'i-text') && activeObject.isEditing) return;
            
            const activeObjects = canvas.getActiveObjects();
            if (activeObjects.length) {
                canvas.remove(...activeObjects);
                canvas.discardActiveObject();
                saveHistory();
            }
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

    // History buttons
    const undoBtn = document.getElementById('wb-undo');
    if(undoBtn) undoBtn.onclick = undo;
    const redoBtn = document.getElementById('wb-redo');
    if(redoBtn) redoBtn.onclick = redo;

    // Export PNG
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

    // Auto-save history on object modification
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
