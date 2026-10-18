(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  function showToast(message, type = 'success') {
    const toast = $('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => { toast.className = 'toast'; }, 3000);
  }

  async function api(endpoint, options = {}) {
    const method = options.method || 'GET';
    const headers = { 'Content-Type': 'application/json' };
    if (method !== 'GET') headers['X-Requested-With'] = 'yt2';
    try {
      const response = await fetch(endpoint, { ...options, method, headers, credentials: 'same-origin' });
      let body = null;
      try { body = await response.json(); } catch (_) { /* ignore */ }
      if (!response.ok) throw new Error((body && body.error) || 'Request failed');
      return body;
    } catch (error) {
      showToast(error.message, 'error');
      throw error;
    }
  }

  // Build a list row with textContent only (no HTML injection).
  function row(title, meta, onDelete) {
    const item = document.createElement('div');
    item.className = 'item';
    const content = document.createElement('div');
    const t = document.createElement('div');
    t.className = 'item-title';
    t.textContent = title;
    const m = document.createElement('div');
    m.className = 'item-meta';
    m.textContent = meta;
    content.append(t, m);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-delete';
    del.textContent = 'Delete';
    del.addEventListener('click', onDelete);
    item.append(content, del);
    return item;
  }

  function fillList(container, rows, emptyText) {
    container.replaceChildren();
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }
    rows.forEach(r => container.appendChild(r));
  }

  // Row with several action buttons (textContent only).
  function actionRow(title, meta, actions, href) {
    const item = document.createElement('div');
    item.className = 'item';
    const content = document.createElement('div');
    const t = document.createElement('div');
    t.className = 'item-title';
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = title;
      t.appendChild(a);
    } else {
      t.textContent = title;
    }
    const m = document.createElement('div');
    m.className = 'item-meta';
    m.textContent = meta;
    content.append(t, m);
    const box = document.createElement('div');
    box.className = 'item-actions';
    actions.forEach(({ label, className, onClick }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = className || 'btn-neutral';
      b.textContent = label;
      b.addEventListener('click', onClick);
      box.appendChild(b);
    });
    item.append(content, box);
    return item;
  }

  async function loadFlags() {
    const flags = await api('/api/admin/flags');
    const badge = $('flags-badge');
    badge.textContent = String(flags.length);
    badge.classList.toggle('hidden', flags.length === 0);

    fillList($('flags-list'), flags.map(f => actionRow(
      f.title || f.video_id,
      `${f.channel_name || f.channel_id} | matched "${f.keyword}" | shown ${f.hit_count}x | last ${new Date(f.last_seen).toLocaleString()}`,
      [
        {
          label: "Don't alert again",
          onClick: async () => {
            await api(`/api/admin/flags/${f.id}/ignore`, { method: 'POST', body: '{}' });
            showToast('Will not alert again for this channel and word');
            refreshLists();
          }
        },
        {
          label: 'Block channel',
          className: 'btn-delete',
          onClick: async () => {
            if (!confirm(`Block ${f.channel_name || f.channel_id}? It is removed from the allowed list.`)) return;
            await api(`/api/admin/flags/${f.id}/block`, { method: 'POST', body: '{}' });
            showToast('Channel blocked');
            refreshLists();
          }
        },
        {
          label: 'Dismiss',
          onClick: async () => {
            await api(`/api/admin/flags/${f.id}/dismiss`, { method: 'POST', body: '{}' });
            refreshLists();
          }
        }
      ],
      /^[A-Za-z0-9_-]{6,20}$/.test(f.video_id) ? `https://www.youtube.com/watch?v=${f.video_id}` : null
    )), 'Nothing to review');
  }

  async function loadIgnores() {
    const list = await api('/api/admin/alert-ignores');
    fillList($('ignores-list'), list.map(i => actionRow(
      `${i.channel_name || i.channel_id}: "${i.keyword}"`,
      'Matches on this channel are not logged',
      [{
        label: 'Turn alerts back on',
        onClick: async () => {
          await api(`/api/admin/alert-ignores/${i.id}`, { method: 'DELETE' });
          showToast('Alerts turned back on');
          refreshLists();
        }
      }]
    )), 'None');
  }

  async function loadSummary() {
    const s = await api('/api/admin/summary');
    $('keywords-count').textContent = s.blocked_keywords_count;
    $('blocked-channels-count').textContent = s.blocked_channels_count;
    $('allowed-channels-count').textContent = s.allowed_channels_count;
  }

  async function loadKeywords() {
    const list = await api('/api/admin/keywords');
    fillList($('keywords-list'), list.map(k => row(
      k.keyword,
      k.case_sensitive ? 'Case sensitive' : 'Case insensitive',
      async () => {
        if (!confirm(`Remove "${k.keyword}" from the blocklist?`)) return;
        await api(`/api/admin/keywords/${k.id}`, { method: 'DELETE' });
        showToast('Keyword removed');
        refreshLists();
      }
    )), 'No blocked keywords');
  }

  function channelLoader(path, listId, metaFn, label) {
    return async () => {
      const list = await api(`/api/admin/${path}`);
      fillList($(listId), list.map(c => row(
        c.channel_name || c.channel_id,
        metaFn(c),
        async () => {
          if (!confirm(`Remove ${c.channel_name || c.channel_id}?`)) return;
          await api(`/api/admin/${path}/${c.id}`, { method: 'DELETE' });
          showToast('Channel removed');
          refreshLists();
        }
      )), `No ${label} channels`);
    };
  }

  const loadBlocked = channelLoader('blocked-channels', 'blocked-channels-list',
    c => `ID: ${c.channel_id}${c.reason ? ` | ${c.reason}` : ''}`, 'blocked');
  const loadAllowed = channelLoader('allowed-channels', 'allowed-channels-list',
    c => `ID: ${c.channel_id}${c.notes ? ` | ${c.notes}` : ''}`, 'allowed');


  // ---- Community lists (reviewed import) -----------------------------------
  async function loadCommunity() {
    const [sources, candidates] = await Promise.all([
      api('/api/admin/community/sources'),
      api('/api/admin/community/candidates?status=pending')
    ]);

    fillList($('community-sources'), sources.map(s => actionRow(
      s.label,
      `${s.license} | ${s.last_imported_at ? `imported ${new Date(s.last_imported_at).toLocaleString()}, ${s.entry_count} entries` : 'never imported'}` +
        `${s.handles_stored ? ` | ${s.handles_stored} handles stored` : ''} | pending ${s.pending}, applied ${s.accepted}, dismissed ${s.rejected}`,
      [
        {
          label: s.last_imported_at ? 'Refresh' : 'Import',
          onClick: async () => {
            const r = await api('/api/admin/community/import', { method: 'POST', body: JSON.stringify({ source: s.source }) });
            showToast(`${r.entries} entries read, ${r.queued} new for review`);
            refreshLists();
          }
        },
        {
          label: 'Remove everything from this source',
          className: 'btn-delete',
          onClick: async () => {
            if (!confirm(`Remove every channel and keyword that came from "${s.label}", and forget its pending entries?`)) return;
            const r = await api(`/api/admin/community/sources/${s.source}`, { method: 'DELETE' });
            showToast(`Removed ${r.channels} channels and ${r.keywords} keywords`);
            refreshLists();
          }
        }
      ]
    )), 'No sources');

    const rows = [];
    const groups = new Map();
    candidates.forEach(c => {
      const key = `${c.source}|${c.category || ''}`;
      groups.set(key, (groups.get(key) || 0) + 1);
    });
    groups.forEach((count, key) => {
      const [source, category] = key.split('|');
      rows.push(actionRow(`${source}: ${category || 'uncategorized'} (${count} shown)`, 'Apply to everything in this group', [
        {
          label: 'Block all',
          className: 'btn-delete',
          onClick: async () => {
            if (!confirm(`Block every pending "${category || 'uncategorized'}" entry from ${source}? Allowed channels are skipped.`)) return;
            const r = await api('/api/admin/community/candidates/bulk', { method: 'POST', body: JSON.stringify({ source, category: category || null, action: 'accept' }) });
            showToast(`${r.done} applied${r.skippedAllowed ? `, ${r.skippedAllowed} skipped (on your allowed list)` : ''}`);
            refreshLists();
          }
        },
        {
          label: 'Dismiss all',
          onClick: async () => {
            const r = await api('/api/admin/community/candidates/bulk', { method: 'POST', body: JSON.stringify({ source, category: category || null, action: 'reject' }) });
            showToast(`${r.done} dismissed`);
            refreshLists();
          }
        }
      ]));
    });

    candidates.forEach(c => {
      const what = c.type === 'channel' ? (c.name || c.value) : `Keyword: ${c.value}`;
      const meta = [c.type === 'channel' ? `ID ${c.value}` : null, c.source, c.category, c.reason,
        c.conflicts_with_allowed ? 'ON YOUR ALLOWED LIST: cannot be blocked from here' : null].filter(Boolean).join(' | ');
      rows.push(actionRow(what, meta, [
        {
          label: 'Block',
          className: 'btn-delete',
          onClick: async () => {
            if (c.conflicts_with_allowed) { showToast('This channel is on your allowed list', 'error'); return; }
            await api(`/api/admin/community/candidates/${c.id}/accept`, { method: 'POST', body: '{}' });
            showToast('Applied');
            refreshLists();
          }
        },
        {
          label: 'Dismiss',
          onClick: async () => {
            await api(`/api/admin/community/candidates/${c.id}/reject`, { method: 'POST', body: '{}' });
            refreshLists();
          }
        }
      ]));
    });
    fillList($('community-queue'), rows, 'Nothing to review. Import a list above.');
  }

  function refreshLists() {
    return Promise.all([loadSummary(), loadKeywords(), loadBlocked(), loadAllowed(), loadFlags(), loadIgnores(), loadCommunity()]).catch(() => {});
  }

  // ---- Config -------------------------------------------------------------
  const BOOL_KEYS = ['allowlist_only', 'block_live', 'match_plurals', 'community_auto_block'];

  async function loadConfig() {
    const config = await api('/api/admin/config');
    BOOL_KEYS.forEach(k => { $(`cfg-${k}`).checked = config[k] && config[k].value === 'true'; });
    $('cfg-made_for_kids').value = (config.made_for_kids && config.made_for_kids.value) || 'off';
  }

  BOOL_KEYS.forEach(key => {
    $(`cfg-${key}`).addEventListener('change', async event => {
      const el = event.target;
      try {
        await api(`/api/admin/config/${key}`, { method: 'PUT', body: JSON.stringify({ value: String(el.checked) }) });
        showToast('Saved');
      } catch (_) {
        el.checked = !el.checked;
      }
    });
  });

  $('cfg-made_for_kids').addEventListener('change', async event => {
    try {
      await api('/api/admin/config/made_for_kids', { method: 'PUT', body: JSON.stringify({ value: event.target.value }) });
      showToast('Saved');
    } catch (_) {
      loadConfig();
    }
  });

  // ---- Add forms ----------------------------------------------------------
  $('keyword-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/api/admin/keywords', {
        method: 'POST',
        body: JSON.stringify({ keyword: $('keyword-input').value, case_sensitive: $('keyword-case-sensitive').checked })
      });
      $('keyword-input').value = '';
      $('keyword-case-sensitive').checked = false;
      showToast('Keyword added');
      refreshLists();
    } catch (_) { /* toast shown */ }
  });

  function channelForm(formId, path, idEl, nameEl, extraEl, extraKey, doneText) {
    $(formId).addEventListener('submit', async e => {
      e.preventDefault();
      try {
        await api(`/api/admin/${path}`, {
          method: 'POST',
          body: JSON.stringify({
            channel_id: $(idEl).value.trim(),
            channel_name: $(nameEl).value.trim() || null,
            [extraKey]: $(extraEl).value.trim() || null
          })
        });
        [idEl, nameEl, extraEl].forEach(id => { $(id).value = ''; });
        showToast(doneText);
        refreshLists();
      } catch (_) { /* toast shown */ }
    });
  }
  channelForm('blocked-form', 'blocked-channels', 'blocked-channel-id', 'blocked-channel-name', 'blocked-channel-reason', 'reason', 'Channel blocked');
  channelForm('allowed-form', 'allowed-channels', 'allowed-channel-id', 'allowed-channel-name', 'allowed-channel-notes', 'notes', 'Channel allowed');

  // ---- Google ---------------------------------------------------------------
  async function loadGoogle() {
    const s = await api('/api/admin/google/status');
    const el = $('google-status');
    if (!s.configured) {
      el.textContent = 'Not configured: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and TOKEN_ENCRYPTION_KEY.';
    } else if (s.connected) {
      const who = s.channel_title ? `as ${s.channel_title}` : '';
      const when = s.connected_at ? ` since ${new Date(s.connected_at).toLocaleString()}` : '';
      el.textContent = `Connected ${who}${when}`.replace(/\s+/g, ' ');
    } else {
      el.textContent = 'Not signed in. The child UI shows nothing until you sign in.';
    }
    $('google-signin').classList.toggle('hidden', !s.configured);
    $('google-signin').textContent = s.connected ? 'Sign in again' : 'Sign in with Google';
    $('google-signout').classList.toggle('hidden', !s.connected);
  }

  $('google-signout').addEventListener('click', async () => {
    if (!confirm('Sign out of Google? The child UI will stop working until you sign in again.')) return;
    await api('/api/admin/google/disconnect', { method: 'POST', body: '{}' });
    showToast('Signed out');
    loadGoogle();
  });

  const GOOGLE_MESSAGES = {
    connected: ['Google account connected', 'success'],
    denied: ['Google sign-in was cancelled', 'error'],
    error: ['Google sign-in failed. Check server logs and OAuth settings.', 'error'],
    not_configured: ['Google OAuth is not configured on the server', 'error']
  };
  const flag = new URLSearchParams(window.location.search).get('google');
  if (flag && GOOGLE_MESSAGES[flag]) {
    showToast(...GOOGLE_MESSAGES[flag]);
    history.replaceState(null, '', window.location.pathname);
  }

  loadGoogle().catch(() => {});
  loadConfig().catch(() => {});
  refreshLists();
})();
