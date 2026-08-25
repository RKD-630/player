// --- State Management ---
    const resolutions = {
        '240p': { width: 426, height: 240 },
        '360p': { width: 640, height: 360 },
        '480p': { width: 854, height: 480 },
        '720p': { width: 1280, height: 720 },
        '1080p': { width: 1920, height: 1080 }
    };

    const state = {
        isStreaming: false,
        facingMode: 'environment',
        settings: { resolution: '720p', facingMode: 'environment', password: '', audioEnabled: true, wakeLock: true },
        peerId: null,
        wakeLock: null,
        rotation: 0
    };

    let localStream = null;
    let peer = null;
    let dataConnections = [];
    let mediaRecorder = null;
    let recordedChunks = [];
    let isRecording = false;
    let recordingStartTime = 0;
    let recordingTimerInterval = null;
    let db = null;

    // Viewer State
    let viewerPeer = null;
    let conn = null;

    // --- Initialization ---
    window.onload = () => {
        loadSettings();
        initDB();
        detectWiFiIP();
        
        // Check for Viewer Mode via URL
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('viewer') === '1') {
            switchView('viewer');
            if (urlParams.has('peerId')) {
                document.getElementById('viewer-peer-id').value = urlParams.get('peerId');
            }
        } else {
            // Auto-start camera if available
            startCamera(true);
        }

        // Theme Init
        if (localStorage.getItem('theme') === 'light') {
            document.body.classList.add('light-theme');
            document.querySelector('#theme-toggle i').className = 'fas fa-sun';
        }

        // System Stats
        updateSystemStats();
        setInterval(updateSystemStats, 5000);
    };

    // --- Navigation ---
    function switchView(viewName) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${viewName}`).classList.add('active');
        
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const viewMap = { 'home': 0, 'camera': 1, 'network': 2, 'recordings': 3, 'settings': 4 };
        if (viewMap[viewName] !== undefined) {
            document.querySelectorAll('.nav-btn')[viewMap[viewName]].classList.add('active');
        }
    }

    function toggleTheme() {
        document.body.classList.toggle('light-theme');
        const isLight = document.body.classList.contains('light-theme');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        document.querySelector('#theme-toggle i').className = isLight ? 'fas fa-sun' : 'fas fa-moon';
    }

    // --- Camera Functions ---
    async function startCamera(isAutoStart = false) {
        try {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
            const res = state.settings.resolution;
            const constraints = {
                video: {
                    facingMode: state.facingMode,
                    width: { ideal: resolutions[res].width },
                    height: { ideal: resolutions[res].height }
                },
                audio: state.settings.audioEnabled
            };
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
            document.getElementById('local-video').srcObject = localStream;
            state.isStreaming = true;
            
            document.getElementById('stat-status').innerText = 'Online';
            document.getElementById('stat-status').className = 'online';
            document.getElementById('stat-res').innerText = `${resolutions[res].width}×${resolutions[res].height}`;
            
            if (state.settings.wakeLock) requestWakeLock();
            updateFPS();
        } catch (err) {
            document.getElementById('stat-status').innerText = 'Offline';
            document.getElementById('stat-status').className = 'offline';
            if (!isAutoStart) {
                alert('Camera access denied or not available: ' + err.message);
            }
        }
    }

    function stopCamera() {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
            state.isStreaming = false;
            document.getElementById('local-video').srcObject = null;
            document.getElementById('stat-status').innerText = 'Offline';
            document.getElementById('stat-status').className = 'offline';
        }
    }

    function pauseStream() {
        if (localStream) localStream.getVideoTracks().forEach(track => track.enabled = false);
    }

    function resumeStream() {
        if (localStream) localStream.getVideoTracks().forEach(track => track.enabled = true);
    }

    async function switchCamera() {
        state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
        await startCamera();
    }

    async function toggleTorch() {
        if (!localStream) return;
        const track = localStream.getVideoTracks()[0];
        const capabilities = track.getCapabilities();
        if (capabilities.torch) {
            const current = track.getSettings().torch || false;
            await track.applyConstraints({ advanced: [{ torch: !current }] });
        } else {
            alert('Torch not supported on this device');
        }
    }

    function toggleMute() {
        if (localStream) {
            state.settings.audioEnabled = !state.settings.audioEnabled;
            localStream.getAudioTracks().forEach(track => track.enabled = state.settings.audioEnabled);
        }
    }

    function toggleQuality() {
        const current = state.settings.resolution;
        const next = current === '1080p' ? '480p' : '1080p';
        state.settings.resolution = next;
        document.getElementById('setting-resolution').value = next;
        startCamera();
    }

    function rotateCamera() {
        state.rotation = (state.rotation + 90) % 360;
        document.getElementById('local-video').style.transform = `rotate(${state.rotation}deg)`;
    }

    async function adjustZoom(step) {
        if (!localStream) return;
        try {
            const track = localStream.getVideoTracks()[0];
            const capabilities = track.getCapabilities();
            
            if (!capabilities.zoom) {
                alert("Zoom is not supported on this device/camera.");
                return;
            }
            
            const settings = track.getSettings();
            let zoom = settings.zoom || capabilities.zoom.min;
            zoom += step;
            zoom = Math.max(capabilities.zoom.min, Math.min(zoom, capabilities.zoom.max));
            
            await track.applyConstraints({ advanced: [{ zoom: zoom }] });
        } catch (err) {
            console.error("Zoom failed:", err);
        }
    }

    function toggleFullscreen(elementId) {
        const elem = document.getElementById(elementId);
        if (!document.fullscreenElement) {
            elem.requestFullscreen().catch(err => alert(`Fullscreen error: ${err.message}`));
        } else {
            document.exitFullscreen();
        }
    }

    // --- Recording Functions ---
    function toggleRecording() {
        isRecording ? stopRecording() : startRecording();
    }

    function startRecording() {
        if (!localStream) return;
        recordedChunks = [];
        const options = { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' };
        mediaRecorder = new MediaRecorder(localStream, options);
        
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const filename = `rec_${Date.now()}.webm`;
            saveRecording(blob, filename);
        };
        
        mediaRecorder.start(1000);
        isRecording = true;
        recordingStartTime = Date.now();
        document.getElementById('recording-indicator').classList.remove('hidden');
        document.getElementById('stat-rec').innerText = 'ON';
        document.getElementById('stat-rec').style.color = 'var(--danger-color)';
        
        recordingTimerInterval = setInterval(() => {
            const duration = ((Date.now() - recordingStartTime) / 1000).toFixed(0);
            const mins = Math.floor(duration / 60).toString().padStart(2, '0');
            const secs = (duration % 60).toString().padStart(2, '0');
            document.getElementById('rec-timer').innerText = `${mins}:${secs}`;
        }, 1000);
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            isRecording = false;
            clearInterval(recordingTimerInterval);
            document.getElementById('recording-indicator').classList.add('hidden');
            document.getElementById('stat-rec').innerText = 'OFF';
            document.getElementById('stat-rec').style.color = 'inherit';
        }
    }

    function captureLocalSnapshot() {
        const video = document.getElementById('local-video');
        if (!video.videoWidth) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        const url = canvas.toDataURL('image/jpeg');
        const a = document.createElement('a');
        a.href = url;
        a.download = `snapshot_${Date.now()}.jpg`;
        a.click();
    }

    // --- WebRTC / Server Functions ---
    let currentMockIp = 'Detecting...';

    async function detectWiFiIP() {
        let ip = window.location.hostname;
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        
        if (ipRegex.test(ip) && !ip.startsWith('127.')) {
            currentMockIp = ip;
        } else {
            try {
                const pc = new RTCPeerConnection({ iceServers: [] });
                pc.createDataChannel('');
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                
                const detected = await new Promise(resolve => {
                    const timer = setTimeout(() => { pc.close(); resolve(null); }, 1500);
                    pc.onicecandidate = (e) => {
                        if (!e || !e.candidate) return;
                        const match = e.candidate.candidate.match(/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
                        if (match && !match[1].startsWith('127.') && !match[1].startsWith('0.')) {
                            clearTimeout(timer);
                            pc.close();
                            resolve(match[1]);
                        }
                    };
                });
                if (detected) {
                    currentMockIp = detected;
                } else if (currentMockIp === 'Detecting...' || currentMockIp === '192.168.1.x') {
                    currentMockIp = `192.168.1.${Math.floor(Math.random() * 200) + 10}`;
                }
            } catch (e) {
                if (currentMockIp === 'Detecting...' || currentMockIp === '192.168.1.x') {
                    currentMockIp = `192.168.1.${Math.floor(Math.random() * 200) + 10}`;
                }
            }
        }

        document.querySelectorAll('.display-mock-ip-elem').forEach(el => el.innerText = currentMockIp);
        const legacyIp = document.getElementById('display-mock-ip');
        if (legacyIp) legacyIp.innerText = currentMockIp;
        
        generateQR(state.peerId || '');

        return currentMockIp;
    }

    async function startServer() {
        if (!localStream) {
            alert('Please start the camera first!');
            return;
        }
        
        document.querySelectorAll('.btn-start-server-elem').forEach(el => el.classList.add('hidden'));
        document.querySelectorAll('.server-info-elem').forEach(el => el.classList.remove('hidden'));
        document.querySelectorAll('.server-status-elem').forEach(el => {
            el.innerText = 'Server: Running';
            el.className = 'status-badge online server-status-elem';
        });
        
        const legacyBtn = document.getElementById('btn-start-server');
        if (legacyBtn) legacyBtn.classList.add('hidden');
        const legacyInfo = document.getElementById('server-info');
        if (legacyInfo) legacyInfo.classList.remove('hidden');
        const legacyStatus = document.getElementById('server-status');
        if (legacyStatus) { legacyStatus.innerText = 'Running'; legacyStatus.className = 'status-badge online'; }

        // Ensure current WiFi IP is detected and displayed
        await detectWiFiIP();
        
        // Initialize PeerJS
        peer = new Peer();
        peer.on('open', (id) => {
            state.peerId = id;
            document.querySelectorAll('.display-peer-id-elem').forEach(el => el.innerText = id);
            const legacyPeerId = document.getElementById('display-peer-id');
            if (legacyPeerId) legacyPeerId.innerText = id;
            generateQR(id);
        });
        
        peer.on('connection', (conn) => {
            if (state.settings.password && conn.metadata?.password !== state.settings.password) {
                conn.send({ type: 'error', message: 'Invalid password' });
                conn.close();
                return;
            }
            dataConnections.push(conn);
            updateDashboard();
            
            conn.on('data', (data) => handleRemoteCommand(data, conn));
            conn.on('close', () => {
                dataConnections = dataConnections.filter(c => c !== conn);
                updateDashboard();
            });
        });
        
        peer.on('call', (call) => {
            if (localStream) call.answer(localStream);
        });
    }

    async function generateQR(peerId = '') {
        const qrContainers = document.querySelectorAll('.qrcode-elem');
        qrContainers.forEach(el => el.innerHTML = '');
        const legacyQr = document.getElementById('qrcode');
        if (legacyQr) legacyQr.innerHTML = '';
        
        let host = window.location.host;
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            const port = window.location.port || '8080';
            host = `${currentMockIp}:${port}`;
        }
        
        const baseUrl = window.location.protocol + '//' + host + window.location.pathname;
        const streamUrl = peerId ? `${baseUrl}?viewer=1&peerId=${peerId}` : `${baseUrl}?viewer=1`;
        
        document.querySelectorAll('.display-mock-ip-elem').forEach(el => el.innerText = currentMockIp);
        document.querySelectorAll('.display-stream-url-elem').forEach(el => el.innerText = streamUrl);
        const legacyIp = document.getElementById('display-mock-ip');
        if (legacyIp) legacyIp.innerText = currentMockIp;
        
        qrContainers.forEach(container => {
            container.innerHTML = '';
            new QRCode(container, {
                text: streamUrl, width: 140, height: 140,
                colorDark: "#000000", colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        });
        if (legacyQr && legacyQr.children.length === 0) {
            new QRCode(legacyQr, {
                text: streamUrl, width: 140, height: 140,
                colorDark: "#000000", colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        }
    }

    // --- Viewer Functions ---
    let html5QrCode = null;
    let qrFacingMode = "environment"; // Default to back camera

    function startQRScanner() {
        const containerDiv = document.getElementById('qr-scanner-container');
        
        if (containerDiv.style.display === 'block') {
            // Close scanner
            if (html5QrCode) {
                html5QrCode.stop().then(() => {
                    html5QrCode.clear();
                    html5QrCode = null;
                }).catch(err => console.error("Failed to stop scanner", err));
            }
            containerDiv.style.display = 'none';
            return;
        }

        if (typeof Html5Qrcode === 'undefined') {
            alert('QR Scanner library is still loading. Please try again.');
            return;
        }

        containerDiv.style.display = 'block';
        
        html5QrCode = new Html5Qrcode("qr-reader");
        startQRLens();
    }

    function switchQRCamera() {
        qrFacingMode = (qrFacingMode === "environment") ? "user" : "environment";
        if (html5QrCode) {
            html5QrCode.stop().then(() => {
                startQRLens();
            }).catch(err => console.error("Failed to stop camera for switching", err));
        }
    }

    function startQRLens() {
        html5QrCode.start(
            { facingMode: qrFacingMode },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText, decodedResult) => {
                handleQRScanSuccess(decodedText);
            },
            (errorMessage) => {
                // Ignore ongoing scan failures
            }
        ).catch(err => {
            console.error("Failed to start QR scanner", err);
            // If we failed to start the environment camera, maybe it's a device (like a laptop) without one.
            if (qrFacingMode === "environment") {
                qrFacingMode = "user";
                startQRLens();
            }
        });
    }

    function handleQRScanSuccess(decodedText) {
        const containerDiv = document.getElementById('qr-scanner-container');
        
        const finishScan = () => {
            if (html5QrCode) {
                html5QrCode.stop().then(() => {
                    html5QrCode.clear();
                    html5QrCode = null;
                }).catch(err => console.error("Failed to stop scanner", err));
            }
            containerDiv.style.display = 'none';
            connectToCamera();
        };

        try {
            const url = new URL(decodedText);
            const peerId = url.searchParams.get('peerId');
            if (peerId) {
                document.getElementById('viewer-peer-id').value = peerId;
                finishScan();
            } else {
                alert('QR Code does not contain a valid Camera ID.');
            }
        } catch (e) {
            if (decodedText.length > 5) { // Basic sanity check for plain ID
                document.getElementById('viewer-peer-id').value = decodedText;
                finishScan();
            } else {
                console.error('Invalid QR code format', e);
            }
        }
    }

    function connectToCamera() {
        let targetId = document.getElementById('viewer-peer-id').value.trim();
        const password = document.getElementById('viewer-password').value.trim();
        if (!targetId) return alert('Please enter a Camera ID or WiFi IP Stream Address');
        
        try {
            if (targetId.startsWith('http://') || targetId.startsWith('https://')) {
                const parsedUrl = new URL(targetId);
                if (parsedUrl.searchParams.has('peerId')) {
                    targetId = parsedUrl.searchParams.get('peerId');
                }
            }
        } catch(e) {}
        
        document.getElementById('viewer-connect-panel').classList.add('hidden');
        document.getElementById('viewer-video-panel').classList.remove('hidden');
        
        viewerPeer = new Peer();
        viewerPeer.on('open', () => {
            conn = viewerPeer.connect(targetId, { metadata: { password } });
            conn.on('open', () => conn.send({ type: 'request_stream' }));
            conn.on('data', (data) => {
                if (data.type === 'error') {
                    alert(data.message);
                    disconnectViewer();
                }
            });
        });
        
        viewerPeer.on('call', (call) => {
            // Answer incoming call to receive remote camera stream (no local camera/mic required)
            call.answer();
            call.on('stream', (remoteStream) => {
                document.getElementById('remote-video').srcObject = remoteStream;
                const track = remoteStream.getVideoTracks()[0];
                if (track) {
                    const settings = track.getSettings();
                    if (settings && settings.width) {
                        document.getElementById('viewer-res').innerText = `${settings.width}×${settings.height}`;
                    }
                }
            });
        });
    }

    function sendRemoteCommand(action, payload = {}) {
        if (conn && conn.open) {
            conn.send({ type: 'command', action, ...payload });
        } else {
            alert('Not connected to camera');
        }
    }

    function disconnectViewer() {
        if (conn) conn.close();
        if (viewerPeer) viewerPeer.destroy();
        document.getElementById('viewer-video-panel').classList.add('hidden');
        document.getElementById('viewer-connect-panel').classList.remove('hidden');
        document.getElementById('remote-video').srcObject = null;
    }

    function captureSnapshot() {
        const video = document.getElementById('remote-video');
        if (!video.videoWidth) return;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        const url = canvas.toDataURL('image/jpeg');
        const a = document.createElement('a');
        a.href = url;
        a.download = `remote_snapshot_${Date.now()}.jpg`;
        a.click();
    }

    // --- Host Command Handler ---
    function handleRemoteCommand(data, conn) {
        if (data.type === 'request_stream') {
            if (localStream) {
                peer.call(conn.peer, localStream);
            } else {
                conn.send({ type: 'error', message: 'Camera is not started on host' });
            }
        } else if (data.type === 'command') {
            switch(data.action) {
                case 'start_recording': startRecording(); break;
                case 'stop_recording': stopRecording(); break;
                case 'switch_camera': switchCamera(); break;
                case 'toggle_flash': toggleTorch(); break;
            }
        }
    }

    // --- IndexedDB File Manager ---
    function initDB() {
        const request = indexedDB.open("IPCameraDB", 1);
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            if (!db.objectStoreNames.contains("recordings")) {
                db.createObjectStore("recordings", { keyPath: "id", autoIncrement: true });
            }
        };
        request.onsuccess = (event) => {
            db = event.target.result;
            renderRecordings();
        };
    }

    function saveRecording(blob, filename) {
        const transaction = db.transaction(["recordings"], "readwrite");
        const store = transaction.objectStore("recordings");
        store.add({
            name: filename, blob: blob, date: new Date().toISOString(),
            size: blob.size, duration: (Date.now() - recordingStartTime) / 1000
        });
        transaction.oncomplete = () => renderRecordings();
    }

    function renderRecordings() {
        const list = document.getElementById('recordings-list');
        list.innerHTML = '';
        const transaction = db.transaction(["recordings"], "readonly");
        const store = transaction.objectStore("recordings");
        store.getAll().onsuccess = (e) => {
            const recordings = e.target.result.reverse();
            if (recordings.length === 0) {
                list.innerHTML = '<p style="opacity:0.6; text-align:center;">No recordings yet.</p>';
                return;
            }
            recordings.forEach(rec => {
                const url = URL.createObjectURL(rec.blob);
                const div = document.createElement('div');
                div.className = 'recording-item';
                div.innerHTML = `
                    <video src="${url}" style="width:80px; height:60px; object-fit:cover; border-radius:4px;"></video>
                    <div class="rec-info">
                        <div class="rec-name">${rec.name}</div>
                        <div class="rec-meta">${(rec.size/1024/1024).toFixed(2)} MB • ${rec.duration.toFixed(1)}s • ${new Date(rec.date).toLocaleString()}</div>
                    </div>
                    <div class="rec-actions">
                        <a href="${url}" download="${rec.name}" class="icon-btn"><i class="fas fa-download"></i></a>
                        <button onclick="deleteRecording(${rec.id})" class="icon-btn"><i class="fas fa-trash"></i></button>
                    </div>
                `;
                list.appendChild(div);
            });
        };
    }

    function deleteRecording(id) {
        if (!confirm('Delete this recording?')) return;
        const transaction = db.transaction(["recordings"], "readwrite");
        const store = transaction.objectStore("recordings");
        store.delete(id);
        transaction.oncomplete = () => renderRecordings();
    }

    // --- Settings & Utilities ---
    function loadSettings() {
        const saved = localStorage.getItem('ipcam_settings');
        if (saved) state.settings = { ...state.settings, ...JSON.parse(saved) };
        document.getElementById('setting-resolution').value = state.settings.resolution;
        document.getElementById('setting-camera').value = state.settings.facingMode;
        document.getElementById('setting-password').value = state.settings.password;
        document.getElementById('setting-audio').checked = state.settings.audioEnabled;
        document.getElementById('setting-wake-lock').checked = state.settings.wakeLock;
    }

    function saveSettings() {
        state.settings.resolution = document.getElementById('setting-resolution').value;
        state.settings.facingMode = document.getElementById('setting-camera').value;
        state.settings.password = document.getElementById('setting-password').value;
        state.settings.audioEnabled = document.getElementById('setting-audio').checked;
        state.settings.wakeLock = document.getElementById('setting-wake-lock').checked;
        localStorage.setItem('ipcam_settings', JSON.stringify(state.settings));
        alert('Settings saved!');
    }

    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                state.wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (err) { console.log('Wake lock failed', err); }
    }

    function updateDashboard() {
        document.getElementById('stat-users').innerText = dataConnections.length;
    }

    function updateSystemStats() {
        if (navigator.getBattery) {
            navigator.getBattery().then(battery => {
                document.getElementById('stat-battery').innerText = `${Math.round(battery.level * 100)}%`;
            });
        }
        if (navigator.connection) {
            document.getElementById('stat-network').innerText = `${navigator.connection.downlink} Mbps`;
            document.getElementById('stat-bitrate').innerText = `~${navigator.connection.downlink} Mbps`;
        }
    }

    let frames = 0;
    let lastTime = performance.now();
    function updateFPS() {
        if (!state.isStreaming) return;
        frames++;
        const now = performance.now();
        if (now - lastTime >= 1000) {
            document.getElementById('stat-fps').innerText = frames;
            if (document.getElementById('viewer-fps')) document.getElementById('viewer-fps').innerText = frames;
            frames = 0;
            lastTime = now;
        }
        requestAnimationFrame(updateFPS);
    }