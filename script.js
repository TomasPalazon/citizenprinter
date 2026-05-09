const SCALE = 3.7795275591; // 1mm = 3.78px approx at 96 DPI
const PAPER_W_MM = 210;
const PAPER_H_MM = 170;

let canvas;
let clipboard = null;
let undoStack = [];
let redoStack = [];
let isRedoing = false;
let isExporting = false;
let lastSubTarget = null;
let showGrid = false;
let excelData = null; // Almacenará los datos del Excel para automatización
const gridStep = 10 * SCALE; // Rejilla cada 10mm

document.addEventListener('DOMContentLoaded', () => {
    initCanvas();
    setupEventListeners();
    saveState();
});

function initCanvas() {
    canvas = new fabric.Canvas('label-canvas', {
        width: PAPER_W_MM * SCALE,
        height: PAPER_H_MM * SCALE,
        backgroundColor: '#ffffff',
        // Mejorar nitidez reduciendo pixelado en pantalla/exportaciones
        enableRetinaScaling: true,
        preserveObjectStacking: true
    });

    // Dibujar línea de corte fija por encima de todo
    canvas.on('after:render', function() {
        if (isExporting) return; // No dibujar en el PDF
        
        const ctx = canvas.getContext();
        ctx.save();

        // Dibujar Rejilla (Grid) y Medidas (mm)
        if (showGrid) {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)'; // Un poco más oscuro
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';    // Color para los números
            ctx.font = '10px Arial';
            ctx.lineWidth = 0.5;

            // Verticales y números superiores
            for (let i = 0; i <= (PAPER_W_MM * SCALE); i += gridStep) {
                ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, PAPER_H_MM * SCALE); ctx.stroke();
                // Dibujar número cada 20mm para no saturar
                if ((i / SCALE) % 20 === 0) {
                    ctx.fillText(Math.round(i / SCALE) + 'mm', i + 2, 12);
                }
            }
            // Horizontales y números laterales
            for (let i = 0; i <= (PAPER_H_MM * SCALE); i += gridStep) {
                ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(PAPER_W_MM * SCALE, i); ctx.stroke();
                if ((i / SCALE) % 20 === 0 && i > 0) {
                    ctx.fillText(Math.round(i / SCALE) + 'mm', 2, i - 2);
                }
            }
        }

        const mode = document.getElementById('label-mode').value;
        if (mode === 'double') {
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, (PAPER_H_MM / 2) * SCALE);
            ctx.lineTo(PAPER_W_MM * SCALE, (PAPER_H_MM / 2) * SCALE);
            ctx.stroke();
        }
        ctx.restore();
    });

    initSnapping();

    canvas.on('object:modified', () => saveState());
    canvas.on('object:moving', (options) => {
        updatePropertiesPanel();
        handleTableMovement(options.target);
    });
    canvas.on('object:scaling', updatePropertiesPanel);
    canvas.on('object:added', () => {
        if (!isRedoing) saveState();
    });
    canvas.on('selection:created', updatePropertiesPanel);
    canvas.on('selection:updated', updatePropertiesPanel);
    canvas.on('selection:cleared', () => {
        hidePropertiesPanel();
        lastSubTarget = null;
    });

    canvas.on('mouse:down', (options) => {
        if (options.subTarget) {
            lastSubTarget = options.subTarget;
        } else {
            lastSubTarget = options.target;
        }
    });
}

function updateSplitLine() {
    canvas.renderAll();
}


