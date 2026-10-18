#!/usr/bin/env node
// Dry run: download public filter lists, parse them, and report what WOULD be offered for
// review. Never touches a database and never changes any rule.
//   node scripts/community-lists-dry-run.js [output.json]
const fs = require('fs');
const { SOURCES, parseDkberktas, parseAislist, parseWordList } = require('../lib/communityLists');

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

(async () => {
  const report = { generated_at: new Date().toISOString(), sources: {} };

  const dk = parseDkberktas(JSON.parse(await download(SOURCES.dkberktas.url)));
  const ais = parseAislist(await download(SOURCES.aislist.url));
  const words = parseWordList(await download(SOURCES.ldnoobw.url));

  const byCategory = {};
  for (const e of dk) byCategory[e.category] = (byCategory[e.category] || 0) + 1;

  report.sources.dkberktas = { ...SOURCES.dkberktas, entries: dk.length, byCategory, sample: dk.slice(0, 3) };
  report.sources.aislist = {
    ...SOURCES.aislist,
    entries: ais.length,
    note: 'Handles only: each must be resolved to a channel ID (channels.list part=snippet returns customUrl) before matching.',
    sample: ais.slice(0, 3)
  };
  report.sources.ldnoobw = { ...SOURCES.ldnoobw, entries: words.length, sample: words.slice(0, 5) };

  for (const [name, s] of Object.entries(report.sources)) {
    console.log(`${name.padEnd(10)} ${String(s.entries).padStart(6)} entries  ${s.license}`);
  }
  if (process.argv[2]) {
    fs.writeFileSync(process.argv[2], JSON.stringify({ ...report, entries: { dkberktas: dk, aislist: ais, ldnoobw: words } }, null, 1));
    console.log(`Full candidate list written to ${process.argv[2]}`);
  }
})().catch(err => {
  console.error('Dry run failed:', err.message);
  process.exit(1);
});
