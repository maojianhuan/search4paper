const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const core = require('../zotero-plugin/content/core.js');
const scope = { URL, URLSearchParams, Search4PaperCore: core };
for (const file of ['discovery', 'cross-search', 'import']) {
  vm.runInNewContext(readFileSync(require.resolve(`../zotero-plugin/content/${file}.js`), 'utf8'), scope);
}
const search = scope.Search4PaperCrossSearch;
const query = { terms: ['time series', 'anomaly detection'], fields: ['title', 'abstract'], operator: 'AND' };
const targets = [{ conference: 'ICLR', year: 2026 }];
const signal = () => new AbortController().signal;
const note = (id, changes = {}) => ({ id, content: { venueid: { value: core.venueID('ICLR', 2026) },
  title: { value: 'Time Series Models' }, authors: { value: ['Ada Example'] },
  abstract: { value: 'We study anomaly detection.' }, ...changes } });
const work = (id = 'W1', changes = {}) => ({ id: `https://openalex.org/${id}`, title: 'Time Series Models',
  doi: 'https://doi.org/10.1000/example', publication_year: 2026, publication_date: '2026-01-01', type: 'article',
  authorships: [{ author: { display_name: 'Ada Example' } }], abstract_inverted_index: { anomaly: [0], detection: [1] },
  primary_location: { source: { display_name: 'Journal Example', type: 'journal', issn: ['1533-7928'] }, landing_page_url: 'https://example.org/paper' },
  locations: [], ...changes });
const oaPaper = (id = 'W1', changes = {}) => search.normalizeWork(work(id, changes), { years: [2026] });
const record = (paper, name = 'fixture', priority = 0) => search.provenance(paper, { source: name,
  url: 'https://example.org/search?q=%3Cscript%3E', fetchedAt: '2026-11-13T00:00:00Z' }, priority);
const sessionWith = records => ({ ...search.plan(query, targets, 'off'), records });

test('query plan contains only bounded keyword jobs, exact venue/year scopes and explicit OpenAlex range', () => {
  const plan = search.plan(query, [...targets, { conference: 'ICML', year: 2025 }, ...targets], 'all');
  assert.equal(plan.targets.length, 2); assert.equal(plan.jobs.length, 10);
  const first = new URL(search.url(plan.jobs[0]));
  assert.equal(first.pathname, '/notes/search'); assert.equal(first.searchParams.get('term'), 'time series');
  assert.equal(first.searchParams.get('venueid'), 'ICLR.cc/2026/Conference');
  assert.equal(first.searchParams.get('limit'), '50'); assert.equal(first.searchParams.get('source'), 'forum');
  const oa = new URL(search.url(plan.jobs.at(-1)));
  assert.equal(oa.searchParams.get('filter'), 'publication_year:2025|2026');
  assert.equal(oa.searchParams.get('per_page'), '50');
  assert.equal(oa.searchParams.get('search.title_abstract_keywords'), 'anomaly detection');
  assert.throws(() => search.plan(query, targets, 'journals'), /期刊/);
  const journal = search.plan(query, [{ conference: 'JMLR', year: 2025 }], 'journals');
  assert.equal(journal.jobs.length, 2);
  assert.match(new URL(search.url(journal.jobs[0])).searchParams.get('filter'), /1533-7928/);
  assert.throws(() => search.plan({ ...query, terms: [] }, targets), /关键词/);
});

test('local retrieval reads only selected caches, reports absence, and fails on corrupt data without network or writes', async () => {
  const paper = core.normalizeNote(note('n1'), 2026, 'ICLR');
  const metadata = { schemaVersion: 1, venueID: paper.venueID, year: 2026, fetchedAt: '2026-01-01T00:00:00Z', paperCount: 1, papers: [paper] };
  const plan = search.plan(query, [...targets, { conference: 'ICML', year: 2026 }], 'off');
  const before = JSON.stringify(metadata), seen = [];
  const session = await search.readLocal(plan, { signal: signal(), readMetadata: async t => {
    seen.push(t.conference); return t.conference === 'ICLR' ? metadata : null;
  } });
  assert.equal(seen.join(','), 'ICLR,ICML'); assert.equal(session.records.length, 1);
  assert.equal(session.local[1].available, false); assert.equal(JSON.stringify(metadata), before);
  await assert.rejects(search.readLocal(plan, { readMetadata: async () => ({ ...metadata, paperCount: 3 }) }), /数量|完整/);
});