function setupEventListeners() {
    // Modo de etiqueta
    document.getElementById('label-mode').addEventListener('change', updateSplitLine);

    // Herramientas
    document.getElementById('add-text').onclick = () => {
        const text = new fabric.IText('Nuevo Texto', {
            left: 50,
            top: 50,
            fontSize: 20 * SCALE,
            fontFamily: 'Arial'
        });
        canvas.add(text);
        canvas.setActiveObject(text);
    };

    document.getElementById('add-counter').onclick = () => {
        const text = new fabric.IText('1', {
            left: 50,
            top: 50,
            fontSize: 30 * SCALE,
            fontFamily: 'Arial',
            fontWeight: 'bold',
            isCounter: true
        });
        canvas.add(text);
        canvas.setActiveObject(text);
    };

    document.getElementById('add-rect').onclick = () => {
        const rect = new fabric.Rect({
            left: 100,
            top: 100,
            fill: '#000000',
            width: 50 * SCALE,
            height: 30 * SCALE
        });
        canvas.add(rect);
        canvas.setActiveObject(rect);
    };

    document.getElementById('add-circle').onclick = () => {
        const circle = new fabric.Circle({
            left: 100,
            top: 100,
            fill: '#000000',
            radius: 25 * SCALE
        });
        canvas.add(circle);
        canvas.setActiveObject(circle);
    };

    // Formas solo con borde (sin relleno), útiles para marcos
    document.getElementById('add-rect-outline').onclick = () => {
        const rect = new fabric.Rect({
            left: 100,
            top: 100,
            width: 50 * SCALE,
            height: 30 * SCALE,
            fill: 'transparent',
            stroke: '#000000',
            strokeWidth: 1 * (SCALE / 3.78) // ~1 px visual
        });
        canvas.add(rect);
        canvas.setActiveObject(rect);
    };

    document.getElementById('add-circle-outline').onclick = () => {
        const circle = new fabric.Circle({
            left: 100,
            top: 100,
            radius: 25 * SCALE,
            fill: 'transparent',
            stroke: '#000000',
            strokeWidth: 1 * (SCALE / 3.78)
        });
        canvas.add(circle);
        canvas.setActiveObject(circle);
    };

    document.getElementById('add-line').onclick = () => {
        const line = new fabric.Line([50, 50, 150, 50], {
            left: 50,
            top: 50,
            stroke: '#000000',
            strokeWidth: 1
        });
        canvas.add(line);
        canvas.setActiveObject(line);
    };

    document.getElementById('add-table').onclick = () => {
        const rows = parseInt(prompt("Número de filas:", "3")) || 0;
        const cols = parseInt(prompt("Número de columnas:", "3")) || 0;
        if (rows > 0 && cols > 0) createTable(rows, cols);
    };

    document.getElementById('add-image').onclick = () => {
        document.getElementById('img-upload').click();
    };

    document.getElementById('add-pdf').onclick = () => {
        document.getElementById('pdf-upload').click();
    };

    document.getElementById('add-white-cover').onclick = addWhiteCover;

    document.getElementById('add-excel').onclick = () => {
        document.getElementById('excel-upload').click();
    };

    document.getElementById('img-upload').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (f) => {
            fabric.Image.fromURL(f.target.result, (img) => {
                img.scaleToWidth(100 * SCALE);
                canvas.add(img);
                canvas.setActiveObject(img);
            });
        };
        reader.readAsDataURL(file);
    };

    document.getElementById('pdf-upload').onchange = handlePDFUpload;
    document.getElementById('excel-upload').onchange = handleExcelUpload;

    // Propiedades
    const inputs = ['prop-x', 'prop-y', 'prop-w', 'prop-h', 'prop-rotate', 'prop-size', 'prop-font', 'prop-color'];
    inputs.forEach(id => {
        document.getElementById(id).oninput = applyProperties;
    });

    document.getElementById('prop-bold').onclick = () => toggleStyle('fontWeight', 'bold', 'normal');
    document.getElementById('prop-italic').onclick = () => toggleStyle('fontStyle', 'italic', 'normal');
    document.getElementById('prop-is-counter').onchange = (e) => {
        const obj = canvas.getActiveObject();
        if (obj) {
            obj.isCounter = e.target.checked;
            saveState();
        }
    };
    
    document.getElementById('btn-forward').onclick = () => {
        const obj = canvas.getActiveObject();
        if (obj) { obj.bringForward(); canvas.renderAll(); saveState(); }
    };
    document.getElementById('btn-backward').onclick = () => {
        const obj = canvas.getActiveObject();
        if (obj) { obj.sendBackwards(); canvas.renderAll(); saveState(); }
    };

    document.getElementById('btn-rot-ccw90').onclick = () => rotateSelected(-90);
    document.getElementById('btn-rot-ccw15').onclick = () => rotateSelected(-15);
    document.getElementById('btn-rot-cw15').onclick  = () => rotateSelected(15);
    document.getElementById('btn-rot-cw90').onclick  = () => rotateSelected(90);
    document.getElementById('btn-crop').onclick = startCrop;
    document.getElementById('btn-confirm-crop').onclick = confirmCrop;
    document.getElementById('btn-delete').onclick = deleteSelected;

    document.getElementById('btn-export-pdf').onclick = exportPDF;
    document.getElementById('btn-print').onclick = printLabels;

    // Lienzo
    document.getElementById('btn-clear').onclick = () => {
        if (confirm("¿Estás seguro de que quieres borrar todo el diseño?")) {
            canvas.getObjects().forEach(obj => {
                if (obj.id !== 'split-line') canvas.remove(obj);
            });
            saveState();
        }
    };

    document.getElementById('zoom-in').onclick = () => changeZoom(0.1);
    document.getElementById('zoom-out').onclick = () => changeZoom(-0.1);
    document.getElementById('show-grid').onchange = (e) => {
        showGrid = e.target.checked;
        canvas.renderAll();
    };

    // Botones de alineación
    document.getElementById('align-left').onclick = () => alignSelected('left');
    document.getElementById('align-center-h').onclick = () => alignSelected('center-h');
    document.getElementById('align-right').onclick = () => alignSelected('right');
    document.getElementById('align-top').onclick = () => alignSelected('top');
    document.getElementById('align-center-v').onclick = () => alignSelected('center-v');
    document.getElementById('align-bottom').onclick = () => alignSelected('bottom');

    // Teclas rápidas
    window.addEventListener('keydown', (e) => {
        const activeObj = canvas.getActiveObject();
        
        // Atajos de edición
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (activeObj && !activeObj.isEditing) {
                deleteSelected();
            }
        }
        if (e.ctrlKey && e.key === 'z') undo();
        if (e.ctrlKey && e.key === 'y') redo();

        // Copiar / pegar selección
        if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
            if (activeObj) {
                activeObj.clone((cloned) => {
                    clipboard = cloned;
                });
            }
        }
        if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) {
            if (clipboard) {
                clipboard.clone((clonedObj) => {
                    canvas.discardActiveObject();
                    clonedObj.set({
                        left: (clonedObj.left || 0) + 10 * SCALE,
                        top: (clonedObj.top || 0) + 10 * SCALE,
                        evented: true
                    });

                    if (clonedObj.type === 'activeSelection') {
                        // Si el portapapeles era una selección múltiple
                        clonedObj.canvas = canvas;
                        clonedObj.forEachObject((obj) => {
                            canvas.add(obj);
                        });
                        clonedObj.setCoords();
                    } else {
                        canvas.add(clonedObj);
                    }

                    canvas.setActiveObject(clonedObj);
                    canvas.requestRenderAll();
                    saveState();
                });
            }
        }

        // Escritura directa en celdas/texto (estilo Excel)
        const target = lastSubTarget || activeObj;
        const isIText = target && target.type === 'i-text';
        const isRectWithText = target && target.linkedText;

        if ((isIText || isRectWithText) && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            const targetText = isIText ? target : target.linkedText;
            
            if (!targetText.isEditing) {
                // Si está en un grupo, tenemos que gestionarlo
                if (activeObj && activeObj.type === 'group') {
                    activeObj.toActiveSelection();
                }

                canvas.setActiveObject(targetText);
                targetText.enterEditing();
                targetText.selectAll();
                // Re-enviar la tecla para que se escriba
                setTimeout(() => {
                    const event = new KeyboardEvent('keydown', { key: e.key });
                    targetText.hiddenTextarea.dispatchEvent(event);
                }, 10);
            }
        }
    });

    document.getElementById('btn-undo').onclick = undo;
    document.getElementById('btn-redo').onclick = redo;

    // Duplicar selección para etiqueta doble
    document.getElementById('btn-duplicate-double').onclick = duplicateSelectionForDouble;

    // ── Menú contextual ──────────────────────────────────────
    setupContextMenu();

    // ── Zoom con rueda del ratón (Ctrl + scroll) ─────────────
    document.getElementById('canvas-wrapper').addEventListener('wheel', (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        changeZoom(delta);
    }, { passive: false });
}

