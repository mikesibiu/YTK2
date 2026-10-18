// API Base URL (will use current host)
const API_BASE = window.location.origin;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('api-url').textContent = `${API_BASE}/api/filters`;
    loadAll();

    // Setup config listeners
    document.getElementById('whitelist-mode').addEventListener('change', updateWhitelistMode);
    document.getElementById('search-in').addEventListener('change', updateSearchIn);
});

// ============================================
// UTILITY FUNCTIONS
// ============================================

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
        toast.className = 'toast';
    }, 3000);
}

async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
            },
            ...options
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Request failed');
        }

        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        showToast(error.message, 'error');
        throw error;
    }
}

// ============================================
// LOAD DATA
// ============================================

async function loadAll() {
    await Promise.all([
        loadSummary(),
        loadConfig(),
        loadKeywords(),
        loadBlockedChannels(),
        loadAllowedChannels(),
        loadCommunity()
    ]);
}

async function loadSummary() {
    try {
        const summary = await apiCall('/api/filters/summary');
        document.getElementById('keywords-count').textContent = summary.blocked_keywords_count || 0;
        document.getElementById('blocked-channels-count').textContent = summary.blocked_channels_count || 0;
        document.getElementById('allowed-channels-count').textContent = summary.allowed_channels_count || 0;
    } catch (error) {
        console.error('Failed to load summary:', error);
    }
}

