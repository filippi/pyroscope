/* Client-side query engine for 32-byte STFY event summary records. */
importScripts('https://unpkg.com/fzstd@0.1.1/umd/index.js');

const RECORD_BYTES = 32;
const datasets = new Map();

function h3Parent(value, resolution) {
  let parent = (value & ~(15n << 52n)) | (BigInt(resolution) << 52n);
  for (let digit = resolution + 1; digit <= 15; digit++) {
    parent |= 7n << BigInt((15 - digit) * 3);
  }
  return parent;
}

const h3Hex = value => value.toString(16).padStart(15, '0');
const tixHex = value => value.toString(16);

function tixEpoch(tix) {
  const level = Number(tix >> 42n);
  const stored = tix & ((1n << 42n) - 1n);
  const prefix = stored >> BigInt(42 - level);
  return Number((prefix << BigInt(40 - level)) - 549755813888n);
}

function eventId(kind, h7, first) {
  const h0 = h3Hex(h3Parent(h7, 0));
  const h3 = h3Hex(h3Parent(h7, 3));
  const h5 = h3Hex(h3Parent(h7, 5));
  const key = h3Hex(h7) + '_' + (first & 0xffffffffffffn).toString(16).padStart(12, '0') + '.stfy';
  return `${kind}:${h0}/${h3}/${h5}/${key}`;
}

async function loadDataset(kind, url) {
  const response = await fetch(url, {cache: 'no-store'});
  // Older deployments create the archive index only after the first retirement.
  const emptyArchive = kind === 'ARCHIVE' && response.status === 404;
  if (!response.ok && !emptyArchive) throw Error(`${url}: HTTP ${response.status}`);
  const transferred = emptyArchive ? new Uint8Array() : new Uint8Array(await response.arrayBuffer());
  const raw = !emptyArchive && url.endsWith('.zst') ? fzstd.decompress(transferred) : transferred;
  if (raw.byteLength % RECORD_BYTES) throw Error(`${url}: invalid record boundary`);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  let first = 0n, last = 0n;
  for (let offset = 0; offset < raw.byteLength; offset += RECORD_BYTES) {
    const a = view.getBigUint64(offset + 8, true);
    const b = view.getBigUint64(offset + 16, true);
    if (!first || a < first) first = a;
    if (b > last) last = b;
  }
  const value = {kind, raw, view, count: raw.byteLength / RECORD_BYTES, first, last, transferredBytes: transferred.byteLength};
  datasets.set(kind, value);
  return value;
}

function tixBucket(tix, target) {
  const level = Number(tix >> 42n);
  const stored = tix & ((1n << 42n) - 1n);
  const prefix = stored >> BigInt(42 - level);
  return prefix >> BigInt(level - target);
}

function buildIndex(dataset, progress) {
  const buckets = new Map(), totals = new Map(), view = dataset.view;
  for (let offset = 0, record = 0; offset < view.byteLength; offset += RECORD_BYTES, record++) {
    const h7 = view.getBigUint64(offset, true), h2 = h3Hex(h3Parent(h7, 2));
    const first = view.getBigUint64(offset + 8, true), last = view.getBigUint64(offset + 16, true);
    const hotspots = view.getUint32(offset + 24, true), frp = view.getFloat32(offset + 28, true);
    const firstBucket = tixBucket(first, 21), lastBucket = tixBucket(last, 21);
    const totalKey = h2 + ':' + firstBucket.toString(16);
    let total = totals.get(totalKey);
    if (!total) totals.set(totalKey, total = {h2, t21: firstBucket, events: 0, hotspots: 0, frp: 0});
    total.events++;
    total.hotspots += hotspots;
    total.frp += frp;
    for (let bucket = firstBucket; bucket <= lastBucket; bucket++) {
      const key = bucket.toString(16);
      let spatial = buckets.get(key);
      if (!spatial) buckets.set(key, spatial = new Map());
      let offsets = spatial.get(h2);
      if (!offsets) spatial.set(h2, offsets = []);
      offsets.push(record);
    }
    if (!(record & 8191)) progress(record / dataset.count);
  }
  for (const spatial of buckets.values()) {
    for (const [h2, offsets] of spatial) spatial.set(h2, Uint32Array.from(offsets));
  }
  dataset.buckets = buckets;
  dataset.totals = totals;
  progress(1);
}

