(() => {
  const config = window.YTK2_WEB_CONFIG || {};
  const apiBase = (config.API_BASE_URL || '').replace(/\/$/, '');

  const statusEl = document.getElementById('status');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const micBtn = document.getElementById('micBtn');
  const resultsEl = document.getElementById('results');
  const chips = document.querySelectorAll('.chip');

  const player = document.getElementById('player');
  const playerFrame = document.getElementById('playerFrame');
  const closePlayer = document.getElementById('closePlayer');
  const embedOrigin = encodeURIComponent(window.location.origin);

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function esc(value) {
    const d = document.createElement('div');
    d.textContent = value || '';
    return d.innerHTML;
  }

  async function search(q) {
    if (!q || !q.trim()) {
      setStatus('Enter a search term');
      return;
    }

    setStatus('Searching...');

    try {
      const url = `${apiBase}/api/search?q=${encodeURIComponent(q.trim())}`;
      const res = await fetch(url);
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'Search failed');
      }
      render(payload.items || []);
      setStatus(`Showing ${(payload.items || []).length} safe results (${payload.filtered_count || 0} filtered)`);
    } catch (error) {
      resultsEl.innerHTML = `<div class="card"><div class="card-body">${esc(error.message)}</div></div>`;
      setStatus('Search failed');
    }
  }

  function render(items) {
    if (!items.length) {
      resultsEl.innerHTML = '<div class="card"><div class="card-body">No safe results found.</div></div>';
      return;
    }

    resultsEl.innerHTML = items.map(item => `
      <button class="card" data-id="${esc(item.video_id)}">
        <img src="${esc(item.thumbnail)}" alt="thumbnail" loading="lazy" />
        <div class="card-body">
          <div class="title">${esc(item.title)}</div>
          <div class="meta">${esc(item.channel_name)}</div>
        </div>
      </button>
    `).join('');

    document.querySelectorAll('.card[data-id]').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        playerFrame.src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1&origin=${embedOrigin}&modestbranding=1&iv_load_policy=3&controls=0&disablekb=1&fs=0`;
        player.classList.remove('hidden');
      });
    });
  }

  function setupMic() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micBtn.disabled = true;
      micBtn.textContent = 'No Mic';
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    micBtn.addEventListener('click', () => {
      try { recognition.start(); } catch (_) {}
    });

    recognition.onresult = e => {
      const transcript = e.results[0][0].transcript;
      searchInput.value = transcript;
      search(transcript);
    };
  }

  searchBtn.addEventListener('click', () => search(searchInput.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') search(searchInput.value);
  });
  chips.forEach(chip => chip.addEventListener('click', () => {
    const q = chip.getAttribute('data-q') || '';
    searchInput.value = q;
    search(q);
  }));
  closePlayer.addEventListener('click', () => {
    playerFrame.src = 'about:blank';
    player.classList.add('hidden');
  });

  setupMic();
  setStatus(`Ready. API: ${apiBase || 'not configured'}`);
})();