test('one explicit load reads at most one 50-record page per query and preserves the previous session', async () => {
  const plan = search.plan({ ...query, terms: ['time series'], fields: ['title'] }, targets, 'off');
  const calls = [];
  const request = async url => {
    const p = new URL(url).searchParams; calls.push(Number(p.get('offset')));
    return { count: 51, notes: p.get('offset') === '0' ? Array.from({ length: 50 }, (_, i) => note(`n${i}`)) : [note('last')] };
  };
  const first = await search.next(plan, { request, signal: signal() });
  assert.equal(first.records.length, 50); assert.equal(plan.records.length, 0); assert.equal(plan.jobs[0].offset, 0);
  assert.equal(search.hasMore(first), true); assert.equal(calls.length, 1);
  const last = await search.next(first, { request, signal: signal() });
  assert.equal(last.records.length, 51); assert.equal(search.hasMore(last), false);
  assert.deepEqual(calls, [0, 50]); assert.equal(first.jobs[0].offset, 50);
});

test('OpenAlex page numbers, year and ISSN are validated, without inventing abstract or TLDR', async () => {
  const plan = search.plan({ ...query, terms: ['time series'] }, [{ conference: 'JMLR', year: 2026 }], 'journals');
  const result = await search.next(plan, { request: async url => {
    assert.equal(new URL(url).searchParams.get('page'), '1');
    return { meta: { count: 1 }, results: [work()] };
  } });
  assert.equal(result.records[0].itemType, 'journalArticle');
  assert.equal(result.records[0].tldr, '');
  assert.equal(oaPaper('W2', { abstract_inverted_index: null }).abstract, '');
  assert.throws(() => search.normalizeWork(work('W1', { publication_year: 2025 }), { years: [2026] }), /年份/);
  assert.throws(() => search.normalizeWork(work(), { years: [2026], issn: '1041-4347' }), /ISSN/);
});

test('malformed, early, duplicate and changed pagination stops explicitly', async () => {
  const plan = search.plan({ ...query, terms: ['time series'], fields: ['title'] }, targets, 'off');
  for (const payload of [{ count: 2, notes: [] }, { count: '1', notes: [note('n1')] },
    { count: 60, notes: [note('n1')] }, { count: 2, notes: [note('n1'), note('n1')] },
    { count: 1, notes: [note('n1', { venueid: { value: 'ICLR.cc/2026/Conference/Rejected' } })] }]) {
    await assert.rejects(search.next(plan, { request: async () => payload }));
  }
  const first = await search.next(plan, { request: async () => ({ count: 51, notes: Array.from({ length: 50 }, (_, i) => note('n' + i)) }) });
  for (const payload of [{ count: 52, notes: [note('n50'), note('n51')] }, { count: 51, notes: [note('n0')] }]) {
    await assert.rejects(search.next(first, { request: async () => payload }), /变化|重复/);
  }
});

test('network errors and cancellation cannot advance any job or publish earlier jobs in the same batch', async () => {
  for (const cancel of [false, true]) {
    const plan = search.plan(query, targets, 'off'), before = JSON.stringify(plan), controller = new AbortController();
    let calls = 0;
    await assert.rejects(search.next(plan, { signal: controller.signal, request: async () => {
      if (++calls === 2) {
        if (cancel) controller.abort(); else throw Error('HTTP 429');
      }
      return { count: 1, notes: [note('n1')] };
    } }));
    assert.equal(calls, 2); assert.equal(JSON.stringify(plan), before);
  }
});

test('AND matches across fields of the same record, never across different versions of a record', () => {
  const p = core.normalizeNote(note('n1'), 2026, 'ICLR');
  assert.equal(search.results(sessionWith([record(p)])).length, 1);
  const split = [record({ ...p, abstract: '' }), record({ ...p, title: 'Different title' }, 'second')];
  assert.equal(search.results(sessionWith(split)).length, 0);
  const session = sessionWith([record(p)]); session.query.fields = ['title'];
  assert.equal(search.results(session).length, 0);
});

