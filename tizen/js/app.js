(function () {
  const config = window.YTK2_CONFIG || {};
  const filterEngine = window.YTK2FilterEngine;
  const apiBase = (config.FILTER_API_BASE_URL || '').replace(/\/$/, '');
  const youtubeKey = config.YOUTUBE_API_KEY || '';

  const statusEl = document.getElementById('status');
  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const resultsEl = document.getElementById('results');

  const modal = document.getElementById('playerModal');
  const playerFrame = document.getElementById('playerFrame');
  const closePlayerBtn = document.getElementById('closePlayerBtn');

  let filters = {
    blocked_keywords: [],
    blocked_channels: [],
    allowed_channels: [],
    config: { whitelist_mode: false, search_in: 'title' }
  };

  if (!filterEngine) {
    console.error('YTK2FilterEngine not loaded');
    return;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }
    return response.json();
  }

  async function loadFilters(showToast) {
    if (!apiBase) {
      setStatus('Set FILTER_API_BASE_URL in js/config.js');
      return;
    }

    setStatus('Syncing filters...');

    try {
      filters = await fetchJson(apiBase + '/api/filters');
      setStatus('Filters ready: ' + filters.blocked_keywords.length + ' blocked keywords');
      if (showToast) {
        alert('Filters refreshed');
      }
    } catch (error) {
      setStatus('Could not load filters from API');
    }
  }

  function renderResults(items, total) {
    if (!items.length) {
      resultsEl.innerHTML = '<div class="empty">No safe results found.</div>';
      return;
    }

    resultsEl.innerHTML = items.map(function (item) {
      const snippet = item.snippet || {};
      const id = (item.id && item.id.videoId) || '';
      return (
        '<button class="video-card" data-video-id="' + escapeHtml(id) + '">' +
          '<div class="video-title">' + escapeHtml(snippet.title) + '</div>' +
          '<div class="video-channel">' + escapeHtml(snippet.channelTitle || 'Unknown channel') + '</div>' +
        '</button>'
      );
    }).join('');

    const filteredCount = Math.max(total - items.length, 0);
    setStatus('Showing ' + items.length + ' safe videos (' + filteredCount + ' filtered)');

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
    const url = 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId) + '?autoplay=1&rel=0';
    playerFrame.src = url;
    modal.classList.remove('hidden');
    closePlayerBtn.focus();
  }

  function closePlayer() {
    playerFrame.src = 'about:blank';
    modal.classList.add('hidden');
  }

  async function searchVideos(query) {
    if (!youtubeKey) {
      setStatus('Set YOUTUBE_API_KEY in js/config.js');
      return;
    }

    if (!query || !query.trim()) {
      setStatus('Enter a search term');
      return;
    }

    setStatus('Searching...');

    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      maxResults: '30',
      safeSearch: 'strict',
      q: query.trim(),
      key: youtubeKey
    });

    try {
      const payload = await fetchJson('https://www.googleapis.com/youtube/v3/search?' + params.toString());
      const allItems = payload.items || [];
      const allowedItems = allItems.filter(function (item) {
        return filterEngine.isAllowedVideo(item, filters);
      });
      renderResults(allowedItems, allItems.length);
    } catch (error) {
      resultsEl.innerHTML = '<div class="error">Search failed. Check API key and network.</div>';
      setStatus('Search failed');
    }
  }

  function promptPinThenRefresh() {
    const expectedPin = config.PARENT_PIN || '1967';
    const entered = prompt('Enter parent PIN to refresh filters:');
    if (entered === null) return;
    if (entered !== expectedPin) {
      alert('Invalid PIN');
      return;
    }
    loadFilters(true);
  }

  function bindEvents() {
    searchBtn.addEventListener('click', function () {
      searchVideos(searchInput.value);
    });

    refreshBtn.addEventListener('click', promptPinThenRefresh);

    Array.from(document.querySelectorAll('.quick')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        const q = btn.getAttribute('data-query') || '';
        searchInput.value = q;
        searchVideos(q);
      });
    });

    closePlayerBtn.addEventListener('click', closePlayer);

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
        closePlayer();
      }
      if (event.key === 'Enter' && document.activeElement === searchInput) {
        searchVideos(searchInput.value);
      }
    });
  }

  bindEvents();
  loadFilters(false);
})();