function setupContextMenu() {
    const menu = document.getElementById('ctx-menu');

    // Usamos el evento nativo sobre el contenedor para mayor fiabilidad
    canvas.upperCanvasEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Encontrar objeto bajo el puntero usando coordenadas de Fabric
        const pointer = canvas.getPointer(e);
        const target = canvas.findTarget(e, false);

        if (target && target.id !== 'split-line') {
            canvas.setActiveObject(target);
            canvas.renderAll();
            
            // Mostrar menú (primero invisible para calcular tamaño real)
            menu.style.visibility = 'hidden';
            menu.style.display = 'block';
            
            const mw = menu.offsetWidth;
            const mh = menu.offsetHeight;
            
            menu.style.visibility = 'visible';

            const x = e.clientX;
            const y = e.clientY;
            const winW = window.innerWidth;
            const winH = window.innerHeight;

            // Posicionamiento horizontal
            let left = x;
            if (x + mw > winW) {
                left = x - mw;
            }

            // Posicionamiento vertical inteligente
            let top = y;
            if (y + mh > winH) {
                // Si no cabe abajo, lo ponemos hacia arriba desde el cursor
                top = y - mh;
                // Si aún así se sale por arriba (pantalla muy pequeña), lo pegamos al borde superior
                if (top < 10) top = 10;
            }
            
            menu.style.left = left + 'px';
            menu.style.top = top + 'px';
        } else {
            hideCtxMenu();
        }
    });

    // Cerrar al hacer clic en cualquier otro sitio
    document.addEventListener('click',     () => hideCtxMenu());
    document.addEventListener('contextmenu', (e) => {
        if (!e.target.closest('#ctx-menu')) hideCtxMenu();
    });

    // ── Acciones del menú ────────────────────────────────────

    // Edición
    document.getElementById('ctx-copy').onclick = () => {
        const obj = canvas.getActiveObject();
        if (obj) obj.clone(c => { clipboard = c; });
        hideCtxMenu();
    };
    document.getElementById('ctx-paste').onclick = () => {
        if (clipboard) {
            clipboard.clone(cloned => {
                canvas.discardActiveObject();
                cloned.set({ left: (cloned.left||0) + 10*SCALE, top: (cloned.top||0) + 10*SCALE, evented: true });
                if (cloned.type === 'activeSelection') {
                    cloned.canvas = canvas;
                    cloned.forEachObject(o => canvas.add(o));
                    cloned.setCoords();
                } else { canvas.add(cloned); }
                canvas.setActiveObject(cloned);
                canvas.requestRenderAll();
                saveState();
            });
        }
        hideCtxMenu();
    };
    document.getElementById('ctx-dup').onclick = () => {
        const obj = canvas.getActiveObject();
        if (obj) obj.clone(c => {
            c.set({ left: (c.left||0) + 10*SCALE, top: (c.top||0) + 10*SCALE });
            canvas.add(c); canvas.setActiveObject(c); canvas.renderAll(); saveState();
        });
        hideCtxMenu();
    };

    // Rotación
    document.getElementById('ctx-r-ccw90').onclick = () => { rotateSelected(-90); hideCtxMenu(); };
    document.getElementById('ctx-r-cw90').onclick  = () => { rotateSelected(90);  hideCtxMenu(); };

    // Voltear
    document.getElementById('ctx-flip-h').onclick = () => {
        const obj = canvas.getActiveObject();
        if (obj) { obj.set('flipX', !obj.flipX); canvas.renderAll(); saveState(); }
        hideCtxMenu();
    };
    document.getElementById('ctx-flip-v').onclick = () => {
        const obj = canvas.getActiveObject();
        if (obj) { obj.set('flipY', !obj.flipY); canvas.renderAll(); saveState(); }
        hideCtxMenu();
    };

    // Capas
    document.getElementById('ctx-front').onclick   = () => { const o = canvas.getActiveObject(); if(o){ o.bringToFront();  canvas.renderAll(); saveState(); } hideCtxMenu(); };
    document.getElementById('ctx-forward').onclick  = () => { const o = canvas.getActiveObject(); if(o){ o.bringForward(); canvas.renderAll(); saveState(); } hideCtxMenu(); };
    document.getElementById('ctx-backward').onclick = () => { const o = canvas.getActiveObject(); if(o){ o.sendBackwards();canvas.renderAll(); saveState(); } hideCtxMenu(); };
    document.getElementById('ctx-back').onclick     = () => { const o = canvas.getActiveObject(); if(o){ o.sendToBack();   canvas.renderAll(); saveState(); } hideCtxMenu(); };

    // Eliminar
    document.getElementById('ctx-delete').onclick = () => { deleteSelected(); hideCtxMenu(); };
}

