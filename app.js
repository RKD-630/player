'use strict';
/* ================================================================
   CutFlow — Professional Browser Video Editor
   Core Engine: State • Timeline • Canvas Renderer • Inspector
   ================================================================ */

// ============================================================
// 1. APPLICATION STATE
// ============================================================
const App = {
  project: {
    name: 'Untitled Project',
    canvas: { width: 1920, height: 1080, ratio: '16:9', bg: { type: 'solid', color: '#1a1a2e' } },
    tracks: [],          // [{id, type, name, locked, hidden, muted, clips:[]}]
    duration: 0,         // total duration in ms
  },
  playback: {
    currentTime: 0,
    playing: false,
    speed: 1,
    loop: false,
    raf: null,
    lastTs: null,
  },
  timeline: {
    zoom: 80,            // px per second
    snapEnabled: true,
    scrollLeft: 0,
  },
  selection: {
    clipId: null,
    type: null,          // 'video'|'audio'|'text'|'image'
  },
  mediaLibrary: [],      // [{id, name, type, src, duration, thumbnail, file}]
  textElements: [],      // text layers rendered on canvas
  customFonts: [],
  undoStack: [],
  redoStack: [],
  bgImage: null,
  canvasScale: 1,
  canvasOffsetX: 0,
  canvasOffsetY: 0,
  nextId: 1,
};
window.App = App;
window.CutFlow = App;

// ============================================================
// 2. UTILITIES
// ============================================================
const uid = () => `id_${App.nextId++}_${Math.random().toString(36).slice(2,7)}`;

function formatTime(ms) {
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  const msRem = Math.floor(ms % 1000);
  return `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(msRem).padStart(3,'0')}`;
}

function showToast(msg, dur=2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), dur);
}

function hexToRgba(hex, alpha=1) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function saveUndo() {
  App.undoStack.push(JSON.stringify({ tracks: App.project.tracks, duration: App.project.duration, textElements: App.textElements.map(t=>({...t})) }));
  if (App.undoStack.length > 60) App.undoStack.shift();
  App.redoStack = [];
}

function undo() {
  if (!App.undoStack.length) return showToast('Nothing to undo');
  App.redoStack.push(JSON.stringify({ tracks: App.project.tracks, duration: App.project.duration, textElements: App.textElements }));
  const s = JSON.parse(App.undoStack.pop());
  App.project.tracks = s.tracks; App.project.duration = s.duration; App.textElements = s.textElements || [];
  updateDuration(); renderTimeline(); renderCanvas();
  showToast('Undo');
}

function redo() {
  if (!App.redoStack.length) return showToast('Nothing to redo');
  App.undoStack.push(JSON.stringify({ tracks: App.project.tracks, duration: App.project.duration, textElements: App.textElements }));
  const s = JSON.parse(App.redoStack.pop());
  App.project.tracks = s.tracks; App.project.duration = s.duration; App.textElements = s.textElements || [];
  updateDuration(); renderTimeline(); renderCanvas();
  showToast('Redo');
}

// ============================================================
// 3. CANVAS SETUP & RENDERING
// ============================================================
const canvas = document.getElementById('mainCanvas');
const ctx = canvas.getContext('2d');

function setCanvasSize(w, h) {
  canvas.width = w; canvas.height = h;
  fitCanvas();
}

function fitCanvas() {
  const container = document.getElementById('previewArea');
  const cw = container.clientWidth - 32, ch = container.clientHeight - 80;
  const scaleW = cw / canvas.width, scaleH = ch / canvas.height;
  App.canvasScale = Math.min(scaleW, scaleH, 1);
  canvas.style.width  = Math.floor(canvas.width  * App.canvasScale) + 'px';
  canvas.style.height = Math.floor(canvas.height * App.canvasScale) + 'px';
  document.getElementById('canvasZoomLabel').textContent = Math.round(App.canvasScale * 100) + '%';
}

function renderCanvas() {
  const { width: W, height: H, bg } = App.project.canvas;
  ctx.clearRect(0, 0, W, H);

  // Background
  if (bg.type === 'solid') {
    ctx.fillStyle = bg.color || '#1a1a2e'; ctx.fillRect(0, 0, W, H);
  } else if (bg.type === 'gradient') {
    const grad = ctx.createLinearGradient(...gradCoords(bg.angle || 135, W, H));
    grad.addColorStop(0, bg.color1 || '#6c63ff');
    grad.addColorStop(1, bg.color2 || '#ff6584');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
  } else if (bg.type === 'image' && App.bgImage) {
    ctx.drawImage(App.bgImage, 0, 0, W, H);
  } else {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  }

  const t = App.playback.currentTime;

  // Render video/image clips
  for (const track of App.project.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (t < clip.startTime || t > clip.startTime + clip.duration) continue;
      const localT = (t - clip.startTime) / 1000;
      ctx.save();
      applyClipTransform(clip, W, H);
      applyColorFilter(clip);
      if (clip.type === 'video' && clip._videoEl) {
        drawMediaClip(clip._videoEl, clip, W, H);
      } else if (clip.type === 'image' && clip._imgEl) {
        drawMediaClip(clip._imgEl, clip, W, H);
      }
      ctx.restore();
    }
  }

  // Render text elements
  for (const te of App.textElements) {
    if (t < te.startTime || t > te.startTime + te.duration) continue;
    renderTextElement(te, t);
  }
}

function gradCoords(angle, W, H) {
  const rad = (angle - 90) * Math.PI / 180;
  const cx = W/2, cy = H/2, len = Math.sqrt(W*W + H*H)/2;
  return [cx - Math.cos(rad)*len, cy - Math.sin(rad)*len, cx + Math.cos(rad)*len, cy + Math.sin(rad)*len];
}

function applyClipTransform(clip, W, H) {
  const cx = (clip.posX != null ? clip.posX : W/2);
  const cy = (clip.posY != null ? clip.posY : H/2);
  ctx.translate(cx, cy);
  const scale = (clip.scale || 100) / 100;
  const rot = (clip.rotation || 0) * Math.PI / 180;
  ctx.rotate(rot);
  ctx.scale(clip.flipH ? -scale : scale, clip.flipV ? -scale : scale);
  ctx.globalAlpha = (clip.opacity != null ? clip.opacity : 100) / 100;
  applyColorFilter(clip);
}

function applyColorFilter(clip) {
  const filters = [];
  if (clip.brightness) filters.push(`brightness(${1 + clip.brightness/100})`);
  if (clip.contrast)   filters.push(`contrast(${1 + clip.contrast/100})`);
  if (clip.saturation) filters.push(`saturate(${1 + clip.saturation/100})`);
  if (clip.hue)        filters.push(`hue-rotate(${clip.hue}deg)`);
  if (clip.blur)       filters.push(`blur(${clip.blur}px)`);
  ctx.filter = filters.length ? filters.join(' ') : 'none';
}

function drawMediaClip(el, clip, W, H) {
  const sw = clip.width || W, sh = clip.height || H;
  try { ctx.drawImage(el, -sw/2, -sh/2, sw, sh); } catch(e){}
}

function renderTextElement(te, currentTime) {
  ctx.save();
  const localT = (currentTime - te.startTime) / 1000;
  const animT = Math.min(1, localT / (te.animDuration || 1));

  // Compute animated position/scale/opacity
  let ox = 0, oy = 0, sc = 1, opacity = te.opacity/100;
  const anim = te.animation || 'none';
  if (anim === 'fade-in') opacity *= Math.min(1, animT);
  else if (anim === 'slide-in-left') { ox = (1-animT) * -200; opacity *= animT; }
  else if (anim === 'slide-in-right') { ox = (1-animT) * 200; opacity *= animT; }
  else if (anim === 'slide-in-top') { oy = (1-animT) * -100; opacity *= animT; }
  else if (anim === 'zoom-in') { sc = 0.3 + animT * 0.7; opacity *= animT; }
  else if (anim === 'bounce') { oy = Math.sin(localT * 8) * 10 * Math.max(0, 1-animT*2); opacity *= Math.min(1, animT*2); }
  else if (anim === 'pop') { sc = animT < 0.5 ? animT * 2.4 : 1.2 - (animT-0.5)*0.4; opacity *= Math.min(1, animT*3); }
  else if (anim === 'rotate-in') { ctx.rotate((1-animT)*-1.5); opacity *= animT; }
  else if (anim === 'fade-out') { const left = Math.max(0,1-localT/te.animDuration); opacity *= left; }
  else if (anim === 'zoom-out') { const left = Math.max(0,1-localT/te.animDuration); sc = 1-left*0.7; opacity *= left; }
  else if (anim === 'floating') { oy = Math.sin(localT*2)*8; }
  else if (anim === 'pulse') { sc = 1 + Math.sin(localT*3)*0.08; }
  else if (anim === 'shake') { ox = Math.sin(localT*20)*4; }
  else if (anim === 'blink') { opacity *= Math.round(Math.sin(localT*4)+1)/2; }

  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  const x = (te.posX || App.project.canvas.width/2) + ox;
  const y = (te.posY || App.project.canvas.height/2) + oy;
  ctx.translate(x, y);
  ctx.rotate((te.rotation||0)*Math.PI/180);
  ctx.scale((te.scale||100)/100 * sc, (te.scale||100)/100 * sc);

  // Text style
  const weight = te.bold ? 'bold' : (te.fontWeight || 'normal');
  const style  = te.italic ? 'italic' : 'normal';
  const size   = te.fontSize || 48;
  const font   = te.fontFamily || 'Inter';
  ctx.font = `${style} ${weight} ${size}px "${font}", sans-serif`;
  ctx.textAlign = te.align || 'center';
  ctx.textBaseline = 'middle';

  const maxW = te.maxWidth || 800;
  const lines = wrapText(ctx, te.text || 'Text', maxW);
  const lineH = size * ((te.lineHeight||120)/100);
  const totalH = lines.length * lineH;

  // Background
  if (te.bgEnabled && te.bgColor) {
    const pad = te.bgPadding || 10;
    let maxLineW = 0;
    for (const l of lines) maxLineW = Math.max(maxLineW, ctx.measureText(l).width);
    ctx.fillStyle = hexToRgba(te.bgColor, (te.bgOpacity||60)/100);
    const bx = te.align==='center' ? -maxLineW/2-pad : te.align==='right' ? -maxLineW-pad : -pad;
    ctx.fillRect(bx, -totalH/2-pad, maxLineW+pad*2, totalH+pad*2);
  }

  // Shadow
  if (te.shadowBlur || te.shadowX || te.shadowY) {
    ctx.shadowColor = hexToRgba(te.shadowColor||'#000000', (te.shadowOpacity||60)/100);
    ctx.shadowBlur  = te.shadowBlur || 0;
    ctx.shadowOffsetX = te.shadowX || 0;
    ctx.shadowOffsetY = te.shadowY || 0;
  }

  // Stroke
  if (te.strokeWidth > 0) {
    ctx.strokeStyle = te.strokeColor || '#000';
    ctx.lineWidth   = te.strokeWidth;
  }

  // Typewriter effect
  const isTypewriter = anim === 'typewriter';

  lines.forEach((line, i) => {
    const drawLine = isTypewriter ? line.slice(0, Math.floor(animT * line.length)) : line;
    const yOff = (i - (lines.length-1)/2) * lineH;
    ctx.fillStyle = te.color || '#ffffff';
    if (te.underline) {
      const w = ctx.measureText(drawLine).width;
      const ulx = te.align==='center' ? -w/2 : te.align==='right' ? -w : 0;
      ctx.fillRect(ulx, yOff + size*0.55, w, 1.5);
    }
    if (te.strokeWidth > 0) ctx.strokeText(drawLine, 0, yOff);
    ctx.fillText(drawLine, 0, yOff);
  });

  ctx.restore();
}