async function loadConfig() {
    try {
        const config = await apiCall('/api/admin/config');
        document.getElementById('whitelist-mode').checked = config.whitelist_mode?.value === 'true';
        document.getElementById('search-in').value = config.search_in?.value || 'title';
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

async function loadKeywords() {
    try {
        const keywords = await apiCall('/api/admin/keywords');
        const container = document.getElementById('keywords-list');

        if (keywords.length === 0) {
            container.innerHTML = '<div class="empty-state">No blocked keywords yet</div>';
            return;
        }

        container.innerHTML = keywords.map(k => `
            <div class="item">
                <div class="item-content">
                    <div class="item-title">${escapeHtml(k.keyword)}</div>
                    <div class="item-meta">
                        ${k.case_sensitive ? 'Case Sensitive' : 'Case Insensitive'} •
                        Added: ${new Date(k.created_at).toLocaleDateString()}
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn-delete" onclick="deleteKeyword(${k.id})">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load keywords:', error);
    }
}

async function loadBlockedChannels() {
    try {
        const channels = await apiCall('/api/admin/blocked-channels');
        const container = document.getElementById('blocked-channels-list');

        if (channels.length === 0) {
            container.innerHTML = '<div class="empty-state">No blocked channels yet</div>';
            return;
        }

        container.innerHTML = channels.map(c => `
            <div class="item">
                <div class="item-content">
                    <div class="item-title">${escapeHtml(c.channel_name || c.channel_id)}</div>
                    <div class="item-meta">
                        ID: ${escapeHtml(c.channel_id)}
                        ${c.reason ? `<br>Reason: ${escapeHtml(c.reason)}` : ''}
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn-delete" onclick="deleteBlockedChannel(${c.id})">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load blocked channels:', error);
    }
}

async function loadAllowedChannels() {
    try {
        const channels = await apiCall('/api/admin/allowed-channels');
        const container = document.getElementById('allowed-channels-list');

        if (channels.length === 0) {
            container.innerHTML = '<div class="empty-state">No allowed channels yet</div>';
            return;
        }

        container.innerHTML = channels.map(c => `
            <div class="item">
                <div class="item-content">
                    <div class="item-title">${escapeHtml(c.channel_name || c.channel_id)}</div>
                    <div class="item-meta">
                        ID: ${escapeHtml(c.channel_id)}
                        ${c.notes ? `<br>Notes: ${escapeHtml(c.notes)}` : ''}
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn-delete" onclick="deleteAllowedChannel(${c.id})">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load allowed channels:', error);
    }
}

// ============================================
// ADD FUNCTIONS
// ============================================

async function addKeyword() {
    const input = document.getElementById('keyword-input');
    const caseSensitive = document.getElementById('keyword-case-sensitive');
    const keyword = input.value.trim();

    if (!keyword) {
        showToast('Please enter a keyword', 'error');
        return;
    }

    try {
        await apiCall('/api/admin/keywords', {
            method: 'POST',
            body: JSON.stringify({
                keyword: keyword,
                case_sensitive: caseSensitive.checked
            })
        });

        input.value = '';
        caseSensitive.checked = false;
        showToast('Keyword added successfully');
        await loadKeywords();
        await loadSummary();
    } catch (error) {
        // Error already shown by apiCall
    }
}

async function addBlockedChannel() {
    const channelId = document.getElementById('blocked-channel-id').value.trim();
    const channelName = document.getElementById('blocked-channel-name').value.trim();
    const reason = document.getElementById('blocked-channel-reason').value.trim();

    if (!channelId) {
        showToast('Please enter a channel ID', 'error');
        return;
    }

    try {
        await apiCall('/api/admin/blocked-channels', {
            method: 'POST',
            body: JSON.stringify({
                channel_id: channelId,
                channel_name: channelName || null,
                reason: reason || null
            })
        });

        document.getElementById('blocked-channel-id').value = '';
        document.getElementById('blocked-channel-name').value = '';
        document.getElementById('blocked-channel-reason').value = '';
        showToast('Channel blocked successfully');
        await loadBlockedChannels();
        await loadSummary();
    } catch (error) {
        // Error already shown by apiCall
    }
}

async function addAllowedChannel() {
    const channelId = document.getElementById('allowed-channel-id').value.trim();
    const channelName = document.getElementById('allowed-channel-name').value.trim();
    const notes = document.getElementById('allowed-channel-notes').value.trim();

    if (!channelId) {
        showToast('Please enter a channel ID', 'error');
        return;
    }

    try {
        await apiCall('/api/admin/allowed-channels', {
            method: 'POST',
            body: JSON.stringify({
                channel_id: channelId,
                channel_name: channelName || null,
                notes: notes || null
            })
        });

        document.getElementById('allowed-channel-id').value = '';
        document.getElementById('allowed-channel-name').value = '';
        document.getElementById('allowed-channel-notes').value = '';
        showToast('Channel allowed successfully');
        await loadAllowedChannels();
        await loadSummary();
    } catch (error) {
        // Error already shown by apiCall
    }
}

// ============================================
// DELETE FUNCTIONS
// ============================================

async function deleteKeyword(id) {
    if (!confirm('Are you sure you want to delete this keyword?')) {
        return;
    }

    try {
        await apiCall(`/api/admin/keywords/${id}`, { method: 'DELETE' });
        showToast('Keyword deleted successfully');
        await loadKeywords();
        await loadSummary();
    } catch (error) {
        // Error already shown by apiCall
    }
}

async function deleteBlockedChannel(id) {
    if (!confirm('Are you sure you want to unblock this channel?')) {
        return;
    }

    try {
        await apiCall(`/api/admin/blocked-channels/${id}`, { method: 'DELETE' });
        showToast('Channel unblocked successfully');
        await loadBlockedChannels();
        await loadSummary();
    } catch (error) {
        // Error already shown by apiCall
    }
}

async function deleteAllowedChannel(id) {
    if (!confirm('Are you sure you want to remove this channel from the allowed list?')) {
        return;
    }

    try {
        await apiCall(`/api/admin/allowed-channels/${id}`, { method: 'DELETE' });
        showToast('Channel removed from allowed list');
        await loadAllowedChannels();
        await loadSummary();
    } catch (error) {
        // Error already shown by apiCall
    }
}

// ============================================
// CONFIG UPDATE FUNCTIONS
// ============================================

async function updateWhitelistMode(event) {
    const enabled = event.target.checked;

    try {
        await apiCall('/api/admin/config/whitelist_mode', {
            method: 'PUT',
            body: JSON.stringify({ value: enabled.toString() })
        });
        showToast(`Whitelist mode ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
        // Revert checkbox on error
        event.target.checked = !enabled;
    }
}

async function updateSearchIn(event) {
    const value = event.target.value;

    try {
        await apiCall('/api/admin/config/search_in', {
            method: 'PUT',
            body: JSON.stringify({ value: value })
        });
        showToast('Search setting updated');
    } catch (error) {
        // Error already shown by apiCall
    }
}

// ============================================
// UTILITY
// ============================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Allow Enter key to submit forms
document.getElementById('keyword-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addKeyword();
});

document.getElementById('blocked-channel-id').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addBlockedChannel();
});

document.getElementById('allowed-channel-id').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addAllowedChannel();
});


// ============================================
// COMMUNITY LISTS (reviewed import)
// ============================================

function actionRow(title, meta, actions) {
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
    const box = document.createElement('div');
    box.className = 'item-actions';
    actions.forEach(({ label, className, disabled, onClick }) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = className || 'btn-secondary';
        b.textContent = label;
        b.disabled = Boolean(disabled);
        b.addEventListener('click', onClick);
        box.appendChild(b);
    });
    item.append(content, box);
    return item;
}