function hideCtxMenu() {
    document.getElementById('ctx-menu').style.display = 'none';
}


function updatePropertiesPanel() {
    const obj = canvas.getActiveObject();
    if (!obj || obj.id === 'split-line') return;

    document.getElementById('no-selection').style.display = 'none';
    document.getElementById('prop-controls').style.display = 'block';

    document.getElementById('prop-x').value = (obj.left / SCALE).toFixed(1);
    document.getElementById('prop-y').value = (obj.top / SCALE).toFixed(1);
    document.getElementById('prop-w').value = (obj.getScaledWidth() / SCALE).toFixed(1);
    document.getElementById('prop-h').value = (obj.getScaledHeight() / SCALE).toFixed(1);
    document.getElementById('prop-rotate').value = Math.round(obj.angle || 0);
    document.getElementById('prop-color').value = obj.fill || '#000000';

    if (obj.type === 'image') {
        document.getElementById('btn-crop').style.display = 'block';
    } else {
        document.getElementById('btn-crop').style.display = 'none';
    }

    if (obj.type === 'i-text') {
        document.getElementById('text-props').style.display = 'block';
        document.getElementById('prop-font').value = obj.fontFamily;
        // Mostrar tamaño visual (base * escala)
        const visualSize = obj.fontSize * (obj.scaleX || 1);
        document.getElementById('prop-size').value = (visualSize / SCALE).toFixed(1);
        document.getElementById('prop-is-counter').checked = !!obj.isCounter;
    } else {
        document.getElementById('text-props').style.display = 'none';
    }
}

function hidePropertiesPanel() {
    document.getElementById('no-selection').style.display = 'block';
    document.getElementById('prop-controls').style.display = 'none';
    document.getElementById('btn-crop').style.display = 'none';
    document.getElementById('btn-confirm-crop').style.display = 'none';
}


function applyProperties() {
    const obj = canvas.getActiveObject();
    if (!obj) return;

    obj.set({
        left: parseFloat(document.getElementById('prop-x').value) * SCALE,
        top: parseFloat(document.getElementById('prop-y').value) * SCALE,
        angle: parseFloat(document.getElementById('prop-rotate').value) || 0,
        fill: document.getElementById('prop-color').value
    });

    if (obj.type === 'i-text') {
        obj.set({
            fontFamily: document.getElementById('prop-font').value,
            fontSize: parseFloat(document.getElementById('prop-size').value) * SCALE,
            scaleX: 1,
            scaleY: 1
        });
    } else {
        // Redimensionar formas e imágenes
        const newW = parseFloat(document.getElementById('prop-w').value) * SCALE;
        const newH = parseFloat(document.getElementById('prop-h').value) * SCALE;
        obj.scaleToWidth(newW);
        obj.scaleToHeight(newH);
    }

    obj.setCoords();
    canvas.renderAll();
    saveState();
}

function toggleStyle(prop, val1, val2) {
    const obj = canvas.getActiveObject();
    if (!obj || obj.type !== 'i-text') return;
    obj.set(prop, obj[prop] === val1 ? val2 : val1);
    canvas.renderAll();
    saveState();
}

function rotateSelected(delta) {
    const obj = canvas.getActiveObject();
    if (!obj) return;
    const newAngle = ((obj.angle || 0) + delta + 360) % 360;
    obj.rotate(newAngle);
    obj.setCoords();
    canvas.renderAll();
    document.getElementById('prop-rotate').value = Math.round(newAngle);
    saveState();
}

function deleteSelected() {
    const activeObjects = canvas.getActiveObjects();
    canvas.discardActiveObject();
    activeObjects.forEach(obj => {
        if (obj.id !== 'split-line') canvas.remove(obj);
    });
    saveState();
}

// Historial
function saveState() {
    if (isRedoing) return;
    const json = JSON.stringify(canvas.toObject(['id', 'selectable', 'evented']));
    if (undoStack.length > 0 && undoStack[undoStack.length - 1] === json) return;
    undoStack.push(json);
    if (undoStack.length > 20) undoStack.shift();
    redoStack = [];
}

function undo() {
    if (undoStack.length <= 1) return;
    redoStack.push(undoStack.pop());
    const state = undoStack[undoStack.length - 1];
    isRedoing = true;
    canvas.loadFromJSON(state, () => {
        canvas.renderAll();
        isRedoing = false;
    });
}

