/**
 * Review log for keyword matches on ALLOWED channels. Those videos are shown, but the
 * match is recorded here so the parent can review it. Recording is best-effort: a
 * database problem here must never stop (or change) what the child sees.
 */
function createFlagStore(db, { log = console } = {}) {
  async function record(flagged) {
    for (const { video, keywords } of flagged || []) {
      for (const keyword of keywords) {
        try {
          await db.query(
            `INSERT INTO review_flags (video_id, keyword, title, channel_id, channel_name)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (video_id, keyword)
             DO UPDATE SET last_seen = CURRENT_TIMESTAMP, hit_count = review_flags.hit_count + 1`,
            [video.videoId, keyword, String(video.title || '').slice(0, 500), video.channelId, video.channelTitle || null]
          );
        } catch (error) {
          log.error('Could not record review flag:', error.message);
        }
      }
    }
  }

  return { record };
}

module.exports = { createFlagStore };
