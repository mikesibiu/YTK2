(function () {
  const config = window.YTK2_CONFIG || {};
  const searchClient = window.YTK2SearchClient;
  const apiBase = (config.FILTER_API_BASE_URL || '').replace(/\/$/, '');
  const BACK_KEY = 10009;
  const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;

  const statusEl = document.getElementById('status');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const resultsEl = document.getElementById('results');

  const modal = document.getElementById('playerModal');
  const playerFrame = document.getElementById('playerFrame');
  const closePlayerBtn = document.getElementById('closePlayerBtn');

  if (!searchClient) {
    console.error('YTK2SearchClient not loaded');
    return;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isPlayerOpen() {
    return !modal.classList.contains('hidden');
  }

  function renderResults(result) {
    const items = result.items;
    if (!items.length) {
      resultsEl.innerHTML = '<div class="empty">No safe results found.</div>';
      setStatus('No safe videos (' + result.filteredCount + ' filtered)');
      return;
    }

    resultsEl.innerHTML = items.map(function (item) {
      return (
        '<button class="video-card" data-video-id="' + escapeHtml(item.video_id) + '">' +
          '<div class="video-title">' + escapeHtml(item.title) + '</div>' +
          '<div class="video-channel">' + escapeHtml(item.channel_name || 'Unknown channel') + '</div>' +
        '</button>'
      );
    }).join('');

    setStatus('Showing ' + items.length + ' safe videos (' + result.filteredCount + ' filtered)');

    const cards = Array.from(document.querySelectorAll('.video-card'));
    cards.forEach(function (card) {
      card.addEventListener('click', function () {
        const videoId = card.getAttribute('data-video-id');
        if (videoId) openPlayer(videoId);
      });
    });

    if (cards[0]) cards[0].focus();
  }

  function openPlayer(videoId) {
    if (!VIDEO_ID_PATTERN.test(videoId)) return;
    playerFrame.src = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId) +
      '?autoplay=1&rel=0&playsinline=1&modestbranding=1&iv_load_policy=3&fs=0';
    modal.classList.remove('hidden');
    closePlayerBtn.focus();
  }

  function closePlayer() {
    playerFrame.src = 'about:blank';
    modal.classList.add('hidden');
    const firstCard = document.querySelector('.video-card');
    if (firstCard) firstCard.focus();
  }

  // Filtering happens on the server, which refuses to answer when it cannot load
  // its rules, so a failed search shows nothing rather than unfiltered results.
  async function searchVideos(query) {
    if (!apiBase) {
      setStatus('Set FILTER_API_BASE_URL in js/config.js');
      return;
    }

    if (!query || !query.trim()) {
      setStatus('Enter a search term');
      return;
    }

    setStatus('Searching...');

    try {
      const response = await fetch(searchClient.buildSearchUrl(apiBase, query.trim()));
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      renderResults(searchClient.parseSearchResponse(await response.json()));
    } catch (error) {
      resultsEl.innerHTML = '<div class="error">Search unavailable. Try again later.</div>';
      setStatus('Search unavailable');
    }
  }

  function exitApp() {
    try {
      window.tizen.application.getCurrentApplication().exit();
    } catch (e) {
      // Not running on a TV (desktop browser); nothing to exit.
    }
  }

  function bindEvents() {
    searchBtn.addEventListener('click', function () {
      searchVideos(searchInput.value);
    });

    Array.from(document.querySelectorAll('.quick')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        const q = btn.getAttribute('data-query') || '';
        searchInput.value = q;
        searchVideos(q);
      });
    });

    closePlayerBtn.addEventListener('click', closePlayer);

    document.addEventListener('keydown', function (event) {
      if (event.keyCode === BACK_KEY || event.key === 'Escape') {
        if (isPlayerOpen()) {
          closePlayer();
        } else if (event.keyCode === BACK_KEY) {
          exitApp();
        }
        return;
      }
      if (event.key === 'Enter' && document.activeElement === searchInput) {
        searchVideos(searchInput.value);
      }
    });
  }

  bindEvents();
  setStatus('Pick a topic or type a search');
  const firstQuick = document.querySelector('.quick');
  if (firstQuick) firstQuick.focus();
})();