function redo() {
    if (redoStack.length === 0) return;
    const state = redoStack.pop();
    undoStack.push(state);
    isRedoing = true;
    canvas.loadFromJSON(state, () => {
        canvas.renderAll();
        isRedoing = false;
    });
}

// Duplica la selección actual en la mitad inferior cuando el modo es "double"
function duplicateSelectionForDouble() {
    const mode = document.getElementById('label-mode').value;
    if (mode !== 'double') {
        alert('La duplicación automática solo aplica en modo "Etiqueta Doble".');
        return;
    }

    const activeObjects = canvas.getActiveObjects();
    if (!activeObjects || activeObjects.length === 0) {
        alert('Selecciona primero el texto o los elementos que quieras duplicar.');
        return;
    }

    // Desplazamiento a la mitad inferior + pequeño margen para no quedar pegado a la línea roja
    const offsetY = (PAPER_H_MM / 2) * SCALE + 5 * SCALE;

    // Clonar cada objeto seleccionado y moverlo exactamente a la segunda etiqueta
    const clones = [];
    activeObjects.forEach(obj => {
        obj.clone(clone => {
            clone.set({
                left: obj.left,
                top: obj.top + offsetY
            });
            clones.push(clone);
            canvas.add(clone);
            canvas.renderAll();
            saveState();
        });
    });
}

async function exportPDF() {
    const qtyInput = document.getElementById('print-qty');
    const qty = parseInt(qtyInput.value) || 1;
    const mode = document.getElementById('label-mode').value;
    const overlay = document.getElementById('loading-overlay');
    const progressText = document.getElementById('progress-text');
    
    overlay.style.display = 'flex';
    progressText.innerText = 'Iniciando...';
    isExporting = true;

    try {
        if (!window.jspdf || !window.jspdf.jsPDF) {
            throw new Error("Librería jsPDF no cargada correctamente.");
        }
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: [PAPER_W_MM, PAPER_H_MM],
            compress: true
        });

        const step = (mode === 'double') ? 2 : 1;

        for (let i = 1; i <= qty; i += step) {
            if (i > 1) pdf.addPage();

            // Actualizar numeración
            canvas.getObjects().forEach(obj => {
                if (obj.isCounter) {
                    if (mode === 'single') {
                        obj.text = i.toString();
                    } else {
                        const isTop = obj.top < (PAPER_H_MM / 2) * SCALE;
                        if (isTop) {
                            obj.text = i.toString();
                        } else {
                            if (i + 1 <= qty) {
                                obj.text = (i + 1).toString();
                                obj.visible = true;
                            } else {
                                obj.text = "";
                                obj.visible = false;
                            }
                        }
                    }
                }
            });

            canvas.renderAll();

            // Pequeña espera para que el navegador respire
            await new Promise(resolve => setTimeout(resolve, 60));

            const dataUrl = canvas.toDataURL({
                // PNG evita artefactos de compresión JPEG y mejora nitidez
                format: 'png',
                multiplier: 2.0
            });

            pdf.addImage(dataUrl, 'PNG', 0, 0, PAPER_W_MM, PAPER_H_MM, '', 'FAST');
            
            const percent = Math.round((i / qty) * 100);
            progressText.innerText = `Procesando: ${percent}%`;
        }

        progressText.innerText = 'Guardando PDF...';
        pdf.save(`etiquetas-citizen-${qty}.pdf`);
    } catch (err) {
        console.error("Error en exportPDF:", err);
        alert("Hubo un error al generar el PDF. Por favor, revisa la consola.");
    } finally {
        isExporting = false;
        canvas.renderAll();
        setTimeout(() => { overlay.style.display = 'none'; }, 500);
    }
}

async function printLabels() {
    const qty = parseInt(document.getElementById('print-qty').value) || 1;
    const mode = document.getElementById('label-mode').value;
    const overlay = document.getElementById('loading-overlay');
    const progressText = document.getElementById('progress-text');

    overlay.style.display = 'flex';
    progressText.innerText = 'Preparando impresión...';
    isExporting = true;

    try {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert("El navegador bloqueó la ventana de impresión. Por favor, permite las ventanas emergentes (pop-ups) para este sitio.");
            return;
        }
        printWindow.document.write(`
            <html>
            <head>
                <title>Imprimir Etiquetas Citizen</title>
                <style>
                    @page { 
                        size: 210mm 170mm; 
                        margin: 0; 
                    }
                    body { margin: 0; padding: 0; }
                    img { 
                        display: block; 
                        width: 210mm; 
                        height: 170mm; 
                        page-break-after: always; 
                    }
                </style>
            </head>
            <body></body>
            </html>
        `);
        printWindow.document.close();

        const step = (mode === 'double') ? 2 : 1;

        for (let i = 1; i <= qty; i += step) {
            // Actualizar numeración
            canvas.getObjects().forEach(obj => {
                if (obj.isCounter) {
                    if (mode === 'single') {
                        obj.text = i.toString();
                    } else {
                        const isTop = obj.top < (PAPER_H_MM / 2) * SCALE;
                        if (isTop) {
                            obj.text = i.toString();
                        } else {
                            if (i + 1 <= qty) {
                                obj.text = (i + 1).toString();
                                obj.visible = true;
                            } else {
                                obj.text = "";
                                obj.visible = false;
                            }
                        }
                    }
                }
            });

            canvas.renderAll();
            await new Promise(resolve => setTimeout(resolve, 60));

            const dataUrl = canvas.toDataURL({
                // PNG para mantener bordes y texto más nítidos al imprimir
                format: 'png',
                multiplier: 2.0
            });

            const img = printWindow.document.createElement('img');
            img.src = dataUrl;
            printWindow.document.body.appendChild(img);

            const percent = Math.round((i / qty) * 100);
            progressText.innerText = `Preparando: ${percent}%`;
        }

        progressText.innerText = 'Abriendo diálogo de impresión...';
        
        // Esperar a que las imágenes carguen en la nueva ventana
        setTimeout(() => {
            printWindow.print();
            // printWindow.close(); // Comentado para que el usuario pueda re-imprimir si quiere
        }, 500);

    } catch (err) {
        console.error(err);
        alert("Error al imprimir");
    } finally {
        isExporting = false;
        canvas.renderAll();
        overlay.style.display = 'none';
    }
}