function wrapText(ctx, text, maxW) {
  const paras = text.split('\n');
  const result = [];
  for (const para of paras) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        result.push(line); line = word;
      } else { line = test; }
    }
    if (line) result.push(line);
  }
  return result.length ? result : [''];
}

// ============================================================
// 4. PLAYBACK ENGINE
// ============================================================
function play() {
  if (App.playback.playing) return;
  App.playback.playing = true;
  App.playback.lastTs = null;
  document.getElementById('playIcon').style.display = 'none';
  document.getElementById('pauseIcon').style.display = '';

  // Start actual HTML video elements
  for (const track of App.project.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      const t = App.playback.currentTime;
      if (clip._videoEl && t >= clip.startTime && t <= clip.startTime + clip.duration) {
        clip._videoEl.currentTime = (t - clip.startTime) / 1000;
        clip._videoEl.playbackRate = App.playback.speed;
        clip._videoEl.play().catch(()=>{});
      }
    }
  }
  App.playback.raf = requestAnimationFrame(playbackLoop);
}

function pause() {
  if (!App.playback.playing) return;
  App.playback.playing = false;
  document.getElementById('playIcon').style.display = '';
  document.getElementById('pauseIcon').style.display = 'none';
  cancelAnimationFrame(App.playback.raf);
  for (const track of App.project.tracks) {
    for (const clip of track.clips) {
      if (clip._videoEl) clip._videoEl.pause();
    }
  }
}

function stop() {
  pause();
  App.playback.currentTime = 0;
  seekTo(0);
  updateTimeDisplay();
  renderCanvas();
}

function seekTo(ms) {
  App.playback.currentTime = Math.max(0, Math.min(ms, App.project.duration));
  for (const track of App.project.tracks) {
    for (const clip of track.clips) {
      if (clip._videoEl) {
        const t = App.playback.currentTime;
        if (t >= clip.startTime && t <= clip.startTime + clip.duration) {
          clip._videoEl.currentTime = (t - clip.startTime) / 1000 / App.playback.speed;
        }
      }
    }
  }
  updateTimeDisplay();
  updatePlayheadPosition();
  renderCanvas();
}

function playbackLoop(ts) {
  if (!App.playback.playing) return;
  if (App.playback.lastTs != null) {
    const delta = (ts - App.playback.lastTs) * App.playback.speed;
    App.playback.currentTime += delta;
    if (App.playback.currentTime >= App.project.duration) {
      App.playback.currentTime = 0;
      stop();
      return;
    }
  }
  App.playback.lastTs = ts;
  updateTimeDisplay();
  updatePlayheadPosition();
  renderCanvas();
  App.playback.raf = requestAnimationFrame(playbackLoop);
}

function updateTimeDisplay() {
  document.getElementById('currentTime').textContent = formatTime(App.playback.currentTime);
  document.getElementById('totalDuration').textContent = formatTime(App.project.duration);
}

// ============================================================
// 5. TIMELINE ENGINE
// ============================================================
const TRACK_H = 40, RULER_H = 26, LABEL_W = 110;

function pxPerMs() { return App.timeline.zoom / 1000; }
function timeToPx(ms) { return ms * pxPerMs(); }
function pxToTime(px) { return px / pxPerMs(); }

function createTrack(type, name) {
  const track = {
    id: uid(), type, name: name || `${type} ${App.project.tracks.length+1}`,
    locked: false, hidden: false, muted: false, clips: []
  };
  App.project.tracks.push(track);
  renderTimeline();
  return track;
}

function addClipToTrack(trackId, clip) {
  const track = App.project.tracks.find(t => t.id === trackId);
  if (!track) return;
  track.clips.push(clip);
  updateDuration();
  renderTimeline();
  saveUndo();
}

function updateDuration() {
  let max = 3000; // min 3s
  for (const track of App.project.tracks) {
    for (const clip of track.clips) {
      max = Math.max(max, clip.startTime + clip.duration);
    }
  }
  for (const te of App.textElements) {
    max = Math.max(max, te.startTime + te.duration);
  }
  App.project.duration = max;
  updateTimeDisplay();
  renderRuler();
}

function renderTimeline() {
  const trackLabels = document.getElementById('trackLabels');
  const tracksContainer = document.getElementById('tracksContainer');
  trackLabels.innerHTML = '';
  tracksContainer.innerHTML = '';

  const totalW = Math.max(800, timeToPx(App.project.duration) + 200);
  tracksContainer.style.width = totalW + 'px';
  document.getElementById('timelineRuler').width = totalW;
  document.getElementById('timelineRuler').style.width = totalW + 'px';

  for (const track of App.project.tracks) {
    // Label
    const lbl = document.createElement('div');
    lbl.className = 'track-label';
    lbl.dataset.trackId = track.id;
    const icon = track.type === 'video' ? '🎬' : track.type === 'audio' ? '🎵' : track.type === 'text' ? 'T' : '🖼';
    lbl.innerHTML = `
      <span class="track-icon">${icon}</span>
      <span class="track-label-name">${track.name}</span>
      <button class="track-mute-btn${track.muted?' muted':''}" data-id="${track.id}" title="Mute">M</button>
      <button class="track-vis-btn${track.hidden?' hidden':''}" data-id="${track.id}" title="Hide">V</button>
      <button class="track-lock-btn${track.locked?' active':''}" data-id="${track.id}" title="Lock">L</button>
    `;
    trackLabels.appendChild(lbl);

    // Track row
    const row = document.createElement('div');
    row.className = 'track-row';
    row.dataset.trackId = track.id;
    row.dataset.trackType = track.type;

    // Drop target
    row.addEventListener('dragover', e => {
      e.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const mediaId = e.dataTransfer.getData('mediaId') || e.dataTransfer.getData('text/plain');
      if (mediaId) addMediaToTrack(mediaId, track.id, e.offsetX);
    });

    // Render clips
    for (const clip of track.clips) {
      const clipEl = createClipElement(clip, track);
      row.appendChild(clipEl);
    }

    tracksContainer.appendChild(row);
  }

  updatePlayheadPosition();
  setupTrackLabelButtons();
  renderRuler();
}

function createClipElement(clip, track) {
  const el = document.createElement('div');
  const w = Math.max(10, timeToPx(clip.duration));
  el.className = `clip clip-${clip.type}${App.selection.clipId === clip.id ? ' selected' : ''}`;
  el.style.left = timeToPx(clip.startTime) + 'px';
  el.style.width = w + 'px';
  el.dataset.clipId = clip.id;
  el.dataset.trackId = track.id;

  el.innerHTML = `
    <div class="clip-resize-handle left"></div>
    <div class="clip-label">${clip.name || clip.type}</div>
    <div class="clip-resize-handle right"></div>
  `;

  // Draw audio waveform placeholder
  if (clip.type === 'audio') {
    const wave = document.createElement('canvas');
    wave.className = 'clip-wave';
    wave.width = Math.max(1, w); wave.height = 20;
    drawWaveform(wave, clip);
    el.insertBefore(wave, el.querySelector('.clip-label'));
  }

  // Click to select
  el.addEventListener('mousedown', e => {
    if (e.target.classList.contains('clip-resize-handle')) return;
    e.stopPropagation();
    selectClip(clip.id, clip.type);
    startClipDrag(e, clip, track, el);
  });

  // Resize handles
  el.querySelectorAll('.clip-resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      startClipResize(e, clip, track, el, handle.classList.contains('left') ? 'left' : 'right');
    });
  });

  // Right-click context menu
  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    selectClip(clip.id, clip.type);
    showContextMenu(e.clientX, e.clientY, clip, track);
  });

  return el;
}

function drawWaveform(canvas, clip) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const pts = Math.floor(canvas.width / 2);
  for (let i = 0; i <= pts; i++) {
    const x = i * 2;
    const h = (Math.random() * 0.8 + 0.1) * canvas.height;
    ctx.moveTo(x, canvas.height/2 - h/2);
    ctx.lineTo(x, canvas.height/2 + h/2);
  }
  ctx.stroke();
}

function renderRuler() {
  const rulerCanvas = document.getElementById('timelineRuler');
  const rctx = rulerCanvas.getContext('2d');
  const W = rulerCanvas.width, H = RULER_H;
  rctx.clearRect(0, 0, W, H);
  rctx.fillStyle = '#0d0d14';
  rctx.fillRect(0, 0, W, H);

  const durationMs = App.project.duration + 1000;
  const ppm = pxPerMs();
  const totalPx = timeToPx(durationMs);

  // Determine tick interval
  let intervalMs = 1000;
  if (ppm < 0.01) intervalMs = 60000;
  else if (ppm < 0.05) intervalMs = 10000;
  else if (ppm < 0.1) intervalMs = 5000;
  else if (ppm < 0.3) intervalMs = 2000;

  rctx.fillStyle = '#55557a';
  rctx.font = '9px JetBrains Mono, monospace';
  rctx.textAlign = 'left';

  for (let ms = 0; ms <= durationMs + intervalMs; ms += intervalMs) {
    const x = timeToPx(ms);
    rctx.fillStyle = 'rgba(255,255,255,0.15)';
    rctx.fillRect(x, H-8, 1, 8);
    rctx.fillStyle = '#55557a';
    rctx.fillText(formatTime(ms).slice(0,-4), x+2, H-10);
  }

  // Sub-ticks
  const subInt = intervalMs / 4;
  for (let ms = 0; ms <= durationMs; ms += subInt) {
    if (ms % intervalMs === 0) continue;
    const x = timeToPx(ms);
    rctx.fillStyle = 'rgba(255,255,255,0.06)';
    rctx.fillRect(x, H-4, 1, 4);
  }
}

// ============================================================
// 6. DRAG AND DROP FOR CLIPS
// ============================================================
let dragState = null;

function startClipDrag(e, clip, track, el) {
  if (track.locked) return;
  const startX = e.clientX;
  const origStart = clip.startTime;
  dragState = { type: 'move', clip, track, el, startX, origStart };
  document.addEventListener('mousemove', onClipMouseMove);
  document.addEventListener('mouseup', onClipMouseUp);
}

function startClipResize(e, clip, track, el, side) {
  if (track.locked) return;
  const startX = e.clientX;
  const origStart = clip.startTime, origDur = clip.duration;
  dragState = { type: 'resize', side, clip, track, el, startX, origStart, origDur };
  document.addEventListener('mousemove', onClipMouseMove);
  document.addEventListener('mouseup', onClipMouseUp);
}

