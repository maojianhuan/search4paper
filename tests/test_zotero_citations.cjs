const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const core = require('../zotero-plugin/content/core.js');
const scope = { URL, Search4PaperCore: core };
for (const name of ['discovery', 'citations']) {
  vm.runInNewContext(readFileSync(require.resolve(`../zotero-plugin/content/${name}.js`), 'utf8'), scope);
}
const citations = scope.Search4PaperCitations;
const paper = { id: 'note1', title: 'Exact Graph Paper', year: 2026,
  authors: ['Ada Example', 'Jia Li'], doi: 'https://doi.org/10.1000/Example' };
const work = overrides => ({ id: 'https://openalex.org/W123', title: paper.title,
  publication_year: 2026, doi: 'https://doi.org/10.1000/example', cited_by_count: 7,
  authorships: paper.authors.map(display_name => ({ author: { display_name } })), ...overrides });
const now = () => '2026-11-27T05:00:00.000Z';
const lookup = (candidate, response) => citations.lookup(candidate, { now, request: async () => response });

test('exact DOI lookup preserves zero, provenance and the original paper', async () => {
  const before = JSON.stringify(paper), calls = [];
  const result = await citations.lookup(paper, { now, request: async (url, signal, type) => {
    calls.push(url); assert.equal(type, 'json');
    assert.equal(new URL(url).pathname, '/works/https://doi.org/10.1000%2Fexample');
    return work({ cited_by_count: 0 });
  } });
  assert.equal(calls.length, 1); assert.equal(result.status, 'matched'); assert.equal(result.count, 0);
  assert.equal(result.source, 'OpenAlex'); assert.equal(result.sourceURL, 'https://openalex.org/W123');
  assert.equal(result.retrievedAt, now()); assert.equal(result.matchMethod, 'doi');
  assert.equal(JSON.stringify(paper), before);
});

test('DOI and existing OpenAlex identity conflicts never contribute a count', async () => {
  for (const changed of [{ doi: '10.1000/other' }, { doi: null }]) {
    const result = await lookup(paper, work(changed));
    assert.equal(result.status, 'unmatched'); assert.equal(result.count, null);
  }
  const result = await lookup({ ...paper, openalexID: 'W456' }, work());
  assert.equal(result.status, 'unmatched'); assert.equal(result.count, null);
  assert.match(result.message, /ID/);
});

test('ID-only lookup validates the exact returned ID without inferring a DOI', async () => {
  const candidate = { ...paper, doi: '', openalexID: 'W123' };
  const result = await citations.lookup(candidate, { now, request: async url => {
    assert.equal(new URL(url).pathname, '/works/W123'); return work();
  } });
  assert.equal(result.matchMethod, 'openalex_id'); assert.equal(result.count, 7);
  assert.equal(candidate.doi, '');
  assert.equal((await lookup(candidate, work({ id: 'https://openalex.org/W456' }))).count, null);
});

test('missing counts stay unknown and malformed counts fail explicitly', async () => {
  for (const count of [undefined, null]) {
    const result = await lookup(paper, work({ cited_by_count: count }));
    assert.equal(result.status, 'matched'); assert.equal(result.count, null); assert.match(result.message, /未提供/);
  }
  for (const count of [-1, 1.2, '0', true, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(lookup(paper, work({ cited_by_count: count })), /非负整数/);
  }
});

test('title lookup is bounded and requires title, authors, year and one matching candidate', async () => {
  const candidate = { ...paper, doi: '' };
  const response = { results: [work({ title: 'Unrelated paper' }), work()] };
  const result = await citations.lookup(candidate, { now, request: async url => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('per-page'), '10'); assert.equal(params.get('search'), candidate.title);
    return response;
  } });
  assert.equal(result.count, 7); assert.equal(result.matchMethod, 'title_authors_year');
  assert.match(result.message, /前 10 条/);
  for (const changed of [{ title: 'Other Paper' }, { publication_year: 2025 }, { authorships: [] }]) {
    assert.equal((await lookup(candidate, { results: [work(changed)] })).status, 'not_found');
  }
  const ambiguous = await lookup(candidate, { results: [work(), work({ id: 'https://openalex.org/W456' })] });
  assert.equal(ambiguous.status, 'unmatched'); assert.equal(ambiguous.count, null);
});

test('insufficient or invalid identity data cannot issue remote queries', async () => {
  for (const candidate of [{ doi: '' }, { ...paper, doi: '', year: '' }, { ...paper, doi: '', authors: [] },
    { ...paper, doi: 'not a doi' }, { ...paper, openalexID: '../arbitrary' },
    { ...paper, doi: '', openalexID: 'W123', extra: 'OpenAlex ID: W456' }]) {
    const result = await citations.lookup(candidate, { now, request: async () => { throw Error('Must not request'); } });
    assert.equal(result.status, 'unmatched'); assert.equal(result.count, null);
  }
});

test('404 is unknown; request errors are propagated once without fallback or retry', async () => {
  for (const status of [404, 429, 500]) {
    let calls = 0;
    const request = async () => { calls++; throw Object.assign(new Error('HTTP ' + status), { status }); };
    if (status === 404) {
      const result = await citations.lookup(paper, { now, request });
      assert.equal(result.status, 'not_found'); assert.equal(result.count, null);
    }
    else await assert.rejects(citations.lookup(paper, { now, request }), error => error.status === status);
    assert.equal(calls, 1);
  }
});

test('malformed responses do not become valid citation data', async () => {
  for (const payload of [null, {}, work({ title: '' }), work({ id: 'https://example.org/W123' })]) {
    await assert.rejects(lookup(paper, payload), /有效 ID 或标题/);
  }
  await assert.rejects(lookup({ ...paper, doi: '' }, {}), /候选格式/);
  await assert.rejects(lookup({ ...paper, doi: '' }, { results: [null] }), /有效 ID 或标题/);
});

test('cancellation before or during a request cannot publish a result', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(citations.lookup(paper, { signal: controller.signal,
    request: async () => { throw Error('Must not request'); } }), error => error.name === 'AbortError');
  const during = new AbortController();
  await assert.rejects(citations.lookup(paper, { signal: during.signal, request: async () => {
    during.abort(); return work();
  } }), error => error.name === 'AbortError');
});

test('citation notes preserve zero and unknown, timestamps and escaped source evidence', () => {
  const value={source:'OpenAlex',status:'matched',count:0,retrievedAt:now(),sourceURL:'https://openalex.org/W123',matchMethod:'doi',message:'<script>test</script>'};
  const note=core.citationNote(value);
  assert.match(note,/OpenAlex work citations: 0/); assert.ok(note.includes(now()));
  assert.match(note,/https:\/\/openalex.org\/W123/); assert.equal(note.includes('<script>'),false);
  assert.match(core.citationNote({...value,count:null}),/citations: unknown/);
  assert.match(core.citationNote({...value,status:'error',count:9}),/citations: unknown/);
  assert.equal(core.citationNote(null),'');
});