async function handlePDFUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const overlay = document.getElementById('loading-overlay');
    const progressText = document.getElementById('progress-text');
    overlay.style.display = 'flex';
    progressText.innerText = 'Cargando PDF...';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const typedarray = new Uint8Array(arrayBuffer);
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        const page = await pdf.getPage(1);

        const canvasWidth = PAPER_W_MM * SCALE;
        const canvasHeight = PAPER_H_MM * SCALE;

        // Calcular escala para que el PDF encaje exactamente en el lienzo
        const pdfViewport0 = page.getViewport({ scale: 1 });
        const scaleToFit = Math.min(
            canvasWidth / pdfViewport0.width,
            canvasHeight / pdfViewport0.height
        );

        // Renderizar a 4× resolución para texto nítido (supersample)
        const RENDER_SCALE = 4;
        const viewport = page.getViewport({ scale: scaleToFit * RENDER_SCALE });

        progressText.innerText = 'Renderizando PDF (alta resolución)...';

        // Renderizar la página en un canvas temporal off-screen a alta res
        const offCanvas = document.createElement('canvas');
        offCanvas.width = Math.round(viewport.width);
        offCanvas.height = Math.round(viewport.height);
        const ctx = offCanvas.getContext('2d');

        await page.render({
            canvasContext: ctx,
            viewport: viewport
        }).promise;

        // Convertir a dataURL y añadir como imagen Fabric
        const dataUrl = offCanvas.toDataURL('image/png');

        fabric.Image.fromURL(dataUrl, (img) => {
            img.set({
                left: 0,
                top: 0,
                selectable: true,
                evented: true,
                hasControls: true,
                hasBorders: true,
                // Permite escalar ancho y alto de forma independiente
                lockUniScaling: false
            });
            // Ajustar al lienzo manteniendo la imagen visible completa
            img.scaleToWidth(canvasWidth);
            canvas.add(img);
            // Seleccionar la imagen para poder redimensionarla inmediatamente
            canvas.setActiveObject(img);
            updateSplitLine();
            saveState();
            overlay.style.display = 'none';
        });
    } catch (err) {
        console.error(err);
        alert("Error al cargar el PDF");
        overlay.style.display = 'none';
    }
}

// Añade un rectángulo blanco opaco para tapar zonas del diseño
function addWhiteCover() {
    const rect = new fabric.Rect({
        left: 80 * SCALE,
        top: 60 * SCALE,
        width: 60 * SCALE,
        height: 20 * SCALE,
        fill: '#ffffff',
        stroke: null,      // Sin borde para que sea invisible al imprimir
        strokeWidth: 0,
        opacity: 1
    });
    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
    saveState();
}

// Intenta aproximar la fuente del PDF usando el nombre que devuelve pdf.js.
// Esto suele mejorar el aspecto del texto importado (menos diferencia por fuente distinta).
function resolveFontFromPdfJs(fontName) {
    if (!fontName) {
        return { fontFamily: 'Times New Roman', fontStyle: 'normal', fontWeight: 'normal' };
    }

    const n = String(fontName).toLowerCase();

    let fontFamily = 'Times New Roman';
    if (n.includes('courier')) fontFamily = 'Courier New';
    else if (n.includes('verdana')) fontFamily = 'Verdana';
    else if (n.includes('arial') || n.includes('helvetica') || n.includes('sans')) fontFamily = 'Arial';
    else if (n.includes('times')) fontFamily = 'Times New Roman';

    const fontStyle = /italic|oblique/i.test(n) ? 'italic' : 'normal';
    const fontWeight = /bold/i.test(n) ? 'bold' : 'normal';

    return { fontFamily, fontStyle, fontWeight };
}

