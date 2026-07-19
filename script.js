/* =========================================================
   PDF TO BOOKLET CONVERTER — Core Logic
   ========================================================= */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const state = {
  pdfDoc: null,
  pdfBytes: null,
  pageCount: 0,
  fileName: '',
  fileSize: 0,
  bookletOrder: [], // array of [leftPageNum, rightPageNum] (1-indexed, 0 = blank)
  currentSheet: 0,
  zoom: 1,
  generatedPdfBytes: null,
  settings: {}
};

/* ---------- Theme ---------- */
const themeToggle = document.getElementById('themeToggle');
const bgStates = ['bright', 'dim', 'yellow', 'dark'];
let currentBgIndex = bgStates.indexOf(localStorage.getItem('theme'));
if (currentBgIndex === -1) currentBgIndex = 0;

function setTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('theme', t);
  
  if (t === 'bright') {
    themeToggle.innerHTML = '☀️ Bright';
    themeToggle.style.width = 'auto'; themeToggle.style.padding = '0 12px'; themeToggle.style.fontSize = '14px'; themeToggle.style.fontWeight = '600';
  } else if (t === 'dim') {
    themeToggle.innerHTML = '🌙 Dim';
    themeToggle.style.width = 'auto'; themeToggle.style.padding = '0 12px'; themeToggle.style.fontSize = '14px'; themeToggle.style.fontWeight = '600';
  } else if (t === 'yellow') {
    themeToggle.innerHTML = '📙 Yellow';
    themeToggle.style.width = 'auto'; themeToggle.style.padding = '0 12px'; themeToggle.style.fontSize = '14px'; themeToggle.style.fontWeight = '600';
  } else if (t === 'dark') {
    themeToggle.innerHTML = '🌌 Dark';
    themeToggle.style.width = 'auto'; themeToggle.style.padding = '0 12px'; themeToggle.style.fontSize = '14px'; themeToggle.style.fontWeight = '600';
  }
}
setTheme(bgStates[currentBgIndex]);
themeToggle.addEventListener('click', () => {
  currentBgIndex = (currentBgIndex + 1) % bgStates.length;
  setTheme(bgStates[currentBgIndex]);
});

/* ---------- Toast ---------- */
function toast(msg, type='info'){
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = `<span>${msg}</span>`;
  document.getElementById('toastWrap').appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transform='translateX(100%)';el.style.transition='all .3s';setTimeout(()=>el.remove(),300)},3500);
}

/* ---------- Mobile Drawers ---------- */
const leftSb = document.getElementById('leftSidebar');
const rightSb = document.getElementById('rightSidebar');
const overlay = document.getElementById('drawerOverlay');
function openDrawer(which){
  if(which==='left') leftSb.classList.add('open'); else rightSb.classList.add('open');
  overlay.classList.add('show');
}
function closeDrawers(){ leftSb.classList.remove('open'); rightSb.classList.remove('open'); overlay.classList.remove('show'); }
document.getElementById('menuLeft').addEventListener('click', ()=>openDrawer('left'));
document.getElementById('menuRight').addEventListener('click', ()=>openDrawer('right'));
overlay.addEventListener('click', closeDrawers);

/* ---------- Collapsible ---------- */
document.querySelectorAll('.collapsible-header').forEach(h=>{
  h.addEventListener('click', ()=>{
    h.classList.toggle('open');
    const body = document.getElementById(h.dataset.target);
    body.classList.toggle('open');
  });
});

/* ---------- Slider live values ---------- */
function bindSlider(id, valId, suffix=''){
  const s = document.getElementById(id), v = document.getElementById(valId);
  const upd = ()=> v.textContent = s.value + suffix;
  s.addEventListener('input', upd); upd();
}
bindSlider('numMargin','numMarginVal',' pt');
bindSlider('numSize','numSizeVal',' pt');
bindSlider('pageGap','pageGapVal',' pt');
bindSlider('outerMargin','outerMarginVal',' pt');
bindSlider('innerMargin','innerMarginVal',' pt');
bindSlider('topMargin','topMarginVal',' pt');
bindSlider('bottomMargin','bottomMarginVal',' pt');
bindSlider('scale','scaleVal','%');
bindSlider('zoom','zoomVal','%');
bindSlider('pdfDarkness','pdfDarknessVal','%');

document.getElementById('numColor').addEventListener('input', e=>{
  document.getElementById('numColorText').value = e.target.value;
});
document.getElementById('numColorText').addEventListener('input', e=>{
  if(/^#[0-9a-f]{6}$/i.test(e.target.value)) {
    document.getElementById('numColor').value = e.target.value;
    if(state.pdfDoc) renderCurrentSheet();
  }
});

/* Toggle buttons */
document.querySelectorAll('.toggle-btn').forEach(b=>{
  b.addEventListener('click', ()=>b.classList.toggle('active'));
});

