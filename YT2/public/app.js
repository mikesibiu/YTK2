(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const statusEl = $('status');
  const resultsEl = $('results');
  const moreBtn = $('moreBtn');
  const backBtn = $('backToPlaylists');
  const playerEl = $('player');
  const frame = $('playerFrame');
  const searchInput = $('searchInput');
  const lockEl = $('lock');
  const codeInput = $('codeInput');
  const lockMsg = $('lockMsg');
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{2,64}$/;

  const state = {
    tab: 'search',
    query: '',
    nextToken: null,
    playlistId: null, // set while viewing the videos inside a playlist
    loadSeq: 0
  };

  const MESSAGES = {
    not_connected: 'A grown-up needs to sign in first.',
    filter_unavailable: 'Videos are resting right now. Please try again in a bit.',
    quota_exceeded: 'That is enough searching for today!',
    upstream_error: 'Something went wrong. Please try again.',
    upstream_timeout: 'That took too long. Please try again.'
  };

  function setStatus(text) {
    statusEl.textContent = text || '';
  }

  async function getJson(path) {
    let res;
    try {
      res = await fetch(path, { headers: { Accept: 'application/json' } });
    } catch (_) {
      throw new Error('No connection. Please try again.');
    }
    let body = null;
    try { body = await res.json(); } catch (_) { /* ignore */ }
    if (!res.ok) {
      if (res.status === 401 && body && body.error === 'locked') {
        showLock();
        throw new Error('Enter the code first.');
      }
      if (res.status === 429) throw new Error('Slow down a little, then try again!');
      throw new Error(MESSAGES[body && body.error] || 'Something went wrong. Please try again.');
    }
    return body;
  }

  // ---- Access code ------------------------------------------------------

  function showLock() {
    lockEl.classList.remove('hidden');
    lockMsg.textContent = '';
    codeInput.value = '';
    codeInput.focus();
  }

  $('lockForm').addEventListener('submit', async e => {
    e.preventDefault();
    lockMsg.textContent = '';
    try {
      const res = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeInput.value })
      });
      if (res.ok) {
        lockEl.classList.add('hidden');
        codeInput.value = '';
        setStatus('Search for something to watch!');
        selectTab(state.tab);
        return;
      }
      lockMsg.textContent = res.status === 429 ? 'Too many tries. Wait a bit.' : 'Try again!';
    } catch (_) {
      lockMsg.textContent = 'No connection. Try again.';
    }
    codeInput.value = '';
    codeInput.focus();
  });

  async function checkSession() {
    try {
      const res = await fetch('/api/session', { headers: { Accept: 'application/json' } });
      const body = await res.json();
      if (!body.unlocked) showLock();
    } catch (_) { /* the first request will show the lock if needed */ }
  }

  function makeCard({ image, title, subtitle, onClick }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card';

    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    if (/^https:\/\/[a-z0-9.-]*ytimg\.com\//i.test(image || '')) img.src = image;
    btn.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = title || '';
    meta.appendChild(t);
    if (subtitle) {
      const s = document.createElement('div');
      s.className = 'channel';
      s.textContent = subtitle;
      meta.appendChild(s);
    }
    btn.appendChild(meta);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderVideos(items, append) {
    if (!append) resultsEl.replaceChildren();
    for (const v of items) {
      if (!VIDEO_ID_RE.test(v.video_id || '')) continue;
      resultsEl.appendChild(makeCard({
        image: v.thumbnail,
        title: v.title,
        subtitle: v.channel_name,
        onClick: () => openPlayer(v.video_id)
      }));
    }
  }

  function setMore(token) {
    state.nextToken = token || null;
    moreBtn.classList.toggle('hidden', !state.nextToken);
  }

  function resetView() {
    state.loadSeq += 1;
    resultsEl.replaceChildren();
    setMore(null);
    setStatus('');
    backBtn.classList.add('hidden');
  }

  // ---- Loaders ----------------------------------------------------------

  async function runSearch(q, append) {
    const seq = ++state.loadSeq;
    if (!append) { resultsEl.replaceChildren(); setMore(null); }
    setStatus('Looking...');
    try {
      let path = `/api/search?q=${encodeURIComponent(q)}`;
      if (append && state.nextToken) path += `&pageToken=${encodeURIComponent(state.nextToken)}`;
      const data = await getJson(path);
      if (seq !== state.loadSeq) return;
      renderVideos(data.items || [], append);
      setMore(data.next_page_token);
      setStatus(resultsEl.children.length ? '' : 'Nothing found. Try another word!');
    } catch (e) {
      if (seq === state.loadSeq) setStatus(e.message);
    }
  }

  async function loadSubscriptions() {
    const seq = ++state.loadSeq;
    setStatus('Loading...');
    try {
      const data = await getJson('/api/subscriptions');
      if (seq !== state.loadSeq) return;
      renderVideos(data.items || [], false);
      setStatus(resultsEl.children.length ? '' : 'No videos here right now.');
    } catch (e) {
      if (seq === state.loadSeq) setStatus(e.message);
    }
  }

  async function loadPlaylists() {
    const seq = ++state.loadSeq;
    state.playlistId = null;
    backBtn.classList.add('hidden');
    resultsEl.replaceChildren();
    setMore(null);
    setStatus('Loading...');
    try {
      const data = await getJson('/api/playlists');
      if (seq !== state.loadSeq) return;
      for (const p of data.items || []) {
        if (!PLAYLIST_ID_RE.test(p.id || '')) continue;
        resultsEl.appendChild(makeCard({
          image: p.thumbnail,
          title: p.title,
          subtitle: `${p.item_count} videos`,
          onClick: () => openPlaylist(p.id)
        }));
      }
      setStatus(resultsEl.children.length ? '' : 'No playlists yet.');
    } catch (e) {
      if (seq === state.loadSeq) setStatus(e.message);
    }
  }

  async function loadPlaylistItems(id, append) {
    const seq = ++state.loadSeq;
    state.playlistId = id;
    backBtn.classList.remove('hidden');
    if (!append) { resultsEl.replaceChildren(); setMore(null); }
    setStatus('Loading...');
    try {
      let path = `/api/playlists/${encodeURIComponent(id)}/items`;
      if (append && state.nextToken) path += `?pageToken=${encodeURIComponent(state.nextToken)}`;
      const data = await getJson(path);
      if (seq !== state.loadSeq) return;
      renderVideos(data.items || [], append);
      setMore(data.next_page_token);
      setStatus(resultsEl.children.length ? '' : 'No videos here right now.');
    } catch (e) {
      if (seq === state.loadSeq) setStatus(e.message);
    }
  }

  // ---- Navigation / history ---------------------------------------------
  // History entries: {yt2:'playlist'} while inside a playlist, {yt2:'player'} while watching.
  // Browser Back closes the player first, then leaves the playlist.

  function openPlaylist(id) {
    history.pushState({ yt2: 'playlist' }, '');
    loadPlaylistItems(id, false);
  }

  function showPlaylistList() {
    loadPlaylists();
  }

  function isPlayerOpen() {
    return !playerEl.classList.contains('hidden');
  }

  function openPlayer(videoId) {
    if (!VIDEO_ID_RE.test(videoId)) return;
    const params = new URLSearchParams({
      autoplay: '1',
      rel: '0',
      playsinline: '1',
      modestbranding: '1',
      iv_load_policy: '3',
      disablekb: '1',
      fs: '0',
      origin: window.location.origin
    });
    history.pushState({ yt2: 'player' }, '');
    frame.src = `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
    playerEl.classList.remove('hidden');
    $('closePlayer').focus();
  }

  function hidePlayer() {
    frame.src = 'about:blank';
    playerEl.classList.add('hidden');
  }

  $('closePlayer').addEventListener('click', () => {
    if (history.state && history.state.yt2 === 'player') history.back();
    else hidePlayer();
  });

  window.addEventListener('popstate', () => {
    if (isPlayerOpen()) {
      hidePlayer();
      return;
    }
    if (state.tab === 'playlists' && state.playlistId) showPlaylistList();
  });

  // ---- Tabs / search -----------------------------------------------------

  function selectTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach(btn => {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    resetView();
    state.playlistId = null;
    if (tab === 'subscriptions') loadSubscriptions();
    else if (tab === 'playlists') loadPlaylists();
    else if (state.query) runSearch(state.query, false);
  }

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab));
  });

  $('searchForm').addEventListener('submit', e => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (!q) { setStatus('Type what you want to watch!'); return; }
    state.query = q;
    if (state.tab !== 'search') {
      selectTab('search');
    } else {
      runSearch(q, false);
    }
    searchInput.blur();
  });

  moreBtn.addEventListener('click', () => {
    if (state.tab === 'search') runSearch(state.query, true);
    else if (state.tab === 'playlists' && state.playlistId) loadPlaylistItems(state.playlistId, true);
  });

  backBtn.addEventListener('click', () => {
    if (history.state && history.state.yt2 === 'playlist') history.back();
    else showPlaylistList();
  });

  setStatus('Search for something to watch!');
  checkSession();
})();