function onClipMouseMove(e) {
  if (!dragState) return;
  const dx = e.clientX - dragState.startX;
  const dms = pxToTime(dx);
  const { clip, el, track } = dragState;

  if (dragState.type === 'move') {
    const newStart = Math.max(0, dragState.origStart + dms);
    clip.startTime = App.timeline.snapEnabled ? snapTime(newStart, clip) : newStart;
    el.style.left = timeToPx(clip.startTime) + 'px';
  } else if (dragState.type === 'resize') {
    if (dragState.side === 'right') {
      clip.duration = Math.max(100, dragState.origDur + dms);
    } else {
      const newStart = Math.max(0, dragState.origStart + dms);
      const newDur = dragState.origDur - (newStart - dragState.origStart);
      if (newDur > 100) { clip.startTime = newStart; clip.duration = newDur; }
    }
    el.style.left = timeToPx(clip.startTime) + 'px';
    el.style.width = Math.max(10, timeToPx(clip.duration)) + 'px';
  }
  updateDuration();
}

function onClipMouseUp() {
  dragState = null;
  document.removeEventListener('mousemove', onClipMouseMove);
  document.removeEventListener('mouseup', onClipMouseUp);
  saveUndo();
}

function snapTime(ms, excludeClip) {
  const snap = 200;
  for (const track of App.project.tracks) {
    for (const clip of track.clips) {
      if (clip === excludeClip) continue;
      if (Math.abs(ms - clip.startTime) < snap) return clip.startTime;
      if (Math.abs(ms - (clip.startTime + clip.duration)) < snap) return clip.startTime + clip.duration;
    }
  }
  return ms;
}

// ============================================================
// 7. MEDIA IMPORT & LIBRARY
// ============================================================
function handleMediaImport(files) {
  for (const file of files) {
    const type = getMediaType(file.type, file.name);
    if (!type) continue;
    const id = uid();
    const src = URL.createObjectURL(file);
    const item = { id, name: file.name, type, src, file, duration: 5000, thumbnail: null };

    if (type === 'video') {
      const vid = document.createElement('video');
      vid.src = src; vid.preload = 'metadata';
      vid.onloadedmetadata = () => {
        item.duration = vid.duration * 1000;
        item._el = vid;
        generateVideoThumbnail(vid, item);
        addToMediaLibrary(item);
      };
      vid.onerror = () => addToMediaLibrary(item);
    } else if (type === 'image') {
      const img = new Image();
      img.src = src;
      img.onload = () => { item._el = img; item.thumbnail = src; addToMediaLibrary(item); };
      img.onerror = () => addToMediaLibrary(item);
    } else if (type === 'audio') {
      const aud = new Audio(src);
      aud.preload = 'metadata';
      aud.onloadedmetadata = () => { item.duration = aud.duration * 1000; item._el = aud; addToMediaLibrary(item); };
      aud.onerror = () => addToMediaLibrary(item);
    }
  }
}

function getMediaType(mime, name) {
  if (mime.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/i.test(name)) return 'video';
  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(name)) return 'image';
  if (mime.startsWith('audio/') || /\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(name)) return 'audio';
  return null;
}

function generateVideoThumbnail(video, item) {
  const tc = document.createElement('canvas');
  tc.width = 160; tc.height = 90;
  const tctx = tc.getContext('2d');
  video.currentTime = 0.5;
  video.onseeked = () => {
    try { tctx.drawImage(video, 0, 0, 160, 90); item.thumbnail = tc.toDataURL(); } catch(e){}
    updateMediaLibraryItem(item);
  };
}

function addToMediaLibrary(item) {
  App.mediaLibrary.push(item);
  renderMediaLibrary();
}

function updateMediaLibraryItem(item) {
  const el = document.querySelector(`[data-media-id="${item.id}"]`);
  if (!el) return renderMediaLibrary();
  const thumb = el.querySelector('.media-thumb');
  if (item.thumbnail) {
    thumb.innerHTML = `<img src="${item.thumbnail}" />`;
  }
  el.querySelector('.media-dur').textContent = formatTime(item.duration).slice(0,-4);
}

function renderMediaLibrary() {
  const lib = document.getElementById('mediaLibrary');
  const search = document.getElementById('mediaSearch').value.toLowerCase();
  const items = App.mediaLibrary.filter(i => i.name.toLowerCase().includes(search));

  if (!items.length) {
    lib.innerHTML = `<div class="empty-state"><svg viewBox="0 0 48 48" width="48" height="48" opacity=".3"><rect x="4" y="10" width="28" height="20" rx="3" stroke="currentColor" stroke-width="2" fill="none"/></svg><p>Import media to begin</p><span>Video · Audio · Images</span></div>`;
    return;
  }

  lib.innerHTML = items.map(item => {
    const thumbHTML = item.thumbnail
      ? `<img src="${item.thumbnail}" alt="${item.name}" />`
      : `<div class="media-type-icon">${item.type==='video'?'🎬':item.type==='audio'?'🎵':'🖼'}</div>`;
    return `
      <div class="media-item" data-media-id="${item.id}" draggable="true" title="${item.name}">
        <div class="media-type-badge ${item.type}">${item.type}</div>
        <div class="media-thumb">${thumbHTML}</div>
        <div class="media-info">
          <div class="media-name">${item.name}</div>
          <div class="media-dur">${formatTime(item.duration).slice(0,-4)}</div>
        </div>
      </div>`;
  }).join('');

  // Drag to timeline
  lib.querySelectorAll('.media-item').forEach(el => {
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('mediaId', el.dataset.mediaId);
      e.dataTransfer.setData('text/plain', el.dataset.mediaId);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dblclick', () => quickAddMedia(el.dataset.mediaId));
  });
}

function quickAddMedia(mediaId) {
  const item = App.mediaLibrary.find(m => m.id === mediaId);
  if (!item) return;
  let track = App.project.tracks.find(t => t.type === item.type);
  if (!track) track = createTrack(item.type, `${item.type.charAt(0).toUpperCase()+item.type.slice(1)} 1`);
  const startTime = getNextFreeTime(track);
  addMediaToTrack(mediaId, track.id, null, startTime);
}

function getNextFreeTime(track) {
  let max = 0;
  for (const clip of track.clips) max = Math.max(max, clip.startTime + clip.duration);
  return max;
}

function addMediaToTrack(mediaId, trackId, dropOffsetPx, forceStart) {
  const item = App.mediaLibrary.find(m => m.id === mediaId);
  const track = App.project.tracks.find(t => t.id === trackId);
  if (!item || !track) return;

  const startTime = forceStart != null ? forceStart : (dropOffsetPx != null ? pxToTime(dropOffsetPx) : 0);

  const clip = {
    id: uid(),
    mediaId: item.id,
    name: item.name.replace(/\.[^.]+$/, ''),
    type: item.type,
    startTime: Math.max(0, startTime),
    duration: item.duration || 5000,
    // Transform
    posX: App.project.canvas.width / 2,
    posY: App.project.canvas.height / 2,
    width: App.project.canvas.width,
    height: App.project.canvas.height,
    scale: 100, rotation: 0, opacity: 100,
    flipH: false, flipV: false,
    // Color
    brightness: 0, contrast: 0, saturation: 0, hue: 0, blur: 0,
    // Audio
    volume: 100, fadeIn: 0, fadeOut: 0,
    speed: 100,
    effects: [],
  };

  // Attach media elements
  if (item.type === 'video' && item._el) {
    const vid = item._el.cloneNode();
    vid.loop = false; vid.muted = track.muted;
    clip._videoEl = vid;
  } else if (item.type === 'image' && item._el) {
    clip._imgEl = item._el;
    clip.duration = 5000;
  } else if (item.type === 'audio' && item._el) {
    const aud = new Audio(item.src);
    clip._audioEl = aud;
  }

  addClipToTrack(trackId, clip);
  selectClip(clip.id, clip.type);
  showToast(`Added ${clip.name} to timeline`);
}

// ============================================================
// 8. CLIP SELECTION & INSPECTOR
// ============================================================
function selectClip(clipId, type) {
  App.selection.clipId = clipId;
  App.selection.type = type;

  // Highlight clip elements
  document.querySelectorAll('.clip').forEach(el => {
    el.classList.toggle('selected', el.dataset.clipId === clipId);
  });

  const clip = findClip(clipId);
  if (!clip) { showInspector(null); return; }

  showInspector(type, clip);
}

function findClip(clipId) {
  for (const track of App.project.tracks) {
    const clip = track.clips.find(c => c.id === clipId);
    if (clip) return clip;
  }
  return null;
}

function showInspector(type, clip) {
  document.getElementById('noSelection').style.display = type ? 'none' : '';
  document.getElementById('videoInspector').style.display  = type === 'video' ? '' : 'none';
  document.getElementById('textInspector').style.display   = type === 'text' ? '' : 'none';
  document.getElementById('imageInspector').style.display  = type === 'image' ? '' : 'none';
  document.getElementById('audioInspector').style.display  = type === 'audio' ? '' : 'none';

  if (!type || !clip) return;

  const id = document.getElementById('inspectorTitle');
  id.textContent = type.charAt(0).toUpperCase() + type.slice(1) + ' Inspector';

  if (type === 'video' || type === 'image') {
    const pfx = type === 'video' ? 'v' : 'i';
    setVal(pfx+'PosX', clip.posX || 0);
    setVal(pfx+'PosY', clip.posY || 0);
    setSlider(pfx+'Scale', clip.scale || 100, '%');
    setSlider(pfx+'Rotation', clip.rotation || 0, 'deg');
    setSlider(pfx+'Opacity', clip.opacity || 100, '%');
    setSlider(pfx+'Brightness', clip.brightness || 0, '');
    setSlider(pfx+'Contrast', clip.contrast || 0, '');
    setSlider(pfx+'Saturation', clip.saturation || 0, '');
    setSlider(pfx+'Hue', clip.hue || 0, 'deg');
    setSlider(pfx+'Blur', clip.blur || 0, 'px');
    if (type === 'video') {
      setSlider('vSpeed', clip.speed || 100, 'x', v => (v/100).toFixed(2)+'x');
      setSlider('vVolume', clip.volume || 100, '%');
      setSlider('vFadeIn', clip.fadeIn || 0, 's', v => (v/1000).toFixed(1)+'s');
      setSlider('vFadeOut', clip.fadeOut || 0, 's', v => (v/1000).toFixed(1)+'s');
      if (clip.width) setVal('vWidth', clip.width);
      if (clip.height) setVal('vHeight', clip.height);
      renderEffectChips(clip);
    } else {
      if (clip.width) setVal('iWidth', clip.width);
      if (clip.height) setVal('iHeight', clip.height);
    }
  } else if (type === 'audio') {
    setSlider('aVolume', clip.volume || 100, '%');
    setSlider('aFadeIn', clip.fadeIn || 0, 's', v => (v/1000).toFixed(1)+'s');
    setSlider('aFadeOut', clip.fadeOut || 0, 's', v => (v/1000).toFixed(1)+'s');
  }
}

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function setSlider(id, v, unit, fmt) {
  const el = document.getElementById(id);
  const lbl = document.getElementById(id+'Val');
  if (el) el.value = v;
  if (lbl) lbl.textContent = fmt ? fmt(v) : v+unit;
}