/* Paper size custom fields */
document.getElementById('paperSize').addEventListener('change', e=>{
  document.getElementById('customSizeFields').style.display = e.target.value==='custom' ? 'block' : 'none';
});

/* Formula editor */
document.getElementById('useCustomFormula').addEventListener('change', e=>{
  document.getElementById('formulaFields').style.display = e.target.checked ? 'block' : 'none';
});
document.getElementById('validateFormula').addEventListener('click', ()=>{
  const fields = ['f1L','f1R','fEvenL','fEvenR','fOddL','fOddR'];
  const tokens = new Set(['start','last','blank']);
  const re = /^(start|last|blank)([+-]\d+)?$/;
  let ok = true;
  fields.forEach(f=>{
    const v = document.getElementById(f).value.trim();
    if(!re.test(v)){ ok=false; }
  });
  if(ok) toast('Formula is valid ✓','success');
  else toast('Invalid formula. Use: start, last, blank, start+1, last-2','error');
});

/* ---------- Upload ---------- */
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
dropZone.addEventListener('click', ()=>fileInput.click());
dropZone.addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' ') fileInput.click(); });
dropZone.addEventListener('dragover', e=>{e.preventDefault();dropZone.classList.add('drag');});
dropZone.addEventListener('dragleave', ()=>dropZone.classList.remove('drag'));
dropZone.addEventListener('drop', e=>{
  e.preventDefault(); dropZone.classList.remove('drag');
  if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); });

document.getElementById('changeFile').addEventListener('click', ()=>fileInput.click());
document.getElementById('clearFile').addEventListener('click', resetAll);

async function handleFile(file){
  if(file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')){
    toast('Please select a PDF file','error'); return;
  }
  if(file.size > 200 * 1024 * 1024){ toast('File too large (max 200 MB)','error'); return; }

  showProgress('Reading PDF...', 10);
  try{
    const buf = await file.arrayBuffer();
    state.pdfBytes = new Uint8Array(buf);
    state.pdfDoc = await pdfjsLib.getDocument({data: state.pdfBytes.slice()}).promise;
    state.pageCount = state.pdfDoc.numPages;
    state.fileName = file.name;
    state.fileSize = file.size;

    // Validate not encrypted
    try{ await state.pdfDoc.getPage(1); }
    catch(err){
      if(err && err.message && /password/i.test(err.message)){
        toast('Password-protected PDFs are not supported','error');
        resetAll(); return;
      }
    }

    // Build booklet order
    state.bookletOrder = computeBookletOrder(state.pageCount);

    // Show file info
    document.getElementById('fName').textContent = file.name;
    document.getElementById('fPages').textContent = state.pageCount + (state.pageCount%4 ? ` (+${4-state.pageCount%4} blank)` : '');
    document.getElementById('fSize').textContent = formatSize(file.size);
    document.getElementById('fSheets').textContent = state.bookletOrder.length;
    document.getElementById('fileInfo').classList.add('show');

    document.getElementById('generateBtn').disabled = false;
    state.currentSheet = 0;
    await buildThumbnails();
    await renderCurrentSheet();
    showProgress('Ready', 100);
    setTimeout(()=>hideProgress(), 600);
    toast(`Loaded ${state.pageCount} pages • ${state.bookletOrder.length} sheets`,'success');
  }catch(err){
    console.error(err);
    toast('Failed to load PDF. File may be corrupted.','error');
    hideProgress();
  }
}

function formatSize(b){
  if(b<1024) return b+' B';
  if(b<1024*1024) return (b/1024).toFixed(1)+' KB';
  return (b/1024/1024).toFixed(2)+' MB';
}

function showProgress(txt, pct){
  const p = document.getElementById('progress');
  p.classList.add('show');
  document.getElementById('progressText').textContent = txt;
  document.getElementById('progressFill').style.width = pct + '%';
}
function hideProgress(){ document.getElementById('progress').classList.remove('show'); }

/* ---------- Booklet Algorithm (as specified) ----------
   Pad to multiple of 4.
   Sheet 1: Blank | 1
   Sheet 2: 2 | (last-1)
   Sheet 3: (last-1) | 2
   Sheet 4: 3 | (last-2)
   Sheet 5: (last-2) | 3
   ... alternating until all pages placed.
   --------------------------------------------------------- */
