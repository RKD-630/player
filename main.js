document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('videoPlayer');
    const mediaUrlInput = document.getElementById('mediaUrl');
    const loadUrlBtn = document.getElementById('loadUrlBtn');
    const addToPlaylistBtn = document.getElementById('addToPlaylistBtn');
    const fileInput = document.getElementById('fileInput');
    const browseBtn = document.getElementById('browseBtn');
    
    // Controls
    const playPauseBtn = document.getElementById('playPauseBtn');
    const bigPlayBtn = document.getElementById('bigPlayBtn');
    const stopBtn = document.getElementById('stopBtn');
    const skipBackBtn = document.getElementById('skipBackBtn');
    const skipForwardBtn = document.getElementById('skipForwardBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const muteBtn = document.getElementById('muteBtn');
    const volumeSlider = document.getElementById('volumeSlider');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const pipBtn = document.getElementById('pipBtn');
    const shareBtn = document.getElementById('shareBtn');
    
    // UI Elements
    const progressBar = document.getElementById('progressBar');
    const progressContainer = document.getElementById('progressContainer');
    const currentTimeEl = document.getElementById('currentTime');
    const durationEl = document.getElementById('duration');
    const nowPlayingTitle = document.getElementById('nowPlayingTitle');
    const mediaFormat = document.getElementById('mediaFormat');
    const infoName = document.getElementById('infoName');
    const infoDuration = document.getElementById('infoDuration');
    const infoRes = document.getElementById('infoRes');
    const infoSource = document.getElementById('infoSource');

    // Playlist & Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const playlistItems = document.getElementById('playlistItems');
    const radioItems = document.getElementById('radioItems');
    const clearPlaylistBtn = document.getElementById('clearPlaylist');
    const genreBtns = document.querySelectorAll('.genre-btn');

    let hls = null;
    let playlist = [];
    let currentIndex = -1;

    // Sample Radio Stations
    const radioStations = [
        { name: "Bollywood Hits", url: "https://n0a.radiojar.com/8s7u7p7p48quv", genre: "music", type: "Radio" },
        { name: "Retro Hindi", url: "https://n02.radiojar.com/0t98v6q95m0uv", genre: "music", type: "Radio" },
        { name: "Bhakti Sagar", url: "https://n0a.radiojar.com/7226u97p48quv", genre: "bhakti", type: "Radio" },
        { name: "Devotional Mix", url: "https://n0b.radiojar.com/wn99t6q95m0uv", genre: "bhakti", type: "Radio" },
        { name: "DJ Remix India", url: "https://n08.radiojar.com/8s7u7p7p48quv", genre: "remix", type: "Radio" },
        { name: "Club Mix DJ", url: "https://n04.radiojar.com/0t98v6q95m0uv", genre: "dj", type: "Radio" },
        { name: "Punjabi Beats", url: "https://n05.radiojar.com/7226u97p48quv", genre: "dj", type: "Radio" }
    ];

    // --- Media Loading Logic ---

    function formatTime(seconds) {
        if (isNaN(seconds)) return "00:00";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) {
            return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
        }
        return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }

    function updateMetadata(source, name = 'Unknown File') {
        const ext = source.split('.').pop().split(/[?#]/)[0].toUpperCase();
        mediaFormat.textContent = ext.length < 5 ? ext : 'STREAM';
        infoName.textContent = name;
        infoSource.textContent = source.length > 50 ? source.substring(0, 50) + '...' : source;
        nowPlayingTitle.textContent = name;
    }

    function loadMedia(url, name = 'Media Stream', index = -1) {
        if (hls) {
            hls.destroy();
            hls = null;
        }
        video.pause();
        video.removeAttribute('src');
        video.load();

        updateMetadata(url, name);
        currentIndex = index;
        updatePlaylistUI();

        if (url.includes('.m3u8')) {
            if (Hls.isSupported()) {
                hls = new Hls({ lowLatencyMode: true });
                hls.loadSource(url);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    video.play().catch(e => console.log("Play blocked"));
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
                video.addEventListener('loadedmetadata', () => video.play());
            }
        } else {
            video.src = url;
            video.play().catch(e => console.log("Play blocked"));
        }
    }

    // --- Playlist Logic ---

    function addToPlaylist(url, name) {
        playlist.push({ url, name });
        if (playlist.length === 1 && video.paused && !video.src) {
            loadMedia(url, name, 0);
        }
        updatePlaylistUI();
    }

    function updatePlaylistUI() {
        if (playlist.length === 0) {
            playlistItems.innerHTML = '<li class="empty-msg">No items in playlist</li>';
            return;
        }

        playlistItems.innerHTML = '';
        playlist.forEach((item, index) => {
            const li = document.createElement('li');
            li.className = `playlist-item ${index === currentIndex ? 'active' : ''}`;
            li.innerHTML = `
                <i class="fas ${item.url.includes('.m3u8') ? 'fa-broadcast-tower' : 'fa-play-circle'}"></i>
                <div class="item-info">
                    <span class="item-title">${item.name}</span>
                    <span class="item-type">${item.url.includes('blob') ? 'Local File' : 'Remote'}</span>
                </div>
            `;
            li.onclick = () => loadMedia(item.url, item.name, index);
            playlistItems.appendChild(li);
        });
    }

    function playNext() {
        if (currentIndex < playlist.length - 1) {
            const next = playlist[currentIndex + 1];
            loadMedia(next.url, next.name, currentIndex + 1);
        }
    }

    function playPrev() {
        if (currentIndex > 0) {
            const prev = playlist[currentIndex - 1];
            loadMedia(prev.url, prev.name, currentIndex - 1);
        }
    }

    // --- Radio Logic ---

    function populateRadio(genre = 'all') {
        radioItems.innerHTML = '';
        const filtered = genre === 'all' ? radioStations : radioStations.filter(s => s.genre === genre);
        
        filtered.forEach(station => {
            const li = document.createElement('li');
            li.className = 'playlist-item';
            li.innerHTML = `
                <i class="fas fa-satellite-dish"></i>
                <div class="item-info">
                    <span class="item-title">${station.name}</span>
                    <span class="item-type">${station.genre.toUpperCase()} Radio</span>
                </div>
            `;
            li.onclick = () => loadMedia(station.url, station.name);
            radioItems.appendChild(li);
        });
    }

    // --- Tab Logic ---

    tabBtns.forEach(btn => {
        btn.onclick = () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab + 'Tab').classList.add('active');
        };
    });

    genreBtns.forEach(btn => {
        btn.onclick = () => {
            genreBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            populateRadio(btn.dataset.genre);
        };
    });

    // --- Event Listeners ---

    loadUrlBtn.onclick = () => {
        const url = mediaUrlInput.value.trim();
        if (url) loadMedia(url, 'Remote Stream');
    };

    addToPlaylistBtn.onclick = () => {
        const url = mediaUrlInput.value.trim();
        if (url) {
            addToPlaylist(url, 'Remote Link ' + (playlist.length + 1));
            mediaUrlInput.value = '';
        }
    };

    browseBtn.onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
        Array.from(e.target.files).forEach(file => {
            const url = URL.createObjectURL(file);
            addToPlaylist(url, file.name);
        });
    };

    clearPlaylistBtn.onclick = () => {
        playlist = [];
        currentIndex = -1;
        updatePlaylistUI();
    };

    // Playback Controls
    playPauseBtn.onclick = () => video.paused ? video.play() : video.pause();
    bigPlayBtn.onclick = () => video.play();
    video.onclick = () => video.paused ? video.play() : video.pause();
    
    video.onplay = () => {
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        bigPlayBtn.style.display = 'none';
    };
    video.onpause = () => {
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        bigPlayBtn.style.display = 'flex';
    };

    stopBtn.onclick = () => { video.pause(); video.currentTime = 0; };
    skipBackBtn.onclick = () => video.currentTime -= 90;
    skipForwardBtn.onclick = () => video.currentTime += 90;
    nextBtn.onclick = playNext;
    prevBtn.onclick = playPrev;

    video.onended = playNext;

    // Volume & Progress
    volumeSlider.oninput = (e) => {
        video.volume = e.target.value;
        muteBtn.innerHTML = video.volume == 0 ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
    };

    muteBtn.onclick = () => {
        video.muted = !video.muted;
        muteBtn.innerHTML = video.muted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
    };

    video.ontimeupdate = () => {
        const percent = (video.currentTime / video.duration) * 100;
        progressBar.style.width = `${percent}%`;
        currentTimeEl.textContent = formatTime(video.currentTime);
    };

    video.onloadedmetadata = () => {
        durationEl.textContent = formatTime(video.duration);
        infoDuration.textContent = formatTime(video.duration);
        infoRes.textContent = video.videoWidth ? `${video.videoWidth}x${video.videoHeight}` : 'Audio Only';
    };

    progressContainer.onclick = (e) => {
        const rect = progressContainer.getBoundingClientRect();
        const pos = (e.pageX - rect.left) / rect.width;
        video.currentTime = pos * video.duration;
    };

    fullscreenBtn.onclick = () => {
        if (!document.fullscreenElement) document.getElementById('videoContainer').requestFullscreen();
        else document.exitFullscreen();
    };

    pipBtn.onclick = async () => {
        try { video !== document.pictureInPictureElement ? await video.requestPictureInPicture() : await document.exitPictureInPicture(); }
        catch(e) { alert("PiP not supported"); }
    };

    // Initial Population
    populateRadio();
});