function renderEffectChips(clip) {
  const wrap = document.getElementById('vEffectChips');
  if (!wrap) return;
  const effects = ['Cinematic','Vignette','Film Grain','VHS','Glitch','Sepia','Cold','Warm','Dramatic'];
  wrap.innerHTML = effects.map(e =>
    `<button class="effect-chip${(clip.effects||[]).includes(e)?' active':''}" data-effect="${e}">${e}</button>`
  ).join('');
  wrap.querySelectorAll('.effect-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const clip = findClip(App.selection.clipId);
      if (!clip) return;
      clip.effects = clip.effects || [];
      const ef = btn.dataset.effect;
      const idx = clip.effects.indexOf(ef);
      if (idx>=0) clip.effects.splice(idx,1); else clip.effects.push(ef);
      btn.classList.toggle('active');
      renderCanvas();
    });
  });
}

// ============================================================
// 9. TEXT SYSTEM
// ============================================================
function addTextElement(preset = {}) {
  saveUndo();
  const te = {
    id: uid(),
    text: preset.text || 'Text',
    fontFamily: preset.fontFamily || 'Inter',
    fontSize: preset.size || 48,
    fontWeight: preset.weight || 'normal',
    italic: false, bold: (preset.weight >= 600), underline: false,
    color: '#ffffff',
    opacity: 100,
    align: 'center',
    posX: App.project.canvas.width / 2,
    posY: App.project.canvas.height / 2,
    scale: 100, rotation: 0,
    letterSpacing: 0,
    lineHeight: 120,
    maxWidth: Math.floor(App.project.canvas.width * 0.8),
    // Shadow
    shadowColor: '#000000', shadowOpacity: 60, shadowBlur: 4, shadowX: 2, shadowY: 2,
    // Bg
    bgEnabled: false, bgColor: '#000000', bgOpacity: 60, bgPadding: 10,
    // Stroke
    strokeColor: '#000000', strokeWidth: 0,
    // Animation
    animation: 'none', animDuration: 1,
    // Timeline
    startTime: App.playback.currentTime,
    duration: 5000,
    type: 'text',
  };
  App.textElements.push(te);

  // Add to a text track
  let track = App.project.tracks.find(t => t.type === 'text');
  if (!track) track = createTrack('text', 'Text');
  const clip = {
    id: te.id, mediaId: null, name: te.text, type: 'text',
    startTime: te.startTime, duration: te.duration,
    _textRef: te,
  };
  track.clips.push(clip);
  updateDuration();
  renderTimeline();
  selectTextElement(te.id);
  renderCanvas();
  showToast('Text added');
}

function selectTextElement(id) {
  App.selection.clipId = id;
  App.selection.type = 'text';
  const te = App.textElements.find(t => t.id === id);
  if (!te) return;
  showTextInspector(te);
  document.querySelectorAll('.clip').forEach(el => {
    el.classList.toggle('selected', el.dataset.clipId === id);
  });
}

function showTextInspector(te) {
  document.getElementById('noSelection').style.display = 'none';
  document.getElementById('videoInspector').style.display = 'none';
  document.getElementById('imageInspector').style.display = 'none';
  document.getElementById('audioInspector').style.display = 'none';
  document.getElementById('textInspector').style.display = '';
  document.getElementById('inspectorTitle').textContent = 'Text Inspector';

  // Populate all fields
  setVal('tContent', te.text);
  populateFontSelector(te.fontFamily);
  setVal('tSize', te.fontSize);
  document.getElementById('tBold').classList.toggle('active', te.bold);
  document.getElementById('tItalic').classList.toggle('active', te.italic);
  document.getElementById('tUnderline').classList.toggle('active', te.underline);
  ['Left','Center','Right'].forEach(a => document.getElementById('tAlign'+a).classList.toggle('active', (te.align||'center') === a.toLowerCase()));
  setVal('tColor', te.color||'#ffffff');
  setSlider('tOpacity', te.opacity||100, '%');
  setSlider('tLetterSpacing', te.letterSpacing||0, 'px');
  setSlider('tLineHeight', te.lineHeight||120, '', v => (v/100).toFixed(1));
  setVal('tMaxWidth', te.maxWidth||600);
  setVal('tShadowColor', te.shadowColor||'#000000');
  setSlider('tShadowOpacity', te.shadowOpacity||60, '%');
  setSlider('tShadowBlur', te.shadowBlur||4, 'px');
  setVal('tShadowX', te.shadowX||2);
  setVal('tShadowY', te.shadowY||2);
  document.getElementById('tBgEnabled').checked = te.bgEnabled||false;
  setVal('tBgColor', te.bgColor||'#000000');
  setSlider('tBgOpacity', te.bgOpacity||60, '%');
  setSlider('tBgPadding', te.bgPadding||10, 'px');
  setVal('tStrokeColor', te.strokeColor||'#000000');
  setSlider('tStrokeWidth', te.strokeWidth||0, 'px');
  // Transform
  setVal('tPosX', te.posX||0);
  setVal('tPosY', te.posY||0);
  setSlider('tRotation', te.rotation||0, 'deg');
  setSlider('tScale', te.scale||100, '%');
  // Animation
  setVal('tAnimType', te.animation||'none');
  setSlider('tAnimDuration', (te.animDuration||1)*10, 's', v => (v/10).toFixed(1)+'s');
}

// ============================================================
// 10. FONT SYSTEM
// ============================================================
const BUILT_IN_FONTS = [
  { name:'Inter', category:'Sans-Serif', url:'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2'},
  { name:'Roboto', category:'Sans-Serif', url:'' },
  { name:'Open Sans', category:'Sans-Serif', url:'' },
  { name:'Montserrat', category:'Sans-Serif', url:'' },
  { name:'Poppins', category:'Sans-Serif', url:'' },
  { name:'Lato', category:'Sans-Serif', url:'' },
  { name:'Nunito', category:'Sans-Serif', url:'' },
  { name:'Source Sans 3', category:'Sans-Serif', url:'' },
  { name:'Oswald', category:'Display', url:'' },
  { name:'Raleway', category:'Display', url:'' },
  { name:'Playfair Display', category:'Serif', url:'' },
  { name:'Merriweather', category:'Serif', url:'' },
  { name:'Lora', category:'Serif', url:'' },
  { name:'Georgia', category:'Serif', url:'' },
  { name:'Pacifico', category:'Handwritten', url:'' },
  { name:'Dancing Script', category:'Handwritten', url:'' },
  { name:'Caveat', category:'Handwritten', url:'' },
  { name:'Great Vibes', category:'Script', url:'' },
  { name:'JetBrains Mono', category:'Monospace', url:'' },
  { name:'Source Code Pro', category:'Monospace', url:'' },
  { name:'Bebas Neue', category:'Display', url:'' },
  { name:'Anton', category:'Display', url:'' },
  { name:'Righteous', category:'Display', url:'' },
  { name:'Fjalla One', category:'Display', url:'' },
];

function initFonts() {
  renderFontsList();
  loadGoogleFonts();
}