function computeBookletOrder(total){
  const padded = total + ((4 - total%4) % 4); // multiple of 4
  const useFormula = document.getElementById('useCustomFormula').checked;

  if (useFormula) {
    const order = [];
    const parse = (expr, s, l) => {
      expr = expr.trim();
      if(expr === 'blank' || expr === '0') return 0;
      if(expr === 'start') return s;
      if(expr === 'last') return l;
      let m = expr.match(/^start\s*([+-])\s*(\d+)$/);
      if(m) return m[1] === '+' ? s + parseInt(m[2]) : s - parseInt(m[2]);
      m = expr.match(/^last\s*([+-])\s*(\d+)$/);
      if(m) return m[1] === '+' ? l + parseInt(m[2]) : l - parseInt(m[2]);
      return 0;
    };

    const f1L = document.getElementById('f1L').value;
    const f1R = document.getElementById('f1R').value;
    const fEvenL = document.getElementById('fEvenL').value;
    const fEvenR = document.getElementById('fEvenR').value;
    const fOddL = document.getElementById('fOddL').value;
    const fOddR = document.getElementById('fOddR').value;

    order.push([parse(f1L, 1, padded), parse(f1R, 1, padded)]);

    let sPtr = 1;
    let lPtr = padded;
    const remainingSheets = (padded / 2) - 1;
    let isEven = true;
    for(let i=0; i<remainingSheets; i++){
      if(isEven){
        order.push([parse(fEvenL, sPtr, lPtr), parse(fEvenR, sPtr, lPtr)]);
      } else {
        order.push([parse(fOddL, sPtr, lPtr), parse(fOddR, sPtr, lPtr)]);
        sPtr++; lPtr--;
      }
      isEven = !isEven;
    }
    return order.map(([l,r])=>[l>total?0:l, r>total?0:r]);
  }

  // Standard Booklet logic
  const order = [];
  let sPtr = 1;
  let lPtr = padded;
  const sheets = padded / 2;
  
  for(let i=0; i<sheets; i++){
    if(i % 2 === 0){
      order.push([lPtr, sPtr]);
    } else {
      order.push([sPtr, lPtr]);
    }
    sPtr++; lPtr--;
  }
  return order.map(([l,r])=>[l>total?0:l, r>total?0:r]);
}

/* ---------- Thumbnails ---------- */
async function buildThumbnails(){
  const wrap = document.getElementById('thumbs');
  wrap.innerHTML = '';
  const total = state.bookletOrder.length;
  for(let i=0;i<total;i++){
    const div = document.createElement('div');
    div.className = 'thumb';
    div.dataset.idx = i;
    const c = document.createElement('canvas');
    div.appendChild(c);
    const num = document.createElement('div');
    num.className = 'thumb-num';
    num.textContent = (i+1);
    div.appendChild(num);
    wrap.appendChild(div);
    div.addEventListener('click', ()=>{ state.currentSheet = i; renderCurrentSheet(); updateThumbActive(); });
    // Render small preview
    renderThumbToCanvas(c, i);
  }
  updateThumbActive();
}
function updateThumbActive(){
  document.querySelectorAll('.thumb').forEach((t,i)=>{
    t.classList.toggle('active', i===state.currentSheet);
  });
}
async function renderThumbToCanvas(canvas, sheetIdx){
  const [l,r] = state.bookletOrder[sheetIdx];
  // Landscape aspect ~ 1.414 (A4)
  const W = 160, H = 113;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,W,H);
  ctx.strokeStyle = '#e5e7eb';
  ctx.strokeRect(0.5,0.5,W-1,H-1);
  ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H); ctx.stroke();

  const halfW = W/2;
  for(const [side, pg] of [['L',l],['R',r]]){
    if(pg === 0){
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(side==='L'?1:halfW+1, 1, halfW-1, H-2);
      continue;
    }
    try{
      const page = await state.pdfDoc.getPage(pg);
      const vp0 = page.getViewport({scale:1});
      const scale = Math.min((halfW-4)/vp0.width, (H-4)/vp0.height);
      const vp = page.getViewport({scale});
      const x = side==='L' ? (halfW - vp.width)/2 : halfW + (halfW - vp.width)/2;
      const y = (H - vp.height)/2;
      const tmp = document.createElement('canvas');
      tmp.width = vp.width; tmp.height = vp.height;
      await page.render({canvasContext: tmp.getContext('2d'), viewport: vp}).promise;
      ctx.drawImage(tmp, x, y);
    }catch(e){}
  }
}