function fillContainer(container, rows, emptyText) {
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

async function loadCommunity() {
    const [sources, candidates, config] = await Promise.all([
        apiCall('/api/admin/community/sources'),
        apiCall('/api/admin/community/candidates?status=pending'),
        apiCall('/api/admin/config')
    ]);

    document.getElementById('community-auto-block').checked =
        config.community_auto_block && config.community_auto_block.value === 'true';

    fillContainer(document.getElementById('community-sources'), sources.map(s => actionRow(
        s.label,
        `${s.license} | ${s.last_imported_at ? `imported ${new Date(s.last_imported_at).toLocaleString()}, ${s.entry_count} entries` : 'never imported'}` +
            `${s.handles_stored ? ` | ${s.handles_stored} handles stored` : ''} | pending ${s.pending}, applied ${s.accepted}, dismissed ${s.rejected}`,
        [
            {
                label: s.last_imported_at ? 'Refresh' : 'Import',
                onClick: async () => {
                    const result = await apiCall('/api/admin/community/import', { method: 'POST', body: JSON.stringify({ source: s.source }) });
                    showToast(`${result.entries} entries read, ${result.queued} new for review`);
                    loadCommunity();
                }
            },
            {
                label: 'Remove everything from this source',
                className: 'btn-delete',
                disabled: !s.accepted && !s.pending,
                onClick: async () => {
                    if (!confirm(`Remove every channel and keyword that came from "${s.label}", and forget its pending entries?`)) return;
                    const result = await apiCall(`/api/admin/community/sources/${s.source}`, { method: 'DELETE' });
                    showToast(`Removed ${result.channels} channels and ${result.keywords} keywords`);
                    loadAll();
                }
            }
        ]
    )), 'No sources');

    const rows = [];
    const groups = new Map();
    candidates.forEach(c => groups.set(`${c.source}|${c.category || ''}`, (groups.get(`${c.source}|${c.category || ''}`) || 0) + 1));
    groups.forEach((count, key) => {
        const [source, category] = key.split('|');
        rows.push(actionRow(
            `${source}: ${category || 'uncategorized'} (${count} shown)`,
            'Apply to everything in this group',
            [
                {
                    label: 'Block all',
                    className: 'btn-delete',
                    onClick: async () => {
                        if (!confirm(`Block every pending "${category || 'uncategorized'}" entry from ${source}? Allowed channels are skipped.`)) return;
                        const r = await apiCall('/api/admin/community/candidates/bulk', { method: 'POST', body: JSON.stringify({ source, category: category || null, action: 'accept' }) });
                        showToast(`${r.done} applied${r.skippedAllowed ? `, ${r.skippedAllowed} skipped (on your allowed list)` : ''}`);
                        loadAll();
                    }
                },
                {
                    label: 'Dismiss all',
                    onClick: async () => {
                        const r = await apiCall('/api/admin/community/candidates/bulk', { method: 'POST', body: JSON.stringify({ source, category: category || null, action: 'reject' }) });
                        showToast(`${r.done} dismissed`);
                        loadCommunity();
                    }
                }
            ]
        ));
    });

    candidates.forEach(c => {
        const what = c.type === 'channel' ? `${c.name || c.value}` : `Keyword: ${c.value}`;
        const meta = [c.type === 'channel' ? `ID ${c.value}` : null, c.source, c.category, c.reason,
            c.conflicts_with_allowed ? 'ON YOUR ALLOWED LIST: cannot be blocked from here' : null].filter(Boolean).join(' | ');
        rows.push(actionRow(what, meta, [
            {
                label: 'Block',
                className: 'btn-delete',
                disabled: c.conflicts_with_allowed,
                onClick: async () => {
                    await apiCall(`/api/admin/community/candidates/${c.id}/accept`, { method: 'POST', body: '{}' });
                    showToast('Applied');
                    loadAll();
                }
            },
            {
                label: 'Dismiss',
                onClick: async () => {
                    await apiCall(`/api/admin/community/candidates/${c.id}/reject`, { method: 'POST', body: '{}' });
                    loadCommunity();
                }
            }
        ]));
    });
    fillContainer(document.getElementById('community-queue'), rows, 'Nothing to review. Import a list above.');
}

document.getElementById('community-auto-block').addEventListener('change', async event => {
    const enabled = event.target.checked;
    try {
        await apiCall('/api/admin/config/community_auto_block', { method: 'PUT', body: JSON.stringify({ value: String(enabled) }) });
        showToast(`Immediate blocking ${enabled ? 'on' : 'off'}`);
    } catch (error) {
        event.target.checked = !enabled;
    }
});