function loadGoogleFonts() {
  const families = BUILT_IN_FONTS.filter(f=>!f.url).map(f=>f.name.replace(/\s+/g,'+')).join('&family=');
  if (families) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${families}&display=swap`;
    document.head.appendChild(link);
  }
}

function renderFontsList() {
  const list = document.getElementById('fontsList');
  const allFonts = [...BUILT_IN_FONTS, ...App.customFonts];
  list.innerHTML = allFonts.map(f => `
    <div class="font-item" data-font="${f.name}" title="${f.category}">
      <span class="font-preview" style="font-family:'${f.name}',sans-serif">Aa</span>
      <span class="font-name">${f.name}</span>
    </div>
  `).join('');

  list.querySelectorAll('.font-item').forEach(el => {
    el.addEventListener('click', () => {
      list.querySelectorAll('.font-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      const te = App.textElements.find(t => t.id === App.selection.clipId);
      if (te) { te.fontFamily = el.dataset.font; populateFontSelector(te.fontFamily); renderCanvas(); }
    });
  });
}

function populateFontSelector(currentFont) {
  const sel = document.getElementById('tFont');
  const allFonts = [...BUILT_IN_FONTS, ...App.customFonts];
  sel.innerHTML = allFonts.map(f =>
    `<option value="${f.name}"${f.name===currentFont?' selected':''}>${f.name}</option>`
  ).join('');
}

function handleFontUpload(files) {
  for (const file of files) {
    const name = file.name.replace(/\.[^.]+$/, '');
    const src = URL.createObjectURL(file);
    const style = document.createElement('style');
    style.textContent = `@font-face { font-family: '${name}'; src: url('${src}'); }`;
    document.head.appendChild(style);
    App.customFonts.push({ name, category: 'Custom', url: src });
    showToast(`Font "${name}" loaded`);
  }
  renderFontsList();
}

// ============================================================
// 11. EFFECTS & TRANSITIONS LIBRARY
// ============================================================
const EFFECTS_LIBRARY = [
  { name:'Cinematic', category:'cinematic', icon:'🎬', css:'brightness(0.8) contrast(1.2) saturate(0.9)' },
  { name:'Vignette',  category:'cinematic', icon:'⭕', css:'' },
  { name:'Film Grain',category:'cinematic', icon:'📽️', css:'' },
  { name:'VHS',       category:'retro',     icon:'📼', css:'contrast(1.1) saturate(1.3) hue-rotate(-5deg)' },
  { name:'Sepia',     category:'retro',     icon:'🟫', css:'sepia(0.8)' },
  { name:'Glitch',    category:'glitch',    icon:'⚡', css:'' },
  { name:'Distort',   category:'glitch',    icon:'🌀', css:'' },
  { name:'Neon',      category:'light',     icon:'💡', css:'brightness(1.2) saturate(1.5)' },
  { name:'Glow',      category:'light',     icon:'✨', css:'brightness(1.1) blur(0.5px)' },
  { name:'Flash',     category:'light',     icon:'⚡', css:'brightness(2)' },
  { name:'Cold',      category:'color',     icon:'🔵', css:'hue-rotate(200deg) saturate(1.2)' },
  { name:'Warm',      category:'color',     icon:'🟠', css:'hue-rotate(-20deg) saturate(1.3)' },
  { name:'Dramatic',  category:'color',     icon:'🎭', css:'contrast(1.4) saturate(0.7)' },
  { name:'Bleach',    category:'color',     icon:'⬜', css:'contrast(1.2) brightness(1.1) saturate(0.3)' },
  { name:'Blur',      category:'blur',      icon:'💨', css:'blur(2px)' },
  { name:'Sharpen',   category:'blur',      icon:'🔍', css:'contrast(1.5)' },
  { name:'Retro',     category:'retro',     icon:'📻', css:'sepia(0.4) contrast(1.1)' },
  { name:'Black & White',category:'color',  icon:'⚫', css:'grayscale(1)' },
];

const TRANSITIONS_LIBRARY = [
  { name:'Fade',      icon:'↔️' },
  { name:'Dissolve',  icon:'🌫️' },
  { name:'Crossfade', icon:'✖️' },
  { name:'Slide Left',icon:'⬅️' },
  { name:'Slide Right',icon:'➡️' },
  { name:'Slide Up',  icon:'⬆️' },
  { name:'Push',      icon:'👉' },
  { name:'Wipe',      icon:'🪟' },
  { name:'Zoom In',   icon:'🔍' },
  { name:'Zoom Out',  icon:'🔎' },
  { name:'Blur',      icon:'💨' },
  { name:'Glitch',    icon:'⚡' },
  { name:'Flash',     icon:'💥' },
  { name:'Spin',      icon:'🔄' },
  { name:'Shake',     icon:'📳' },
];

function initEffectsPanel() {
  const grid = document.getElementById('effectsGrid');
  function renderEffects(cat) {
    const list = cat === 'all' ? EFFECTS_LIBRARY : EFFECTS_LIBRARY.filter(e => e.category === cat);
    grid.innerHTML = list.map(e => `
      <div class="effect-card" data-effect="${e.name}" title="${e.name}">
        <div class="effect-thumb">${e.icon}</div>
        <div class="effect-name">${e.name}</div>
      </div>
    `).join('');
    grid.querySelectorAll('.effect-card').forEach(card => {
      card.addEventListener('click', () => {
        const clip = findClip(App.selection.clipId);
        if (!clip) { showToast('Select a clip first'); return; }
        clip.effects = clip.effects || [];
        const ef = card.dataset.effect;
        if (!clip.effects.includes(ef)) { clip.effects.push(ef); renderCanvas(); renderEffectChips(clip); }
        showToast(`Applied: ${ef}`);
      });
    });
  }
  renderEffects('all');
  document.querySelectorAll('.cat-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderEffects(btn.dataset.cat);
    });
  });
}

function initTransitionsPanel() {
  const grid = document.getElementById('transitionsGrid');
  grid.innerHTML = TRANSITIONS_LIBRARY.map(t => `
    <div class="trans-card" title="${t.name}">
      <div class="trans-thumb">${t.icon}</div>
      <div class="trans-name">${t.name}</div>
    </div>
  `).join('');
  grid.querySelectorAll('.trans-card').forEach(card => {
    card.addEventListener('click', () => {
      const clip = findClip(App.selection.clipId);
      if (!clip) { showToast('Select a clip first'); return; }
      clip.transition = card.querySelector('.trans-name').textContent;
      showToast(`Transition set: ${clip.transition}`);
    });
  });
}

// ============================================================
// 12. INSPECTOR CONTROLS (event binding)
// ============================================================
function bindInspectorControls() {
  // Helper to bind slider + val label
  function bindSlider(id, unit, updateFn, fmtFn) {
    const el = document.getElementById(id);
    const lbl = document.getElementById(id+'Val');
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (lbl) lbl.textContent = fmtFn ? fmtFn(v) : v+unit;
      updateFn(v);
    });
  }

  function bindNum(id, updateFn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => updateFn(parseFloat(el.value) || 0));
  }

  function getVC() { return findClip(App.selection.clipId); }
  function getTE() { return App.textElements.find(t => t.id === App.selection.clipId); }

  // VIDEO inspector
  bindNum('vPosX', v => { const c=getVC(); if(c){c.posX=v; renderCanvas();} });
  bindNum('vPosY', v => { const c=getVC(); if(c){c.posY=v; renderCanvas();} });
  bindSlider('vScale', '%', v => { const c=getVC(); if(c){c.scale=v; renderCanvas();} });
  bindSlider('vRotation', 'deg', v => { const c=getVC(); if(c){c.rotation=v; renderCanvas();} });
  bindSlider('vOpacity', '%', v => { const c=getVC(); if(c){c.opacity=v; renderCanvas();} });
  bindSlider('vSpeed', 'x', v => { const c=getVC(); if(c){c.speed=v; if(c._videoEl)c._videoEl.playbackRate=v/100;} }, v=>(v/100).toFixed(2)+'x');
  bindSlider('vVolume', '%', v => { const c=getVC(); if(c){c.volume=v; if(c._videoEl)c._videoEl.volume=v/100;} });
  bindSlider('vFadeIn', 's', v => { const c=getVC(); if(c)c.fadeIn=v; }, v=>(v/1000).toFixed(1)+'s');
  bindSlider('vFadeOut', 's', v => { const c=getVC(); if(c)c.fadeOut=v; }, v=>(v/1000).toFixed(1)+'s');
  bindSlider('vBrightness', '', v => { const c=getVC(); if(c){c.brightness=v; renderCanvas();} });
  bindSlider('vContrast', '', v => { const c=getVC(); if(c){c.contrast=v; renderCanvas();} });
  bindSlider('vSaturation', '', v => { const c=getVC(); if(c){c.saturation=v; renderCanvas();} });
  bindSlider('vHue', 'deg', v => { const c=getVC(); if(c){c.hue=v; renderCanvas();} });
  bindSlider('vBlur', 'px', v => { const c=getVC(); if(c){c.blur=v; renderCanvas();} });

  document.getElementById('vFlipH')?.addEventListener('click', () => { const c=getVC(); if(c){c.flipH=!c.flipH; renderCanvas();} });
  document.getElementById('vFlipV')?.addEventListener('click', () => { const c=getVC(); if(c){c.flipV=!c.flipV; renderCanvas();} });

  // IMAGE inspector
  bindNum('iPosX', v => { const c=getVC(); if(c){c.posX=v; renderCanvas();} });
  bindNum('iPosY', v => { const c=getVC(); if(c){c.posY=v; renderCanvas();} });
  bindSlider('iScale', '%', v => { const c=getVC(); if(c){c.scale=v; renderCanvas();} });
  bindSlider('iRotation', 'deg', v => { const c=getVC(); if(c){c.rotation=v; renderCanvas();} });
  bindSlider('iOpacity', '%', v => { const c=getVC(); if(c){c.opacity=v; renderCanvas();} });
  bindSlider('iBrightness', '', v => { const c=getVC(); if(c){c.brightness=v; renderCanvas();} });
  bindSlider('iContrast', '', v => { const c=getVC(); if(c){c.contrast=v; renderCanvas();} });
  bindSlider('iSaturation', '', v => { const c=getVC(); if(c){c.saturation=v; renderCanvas();} });
  bindSlider('iHue', 'deg', v => { const c=getVC(); if(c){c.hue=v; renderCanvas();} });
  bindSlider('iBlur', 'px', v => { const c=getVC(); if(c){c.blur=v; renderCanvas();} });
  document.getElementById('iFlipH')?.addEventListener('click', () => { const c=getVC(); if(c){c.flipH=!c.flipH; renderCanvas();} });
  document.getElementById('iFlipV')?.addEventListener('click', () => { const c=getVC(); if(c){c.flipV=!c.flipV; renderCanvas();} });

  // AUDIO inspector
  bindSlider('aVolume', '%', v => { const c=getVC(); if(c){c.volume=v; if(c._audioEl)c._audioEl.volume=v/100;} });
  bindSlider('aFadeIn', 's', v => { const c=getVC(); if(c)c.fadeIn=v; }, v=>(v/1000).toFixed(1)+'s');
  bindSlider('aFadeOut', 's', v => { const c=getVC(); if(c)c.fadeOut=v; }, v=>(v/1000).toFixed(1)+'s');

  // TEXT inspector
  const textUpdate = (fn) => { const te=getTE(); if(te){fn(te); renderCanvas();} };

  document.getElementById('tContent')?.addEventListener('input', e => textUpdate(te => { te.text=e.target.value; updateTextClipLabel(te); }));
  document.getElementById('tFont')?.addEventListener('change', e => textUpdate(te => te.fontFamily=e.target.value));
  document.getElementById('tSize')?.addEventListener('input', e => textUpdate(te => te.fontSize=parseInt(e.target.value)||48));
  document.getElementById('tColor')?.addEventListener('input', e => textUpdate(te => te.color=e.target.value));
  document.getElementById('tBold')?.addEventListener('click', function() { textUpdate(te => te.bold=!te.bold); this.classList.toggle('active'); });
  document.getElementById('tItalic')?.addEventListener('click', function() { textUpdate(te => te.italic=!te.italic); this.classList.toggle('active'); });
  document.getElementById('tUnderline')?.addEventListener('click', function() { textUpdate(te => te.underline=!te.underline); this.classList.toggle('active'); });

  ['Left','Center','Right'].forEach(a => {
    document.getElementById('tAlign'+a)?.addEventListener('click', function() {
      textUpdate(te => te.align=a.toLowerCase());
      document.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
    });
  });

  bindSlider('tOpacity', '%', v => textUpdate(te => te.opacity=v));
  bindSlider('tLetterSpacing', 'px', v => textUpdate(te => te.letterSpacing=v));
  bindSlider('tLineHeight', '', v => { const lbl=document.getElementById('tLHVal'); if(lbl)lbl.textContent=(v/100).toFixed(1); textUpdate(te => te.lineHeight=v); });
  document.getElementById('tMaxWidth')?.addEventListener('input', e => textUpdate(te => te.maxWidth=parseInt(e.target.value)||600));
  document.getElementById('tShadowColor')?.addEventListener('input', e => textUpdate(te => te.shadowColor=e.target.value));
  bindSlider('tShadowOpacity', '%', v => textUpdate(te => te.shadowOpacity=v));
  bindSlider('tShadowBlur', 'px', v => textUpdate(te => te.shadowBlur=v));
  document.getElementById('tShadowX')?.addEventListener('input', e => textUpdate(te => te.shadowX=parseFloat(e.target.value)||0));
  document.getElementById('tShadowY')?.addEventListener('input', e => textUpdate(te => te.shadowY=parseFloat(e.target.value)||0));
  document.getElementById('tBgEnabled')?.addEventListener('change', e => textUpdate(te => te.bgEnabled=e.target.checked));
  document.getElementById('tBgColor')?.addEventListener('input', e => textUpdate(te => te.bgColor=e.target.value));
  bindSlider('tBgOpacity', '%', v => textUpdate(te => te.bgOpacity=v));
  bindSlider('tBgPadding', 'px', v => textUpdate(te => te.bgPadding=v));
  document.getElementById('tStrokeColor')?.addEventListener('input', e => textUpdate(te => te.strokeColor=e.target.value));
  bindSlider('tStrokeWidth', 'px', v => textUpdate(te => te.strokeWidth=v));

  // Text transform
  bindNum('tPosX', v => textUpdate(te => te.posX=v));
  bindNum('tPosY', v => textUpdate(te => te.posY=v));
  bindSlider('tRotation', 'deg', v => textUpdate(te => te.rotation=v));
  bindSlider('tScale', '%', v => textUpdate(te => te.scale=v));

  // Text animation
  document.getElementById('tAnimType')?.addEventListener('change', e => textUpdate(te => te.animation=e.target.value));
  bindSlider('tAnimDuration', 's', v => { const lbl=document.getElementById('tADVal'); if(lbl)lbl.textContent=(v/10).toFixed(1)+'s'; textUpdate(te => te.animDuration=v/10); });

  // Inspector tabs
  document.querySelectorAll('.insp-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      const parent = this.closest('.inspector-content') || this.closest('.insp-tabs').parentElement;
      parent.querySelectorAll('.insp-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      const tabId = this.dataset.tab;
      parent.querySelectorAll('.insp-tab-content').forEach(tc => {
        tc.classList.toggle('active', tc.id.endsWith('-'+tabId) || tc.id === tabId+'-content');
      });
      // fallback: just try matching
      const allTabContents = document.querySelectorAll('.insp-tab-content');
      allTabContents.forEach(tc => {
        if (tc.id.includes(tabId)) { tc.classList.add('active'); }
      });
    });
  });
}

function updateTextClipLabel(te) {
  const clip = findClip(te.id);
  if (clip) clip.name = te.text.slice(0, 20);
  const el = document.querySelector(`[data-clip-id="${te.id}"] .clip-label`);
  if (el) el.textContent = te.text.slice(0, 30);
}

// ============================================================
// 13. BACKGROUND PANEL
// ============================================================
function initBackgroundPanel() {
  const tabs = document.querySelectorAll('.bg-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.bg-panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('bg'+tab.dataset.bg.charAt(0).toUpperCase()+tab.dataset.bg.slice(1)+'Panel');
      if (panel) panel.classList.add('active');
    });
  });

  const bgColor = document.getElementById('bgColor');
  const bgColorHex = document.getElementById('bgColorHex');
  bgColor?.addEventListener('input', () => { bgColorHex.value = bgColor.value; });
  bgColorHex?.addEventListener('input', () => {
    if (/^#[0-9a-f]{6}$/i.test(bgColorHex.value)) bgColor.value = bgColorHex.value;
  });

  document.querySelectorAll('.cswatch').forEach(s => {
    s.addEventListener('click', () => {
      if (bgColor) bgColor.value = s.dataset.color;
      if (bgColorHex) bgColorHex.value = s.dataset.color;
    });
  });

  const bgGradAngle = document.getElementById('bgGradAngle');
  bgGradAngle?.addEventListener('input', () => {
    document.getElementById('bgGradAngleVal').textContent = bgGradAngle.value + 'deg';
  });

  document.getElementById('bgImageInput')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const src = URL.createObjectURL(file);
    const img = new Image(); img.src = src;
    img.onload = () => {
      App.bgImage = img;
      const preview = document.getElementById('bgImagePreview');
      preview.innerHTML = `<img src="${src}" />`;
    };
  });

  document.getElementById('applyBgBtn')?.addEventListener('click', applyBackground);
}

function applyBackground() {
  const activeTab = document.querySelector('.bg-tab.active')?.dataset.bg || 'solid';
  if (activeTab === 'solid') {
    App.project.canvas.bg = { type:'solid', color: document.getElementById('bgColor')?.value || '#1a1a2e' };
  } else if (activeTab === 'gradient') {
    App.project.canvas.bg = {
      type:'gradient',
      color1: document.getElementById('bgGrad1')?.value || '#6c63ff',
      color2: document.getElementById('bgGrad2')?.value || '#ff6584',
      angle: parseInt(document.getElementById('bgGradAngle')?.value || 135),
    };
  } else if (activeTab === 'image') {
    App.project.canvas.bg = { type:'image' };
  } else {
    App.project.canvas.bg = { type:'transparent' };
  }
  renderCanvas();
  showToast('Background applied');
}

// ============================================================
// 14. PLAYHEAD / RULER INTERACTION
// ============================================================
function updatePlayheadPosition() {
  const ph = document.getElementById('playheadLine');
  if (!ph) return;
  const x = timeToPx(App.playback.currentTime);
  ph.style.left = x + 'px';
}

function setupRulerClick() {
  const ruler = document.getElementById('timelineRuler');
  if (!ruler) return;
  ruler.addEventListener('click', e => {
    const rect = ruler.getBoundingClientRect();
    const x = e.clientX - rect.left + document.getElementById('timelineScroll').scrollLeft;
    seekTo(pxToTime(x));
  });
  ruler.addEventListener('mousedown', e => {
    const doSeek = (ev) => {
      const rect = ruler.getBoundingClientRect();
      const x = ev.clientX - rect.left + document.getElementById('timelineScroll').scrollLeft;
      seekTo(Math.max(0, pxToTime(x)));
    };
    const up = () => { document.removeEventListener('mousemove', doSeek); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', doSeek);
    document.addEventListener('mouseup', up);
  });
}

// ============================================================
// 15. SPLIT & DELETE
// ============================================================
function splitAtPlayhead() {
  if (!App.selection.clipId) { showToast('Select a clip first'); return; }
  const t = App.playback.currentTime;

  // Find the clip
  let targetClip = null, targetTrack = null;
  for (const track of App.project.tracks) {
    const clip = track.clips.find(c => c.id === App.selection.clipId);
    if (clip) { targetClip = clip; targetTrack = track; break; }
  }

  // Also check text elements
  if (!targetClip) {
    const te = App.textElements.find(t => t.id === App.selection.clipId);
    if (te) { splitTextElement(te, t); return; }
  }
  if (!targetClip || t <= targetClip.startTime || t >= targetClip.startTime + targetClip.duration) {
    showToast('Playhead must be within selected clip'); return;
  }

  saveUndo();
  const rightDur = (targetClip.startTime + targetClip.duration) - t;
  const newClip = {
    ...targetClip,
    id: uid(),
    startTime: t,
    duration: rightDur,
  };
  if (newClip._videoEl) {
    const item = App.mediaLibrary.find(m => m.id === newClip.mediaId);
    if (item?._el) newClip._videoEl = item._el.cloneNode();
  }
  targetClip.duration = t - targetClip.startTime;
  targetTrack.clips.push(newClip);
  updateDuration();
  renderTimeline();
  showToast('Clip split');
}

function splitTextElement(te, t) {
  saveUndo();
  const newTe = { ...te, id: uid(), startTime: t, duration: (te.startTime + te.duration) - t };
  te.duration = t - te.startTime;
  App.textElements.push(newTe);
  // Also add to track
  for (const track of App.project.tracks) {
    const clip = track.clips.find(c => c.id === te.id);
    if (clip) {
      const newClip = { ...clip, id: newTe.id, startTime: t, duration: newTe.duration, _textRef: newTe };
      clip.duration = te.duration;
      track.clips.push(newClip);
      break;
    }
  }
  updateDuration();
  renderTimeline();
  showToast('Text split');
}

function deleteSelected() {
  if (!App.selection.clipId) return;
  saveUndo();
  for (const track of App.project.tracks) {
    const idx = track.clips.findIndex(c => c.id === App.selection.clipId);
    if (idx >= 0) { track.clips.splice(idx, 1); break; }
  }
  const teIdx = App.textElements.findIndex(t => t.id === App.selection.clipId);
  if (teIdx >= 0) App.textElements.splice(teIdx, 1);
  App.selection.clipId = null; App.selection.type = null;
  showInspector(null);
  updateDuration(); renderTimeline(); renderCanvas();
  showToast('Deleted');
}

// ============================================================
// 16. CONTEXT MENU
// ============================================================
function showContextMenu(x, y, clip, track) {
  const menu = document.getElementById('contextMenu');
  menu.style.display = 'block';
  menu.style.left = x+'px'; menu.style.top = y+'px';
  menu._clip = clip; menu._track = track;
}

function hideContextMenu() {
  document.getElementById('contextMenu').style.display = 'none';
}

function setupContextMenu() {
  document.getElementById('ctx-split')?.addEventListener('click', () => { hideContextMenu(); splitAtPlayhead(); });
  document.getElementById('ctx-duplicate')?.addEventListener('click', () => {
    hideContextMenu();
    const menu = document.getElementById('contextMenu');
    const clip = menu._clip, track = menu._track;
    if (!clip || !track) return;
    saveUndo();
    const dup = { ...clip, id: uid(), startTime: clip.startTime + clip.duration + 200 };
    track.clips.push(dup);
    updateDuration(); renderTimeline();
    showToast('Duplicated');
  });
  document.getElementById('ctx-delete')?.addEventListener('click', () => { hideContextMenu(); deleteSelected(); });
  document.getElementById('ctx-mute')?.addEventListener('click', () => {
    hideContextMenu();
    const menu = document.getElementById('contextMenu');
    const track = menu._track;
    if (!track) return;
    track.muted = !track.muted;
    renderTimeline();
    showToast(track.muted ? 'Track muted' : 'Track unmuted');
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#contextMenu')) hideContextMenu();
  });
}

// ============================================================
// 17. TRACK LABEL BUTTONS
// ============================================================
function setupTrackLabelButtons() {
  document.querySelectorAll('.track-mute-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const track = App.project.tracks.find(t => t.id === btn.dataset.id);
      if (!track) return;
      track.muted = !track.muted;
      btn.classList.toggle('muted', track.muted);
    });
  });
  document.querySelectorAll('.track-vis-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const track = App.project.tracks.find(t => t.id === btn.dataset.id);
      if (!track) return;
      track.hidden = !track.hidden;
      btn.classList.toggle('hidden', track.hidden);
      renderCanvas();
    });
  });
  document.querySelectorAll('.track-lock-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const track = App.project.tracks.find(t => t.id === btn.dataset.id);
      if (!track) return;
      track.locked = !track.locked;
      btn.classList.toggle('active', track.locked);
    });
  });
}

// ============================================================
// 18. EXPORT / RENDER
// ============================================================
let exportRaf = null;

function startExport() {
  if (!App.project.duration || App.project.duration <= 0) {
    showToast('Please add media or text to the timeline before exporting');
    return;
  }
  const format = document.getElementById('expFormat').value;
  const res    = parseInt(document.getElementById('expRes').value);
  const fps    = parseInt(document.getElementById('expFPS').value);
  const quality = document.getElementById('expQuality').value;

  document.getElementById('exportSettings').style.display = 'none';
  document.getElementById('exportProgress').style.display = '';
  document.getElementById('exportDone').style.display = 'none';
  document.getElementById('exportError').style.display = 'none';

  const qualBR = { low: 2e6, medium: 5e6, high: 10e6 };
  const bitrate = qualBR[quality] || 8e6;

  // Scale canvas for export
  const { width: cW, height: cH } = App.project.canvas;
  const scaleF = res / cH;
  const expW = Math.round(cW * scaleF), expH = res;

  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = expW; offscreenCanvas.height = expH;
  const offCtx = offscreenCanvas.getContext('2d');

  let mimeType = 'video/webm;codecs=vp9';
  let ext = 'webm';
  if (format === 'mp4') {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) {
      mimeType = 'video/mp4;codecs=avc1'; ext = 'mp4';
    } else if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4')) {
      mimeType = 'video/mp4'; ext = 'mp4';
    } else if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
      mimeType = 'video/webm;codecs=vp9'; ext = 'mp4';
    } else {
      mimeType = 'video/webm'; ext = 'mp4';
    }
  } else {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
      mimeType = 'video/webm;codecs=vp9'; ext = 'webm';
    } else if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
      mimeType = 'video/webm;codecs=vp8'; ext = 'webm';
    } else {
      mimeType = 'video/webm'; ext = 'webm';
    }
  }

  let mr;
  try {
    mr = new MediaRecorder(offscreenCanvas.captureStream(fps), { mimeType, videoBitsPerSecond: bitrate });
  } catch(e) {
    try {
      mr = new MediaRecorder(offscreenCanvas.captureStream(fps), { mimeType: 'video/webm' });
      mimeType = 'video/webm';
    } catch(e2) {
      showExportError('MediaRecorder not supported: ' + e2.message);
      return;
    }
  }

  const chunks = [];
  mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  mr.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const dl = document.getElementById('downloadLink');
    dl.href = url;
    const safeName = (App.project.name || 'cutflow-export').trim().replace(/[^a-zA-Z0-9_\- ]/g, '') || 'cutflow-export';
    dl.download = `${safeName}.${ext}`;
    document.getElementById('exportProgress').style.display = 'none';
    document.getElementById('exportDone').style.display = '';
    showToast('Export complete!');
  };

  mr.start(1000 / fps);
  const totalDur = App.project.duration;
  const frameMs = 1000 / fps;
  let frameTime = 0;

  const updateStatus = (pct) => {
    document.getElementById('expProgressBar').style.width = pct + '%';
    document.getElementById('expPercent').textContent = Math.round(pct) + '%';
    document.getElementById('expStatus').textContent = `Rendering: ${formatTime(frameTime)} / ${formatTime(totalDur)}`;
  };

  const renderFrame = () => {
    if (frameTime > totalDur) { mr.stop(); return; }

    // Render to offscreen canvas
    offCtx.save();
    offCtx.scale(expW / cW, expH / cH);

    // Re-draw using same logic as renderCanvas but on offCtx
    const { bg } = App.project.canvas;
    offCtx.clearRect(0, 0, cW, cH);
    if (bg.type === 'solid') { offCtx.fillStyle = bg.color; offCtx.fillRect(0,0,cW,cH); }
    else if (bg.type === 'gradient') {
      const grad = offCtx.createLinearGradient(...gradCoords(bg.angle||135,cW,cH));
      grad.addColorStop(0, bg.color1); grad.addColorStop(1, bg.color2);
      offCtx.fillStyle = grad; offCtx.fillRect(0,0,cW,cH);
    } else if (bg.type === 'image' && App.bgImage) {
      offCtx.drawImage(App.bgImage, 0,0,cW,cH);
    } else { offCtx.fillStyle='#000'; offCtx.fillRect(0,0,cW,cH); }

    for (const track of App.project.tracks) {
      if (track.hidden) continue;
      for (const clip of track.clips) {
        if (frameTime < clip.startTime || frameTime > clip.startTime + clip.duration) continue;
        offCtx.save();
        // Same transform as main canvas
        const cxP = clip.posX != null ? clip.posX : cW/2;
        const cyP = clip.posY != null ? clip.posY : cH/2;
        offCtx.translate(cxP, cyP);
        const scale = (clip.scale||100)/100;
        offCtx.rotate((clip.rotation||0)*Math.PI/180);
        offCtx.scale(clip.flipH?-scale:scale, clip.flipV?-scale:scale);
        offCtx.globalAlpha = (clip.opacity||100)/100;
        const filters = [];
        if (clip.brightness) filters.push(`brightness(${1+clip.brightness/100})`);
        if (clip.contrast)   filters.push(`contrast(${1+clip.contrast/100})`);
        if (clip.saturation) filters.push(`saturate(${1+clip.saturation/100})`);
        if (clip.hue)        filters.push(`hue-rotate(${clip.hue}deg)`);
        if (clip.blur)       filters.push(`blur(${clip.blur}px)`);
        offCtx.filter = filters.join(' ') || 'none';
        if (clip.type==='video' && clip._videoEl) {
          try { offCtx.drawImage(clip._videoEl, -(clip.width||cW)/2, -(clip.height||cH)/2, clip.width||cW, clip.height||cH); } catch(e){}
        } else if (clip.type==='image' && clip._imgEl) {
          try { offCtx.drawImage(clip._imgEl, -(clip.width||cW)/2, -(clip.height||cH)/2, clip.width||cW, clip.height||cH); } catch(e){}
        }
        offCtx.restore();
      }
    }

    // Text
    for (const te of App.textElements) {
      if (frameTime < te.startTime || frameTime > te.startTime + te.duration) continue;
      // Simplified text render for export
      offCtx.save();
      offCtx.globalAlpha = (te.opacity||100)/100;
      offCtx.translate(te.posX||cW/2, te.posY||cH/2);
      offCtx.rotate((te.rotation||0)*Math.PI/180);
      offCtx.scale((te.scale||100)/100, (te.scale||100)/100);
      const weight = te.bold?'bold':(te.fontWeight||'normal');
      const style  = te.italic?'italic':'normal';
      offCtx.font = `${style} ${weight} ${te.fontSize||48}px "${te.fontFamily||'Inter'}", sans-serif`;
      offCtx.textAlign = te.align||'center';
      offCtx.textBaseline = 'middle';
      if (te.shadowBlur||te.shadowX||te.shadowY) {
        offCtx.shadowColor = hexToRgba(te.shadowColor||'#000',(te.shadowOpacity||60)/100);
        offCtx.shadowBlur=te.shadowBlur||0; offCtx.shadowOffsetX=te.shadowX||0; offCtx.shadowOffsetY=te.shadowY||0;
      }
      offCtx.fillStyle = te.color||'#fff';
      const lines = wrapText(offCtx, te.text||'Text', te.maxWidth||800);
      const lineH = (te.fontSize||48) * ((te.lineHeight||120)/100);
      lines.forEach((line,i) => offCtx.fillText(line, 0, (i-(lines.length-1)/2)*lineH));
      offCtx.restore();
    }

    offCtx.restore();

    frameTime += frameMs;
    updateStatus((frameTime / totalDur) * 100);
    exportRaf = setTimeout(renderFrame, 0);
  };

  renderFrame();
}

function showExportError(msg) {
  document.getElementById('exportProgress').style.display = 'none';
  document.getElementById('exportError').style.display = '';
  document.getElementById('expErrorMsg').textContent = msg;
}

// ============================================================
// 19. PROJECT SAVE / LOAD
// ============================================================
function saveProject() {
  const data = {
    name: App.project.name,
    canvas: App.project.canvas,
    tracks: App.project.tracks.map(t => ({
      ...t,
      clips: t.clips.map(c => {
        const {_videoEl, _imgEl, _audioEl, _textRef, ...rest} = c;
        return rest;
      })
    })),
    textElements: App.textElements,
    duration: App.project.duration,
    mediaLibrary: App.mediaLibrary.map(m => ({ id:m.id, name:m.name, type:m.type })),
  };
  try {
    localStorage.setItem('cutflow_project', JSON.stringify(data));
    showToast('Project saved');
  } catch(e) {
    showToast('Save failed (storage full?)');
  }
}

function newProject() {
  pause();
  App.project.tracks = [];
  App.project.duration = 0;
  App.textElements = [];
  App.mediaLibrary = [];
  App.selection = { clipId: null, type: null };
  App.undoStack = []; App.redoStack = [];
  App.bgImage = null;
  App.project.canvas.bg = { type:'solid', color:'#1a1a2e' };
  renderTimeline();
  renderMediaLibrary();
  renderCanvas();
  updateTimeDisplay();
  showInspector(null);
  showToast('New project created');
}

// ============================================================
// 20. KEYBOARD SHORTCUTS
// ============================================================
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const tag = e.target.tagName.toLowerCase();
    if (['input','textarea','select'].includes(tag)) return;

    if (e.code === 'Space') { e.preventDefault(); App.playback.playing ? pause() : play(); }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); deleteSelected(); }
    if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); splitAtPlayhead(); }
    if ((e.ctrlKey||e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); }
    if ((e.ctrlKey||e.metaKey) && (e.code === 'KeyY' || (e.shiftKey && e.code === 'KeyZ'))) { e.preventDefault(); redo(); }
    if ((e.ctrlKey||e.metaKey) && e.code === 'KeyS') { e.preventDefault(); saveProject(); }

    // Arrow keys to move text
    if (e.target === document.body || e.target === document.documentElement) {
      const te = App.textElements.find(t => t.id === App.selection.clipId);
      if (te) {
        const step = e.shiftKey ? 10 : 1;
        if (e.code === 'ArrowLeft')  { te.posX -= step; renderCanvas(); syncTextPosUI(te); }
        if (e.code === 'ArrowRight') { te.posX += step; renderCanvas(); syncTextPosUI(te); }
        if (e.code === 'ArrowUp')    { te.posY -= step; renderCanvas(); syncTextPosUI(te); }
        if (e.code === 'ArrowDown')  { te.posY += step; renderCanvas(); syncTextPosUI(te); }
      }
    }
  });
}

function syncTextPosUI(te) {
  setVal('tPosX', Math.round(te.posX));
  setVal('tPosY', Math.round(te.posY));
}

// ============================================================
// 21. CANVAS ZOOM
// ============================================================
function initCanvasZoom() {
  document.getElementById('btnZoomIn')?.addEventListener('click', () => {
    App.canvasScale = Math.min(3, App.canvasScale + 0.1);
    canvas.style.width  = Math.floor(canvas.width  * App.canvasScale) + 'px';
    canvas.style.height = Math.floor(canvas.height * App.canvasScale) + 'px';
    document.getElementById('canvasZoomLabel').textContent = Math.round(App.canvasScale*100)+'%';
  });
  document.getElementById('btnZoomOut')?.addEventListener('click', () => {
    App.canvasScale = Math.max(0.1, App.canvasScale - 0.1);
    canvas.style.width  = Math.floor(canvas.width  * App.canvasScale) + 'px';
    canvas.style.height = Math.floor(canvas.height * App.canvasScale) + 'px';
    document.getElementById('canvasZoomLabel').textContent = Math.round(App.canvasScale*100)+'%';
  });
  document.getElementById('btnFitScreen')?.addEventListener('click', fitCanvas);
}

// ============================================================
// 22. RATIO MODAL
// ============================================================
function initRatioModal() {
  document.getElementById('btnRatio')?.addEventListener('click', () => showModal('ratioModal'));

  document.querySelectorAll('.ratio-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ratio-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setCanvasRatio(parseInt(btn.dataset.w), parseInt(btn.dataset.h), btn.dataset.label);
      hideModal('ratioModal');
    });
  });

  document.getElementById('applyCustomRatio')?.addEventListener('click', () => {
    const w = parseInt(document.getElementById('customW').value) || 1920;
    const h = parseInt(document.getElementById('customH').value) || 1080;
    setCanvasRatio(w, h, `${w}×${h}`);
    hideModal('ratioModal');
  });
}

function setCanvasRatio(w, h, label) {
  App.project.canvas.width = w;
  App.project.canvas.height = h;
  App.project.canvas.ratio = label;
  setCanvasSize(w, h);
  document.getElementById('currentRatioLabel').textContent = label;
  renderCanvas();
  showToast(`Canvas: ${w}×${h} (${label})`);
}

// ============================================================
// 23. FULLSCREEN PREVIEW
// ============================================================
function initFullscreenPreview() {
  document.getElementById('btnPreview')?.addEventListener('click', () => {
    const overlay = document.getElementById('fullscreenPreview');
    overlay.style.display = 'flex';
    const fsCanvas = document.getElementById('fsCanvas');
    fsCanvas.width = App.project.canvas.width;
    fsCanvas.height = App.project.canvas.height;
    const fCtx = fsCanvas.getContext('2d');
    fCtx.drawImage(canvas, 0, 0);
    if (!App.playback.playing) play();
  });
  document.getElementById('fsClose')?.addEventListener('click', () => {
    document.getElementById('fullscreenPreview').style.display = 'none';
    pause();
  });
}

// ============================================================
// 24. MODAL HELPERS
// ============================================================
function showModal(id) { document.getElementById(id).style.display='flex'; }
function hideModal(id) { document.getElementById(id).style.display='none'; }

function setupModals() {
  document.querySelectorAll('.modal-close[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => hideModal(btn.dataset.modal));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.style.display = 'none';
    });
  });
  document.getElementById('btnExport')?.addEventListener('click', () => {
    document.getElementById('exportSettings').style.display = '';
    document.getElementById('exportProgress').style.display = 'none';
    document.getElementById('exportDone').style.display = 'none';
    document.getElementById('exportError').style.display = 'none';
    showModal('exportModal');
  });
  document.getElementById('startExportBtn')?.addEventListener('click', startExport);
  document.getElementById('expRetry')?.addEventListener('click', () => {
    document.getElementById('exportSettings').style.display = '';
    document.getElementById('exportError').style.display = 'none';
  });
  document.getElementById('expNewExport')?.addEventListener('click', () => {
    document.getElementById('exportSettings').style.display = '';
    document.getElementById('exportDone').style.display = 'none';
  });
  document.getElementById('btnNewProject')?.addEventListener('click', () => showModal('newProjectModal'));
  document.getElementById('confirmNewProject')?.addEventListener('click', () => { newProject(); hideModal('newProjectModal'); });
  document.getElementById('btnSave')?.addEventListener('click', saveProject);
}

// ============================================================
// 25. LEFT PANEL NAVIGATION
// ============================================================
function setupLeftNav() {
  document.querySelectorAll('.lnav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lnav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.lpanel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('panel-' + btn.dataset.panel);
      if (panel) panel.classList.add('active');
    });
  });
}

// ============================================================
// 26. TIMELINE ZOOM
// ============================================================
function setupTimelineZoom() {
  document.getElementById('tlZoom')?.addEventListener('input', e => {
    App.timeline.zoom = parseInt(e.target.value) * 0.5 + 10;
    document.getElementById('tlZoomLabel').textContent = e.target.value + '%';
    renderTimeline();
  });
  document.getElementById('btnSnap')?.addEventListener('click', function() {
    App.timeline.snapEnabled = !App.timeline.snapEnabled;
    this.classList.toggle('active', App.timeline.snapEnabled);
  });
}

// ============================================================
// 27. PLAYBACK CONTROL BINDINGS
// ============================================================
function setupPlaybackControls() {
  document.getElementById('btnPlay')?.addEventListener('click', () => App.playback.playing ? pause() : play());
  document.getElementById('btnStop')?.addEventListener('click', stop);
  document.getElementById('btnFramePrev')?.addEventListener('click', () => seekTo(App.playback.currentTime - 1000/30));
  document.getElementById('btnFrameNext')?.addEventListener('click', () => seekTo(App.playback.currentTime + 1000/30));
  document.getElementById('btnSplit')?.addEventListener('click', splitAtPlayhead);
  document.getElementById('btnDelete')?.addEventListener('click', deleteSelected);
  document.getElementById('pbSpeed')?.addEventListener('change', e => { App.playback.speed = parseFloat(e.target.value); });
  document.getElementById('btnUndo')?.addEventListener('click', undo);
  document.getElementById('btnRedo')?.addEventListener('click', redo);
}

// ============================================================
// 28. MEDIA IMPORT BINDING
// ============================================================
function setupMediaImport() {
  document.getElementById('importInput')?.addEventListener('change', e => {
    handleMediaImport(Array.from(e.target.files));
    e.target.value = '';
  });
  document.getElementById('mediaSearch')?.addEventListener('input', renderMediaLibrary);

  // Drag & drop on whole app
  document.getElementById('previewArea')?.addEventListener('dragover', e => e.preventDefault());
  document.getElementById('previewArea')?.addEventListener('drop', e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleMediaImport(files);
  });

  // Font upload
  document.getElementById('fontUploadInput')?.addEventListener('change', e => {
    handleFontUpload(Array.from(e.target.files));
    e.target.value = '';
  });
}

// ============================================================
// 29. TEXT PRESET BUTTONS
// ============================================================
function setupTextPresets() {
  document.querySelectorAll('.text-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      addTextElement({ size: parseInt(btn.dataset.size), weight: parseInt(btn.dataset.weight), text: btn.querySelector('span').textContent.trim() });
    });
  });

  document.querySelectorAll('.anim-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const te = App.textElements.find(t => t.id === App.selection.clipId);
      if (!te) { showToast('Select a text element first'); return; }
      te.animation = chip.dataset.anim;
      setVal('tAnimType', te.animation);
      renderCanvas();
    });
  });
}

// ============================================================
// 30. TRACK BUTTONS
// ============================================================
function setupTrackButtons() {
  document.getElementById('btnAddVideoTrack')?.addEventListener('click', () => {
    createTrack('video', `Video ${App.project.tracks.filter(t=>t.type==='video').length+1}`);
  });
  document.getElementById('btnAddAudioTrack')?.addEventListener('click', () => {
    createTrack('audio', `Audio ${App.project.tracks.filter(t=>t.type==='audio').length+1}`);
  });
}

// ============================================================
// 31. PROJECT NAME
// ============================================================
function setupProjectName() {
  document.getElementById('projectName')?.addEventListener('input', e => {
    App.project.name = e.target.value;
  });
}

// ============================================================
// 32. WINDOW RESIZE
// ============================================================
function setupResize() {
  window.addEventListener('resize', () => { fitCanvas(); renderRuler(); });
}

// ============================================================
// 33. CANVAS CLICK (to deselect or select text)
// ============================================================
function setupCanvasInteraction() {
  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / App.canvasScale;
    const y = (e.clientY - rect.top)  / App.canvasScale;

    // Check if clicking a text element
    let found = false;
    for (const te of App.textElements) {
      const t = App.playback.currentTime;
      if (t < te.startTime || t > te.startTime + te.duration) continue;
      const tx = te.posX || App.project.canvas.width/2;
      const ty = te.posY || App.project.canvas.height/2;
      if (Math.abs(x-tx) < 100 && Math.abs(y-ty) < 50) {
        selectTextElement(te.id);
        found = true; break;
      }
    }
    if (!found && App.selection.type !== 'video') {
      App.selection.clipId = null; App.selection.type = null;
      showInspector(null);
      document.querySelectorAll('.clip').forEach(c => c.classList.remove('selected'));
    }
  });
}

// ============================================================
// INITIALIZATION
// ============================================================
function init() {
  // Setup canvas
  setCanvasSize(App.project.canvas.width, App.project.canvas.height);

  // Create default tracks
  createTrack('video', 'Video 1');
  createTrack('audio', 'Audio 1');

  // Init all modules
  initFonts();
  initEffectsPanel();
  initTransitionsPanel();
  initBackgroundPanel();
  initRatioModal();
  initCanvasZoom();
  initFullscreenPreview();
  setupModals();
  setupLeftNav();
  setupTimelineZoom();
  setupPlaybackControls();
  setupMediaImport();
  setupTextPresets();
  setupTrackButtons();
  setupProjectName();
  setupKeyboardShortcuts();
  setupContextMenu();
  setupCanvasInteraction();
  setupRulerClick();
  setupResize();
  bindInspectorControls();

  // Initial render
  renderCanvas();
  updateTimeDisplay();

  // Sync snap button
  document.getElementById('btnSnap')?.classList.add('active');

  showToast('CutFlow ready! Import media or add text to begin.');
}

// Demo project loader
function loadDemoProject() {
  App.project.tracks.forEach(t => t.clips = []);
  App.textElements = [];

  let textTrack = App.project.tracks.find(t => t.type === 'text');
  if (!textTrack) { createTrack('text', 'Text 1'); textTrack = App.project.tracks.find(t => t.type === 'text'); }
  const demoTextId = uid();
  const demoText = {
    id: demoTextId,
    type: 'text',
    name: 'Intro Title',
    startTime: 0,
    duration: 5000,
    text: 'CutFlow Video Editor',
    fontSize: 54,
    fontWeight: '700',
    fontFamily: 'Inter',
    color: '#ffffff',
    align: 'center',
    posX: App.project.canvas.width / 2,
    posY: App.project.canvas.height / 2,
    opacity: 100,
    animation: 'fade-in',
    animDuration: 1.0,
    shadowColor: '#000000',
    shadowBlur: 16,
    shadowX: 0,
    shadowY: 4,
    shadowOpacity: 70
  };
  App.textElements.push(demoText);
  textTrack.clips.push({
    id: demoTextId,
    type: 'text',
    name: 'Intro Title',
    startTime: 0,
    duration: 5000,
    opacity: 100,
    color: '#ff6584'
  });

  let videoTrack = App.project.tracks.find(t => t.type === 'video');
  if (!videoTrack) { createTrack('video', 'Video 1'); videoTrack = App.project.tracks.find(t => t.type === 'video'); }

  const demoVidCanvas = document.createElement('canvas');
  demoVidCanvas.width = 640; demoVidCanvas.height = 360;
  const dCtx = demoVidCanvas.getContext('2d');
  const g = dCtx.createLinearGradient(0, 0, 640, 360);
  g.addColorStop(0, '#6c63ff');
  g.addColorStop(1, '#ff6584');
  dCtx.fillStyle = g;
  dCtx.fillRect(0, 0, 640, 360);
  dCtx.fillStyle = '#ffffff';
  dCtx.font = 'bold 32px Inter, sans-serif';
  dCtx.textAlign = 'center';
  dCtx.fillText('★ Sample 4K Footage ★', 320, 180);

  const demoImg = new Image();
  demoImg.src = demoVidCanvas.toDataURL();
  demoImg.onload = () => {
    const demoClipId = uid();
    videoTrack.clips.push({
      id: demoClipId,
      type: 'image',
      name: 'Sample Motion BG',
      src: demoImg.src,
      startTime: 0,
      duration: 8000,
      width: App.project.canvas.width,
      height: App.project.canvas.height,
      posX: App.project.canvas.width / 2,
      posY: App.project.canvas.height / 2,
      scale: 100,
      opacity: 100,
      rotation: 0,
      _imgEl: demoImg
    });
    updateDuration();
    renderTimeline();
    renderCanvas();
    showToast('Demo project loaded! Click Play to preview.');
  };

  updateDuration();
  renderTimeline();
  renderCanvas();
}

// Attach demo project button if present
document.getElementById('btnLoadDemo')?.addEventListener('click', loadDemoProject);

// Boot
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.App = App;
window.CutFlow = App;
window.loadDemoProject = loadDemoProject;

