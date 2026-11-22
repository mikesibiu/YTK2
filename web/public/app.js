(() => {
  const config = window.YTK2_WEB_CONFIG || {};
  const apiBase = (config.API_BASE_URL || '').replace(/\/$/, '');

  const statusEl = document.getElementById('status');
  const homeBtn = document.getElementById('homeBtn');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const micBtn = document.getElementById('micBtn');
  const resultsEl = document.getElementById('results');
  const chips = document.querySelectorAll('.chip');

  const player = document.getElementById('player');
  const playerFrame = document.getElementById('playerFrame');
  const closePlayer = document.getElementById('closePlayer');
  const embedOrigin = encodeURIComponent(window.location.origin);
  let playerOpen = false;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function esc(value) {
    const d = document.createElement('div');
    d.textContent = value || '';
    return d.innerHTML.replace(/"/g, '&quot;');
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
        if (!playerOpen) {
          history.pushState({ ytk2Player: true }, '', `#watch=${encodeURIComponent(id)}`);
        }
        playerFrame.src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1&origin=${embedOrigin}&modestbranding=1&iv_load_policy=3&controls=0&disablekb=1&fs=0`;
        player.classList.remove('hidden');
        playerOpen = true;
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
  function closePlayerOverlay(fromPopState = false) {
    playerFrame.src = 'about:blank';
    player.classList.add('hidden');
    if (playerOpen && !fromPopState && history.state && history.state.ytk2Player) {
      history.back();
    }
    playerOpen = false;
  }

  closePlayer.addEventListener('click', () => closePlayerOverlay(false));
  window.addEventListener('popstate', () => {
    if (playerOpen) {
      closePlayerOverlay(true);
    }
  });
  homeBtn.addEventListener('click', () => {
    if (playerOpen) {
      closePlayerOverlay(true);
    }
    if (location.hash) {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    searchInput.focus();
  });

  // Favorites come from the server so every device shows the same list; a failure just hides them.
  async function loadFavorites() {
    try {
      const res = await fetch(`${apiBase}/api/favorites`);
      if (!res.ok) return;
      const { items = [] } = await res.json();
      if (!items.length) return;
      const box = document.getElementById('favorites');
      items.forEach(fav => {
        const btn = document.createElement('button');
        btn.className = 'chip favorite';
        btn.textContent = fav.label;
        btn.addEventListener('click', () => openFavorite(fav));
        box.appendChild(btn);
      });
      box.classList.remove('hidden');
    } catch (_) { /* favorites are optional */ }
  }

  async function openFavorite(fav) {
    searchInput.value = '';
    setStatus(`Loading ${fav.label}...`);
    try {
      const res = await fetch(`${apiBase}/api/favorites/${encodeURIComponent(fav.id)}/videos`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Could not load favorite');
      render(payload.items || []);
      setStatus(`${fav.label}: ${(payload.items || []).length} safe videos (${payload.filtered_count || 0} filtered)`);
    } catch (error) {
      resultsEl.innerHTML = `<div class="card"><div class="card-body">${esc(error.message)}</div></div>`;
      setStatus('Could not load favorite');
    }
  }

  setupMic();
  loadFavorites();
  setStatus(`Ready. API: ${apiBase || 'not configured'}`);
})();