async function handleExcelUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const overlay = document.getElementById('loading-overlay');
    const progressText = document.getElementById('progress-text');
    overlay.style.display = 'flex';
    progressText.innerText = 'Leyendo Excel...';

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, {type: 'array'});
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            
            // Convertimos a JSON (array de arrays)
            excelData = XLSX.utils.sheet_to_json(worksheet, {header: 1});
            
            if (!excelData || excelData.length === 0) {
                alert("El Excel parece estar vacío");
                overlay.style.display = 'none';
                return;
            }

            const importAsTable = confirm(`Se han cargado ${excelData.length} filas.\n\n¿Quieres importar las primeras filas como una TABLA en el diseño?\n(Cancela si prefieres usarlos para Automatización/Mail Merge)`);

            if (importAsTable) {
                progressText.innerText = 'Creando tabla...';
                
                // Optimizamos Fabric para inserción masiva
                canvas.renderOnAddRemove = false;

                let startX = 20 * SCALE;
                let startY = 20 * SCALE;
                const rowHeight = 10 * SCALE;
                const colWidth = 40 * SCALE;

                // Limitamos a 50 filas para la tabla visual para evitar bloqueos
                const rowsToProcess = excelData.slice(0, 50);

                rowsToProcess.forEach((row, rowIndex) => {
                    row.forEach((cell, colIndex) => {
                        if (cell !== undefined && cell !== null && cell !== "") {
                            const text = new fabric.IText(cell.toString(), {
                                left: startX + (colIndex * colWidth),
                                top: startY + (rowIndex * rowHeight),
                                fontSize: 10 * SCALE,
                                fontFamily: 'Arial'
                            });
                            canvas.add(text);
                        }
                    });
                });

                canvas.renderOnAddRemove = true;
                canvas.requestRenderAll();
                saveState();
                alert("Tabla creada. Se han limitado los datos a las primeras 50 filas para mantener el rendimiento.");
            } else {
                alert("Excel cargado correctamente para Automatización. Ahora puedes vincular campos a tus textos.");
            }
        } catch (err) {
            console.error(err);
            alert("Error al procesar el archivo Excel");
        } finally {
            overlay.style.display = 'none';
        }
    };
    reader.readAsArrayBuffer(file);
}

let cropRect;
let imageToCrop;

function startCrop() {
    imageToCrop = canvas.getActiveObject();
    if (!imageToCrop || imageToCrop.type !== 'image') {
        alert("Selecciona una imagen o PDF primero");
        return;
    }

    document.getElementById('btn-crop').style.display = 'none';
    document.getElementById('btn-confirm-crop').style.display = 'block';

    canvas.getObjects().forEach(obj => obj.selectable = false);

    cropRect = new fabric.Rect({
        fill: 'rgba(255,255,255,0.3)',
        stroke: '#3b82f6',
        strokeWidth: 2,
        strokeDashArray: [5, 5],
        width: imageToCrop.getScaledWidth() / 2,
        height: imageToCrop.getScaledHeight() / 2,
        left: imageToCrop.left,
        top: imageToCrop.top,
        cornerColor: '#3b82f6',
        cornerSize: 8,
        hasRotatingPoint: false
    });

    canvas.add(cropRect);
    canvas.setActiveObject(cropRect);
    canvas.renderAll();
}

function confirmCrop() {
    if (!cropRect || !imageToCrop) return;

    // Usar un clipPath absoluto en coordenadas de lienzo para que funcione
    // correctamente con imágenes de origen 'left/top' como las del PDF.
    const clipPath = new fabric.Rect({
        left: cropRect.left,
        top: cropRect.top,
        width: cropRect.getScaledWidth(),
        height: cropRect.getScaledHeight(),
        absolutePositioned: true
    });

    imageToCrop.clipPath = clipPath;

    canvas.remove(cropRect);
    canvas.getObjects().forEach(obj => obj.selectable = true);
    canvas.setActiveObject(imageToCrop);
    
    document.getElementById('btn-confirm-crop').style.display = 'none';
    document.getElementById('btn-crop').style.display = 'block';
    
    canvas.renderAll();
    saveState();
}

function changeZoom(delta) {
    let zoom = canvas.getZoom();
    zoom = zoom + delta;
    if (zoom > 5) zoom = 5;
    if (zoom < 0.1) zoom = 0.1;
    canvas.setZoom(zoom);
    document.getElementById('zoom-level').innerText = Math.round(zoom * 100) + '%';
}

function createTable(rows, cols) {
    const startX = 50 * SCALE;
    const startY = 50 * SCALE;
    const cellW = 40 * SCALE;
    const cellH = 10 * SCALE;

    const tableId = 'table_' + Date.now();

    // Líneas horizontales
    for (let i = 0; i <= rows; i++) {
        const line = new fabric.Line([0, 0, cols * cellW, 0], {
            left: startX,
            top: startY + (i * cellH),
            stroke: '#000000',
            strokeWidth: 1,
            tableId: tableId,
            role: 'row-border',
            rowIdx: i,
            hasControls: false // Solo permitir mover, no escalar líneas individuales
        });
        canvas.add(line);
    }

    // Líneas verticales
    for (let j = 0; j <= cols; j++) {
        const line = new fabric.Line([0, 0, 0, rows * cellH], {
            left: startX + (j * cellW),
            top: startY,
            stroke: '#000000',
            strokeWidth: 1,
            tableId: tableId,
            role: 'col-border',
            colIdx: j,
            hasControls: false
        });
        canvas.add(line);
    }

    // Celdas de texto
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            const text = new fabric.IText('...', {
                left: startX + (j * cellW) + (cellW / 2),
                top: startY + (i * cellH) + (cellH / 2),
                fontSize: 6 * SCALE,
                originX: 'center',
                originY: 'center',
                fontFamily: 'Arial',
                textAlign: 'center',
                tableId: tableId,
                role: 'cell-text',
                rowIdx: i,
                colIdx: j
            });
            canvas.add(text);
        }
    }

    canvas.renderAll();
    saveState();
}