function visit(dataset, callback) {
  const view = dataset.view;
  for (let offset = 0; offset < view.byteLength; offset += RECORD_BYTES) {
    callback({
      kind: dataset.kind,
      h7: view.getBigUint64(offset, true),
      first: view.getBigUint64(offset + 8, true),
      last: view.getBigUint64(offset + 16, true),
      hotspots: view.getUint32(offset + 24, true),
      frp: view.getFloat32(offset + 28, true),
    });
  }
}

function readEvent(dataset, record) {
  const offset = record * RECORD_BYTES, view = dataset.view;
  return {
    kind: dataset.kind,
    h7: view.getBigUint64(offset, true),
    first: view.getBigUint64(offset + 8, true),
    last: view.getBigUint64(offset + 16, true),
    hotspots: view.getUint32(offset + 24, true),
    frp: view.getFloat32(offset + 28, true),
  };
}

function cells(value) {
  return String(value || '').split(',').map(x => x.trim().toLowerCase()).filter(x => /^[0-9a-f]{15}$/.test(x));
}

function parentMatches(h7, cell) {
  const value = BigInt('0x' + cell);
  const resolution = Number((value >> 52n) & 15n);
  return h3Parent(h7, resolution) === value;
}

function context(query) {
  const from = query.from ? BigInt('0x' + query.from) : 0n;
  const to = query.to ? BigInt('0x' + query.to) : (1n << 63n) - 1n;
  const only = cells(query.only), exclude = cells(query.exclude), scope = new Set(cells(query.scope));
  const archiveFrom = query.archive_from ? Date.parse(query.archive_from + 'T00:00:00Z') / 1000 : -Infinity;
  const archiveTo = query.archive_to ? Date.parse(query.archive_to + 'T23:59:59Z') / 1000 : Infinity;
  const minimum = Math.max(0, Number(query.archive_min_spots || 0));
  return {from, to, only, exclude, scope, scopeLevel: Number(query.scope_level), archiveFrom, archiveTo, minimum, lastOnly: query.last_only === '1'};
}

function matches(event, ctx) {
  if (ctx.lastOnly ? (event.last < ctx.from || event.last > ctx.to) : (event.last < ctx.from || event.first > ctx.to)) return false;
  if (ctx.exclude.some(cell => parentMatches(event.h7, cell))) return false;
  if (ctx.only.length && !ctx.only.some(cell => parentMatches(event.h7, cell))) return false;
  if (ctx.scope.size && !ctx.scope.has(h3Hex(h3Parent(event.h7, ctx.scopeLevel)))) return false;
  if (event.kind === 'ARCHIVE') {
    if (event.hotspots < ctx.minimum) return false;
    if (tixEpoch(event.last) < ctx.archiveFrom || tixEpoch(event.first) > ctx.archiveTo) return false;
  }
  return true;
}

function selectedDatasets(includeArchive) {
  const selected = [];
  if (datasets.has('LIVE')) selected.push(datasets.get('LIVE'));
  if (includeArchive && datasets.has('ARCHIVE')) selected.push(datasets.get('ARCHIVE'));
  return selected;
}

function candidateRecords(dataset, ctx) {
  if (!ctx.from || ctx.to === (1n << 63n) - 1n) return null;
  const firstBucket = tixBucket(ctx.from, 21), lastBucket = tixBucket(ctx.to, 21), selectedH2 = new Set();
  if (ctx.scope.size) {
    for (const cell of ctx.scope) {
      const value = BigInt('0x' + cell), resolution = Number((value >> 52n) & 15n);
      if (resolution === 2) selectedH2.add(cell);
    }
  }
  const found = new Set();
  for (let bucket = firstBucket; bucket <= lastBucket; bucket++) {
    const spatial = dataset.buckets.get(bucket.toString(16));
    if (!spatial) continue;
    const entries = selectedH2.size ? [...selectedH2].map(h2 => [h2, spatial.get(h2)]) : spatial.entries();
    for (const [, offsets] of entries) if (offsets) for (const record of offsets) found.add(record);
  }
  return found;
}

function visitQuery(dataset, ctx, callback) {
  const candidates = candidateRecords(dataset, ctx);
  if (candidates === null) return visit(dataset, callback);
  for (const record of candidates) callback(readEvent(dataset, record));
}

function compactEvent(event) {
  return {
    id: eventId(event.kind, event.h7, event.first), kind: event.kind, industrial: false,
    h7: h3Hex(event.h7), first: tixHex(event.first), last: tixHex(event.last),
    hotspots: event.hotspots, frp: event.frp,
  };
}

