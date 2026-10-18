// Persistence for the parent's Google connection. Single row (id = 1).
// The refresh token is stored encrypted; this module never returns it in plaintext.

function createTokenStore(db) {
  return {
    async load() {
      const { rows } = await db.query(
        'SELECT refresh_token_enc, scope, channel_id, channel_title, connected_at FROM google_auth WHERE id = 1'
      );
      return rows[0] || null;
    },

    async save({ refreshTokenEnc, scope, channelId, channelTitle }) {
      await db.query(
        `INSERT INTO google_auth (id, refresh_token_enc, scope, channel_id, channel_title, connected_at, updated_at)
         VALUES (1, $1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           refresh_token_enc = EXCLUDED.refresh_token_enc,
           scope = EXCLUDED.scope,
           channel_id = EXCLUDED.channel_id,
           channel_title = EXCLUDED.channel_title,
           connected_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP`,
        [refreshTokenEnc, scope || null, channelId || null, channelTitle || null]
      );
    },

    async clear() {
      await db.query('DELETE FROM google_auth WHERE id = 1');
    }
  };
}

module.exports = { createTokenStore };
