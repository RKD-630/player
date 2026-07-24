// --- STATE MANAGEMENT ---
        const emotions = ['Happiness', 'Sadness', 'Fear', 'Anger', 'Disgust', 'Surprise'];
        const padsData = {};
        emotions.forEach(e => padsData[e] = []);
        
        let activeTab = 'Happiness';
        let mode = 'Normal';
        let masterVolume = 0.8;
        
        // --- AUDIO ENGINE ---
        let audioCtx;
        let dest;
        let micStream;
        let mediaRecorder;
        let recordedChunks = [];
        let isRecording = false;
        let recStartTime = 0;
        let recTimerInterval;

        function initAudio() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                dest = audioCtx.createMediaStreamDestination();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        }

        // --- UI LOGIC ---
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                activeTab = btn.dataset.tab;
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderPads();
            });
        });

        document.querySelectorAll('input[name="mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                mode = e.target.value;
                document.getElementById('statusText').innerText = `Mode: ${mode}`;
            });
        });

        document.getElementById('masterVolume').addEventListener('input', (e) => {
            masterVolume = parseFloat(e.target.value);
            // Update all existing audio elements
            Object.values(padsData).flat().forEach(pad => {
                if (pad.audio) pad.audio.volume = masterVolume;
            });
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            initAudio();
            const files = e.target.files;
            for (let file of files) {
                if (file.type.startsWith('audio/')) {
                    const url = URL.createObjectURL(file);
                    padsData[activeTab].push({
                        name: file.name,
                        url: url,
                        audio: null
                    });
                }
            }
            renderPads();
            e.target.value = ''; // Reset
        });

        function renderPads() {
            const grid = document.getElementById('padGrid');
            grid.innerHTML = '';
            const pads = padsData[activeTab];
            
            if(pads.length === 0) {
                grid.innerHTML = '<div class="empty-msg">No sounds imported for this emotion.<br>Click "+ Import MP3s" to add sounds.</div>';
                return;
            }

            const icons = ['🎵', '🎧', '🎙️', '🎹', '🎸', '🎺', '🥁', '🎷'];

            pads.forEach((pad, index) => {
                const padEl = document.createElement('div');
                padEl.className = 'pad';
                
                // Icon and Name
                const iconEl = document.createElement('div');
                iconEl.className = 'pad-icon';
                iconEl.innerText = icons[index % icons.length];
                
                const nameEl = document.createElement('div');
                nameEl.className = 'pad-name';
                nameEl.innerText = pad.name.replace(/\.[^/.]+$/, ""); // Remove extension
                
                padEl.appendChild(iconEl);
                padEl.appendChild(nameEl);
                
                // Audio setup
                if (!pad.audio) {
                    pad.audio = new Audio(pad.url);
                    pad.audio.crossOrigin = "anonymous";
                    pad.audio.volume = masterVolume;
                    
                    // Connect to Web Audio API for recording routing
                    try {
                        const source = audioCtx.createMediaElementSource(pad.audio);
                        source.connect(dest); // Send to recorder
                        source.connect(audioCtx.destination); // Send to speakers
                    } catch(e) {
                        console.warn("Audio routing error", e);
                    }
                }
                
                // Interaction Handlers
                padEl.addEventListener('click', () => {
                    if (mode === 'Normal') {
                        pad.audio.currentTime = 0;
                        pad.audio.loop = false;
                        pad.audio.play();
                        padEl.classList.add('playing');
                        pad.audio.onended = () => padEl.classList.remove('playing');
                    } 
                    else if (mode === 'Repeat') {
                        if (pad.audio.paused) {
                            pad.audio.loop = true;
                            pad.audio.play();
                            padEl.classList.add('playing');
                        } else {
                            pad.audio.pause();
                            pad.audio.currentTime = 0;
                            pad.audio.loop = false;
                            padEl.classList.remove('playing');
                        }
                    } 
                    else if (mode === 'Continue') {
                        pad.audio.loop = false;
                        pad.audio.play();
                        padEl.classList.add('playing');
                        pad.audio.onended = () => padEl.classList.remove('playing');
                    }
                });
                
                padEl.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    if (mode === 'Normal' || mode === 'Repeat') {
                        pad.audio.pause();
                        pad.audio.currentTime = 0;
                        pad.audio.loop = false;
                        padEl.classList.remove('playing');
                    }
                });
                
                grid.appendChild(padEl);
            });
        }

        // --- RECORDING LOGIC ---
        const recBtn = document.getElementById('recBtn');
        const recIndicator = document.getElementById('recIndicator');
        const recTimeEl = document.getElementById('recTime');
        const recTextEl = document.getElementById('recText');

        async function toggleRecording() {
            initAudio();
            if (!isRecording) {
                try {
                    // Get Microphone
                    if (!micStream) {
                        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        const micSource = audioCtx.createMediaStreamSource(micStream);
                        micSource.connect(dest); // Mic to recorder only (no feedback)
                    }
                    
                    // Setup Media Recorder
                    const options = { mimeType: 'audio/webm;codecs=opus' };
                    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                        options.mimeType = 'audio/webm';
                    }
                    
                    mediaRecorder = new MediaRecorder(dest.stream, options);
                    recordedChunks = [];
                    
                    mediaRecorder.ondataavailable = e => {
                        if (e.data.size > 0) recordedChunks.push(e.data);
                    };
                    
                    mediaRecorder.onstop = () => {
                        const blob = new Blob(recordedChunks, { type: options.mimeType });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        // We name it MP3 for compatibility, though internally it's WebM/Opus which plays everywhere
                        a.download = `Emotion_Session_${new Date().toISOString().replace(/[:.]/g, '-')}.mp3`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    };
                    
                    mediaRecorder.start();
                    isRecording = true;
                    recStartTime = Date.now();
                    updateRecUI();
                    recTimerInterval = setInterval(updateRecUI, 1000);
                    
                    recBtn.classList.add('active');
                    recTextEl.innerText = "STOP";
                    recIndicator.classList.add('active');
                    
                } catch (err) {
                    alert("Microphone access is required to record your voice along with the soundboard.");
                    console.error(err);
                }
            } else {
                mediaRecorder.stop();
                isRecording = false;
                clearInterval(recTimerInterval);
                recBtn.classList.remove('active');
                recTextEl.innerText = "REC";
                recIndicator.classList.remove('active');
            }
        }

        function updateRecUI() {
            if (!isRecording) return;
            const elapsed = Math.floor((Date.now() - recStartTime) / 1000);
            const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const secs = (elapsed % 60).toString().padStart(2, '0');
            recTimeEl.innerText = `${mins}:${secs}`;
        }

        recBtn.addEventListener('click', toggleRecording);

        // Initial Render
        renderPads();