function summary(query) {
  const ctx = context(query), level = Number(query.level), groups = new Map();
  let total = 0;
  for (const dataset of selectedDatasets(query.archive === '1')) visitQuery(dataset, ctx, event => {
    if (!matches(event, ctx)) return;
    const h3 = h3Hex(h3Parent(event.h7, level));
    let group = groups.get(h3);
    if (!group) groups.set(h3, group = {h3, events: 0, live: 0, archive: 0, hotspots: 0, first: event.first, last: event.last});
    group.events++;
    group[event.kind.toLowerCase()]++;
    group.hotspots += event.hotspots;
    if (event.first < group.first) group.first = event.first;
    if (event.last > group.last) group.last = event.last;
    total++;
  });
  const live = datasets.get('LIVE'), archive = datasets.get('ARCHIVE');
  return {
    database: 'ARCH', level, total_events: total,
    items: [...groups.values()].map(group => ({...group, first: tixHex(group.first), last: tixHex(group.last)})),
    live_min: tixHex(live?.first || 0n), live_max: tixHex(live?.last || 0n),
    archive_min: tixHex(archive?.first || 0n), archive_max: tixHex(archive?.last || 0n),
    archive_min_date: archive?.first ? new Date(tixEpoch(archive.first) * 1000).toISOString().slice(0, 10) : '',
    archive_max_date: archive?.last ? new Date(tixEpoch(archive.last) * 1000).toISOString().slice(0, 10) : '',
  };
}

function eventList(query) {
  const ctx = context(query), found = [], h5 = query.h5 || '';
  for (const dataset of selectedDatasets(query.archive === '1')) visitQuery(dataset, ctx, event => {
    if (h5 && h3Hex(h3Parent(event.h7, 5)) !== h5) return;
    if (matches(event, ctx)) found.push(event);
  });
  if (query.api === 'top_events') {
    const sort = query.sort || 'latest';
    found.sort((a, b) => sort === 'frp' ? b.frp - a.frp || Number(b.last - a.last) :
      sort === 'count' ? b.hotspots - a.hotspots || Number(b.last - a.last) :
      Number(b.last - a.last) || b.hotspots - a.hotspots);
    found.length = Math.min(found.length, Math.max(1, Number(query.limit || 30)));
  } else {
    found.sort((a, b) => Number(a.first - b.first));
  }
  return {events: found.map(compactEvent)};
}

let archiveLoading=null;
function ensureArchiveDataset(url,id){
 if(!archiveLoading){
  self.postMessage({id,progress:{phase:'Loading archived events',fraction:0}});
  archiveLoading=loadDataset('ARCHIVE',url).then(archive=>{
   buildIndex(archive,fraction=>self.postMessage({id,progress:{phase:'Indexing archived events',fraction}}));
   return {records:archive.count,groups:archive.totals.size};
  }).catch(error=>{archiveLoading=null;datasets.delete('ARCHIVE');throw error});
 }
 return archiveLoading;
}

self.onmessage = async event => {
  const {id, action, query} = event.data;
  try {
    let result;
    if (action === 'init') {
      const live = await loadDataset('LIVE', query.live);
      const archive = query.archive ? await loadDataset('ARCHIVE', query.archive) : null;
      const totalCount = Math.max(1, live.count + (archive?.count || 0));
      buildIndex(live, fraction => self.postMessage({id, progress: {phase: 'Indexing live events', fraction: fraction * live.count / totalCount}}));
      if (archive) buildIndex(archive, fraction => self.postMessage({id, progress: {phase: 'Indexing archived events', fraction: (live.count + fraction * archive.count) / totalCount}}));
      result = {
        live: {records: live.count, bytes: live.raw.byteLength, transferred: live.transferredBytes, groups: live.totals.size, latest: tixHex(live.last)},
        archive: archive ? {records: archive.count, bytes: archive.raw.byteLength, transferred: archive.transferredBytes, groups: archive.totals.size} : {records: 0, bytes: 0, transferred: 0, groups: 0},
      };
    } else if (action === 'archive') result = await ensureArchiveDataset(query.archive,id);
    else if (action === 'summary') result = summary(query);
    else if (action === 'events') result = eventList(query);
    else throw Error('Unknown compact-index action');
    self.postMessage({id, result});
  } catch (error) {
    self.postMessage({id, error: error.message || String(error)});
  }
};
