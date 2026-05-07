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
        const mode = document.getElementById('label-mode').value;
        if (mode === 'double') {
            const ctx = canvas.getContext();
            ctx.save();
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, (PAPER_H_MM / 2) * SCALE);
            ctx.lineTo(PAPER_W_MM * SCALE, (PAPER_H_MM / 2) * SCALE);
            ctx.stroke();
            ctx.restore();
        }
    });

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
        const reader = new FileReader();
        reader.onload = async function() {
            const typedarray = new Uint8Array(this.result);
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            
            const pdf = await pdfjsLib.getDocument(typedarray).promise;
            const page = await pdf.getPage(1);
           
            // Intentar extraer texto real del PDF y dibujarlo como objetos editables
            const viewport = page.getViewport({ scale: 2 });
            const textContent = await page.getTextContent();
            const canvasWidth = PAPER_W_MM * SCALE;
            const canvasHeight = PAPER_H_MM * SCALE;
            const pdfWidth = viewport.viewBox[2];
            const pdfHeight = viewport.viewBox[3];

            const scaleX = canvasWidth / pdfWidth;
            const scaleY = canvasHeight / pdfHeight;

            textContent.items.forEach(item => {
                const tx = item.transform; // [scaleX, skewY, skewX, scaleY, x, y]
                const fontSizePdf = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
                
                // Convertir coordenadas PDF a Canvas (manteniendo proporciones)
                const x = tx[4] * scaleX;
                const y = canvasHeight - (tx[5] * scaleY);

                const visualFontSize = fontSizePdf * scaleY;

                const resolvedFont = resolveFontFromPdfJs(item.fontName);
                const text = new fabric.IText(item.str, {
                    left: x,
                    top: y - visualFontSize, // ajustar baseline
                    fontSize: visualFontSize,
                    fontFamily: resolvedFont.fontFamily,
                    fontStyle: resolvedFont.fontStyle,
                    fontWeight: resolvedFont.fontWeight,
                    fill: '#000000'
                });

                // Versión estable: solo texto editable, sin rectángulo automático
                canvas.add(text);
            });

            updateSplitLine();
            saveState();
            overlay.style.display = 'none';
        };
        reader.readAsArrayBuffer(file);
    } catch (err) {
        console.error(err);
        alert("Error al cargar el PDF");
        overlay.style.display = 'none';
    }
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

    const reader = new FileReader();
    reader.onload = function(evt) {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, {type: 'array'});
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {header: 1});

        // Crear tabla en el canvas
        let startX = 20 * SCALE;
        let startY = 20 * SCALE;
        const rowHeight = 10 * SCALE;
        const colWidth = 40 * SCALE;

        jsonData.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
                if (cell !== undefined && cell !== null && cell !== "") {
                    const text = new fabric.IText(cell.toString(), {
                        left: startX + (colIndex * colWidth),
                        top: startY + (rowIndex * rowHeight),
                        fontSize: 12 * SCALE,
                        fontFamily: 'Arial'
                    });
                    canvas.add(text);
                }
            });
        });
        canvas.renderAll();
        saveState();
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




