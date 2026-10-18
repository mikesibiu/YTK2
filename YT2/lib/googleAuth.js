const crypto = require('crypto');
const { encrypt, decrypt } = require('./tokenCrypto');
const { NotConnectedError } = require('./errors');

const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const CHANNELS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
const EXPIRY_SKEW_MS = 60 * 1000;

/**
 * Server-side Google OAuth (authorization-code flow + PKCE).
 * The refresh token is encrypted (AES-256-GCM) before it goes to the store and is never
 * returned by any method here other than internally when talking to Google.
 */
function createGoogleAuth({
  clientId,
  clientSecret,
  redirectUri,
  store,
  encryptionKey, // Buffer(32) or undefined
  fetchFn = (...args) => fetch(...args),
  now = Date.now,
  timeoutMs = 10000
}) {
  let access = null; // { token, expiresAt }
  let inflight = null;

  const isConfigured = () => Boolean(clientId && clientSecret && redirectUri && encryptionKey);

  function createAuthRequest() {
    if (!isConfigured()) {
      throw new Error('Google OAuth is not configured (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI, TOKEN_ENCRYPTION_KEY)');
    }
    const state = crypto.randomBytes(24).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    });
    return { url: `${AUTH_ENDPOINT}?${params.toString()}`, state, verifier };
  }

  async function postForm(url, form) {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(timeoutMs)
    });
    let body = {};
    try {
      body = await response.json();
    } catch (_) {
      // non-JSON body
    }
    return { ok: response.ok, status: response.status, body };
  }

  async function handleCallback({ code, verifier }) {
    if (!isConfigured()) throw new Error('Google OAuth is not configured');
    if (!code || !verifier) throw new Error('Missing authorization code');

    const { ok, body } = await postForm(TOKEN_ENDPOINT, {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier
    });
    if (!ok || !body.access_token) {
      throw new Error(`Token exchange failed (${body.error || 'unknown'})`);
    }
    if (!body.refresh_token) {
      throw new Error('Google did not return a refresh token. Remove YT2 at myaccount.google.com/permissions and sign in again.');
    }
    const scopes = String(body.scope || '').split(/\s+/);
    if (!scopes.includes(SCOPE)) {
      throw new Error('The youtube.readonly permission was not granted');
    }

    // Best-effort: show which YouTube channel was connected.
    let channelId = null;
    let channelTitle = null;
    try {
      const r = await fetchFn(CHANNELS_ENDPOINT, {
        headers: { Authorization: `Bearer ${body.access_token}` },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (r.ok) {
        const data = await r.json();
        const ch = data.items && data.items[0];
        channelId = (ch && ch.id) || null;
        channelTitle = (ch && ch.snippet && ch.snippet.title) || null;
      }
    } catch (_) {
      // cosmetic only
    }

    await store.save({
      refreshTokenEnc: encrypt(body.refresh_token, encryptionKey),
      scope: body.scope,
      channelId,
      channelTitle
    });

    access = { token: body.access_token, expiresAt: now() + (Number(body.expires_in) || 3600) * 1000 };
  }

  async function refresh() {
    const row = await store.load();
    if (!row) throw new NotConnectedError();
    if (!encryptionKey) throw new NotConnectedError('TOKEN_ENCRYPTION_KEY is not configured');

    let refreshToken;
    try {
      refreshToken = decrypt(row.refresh_token_enc, encryptionKey);
    } catch (_) {
      throw new NotConnectedError('Stored token cannot be decrypted; the parent must sign in again');
    }

    const { ok, status, body } = await postForm(TOKEN_ENDPOINT, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    if (!ok) {
      if (body.error === 'invalid_grant') {
        // Revoked or expired (e.g. OAuth app still in "Testing" => 7 day expiry).
        await store.clear();
        access = null;
        throw new NotConnectedError('Google access was revoked or expired; the parent must sign in again');
      }
      throw new Error(`Token refresh failed (HTTP ${status}${body.error ? `, ${body.error}` : ''})`);
    }

    access = { token: body.access_token, expiresAt: now() + (Number(body.expires_in) || 3600) * 1000 };
    return access.token;
  }

  async function getAccessToken({ forceRefresh = false } = {}) {
    if (!forceRefresh && access && access.expiresAt - EXPIRY_SKEW_MS > now()) {
      return access.token;
    }
    if (!inflight) {
      inflight = refresh().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  }

  async function getStatus() {
    const row = await store.load();
    return {
      configured: isConfigured(),
      connected: Boolean(row),
      channel_title: row ? row.channel_title : null,
      channel_id: row ? row.channel_id : null,
      connected_at: row ? row.connected_at : null,
      scope: row ? row.scope : null
    };
  }

  async function disconnect() {
    try {
      const row = await store.load();
      if (row && encryptionKey) {
        try {
          const token = decrypt(row.refresh_token_enc, encryptionKey);
          await postForm(REVOKE_ENDPOINT, { token });
        } catch (_) {
          // Revocation is best-effort; local deletion below is what matters.
        }
      }
    } finally {
      access = null;
      await store.clear();
    }
  }

  return { SCOPE, isConfigured, createAuthRequest, handleCallback, getAccessToken, getStatus, disconnect };
}

module.exports = { createGoogleAuth, SCOPE };