/* ---------- Preview render ---------- */
async function renderCurrentSheet(){
  const canvas = document.getElementById('previewCanvas');
  const empty = document.getElementById('previewEmpty');
  if(!state.pdfDoc){ canvas.style.display='none'; empty.style.display='block'; return; }
  canvas.style.display='block'; empty.style.display='none';

  const zoom = parseInt(document.getElementById('zoom').value)/100;
  const baseW = 900 * zoom;
  const baseH = baseW / Math.SQRT2; // landscape A4-ish
  canvas.width = baseW; canvas.height = baseH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,baseW,baseH);

  const [l,r] = state.bookletOrder[state.currentSheet];
  const halfW = baseW/2;

  // Margins
  const top = parseFloat(document.getElementById('topMargin').value);
  const bot = parseFloat(document.getElementById('bottomMargin').value);
  const inner = parseFloat(document.getElementById('innerMargin').value);
  const outer = parseFloat(document.getElementById('outerMargin').value);
  const gap = parseFloat(document.getElementById('pageGap').value);
  const scalePct = parseFloat(document.getElementById('scale').value)/100;

  // Left page area
  const lArea = { x: outer, y: top, w: halfW - outer - inner - gap/2, h: baseH - top - bot };
  // Right page area
  const rArea = { x: halfW + inner + gap/2, y: top, w: halfW - outer - inner - gap/2, h: baseH - top - bot };

  await drawPageToArea(ctx, l, lArea, scalePct);
  await drawPageToArea(ctx, r, rArea, scalePct);

  // PDF Darkness / Brightness Tint
  const darkness = parseFloat(document.getElementById('pdfDarkness').value) / 100;
  if (darkness !== 0) {
    if (darkness > 0) {
      ctx.fillStyle = '#000000';
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = darkness;
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.abs(darkness);
    }
    ctx.fillRect(0, 0, baseW, baseH);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Page numbers
  drawPageNumbers(ctx, l, r, lArea, rArea, baseW, baseH);

  // Center fold line
  ctx.strokeStyle = '#d1d5db';
  ctx.setLineDash([4,4]);
  ctx.beginPath(); ctx.moveTo(halfW, 0); ctx.lineTo(halfW, baseH); ctx.stroke();
  ctx.setLineDash([]);

  document.getElementById('pageInd').textContent = `Sheet ${state.currentSheet+1} / ${state.bookletOrder.length}`;
  updateThumbActive();
}

async function drawPageToArea(ctx, pgNum, area, scalePct){
  if(pgNum === 0){
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(area.x, area.y, area.w, area.h);
    ctx.fillStyle = '#d1d5db';
    ctx.font = '12px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('(blank)', area.x + area.w/2, area.y + area.h/2);
    return;
  }
  try{
    const page = await state.pdfDoc.getPage(pgNum);
    const vp0 = page.getViewport({scale:1});
    const fitMode = document.getElementById('fitMode').value;
    let scale;
    if(fitMode==='fitWidth') scale = area.w / vp0.width;
    else if(fitMode==='fitHeight') scale = area.h / vp0.height;
    else if(fitMode==='original') scale = 1;
    else scale = Math.min(area.w/vp0.width, area.h/vp0.height);
    scale *= scalePct;
    const vp = page.getViewport({scale});
    const x = area.x + (area.w - vp.width)/2;
    const y = area.y + (area.h - vp.height)/2;
    const tmp = document.createElement('canvas');
    tmp.width = vp.width; tmp.height = vp.height;
    await page.render({canvasContext: tmp.getContext('2d'), viewport: vp}).promise;
    ctx.drawImage(tmp, x, y);
  }catch(e){ console.warn(e); }
}

function drawPageNumbers(ctx, l, r, lArea, rArea, W, H){
  const pos = document.querySelector('input[name="numPos"]:checked').value;
  const margin = parseFloat(document.getElementById('numMargin').value);
  const size = parseFloat(document.getElementById('numSize').value);
  const color = document.getElementById('numColor').value;
  const bold = document.getElementById('numBold').classList.contains('active');
  const italic = document.getElementById('numItalic').classList.contains('active');
  const underline = document.getElementById('numUnderline').classList.contains('active');
  const fontName = document.getElementById('numFont').value;

  const font = (italic?'italic ':'') + (bold?'bold ':'') + size + 'px ' + fontName + ', Inter, Helvetica, sans-serif';
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textBaseline = 'bottom';

  const yBottom = H - margin;
  const yTop = margin + size;
  const bookName = document.getElementById('bookName') ? document.getElementById('bookName').value : '';

  const getX = (area, textW) => {
    if (pos === 'left') return area.x + margin + textW/2;
    if (pos === 'right') return area.x + area.w - margin - textW/2;
    return area.x + area.w / 2;
  };

  const drawText = (txt, area, yPos) => {
    if(!txt) return;
    const w = ctx.measureText(txt).width;
    const cx = getX(area, w);
    
    ctx.fillText(txt, cx - w/2, yPos);
    if(underline){
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx-w/2, yPos+2); ctx.lineTo(cx+w/2, yPos+2); ctx.stroke();
    }
  };

  const enableHeader = document.getElementById('enableHeader').checked;
  const enablePageNums = document.getElementById('enablePageNums').checked;

  if (enablePageNums) {
    drawText(l===0?'':String(l), lArea, yBottom);
    drawText(r===0?'':String(r), rArea, yBottom);
  }

  if (enableHeader && bookName) {
    if(l !== 0) drawText(bookName, lArea, yTop);
    if(r !== 0) drawText(bookName, rArea, yTop);
  }
}