// Lógica para que el texto siga a las líneas y las líneas no se escapen
function handleTableMovement(obj) {
    if (!obj.tableId) return;

    const tableParts = canvas.getObjects().filter(o => o.tableId === obj.tableId);
    
    if (obj.role === 'row-border') {
        const rowIdx = obj.rowIdx;
        // Encontrar líneas anterior y posterior para limitar movimiento
        const prevLine = tableParts.find(o => o.role === 'row-border' && o.rowIdx === rowIdx - 1);
        const nextLine = tableParts.find(o => o.role === 'row-border' && o.rowIdx === rowIdx + 1);

        if (prevLine && obj.top <= prevLine.top + 5) obj.top = prevLine.top + 5;
        if (nextLine && obj.top >= nextLine.top - 5) obj.top = nextLine.top - 5;

        // Reposicionar textos de las filas adyacentes
        const textsAbove = tableParts.filter(o => o.role === 'cell-text' && o.rowIdx === rowIdx - 1);
        const textsBelow = tableParts.filter(o => o.role === 'cell-text' && o.rowIdx === rowIdx);

        textsAbove.forEach(t => {
            const lineAbove = tableParts.find(o => o.role === 'row-border' && o.rowIdx === rowIdx - 1);
            if (lineAbove) t.set({ top: (lineAbove.top + obj.top) / 2 });
            t.setCoords();
        });
        textsBelow.forEach(t => {
            const lineBelow = tableParts.find(o => o.role === 'row-border' && o.rowIdx === rowIdx + 1);
            if (lineBelow) t.set({ top: (obj.top + lineBelow.top) / 2 });
            t.setCoords();
        });

        // Ajustar altura de las líneas verticales
        const firstRow = tableParts.find(o => o.role === 'row-border' && o.rowIdx === 0);
        const lastRow = tableParts.find(o => o.role === 'row-border' && o.role === 'row-border' && o.rowIdx === Math.max(...tableParts.filter(x=>x.role==='row-border').map(x=>x.rowIdx)));
        // (Simplificado: las verticales suelen quedarse igual si solo movemos filas interiores)
    }

    if (obj.role === 'col-border') {
        const colIdx = obj.colIdx;
        const prevLine = tableParts.find(o => o.role === 'col-border' && o.colIdx === colIdx - 1);
        const nextLine = tableParts.find(o => o.role === 'col-border' && o.colIdx === colIdx + 1);

        if (prevLine && obj.left <= prevLine.left + 5) obj.left = prevLine.left + 5;
        if (nextLine && obj.left >= nextLine.left - 5) obj.left = nextLine.left - 5;

        const textsLeft = tableParts.filter(o => o.role === 'cell-text' && o.colIdx === colIdx - 1);
        const textsRight = tableParts.filter(o => o.role === 'cell-text' && o.colIdx === colIdx);

        textsLeft.forEach(t => {
            const lineLeft = tableParts.find(o => o.role === 'col-border' && o.colIdx === colIdx - 1);
            if (lineLeft) t.set({ left: (lineLeft.left + obj.left) / 2 });
            t.setCoords();
        });
        textsRight.forEach(t => {
            const lineRight = tableParts.find(o => o.role === 'col-border' && o.colIdx === colIdx + 1);
            if (lineRight) t.set({ left: (obj.left + lineRight.left) / 2 });
            t.setCoords();
        });
    }
}

function alignSelected(type) {
    const obj = canvas.getActiveObject();
    if (!obj) return;

    const canvasWidth = PAPER_W_MM * SCALE;
    const canvasHeight = PAPER_H_MM * SCALE;

    switch (type) {
        case 'left':     obj.set({ left: 0 }); break;
        case 'center-h': obj.centerH(); break;
        case 'right':    obj.set({ left: canvasWidth - obj.getScaledWidth() }); break;
        case 'top':      obj.set({ top: 0 }); break;
        case 'center-v': obj.centerV(); break;
        case 'bottom':   obj.set({ top: canvasHeight - obj.getScaledHeight() }); break;
    }

    obj.setCoords();
    canvas.renderAll();
    saveState();
    updatePropertiesPanel();
}

function initSnapping() {
    const snappingDistance = 10;
    
    canvas.on('object:moving', function(e) {
        const obj = e.target;
        const canvasWidth = PAPER_W_MM * SCALE;
        const canvasHeight = PAPER_H_MM * SCALE;
        const centerX = canvasWidth / 2;
        const centerY = canvasHeight / 2;

        // Snapping Horizontal (Centro)
        if (Math.abs(obj.left + obj.getScaledWidth() / 2 - centerX) < snappingDistance) {
            obj.set({ left: centerX - obj.getScaledWidth() / 2 });
        }
        // Snapping Horizontal (Bordes)
        if (Math.abs(obj.left) < snappingDistance) obj.set({ left: 0 });
        if (Math.abs(obj.left + obj.getScaledWidth() - canvasWidth) < snappingDistance) {
            obj.set({ left: canvasWidth - obj.getScaledWidth() });
        }

        // Snapping Vertical (Centro)
        if (Math.abs(obj.top + obj.getScaledHeight() / 2 - centerY) < snappingDistance) {
            obj.set({ top: centerY - obj.getScaledHeight() / 2 });
        }
        // Snapping Vertical (Bordes)
        if (Math.abs(obj.top) < snappingDistance) obj.set({ top: 0 });
        if (Math.abs(obj.top + obj.getScaledHeight() - canvasHeight) < snappingDistance) {
            obj.set({ top: canvasHeight - obj.getScaledHeight() });
        }
    });
}