test('strong identities merge bridge records and retain all provenance and aliases while equal titles remain separate', () => {
  const official = core.normalizeNote(note('n1'), 2026, 'ICLR');
  const oa = oaPaper();
  const bridge = oaPaper('W1', { locations: [{ landing_page_url: 'https://openreview.net/forum?id=n1' }] });
  const separate = oaPaper('W2', { doi: 'https://doi.org/10.1000/another' });
  const session = sessionWith([record(official, 'official', 0), record(oa, 'OpenAlex', 2), record(bridge, 'bridge', 2), record(separate, 'separate', 2)]);
  const before = JSON.stringify(session), result = search.results(session);
  assert.equal(result.length, 2); assert.equal(result[0].id, 'n1');
  assert.equal(result[0].searchProvenance.length, 3); assert.equal(result[0].openalexID, 'W1');
  assert.equal(result[0].doi, '10.1000/example'); assert.match(result[0].extra, /OpenReview ID: n1/);
  assert.match(result[0].extra, /OpenAlex ID: W1/); assert.match(result[0].duplicateHint, /未自动合并/);
  assert.equal(JSON.stringify(session), before);
  assert.throws(() => search.results(sessionWith([record(oa), record({ ...oa, doi: '10.1000/conflict' })])), /不同 DOI/);
});

test('coverage distinguishes unread candidates, unavailable local lists, zero search hits and paging caps', () => {
  const session = search.plan(query, targets, 'all');
  session.local = [{ ...targets[0], available: false }];
  session.jobs[0].done = true; session.jobs[0].total = 0;
  assert.match(search.coverage(session, 0), /部分结果/);
  assert.match(search.coverage(session, 0), /未下载整届/);
  assert.match(search.coverage(session, 0), /不受上方 CCF/);
  assert.match(search.coverage(session, 0), /尚未公开/);
  session.jobs.forEach(job => { job.capped = true; job.offset = 10000; });
  assert.equal(search.hasMore(session), false); assert.match(search.coverage(session, 0), /结果不完整/);
});

test('merging later cross-source pages retains the queried citation snapshot without modifying records', () => {
  const official = record(core.normalizeNote(note('n1'), 2026, 'ICLR'), 'official', 0);
  const linked = record(oaPaper('W1', { locations: [{ landing_page_url: 'https://openreview.net/forum?id=n1' }] }), 'OpenAlex', 2);
  linked.citation = {source:'OpenAlex',status:'matched',count:0,retrievedAt:'2026-11-27T03:00:00Z'};
  const session = sessionWith([official, linked]), before = JSON.stringify(session);
  const result = search.results(session);
  assert.equal(result.length,1); assert.equal(result[0].citation.count,0);
  assert.equal(result[0].citation.retrievedAt,linked.citation.retrievedAt);
  assert.equal(JSON.stringify(session),before); assert.equal(official.citation,undefined);
});

test('cross-source provenance is escaped and keeps retrieval conditions and timestamps', () => {
  const p = record(oaPaper(), '<script>source</script>', 2);
  const html = core.evidenceNote(p, query);
  assert.match(html, /Imported by search4paper cross-source/);
  assert.match(html, /&lt;script&gt;/); assert.equal(html.includes('<script>'), false);
  assert.match(html, /2026-11-13/); assert.match(html, /Match: AND/);
  assert.equal(html.includes('undefined'), false);
});