/* Preview controls */
document.getElementById('prevSheet').addEventListener('click', ()=>{
  if(state.currentSheet>0){ state.currentSheet--; renderCurrentSheet(); }
});
document.getElementById('nextSheet').addEventListener('click', ()=>{
  if(state.currentSheet<state.bookletOrder.length-1){ state.currentSheet++; renderCurrentSheet(); }
});
document.getElementById('zoom').addEventListener('input', ()=>{ if(state.pdfDoc) renderCurrentSheet(); });

/* Re-render on settings change */
['numMargin','numSize','numColor','pdfDarkness','numFont','numBold','numItalic','numUnderline',
 'pageGap','outerMargin','innerMargin','topMargin','bottomMargin','scale','fitMode','paperSize', 'bookName', 'enableHeader', 'enablePageNums']
 .forEach(id=>{
   const el = document.getElementById(id);
   if (id === 'numFont') {
     el.addEventListener('change', async ()=>{ 
       const fontName = el.value;
       if (!['Helvetica', 'TimesRoman', 'Courier'].includes(fontName)) {
         const linkId = 'gfont-' + fontName.replace(/\s+/g, '-');
         if (!document.getElementById(linkId)) {
           const link = document.createElement('link');
           link.id = linkId; link.rel = 'stylesheet';
           link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/\s+/g, '+')}&display=swap`;
           document.head.appendChild(link);
           await new Promise(r => { link.onload = r; link.onerror = r; setTimeout(r, 1000); });
         }
       }
       if(state.pdfDoc) renderCurrentSheet(); 
     });
   } else {
     el.addEventListener('change', ()=>{ if(state.pdfDoc) renderCurrentSheet(); });
   }
   if(['range','color','text'].includes(el.type)) el.addEventListener('input', ()=>{ if(state.pdfDoc) renderCurrentSheet(); });
 });
document.querySelectorAll('input[name="numPos"]').forEach(r=>r.addEventListener('change',()=>{ if(state.pdfDoc) renderCurrentSheet(); }));
document.querySelectorAll('.toggle-btn').forEach(b=>b.addEventListener('click',()=>{ if(state.pdfDoc) renderCurrentSheet(); }));

/* ---------- Presets ---------- */
const presets = {
  standard:    { outerMargin:20, innerMargin:20, topMargin:20, bottomMargin:20, pageGap:0, scale:100 },
  compact:     { outerMargin:10, innerMargin:10, topMargin:10, bottomMargin:10, pageGap:0, scale:100 },
  wide:        { outerMargin:40, innerMargin:40, topMargin:30, bottomMargin:30, pageGap:0, scale:95 },
  professional:{ outerMargin:25, innerMargin:25, topMargin:25, bottomMargin:25, pageGap:4, scale:100 },
  binding:     { outerMargin:20, innerMargin:40, topMargin:20, bottomMargin:20, pageGap:0, scale:100 },
  magazine:    { outerMargin:15, innerMargin:20, topMargin:15, bottomMargin:15, pageGap:2, scale:100 },
  custom:      null
};
document.querySelectorAll('.preset').forEach(p=>{
  p.addEventListener('click', ()=>{
    document.querySelectorAll('.preset').forEach(x=>x.classList.remove('active'));
    p.classList.add('active');
    const name = p.dataset.preset;
    
    const layoutCard = document.getElementById('layoutCard');
    if (layoutCard) layoutCard.style.display = (name === 'custom') ? 'block' : 'none';

    const cfg = presets[name];
    if(!cfg) return;
    Object.keys(cfg).forEach(k=>{
      const el = document.getElementById(k);
      if(el){ el.value = cfg[k]; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }
    });
    toast(`Applied "${name}" preset`,'success');
  });
});

/* ---------- Generate Booklet PDF ---------- */
document.getElementById('generateBtn').addEventListener('click', generateBooklet);
document.getElementById('downloadBtn').addEventListener('click', downloadBooklet);
document.getElementById('printBtn').addEventListener('click', printBooklet);

async function generateBooklet(){
  if(!state.pdfBytes){ toast('No PDF loaded','error'); return; }
  showProgress('Generating booklet...', 5);
  try{
    const { PDFDocument, rgb, degrees, StandardFonts, BlendMode } = PDFLib;
    const srcDoc = await PDFDocument.load(state.pdfBytes);
    const outDoc = await PDFDocument.create();
    if (window.fontkit) outDoc.registerFontkit(window.fontkit);

    // Paper size
    const paper = document.getElementById('paperSize').value;
    let sheetW, sheetH;
    const mm2pt = 2.83465;
    if(paper==='a4'){ sheetW = 297*mm2pt; sheetH = 210*mm2pt; }
    else if(paper==='letter'){ sheetW = 11*72; sheetH = 8.5*72; }
    else if(paper==='legal'){ sheetW = 17*72; sheetH = 8.5*72; }
    else if(paper==='a5'){ sheetW = 210*mm2pt; sheetH = 148*mm2pt; }
    else {
      sheetW = parseFloat(document.getElementById('customW').value)*mm2pt;
      sheetH = parseFloat(document.getElementById('customH').value)*mm2pt;
    }

    const topM = parseFloat(document.getElementById('topMargin').value);
    const botM = parseFloat(document.getElementById('bottomMargin').value);
    const innerM = parseFloat(document.getElementById('innerMargin').value);
    const outerM = parseFloat(document.getElementById('outerMargin').value);
    const gap = parseFloat(document.getElementById('pageGap').value);
    const scalePct = parseFloat(document.getElementById('scale').value)/100;
    const rotate = parseFloat(document.querySelector('input[name="rot"]:checked').value);
    const fitMode = document.getElementById('fitMode').value;

    const order = state.bookletOrder;
    const total = order.length;

    for(let i=0;i<total;i++){
      showProgress(`Building sheet ${i+1} of ${total}...`, 5 + (i/total)*80);
      const [lPg, rPg] = order[i];
      const page = outDoc.addPage([sheetW, sheetH]);
      const halfW = sheetW/2;
      
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme === 'dark') {
        page.drawRectangle({ x: 0, y: 0, width: sheetW, height: sheetH, color: rgb(1,1,1) });
      }

      // Draw left
      await placePage({PDFDocument, srcDoc, outDoc, page, pgNum:lPg,
        x: outerM, y: botM,
        w: halfW - outerM - innerM - gap/2,
        h: sheetH - topM - botM,
        fitMode, scalePct, rotate});
      // Draw right
      await placePage({PDFDocument, srcDoc, outDoc, page, pgNum:rPg,
        x: halfW + innerM + gap/2, y: botM,
        w: halfW - outerM - innerM - gap/2,
        h: sheetH - topM - botM,
        fitMode, scalePct, rotate});

      // PDF Darkness / Brightness Tint
      const darkness = parseFloat(document.getElementById('pdfDarkness').value) / 100;
      if (darkness !== 0) {
        if (darkness > 0) {
          page.drawRectangle({
            x: 0, y: 0, width: sheetW, height: sheetH,
            color: rgb(0,0,0), opacity: darkness, blendMode: BlendMode.Multiply
          });
        } else {
          page.drawRectangle({
            x: 0, y: 0, width: sheetW, height: sheetH,
            color: rgb(1,1,1), opacity: Math.abs(darkness), blendMode: BlendMode.Screen
          });
        }
      }

      // Page numbers
      await drawPdfPageNumbers({page, outDoc, PDFLib, lPg, rPg,
        lArea:{x:outerM, y:botM, w:halfW-outerM-innerM-gap/2, h:sheetH-topM-botM},
        rArea:{x:halfW+innerM+gap/2, y:botM, w:halfW-outerM-innerM-gap/2, h:sheetH-topM-botM},
        sheetW, sheetH});

      // Bake background tint
      if (theme === 'dim' || theme === 'yellow') {
        let bgColor = rgb(209/255, 213/255, 219/255);
        if (theme === 'yellow') bgColor = rgb(254/255, 243/255, 199/255);
        page.drawRectangle({ x: 0, y: 0, width: sheetW, height: sheetH, color: bgColor, blendMode: BlendMode.Multiply });
      } else if (theme === 'dark') {
        page.drawRectangle({ x: 0, y: 0, width: sheetW, height: sheetH, color: rgb(1,1,1), blendMode: BlendMode.Difference });
      }
    }


    state.generatedPdfBytes = await outDoc.save();
    showProgress('Done!', 100);
    document.getElementById('downloadBtn').disabled = false;
    document.getElementById('printBtn').disabled = false;
    setTimeout(()=>hideProgress(), 600);
    toast('Booklet generated successfully ✓','success');
  }catch(err){
    console.error(err);
    toast('Generation failed: '+err.message,'error');
    hideProgress();
  }
}

async function placePage({PDFDocument, srcDoc, outDoc, page, pgNum, x, y, w, h, fitMode, scalePct, rotate}){
  if(pgNum === 0) return; // blank
  const { degrees } = PDFLib;
  const [embedded] = await outDoc.embedPdf(srcDoc, [pgNum-1]);
  const origW = embedded.width;
  const origH = embedded.height;
  let sx, sy;
  if(fitMode==='fitWidth'){ sx = w/origW; sy = h/origH; const s = sx; sx=s; sy=s*(origH/origW)*(origW/origH); }
  // Simpler:
  let scale;
  if(fitMode==='fitWidth') scale = w/origW;
  else if(fitMode==='fitHeight') scale = h/origH;
  else if(fitMode==='original') scale = 1;
  else scale = Math.min(w/origW, h/origH);
  scale *= scalePct;
  const drawW = origW * scale;
  const drawH = origH * scale;
  const dx = x + (w - drawW)/2;
  const dy = y + (h - drawH)/2;
  page.drawPage(embedded, {
    x: dx, y: dy,
    xScale: scale, yScale: scale,
    rotate: degrees(rotate)
  });
}

async function drawPdfPageNumbers({page, outDoc, PDFLib, lPg, rPg, lArea, rArea, sheetW, sheetH}){
  const pos = document.querySelector('input[name="numPos"]:checked').value;
  const margin = parseFloat(document.getElementById('numMargin').value);
  const size = parseFloat(document.getElementById('numSize').value);
  const hex = document.getElementById('numColor').value;
  const { rgb, StandardFonts } = PDFLib;
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  
  const fontName = document.getElementById('numFont').value;
  let font;
  if (['Helvetica', 'TimesRoman', 'Courier'].includes(fontName)) {
    let fontKey = StandardFonts[fontName];
    const bold = document.getElementById('numBold').classList.contains('active');
    const italic = document.getElementById('numItalic').classList.contains('active');
    if (fontName === 'Helvetica') {
      if (bold && italic) fontKey = StandardFonts.HelveticaBoldOblique;
      else if (bold) fontKey = StandardFonts.HelveticaBold;
      else if (italic) fontKey = StandardFonts.HelveticaOblique;
    } else if (fontName === 'TimesRoman') {
      if (bold && italic) fontKey = StandardFonts.TimesRomanBoldItalic;
      else if (bold) fontKey = StandardFonts.TimesRomanBold;
      else if (italic) fontKey = StandardFonts.TimesRomanItalic;
    } else if (fontName === 'Courier') {
      if (bold && italic) fontKey = StandardFonts.CourierBoldOblique;
      else if (bold) fontKey = StandardFonts.CourierBold;
      else if (italic) fontKey = StandardFonts.CourierOblique;
    }
    font = await outDoc.embedFont(fontKey);
  } else {
    try {
      const bold = document.getElementById('numBold').classList.contains('active');
      const italic = document.getElementById('numItalic').classList.contains('active');
      const pkgName = fontName.toLowerCase().replace(/\s+/g, '-');
      let weight = bold ? '700' : '400';
      let style = italic ? 'italic' : 'normal';
      let fontUrl = `https://unpkg.com/@fontsource/${pkgName}/files/${pkgName}-latin-${weight}-${style}.woff`;
      
      window.pdfFontCache = window.pdfFontCache || {};
      if (!window.pdfFontCache[fontUrl]) {
        let res = await fetch(fontUrl);
        if (!res.ok) {
           fontUrl = `https://unpkg.com/@fontsource/${pkgName}/files/${pkgName}-latin-400-normal.woff`;
           res = await fetch(fontUrl);
        }
        window.pdfFontCache[fontUrl] = await res.arrayBuffer();
      }
      font = await outDoc.embedFont(window.pdfFontCache[fontUrl]);
    } catch(e) {
      console.warn('Custom font load failed, falling back to Helvetica', e);
      font = await outDoc.embedFont(StandardFonts.Helvetica);
    }
  }

  const bookName = document.getElementById('bookName') ? document.getElementById('bookName').value : '';
  const yHeader = sheetH - margin - size;
  const underline = document.getElementById('numUnderline').classList.contains('active');

  const getX = (area, estW) => {
    if (pos === 'left') return area.x + margin + estW/2;
    if (pos === 'right') return area.x + area.w - margin - estW/2;
    return area.x + area.w / 2;
  };

  const drawText = (txt, area, yPos) => {
    if(!txt) return;
    const estW = font.widthOfTextAtSize(txt, size);
    const cx = getX(area, estW);
    
    page.drawText(txt, {
      x: cx - estW/2,
      y: yPos,
      size: size,
      color: rgb(r,g,b),
      font: font
    });
    if (underline) {
      page.drawLine({
        start: { x: cx - estW/2, y: yPos - 2 },
        end: { x: cx + estW/2, y: yPos - 2 },
        thickness: 1,
        color: rgb(r,g,b)
      });
    }
  };

  const enableHeader = document.getElementById('enableHeader').checked;
  const enablePageNums = document.getElementById('enablePageNums').checked;

  if (enablePageNums) {
    drawText(lPg===0?'':String(lPg), lArea, margin);
    drawText(rPg===0?'':String(rPg), rArea, margin);
  }

  if (enableHeader && bookName) {
    if (lPg !== 0) drawText(bookName, lArea, yHeader);
    if (rPg !== 0) drawText(bookName, rArea, yHeader);
  }
}

function downloadBooklet(){
  if(!state.generatedPdfBytes) return;
  const blob = new Blob([state.generatedPdfBytes], {type:'application/pdf'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.fileName.replace(/\.pdf$/i,'') + '_booklet.pdf';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
  toast('Download started','success');
}

function printBooklet(){
  if(!state.generatedPdfBytes) return;
  const blob = new Blob([state.generatedPdfBytes], {type:'application/pdf'});
  const url = URL.createObjectURL(blob);
  const w = window.open(url);
  if(!w) toast('Please allow pop-ups to print','error');
}

/* ---------- Reset / Save Settings ---------- */
function resetAll(){
  state.pdfDoc = null; state.pdfBytes = null; state.pageCount = 0;
  state.bookletOrder = []; state.generatedPdfBytes = null; state.currentSheet = 0;
  document.getElementById('fileInfo').classList.remove('show');
  document.getElementById('previewCanvas').style.display='none';
  document.getElementById('previewEmpty').style.display='block';
  document.getElementById('thumbs').innerHTML = '';
  document.getElementById('pageInd').textContent = 'Sheet 0 / 0';
  document.getElementById('generateBtn').disabled = true;
  document.getElementById('downloadBtn').disabled = true;
  document.getElementById('printBtn').disabled = true;
  fileInput.value = '';
}

document.getElementById('resetSettings').addEventListener('click', ()=>{
  presets.standard && Object.keys(presets.standard).forEach(k=>{
    const el = document.getElementById(k); if(el){ el.value = presets.standard[k]; el.dispatchEvent(new Event('input')); }
  });
  document.getElementById('numMargin').value=10; document.getElementById('numSize').value=12;
  document.getElementById('numColor').value='#000000'; document.getElementById('numColorText').value='#000000';
  document.getElementById('numFont').value='Helvetica';
  document.querySelectorAll('.toggle-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('posC').checked = true;
  document.getElementById('paperSize').value='a4';
  document.getElementById('customSizeFields').style.display='none';
  document.querySelectorAll('.preset').forEach(p=>p.classList.toggle('active', p.dataset.preset==='standard'));
  if(state.pdfDoc) renderCurrentSheet();
  toast('Settings reset','info');
});

document.getElementById('saveSettingsBtn').addEventListener('click', ()=>{
  const s = {};
  document.querySelectorAll('input[type="range"],select,input[type="color"],input[type="number"]').forEach(el=>{
    if(el.id) s[el.id] = el.value;
  });
  s.numPos = document.querySelector('input[name="numPos"]:checked').value;
  s.rot = document.querySelector('input[name="rot"]:checked').value;
  s.toggles = Array.from(document.querySelectorAll('.toggle-btn.active')).map(b=>b.id);
  localStorage.setItem('bookletSettings', JSON.stringify(s));
  toast('Settings saved','success');
});

function loadSettings(){
  const raw = localStorage.getItem('bookletSettings');
  if(!raw) return;
  try{
    const s = JSON.parse(raw);
    Object.keys(s).forEach(k=>{
      if(k==='numPos'){ const el = document.querySelector(`input[name="numPos"][value="${s[k]}"]`); if(el) el.checked=true; }
      else if(k==='rot'){ const el = document.querySelector(`input[name="rot"][value="${s[k]}"]`); if(el) el.checked=true; }
      else if(k==='toggles'){
        document.querySelectorAll('.toggle-btn').forEach(b=>b.classList.toggle('active', s.toggles.includes(b.id)));
      }
      else {
        const el = document.getElementById(k);
        if(el){ el.value = s[k]; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }
      }
    });
  }catch(e){}
}
loadSettings();

/* ---------- Print Guide Modal ---------- */
document.getElementById('printGuideBtn').addEventListener('click', ()=>{
  document.getElementById('printGuideModal').classList.add('show');
});
document.getElementById('printGuideModal').addEventListener('click', e=>{
  if(e.target.id==='printGuideModal') e.currentTarget.classList.remove('show');
});

/* ---------- Keyboard shortcuts ---------- */
document.addEventListener('keydown', e=>{
  if(!state.pdfDoc) return;
  if(e.key==='ArrowLeft'){ if(state.currentSheet>0){ state.currentSheet--; renderCurrentSheet(); } }
  if(e.key==='ArrowRight'){ if(state.currentSheet<state.bookletOrder.length-1){ state.currentSheet++; renderCurrentSheet(); } }
});

/* ---------- PWA Service Worker (inline) ---------- */
if('serviceWorker' in navigator){
  const swCode = `
    const CACHE='booklet-v1';
    self.addEventListener('install',e=>{self.skipWaiting();});
    self.addEventListener('activate',e=>{self.clients.claim();});
    self.addEventListener('fetch',e=>{
      if(e.request.method!=='GET') return;
      e.respondWith(
        caches.open(CACHE).then(async cache=>{
          const cached = await cache.match(e.request);
          try{
            const net = await fetch(e.request);
            if(net.ok) cache.put(e.request, net.clone());
            return net;
          }catch(err){ return cached || new Response('Offline',{status:503}); }
        })
      );
    });
  `;
  const blob = new Blob([swCode], {type:'application/javascript'});
  navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(()=>{});
}