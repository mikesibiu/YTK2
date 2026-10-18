require('dotenv').config();
const db = require('./db');
const { createApp } = require('./app');
const { parseKey } = require('./lib/tokenCrypto');
const { createRulesLoader } = require('./lib/filterRules');
const { createTokenStore } = require('./lib/tokenStore');
const { createGoogleAuth } = require('./lib/googleAuth');
const { createYouTubeClient, createQuotaGuard } = require('./lib/youtubeClient');
const { createContentService } = require('./lib/contentService');
const { createTtlCache } = require('./lib/ttlCache');
const { createFlagStore } = require('./lib/flagStore');
const { createCommunityStore } = require('./lib/communityStore');
const { createAccessGate } = require('./lib/accessGate');

const PORT = process.env.PORT || 8080;
const isProduction = process.env.NODE_ENV === 'production';

const intEnv = (name, fallback) => {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

if (isProduction) {
  const required = [
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'TOKEN_ENCRYPTION_KEY',
    'CHILD_ACCESS_CODE'
  ];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`);
  }
  const weakPasswords = ['change_me_now', 'changeme', 'password', 'admin'];
  if (process.env.ADMIN_PASSWORD.length < 12 || weakPasswords.includes(process.env.ADMIN_PASSWORD.toLowerCase())) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters and not a default value in production');
  }
}

let encryptionKey;
if (process.env.TOKEN_ENCRYPTION_KEY) {
  encryptionKey = parseKey(process.env.TOKEN_ENCRYPTION_KEY); // throws on a malformed key
} else {
  console.warn('TOKEN_ENCRYPTION_KEY is not set: Google sign-in is disabled.');
}

const rules = createRulesLoader({ db });
const google = createGoogleAuth({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI,
  store: createTokenStore(db),
  encryptionKey
});
const youtube = createYouTubeClient({
  getAccessToken: opts => google.getAccessToken(opts),
  quota: createQuotaGuard({ budget: intEnv('YOUTUBE_DAILY_QUOTA_BUDGET', 9000) }),
  regionCode: process.env.YOUTUBE_REGION_CODE || ''
});
const communityStore = createCommunityStore(db);
const content = createContentService({
  youtube,
  getRules: rules.getRules,
  cache: createTtlCache({ maxEntries: 500 }),
  flags: createFlagStore(db),
  community: { match: ids => communityStore.resolveAndMatch(youtube.rawGet, ids) },
  options: {
    searchTtlMs: intEnv('SEARCH_CACHE_TTL_SECONDS', 600) * 1000,
    feedTtlMs: intEnv('FEED_CACHE_TTL_SECONDS', 900) * 1000,
    maxChannels: intEnv('SUBSCRIPTION_MAX_CHANNELS', 50),
    perChannel: intEnv('SUBSCRIPTION_VIDEOS_PER_CHANNEL', 5),
    resultLimit: intEnv('RESULT_LIMIT', 24)
  }
});

// Access code for the child UI (default 6969). Set CHILD_ACCESS_CODE to change it.
const access = createAccessGate({
  code: process.env.CHILD_ACCESS_CODE || (isProduction ? '' : '6969'),
  secret: process.env.SESSION_SECRET || process.env.TOKEN_ENCRYPTION_KEY
});

const trustProxyEnv = process.env.TRUST_PROXY;
let trustProxy = isProduction ? 1 : false;
if (trustProxyEnv !== undefined) {
  trustProxy = /^\d+$/.test(trustProxyEnv) ? Number(trustProxyEnv) : trustProxyEnv === 'true';
}

const app = createApp({
  db,
  content,
  google,
  rules,
  access,
  community: communityStore,
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
  isProduction,
  trustProxy,
  limits: {
    publicMax: intEnv('RATE_LIMIT_PER_MIN', 120),
    searchMax: intEnv('SEARCH_RATE_LIMIT_PER_MIN', 20),
    adminMax: intEnv('ADMIN_RATE_LIMIT_PER_MIN', 120)
  }
});

const server = app.listen(PORT, () => {
  console.log(`YT2 filter service listening on port ${PORT}`);
  console.log('Kid UI: /   Admin UI: /admin/');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => process.exit(0));
});