test('UI cross search reads official caches without writes, and the original full-list search still reuses them', async () => {
  const paper = core.normalizeNote(note('cached'), 2026, 'ICLR');
  const metadata = { schemaVersion: 1, venueID: paper.venueID, year: 2026, fetchedAt: '2026-01-01T00:00:00Z', paperCount: 1, papers: [paper] };
  const before = JSON.stringify(metadata), elements = new Map(), reads = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', classList: { add() {}, remove() {}, toggle() {} } });
    return elements.get(id);
  };
  const context = { ...scope, AbortController,
    window: { arguments: [{ Zotero: { DataDirectory: { dir: '/isolated' } } }], addEventListener() {}, setTimeout },
    document: { getElementById: element }, PathUtils: { join: (...parts) => parts.join('/') },
    IOUtils: { exists: async path => { reads.push(path); return true; }, readJSON: async () => metadata,
      writeJSON() { throw Error('Cache must not be written'); }, makeDirectory() { throw Error('No new cache directory'); } },
    Search4PaperSources: { fetchAccepted() { throw Error('Must not fetch a whole venue'); } } };
  vm.runInNewContext(readFileSync(require.resolve('../zotero-plugin/content/search.js'), 'utf8'), context);
  const ui = context.Search4PaperUI;
  ui.selectedConferences = () => ['ICLR']; ui.$('year').value = '2026'; ui.$('cross-openalex').value = 'off';
  ui.readQuery = () => query; ui.render = () => {}; ui.preview = () => {};
  let requests = 0;
  ui.request = async () => { requests++; return { count: 1, notes: [note('remote')] }; };
  await ui.crossSearch(signal());
  assert.equal(ui.candidates.length, 2); assert.equal(requests, 4); assert.equal(ui.searchMode, 'cross');
  assert.equal(ui.loadedTargets.length, 0); assert.equal(JSON.stringify(metadata), before);
  await ui.fetchPapers(signal());
  assert.equal(ui.searchMode, 'official'); assert.equal(ui.crossSession, null); assert.equal(ui.candidates.length, 1);
  assert.equal(ui.candidates[0].id, 'cached'); assert.equal(ui.candidates[0].searchProvenance, undefined);
  assert.equal(requests, 4); assert.equal(JSON.stringify(metadata), before);
  assert.ok(reads.every(path => path === '/isolated/search4paper/ICLR/2026.json'));
});

test('OpenAlex candidates use the existing import flow, correct item types and aliases without PDFs or overwrites', async () => {
  const items = []; let next = 1;
  class Item {
    constructor(type) { this.type = type; this.fields = {}; this.collections = []; this.tags = []; }
    getField(key) { return this.fields[key] || ''; } setField(key, value) { this.fields[key] = value; }
    setCreators(value) { this.creators = value; } addToCollection(id) { this.collections.push(id); }
    addTag(tag) { this.tags.push(tag); } setNote(note) { this.note = note; } getNote() { return this.note; }
    getNotes() { return items.filter(i => i.parentID === this.id).map(i => i.id); }
    isRegularItem() { return this.type !== 'note'; }
    async save() { if (!this.id) { this.id = next++; items.push(this); } return this.id; }
  }
  const zotero = { Item, Libraries: { userLibraryID: 1 }, Collections: { getByLibrary: () => [] },
    Items: { getAll: async () => items.filter(i => i.isRegularItem()), getAsync: async ids => items.filter(i => ids.includes(i.id)) },
    DB: { executeTransaction: action => action() } };
  const p = record(oaPaper('W1', { locations: [{ landing_page_url: 'https://openreview.net/forum?id=n1' }] }));
  const first = await scope.Search4PaperImport.papers(zotero, [p], { query });
  assert.equal(first.results[0].status, 'created');
  const item = first.results[0].item;
  assert.equal(item.type, 'journalArticle'); assert.equal(item.getField('publicationTitle'), 'Journal Example');
  assert.equal(item.getField('ISSN'), '1533-7928'); assert.match(item.getField('extra'), /OpenAlex ID: W1/);
  assert.match(item.getField('extra'), /OpenReview ID: n1/);
  item.setField('abstractNote', 'User-edited abstract');
  const second = await scope.Search4PaperImport.papers(zotero, [p], { query });
  assert.equal(second.results[0].status, 'existing'); assert.equal(item.getField('abstractNote'), 'User-edited abstract');
  assert.equal(items.length, 2);
  for (const [type, sourceType, expected] of [['preprint', 'repository', 'preprint'], ['article', 'conference', 'conferencePaper'], ['report', 'repository', 'document']]) {
    const paper = record(oaPaper('W' + next, { doi: null, type,
      primary_location: { source: { type: sourceType }, landing_page_url: 'https://example.org/' + next } }));
    const outcome = await scope.Search4PaperImport.papers(zotero, [paper], { query });
    assert.equal(outcome.results[0].item.type, expected);
  }
});
