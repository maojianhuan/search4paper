/* Actual XHTML/controller smoke test. Remote retrieval and imports are mocked by default.
 * Pass expectedDataDir only in a fresh isolated Zotero profile to also test real item import.
 */
async function runSearch4PaperCrossSearchSmoke(win, { expectedDataDir = null } = {}) {
  const ui = win.Search4PaperUI, service = win.Search4PaperCrossSearch, core = win.Search4PaperCore;
  let checks = 0;
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  const original = { request: ui.request, local: service.readLocal, importer: win.Search4PaperImport.papers };
  const change = (id, value) => {
    const input = ui.$(id);
    if (typeof value === 'boolean') input.checked = value; else input.value = value;
    input.dispatchEvent(new win.Event(id === 'cross-openalex' ? 'change' : 'input', { bubbles: true }));
  };
  const click = async id => {
    ui.$(id).click();
    const start = Date.now();
    while (ui.busy) {
      if (Date.now() - start > 10000) throw new Error('UI action timed out: ' + id);
      await new Promise(resolve => win.setTimeout(resolve, 10));
    }
  };
  const note = (id, title = 'Time Series Models') => ({ id, content: {
    venueid: { value: 'ICLR.cc/2026/Conference' }, title: { value: title },
    authors: { value: ['Fixture Author'] }, abstract: { value: 'Anomaly detection in sensor data.' }
  } });
  const work = (id, doi, linked = false) => ({ id: 'https://openalex.org/' + id, doi, title: 'Time Series Models',
    publication_year: 2026, publication_date: '2026-01-01', type: 'article',
    authorships: [{ author: { display_name: 'Fixture Author' } }],
    abstract_inverted_index: { anomaly: [0], detection: [1] },
    primary_location: { source: { type: 'journal', display_name: 'Fixture Journal' }, landing_page_url: 'https://example.org/' + id },
    locations: linked ? [{ landing_page_url: 'https://openreview.net/forum?id=n0' }] : [] });
  const local = core.normalizeNote(note('local', 'Local Time Series Study'), 2026, 'ICLR');
  const metadata = { schemaVersion: 1, year: 2026, venueID: local.venueID, paperCount: 1,
    fetchedAt: '2026-01-01T00:00:00Z', papers: [local] };
  let calls = [], fail = false, cancel = false, imported;
  try {
    service.readLocal = (session, options) => original.local.call(service, session,
      { signal: options.signal, readMetadata: async () => metadata });
    ui.request = async (url, signal) => {
      calls.push(url);
      if (fail) throw Error('Injected cross-source failure');
      if (cancel) { ui.$('cancel').click(); signal.throwIfAborted(); }
      const params = new URL(url).searchParams;
      if (new URL(url).hostname === 'api2.openreview.net') {
        assert(params.get('content') !== 'venueid' && params.get('limit') === '50', 'Only bounded keyword queries, never whole-venue retrieval');
        return { count: 51, notes: params.get('offset') === '0'
          ? Array.from({ length: 50 }, (_, i) => note('n' + i, i === 0 ? 'Time Series Models' : 'Unrelated Graph Model'))
          : [note('last', 'Last Time Series Study')] };
      }
      return { meta: { count: 2 }, results: [work('W1', 'https://doi.org/10.1000/cross', true), work('W2', 'https://doi.org/10.1000/version')] };
    };
    win.Search4PaperImport.papers = async (_z, papers, options) => {
      imported = { papers, options };
      return { results: papers.map(paper => ({ paper, item: { id: 900 }, status: 'created' })), unprocessed: 0 };
    };
    ui.switchPage('search');
    for (const option of ui.$('conference').options) option.selected = option.value === 'ICLR';
    change('year', '2026'); change('terms', 'time series; anomaly detection'); change('operator', 'AND');
    for (const field of core.FIELDS) change('field-' + field, ['title', 'abstract'].includes(field));
    change('cross-openalex', 'all'); ui.$('cross-search-options').open = true;
    const other = { fulltext: ui.$('fulltext-status').textContent, materials: ui.$('materials-status').textContent,
      discovery: ui.discoveryPapers };
    await click('cross-search');
    assert(calls.length === 6, 'One bounded page for each of four OpenReview and two OpenAlex jobs');
    assert(ui.searchMode === 'cross' && ui.candidates.length === 3, ui.$('status').textContent);
    assert(ui.loadedTargets.length === 0, 'Partial candidates cannot be treated as an official cache');
    assert(ui.$('coverage').textContent.includes('部分结果') && ui.$('coverage').textContent.includes('50 / 51'), 'Coverage shows unread pages');
    assert(!ui.$('cross-more').disabled && ui.$('filter').disabled, 'Paging is explicit; changing remote queries requires a fresh search');
    const merged = ui.candidates.find(p => p.id === 'n0');
    assert(merged.openalexID === 'W1' && merged.searchProvenance.length === 6, 'Strong identity merge keeps all retrieval evidence');
    ui.preview(merged);
    assert(ui.$('evidence').children.length === 2 && ui.$('search-provenance').textContent.includes('OpenAlex'), 'Existing preview shows split-field matches and source provenance');
    assert(ui.$('search-provenance').textContent.includes('未自动合并'), 'Same-title separate versions remain visible');
    const row = [...ui.$('results').children].find(row => row.dataset.id === ui.paperKey(merged));
    row.querySelector('input').click();
    assert(!ui.$('import').disabled && ui.selected.size === 1, 'Existing import accepts cross-source selection');
    assert(ui.$('enrich-abstracts').disabled, 'Partial search cannot overwrite an official cache through enrichment');
    const session = ui.crossSession, before = JSON.stringify(session);
    fail = true; await click('cross-more');
    assert(ui.crossSession === session && JSON.stringify(session) === before && ui.candidates.length === 3, 'Failed next page preserves the successful result and offsets');
    assert(ui.$('coverage').textContent.includes('保留上次'), 'Failed paging does not imply an exhausted search');
    fail = false; cancel = true; await click('cross-more'); cancel = false;
    assert(ui.crossSession === session && ui.$('status').textContent.includes('取消'), 'Cancelled paging preserves the previous batch');
    await click('cross-more');
    assert(ui.candidates.length === 4 && ui.$('cross-more').disabled, 'Explicit next page loads remaining records and stops at the end');
    assert(ui.selected.size === 1, 'Identity-based selection survives new pages');
    await click('import');
    assert(imported.papers.length === 1 && imported.papers[0].id === 'n0' && imported.options.query.operator === 'AND', 'Import receives the merged paper and original query');
    assert(ui.$('fulltext-status').textContent === other.fulltext && ui.$('materials-status').textContent === other.materials
      && ui.discoveryPapers === other.discovery, 'Other workflow data and status stay unchanged');
    change('terms', 'different topic');
    assert(ui.filtersDirty && ui.$('import').disabled && ui.$('cross-more').disabled, 'Changed conditions cannot import stale results or continue the old query');
    fail = true; await click('cross-search');
    assert(ui.crossSession === null && ui.candidates.length === 0 && ui.$('results').children.length === 0, 'Failed new search clears old results');
    assert(ui.$('coverage').textContent.includes('未发布部分结果'), 'New search failure reports incomplete retrieval');
    fail = false; change('terms', 'time series; anomaly detection');
    await click('cross-search');
    assert(ui.candidates.length === 3 && !ui.filtersDirty, 'A fresh search recovers after failure');
    assert(!ui.$('fetch').disabled && !ui.$('refresh-papers').disabled, 'Original full-list retrieval remains available');
    ui.$('venue-type').value = '期刊'; ui.$('venue-type').dispatchEvent(new win.Event('change', { bubbles: true }));
    assert(ui.filtersDirty && ui.$('cross-more').disabled, 'Catalogue filters that change selected sources invalidate cross-source paging');
    ui.$('venue-type').value = ''; ui.$('venue-type').dispatchEvent(new win.Event('change', { bubbles: true }));
    for (const option of ui.$('conference').options) option.selected = option.value === 'ICLR';
    ui.$('conference').dispatchEvent(new win.Event('input', { bubbles: true }));
    await click('cross-search');
  }
  finally { ui.request = original.request; service.readLocal = original.local; win.Search4PaperImport.papers = original.importer; }

  if (expectedDataDir !== null) {
    const z = ui.Zotero;
    assert(z.DataDirectory.dir === expectedDataDir && /search4paper-cross-native-/.test(expectedDataDir), 'Real imports require the explicitly named isolated test profile');
    assert((await z.Items.getAll(z.Libraries.userLibraryID, true, false)).length === 0, 'Native import test requires an empty isolated library');
    const paper = service.provenance(service.normalizeWork(work('W9001', 'https://doi.org/10.1000/cross-native'), { years: [2026] }),
      { source: 'Native smoke fixture', url: 'https://example.org/fixture', fetchedAt: '2026-11-13T00:00:00Z' }, 2);
    let item;
    try {
      const first = await original.importer.call(win.Search4PaperImport, z, [paper], { query: ui.query });
      assert(first.results[0].status === 'created', first.results[0].error || 'Native item was not created');
      item = first.results[0].item;
      assert(item.itemType === 'journalArticle' && item.getField('publicationTitle') === 'Fixture Journal', 'Native OpenAlex import uses journal fields');
      assert(item.getAttachments().length === 0 && item.getNotes().length === 1, 'Import stores evidence without downloading PDFs');
      const notes = await z.Items.getAsync(item.getNotes());
      assert(notes[0].getNote().includes('Imported by search4paper cross-source'), 'Native provenance note is saved');
      item.setField('abstractNote', 'User-reviewed abstract'); await item.saveTx();
      const second = await original.importer.call(win.Search4PaperImport, z, [paper], { query: ui.query });
      assert(second.results[0].status === 'existing' && item.getField('abstractNote') === 'User-reviewed abstract', 'Repeated native import preserves edits');
    }
    finally { if (item) await z.Items.erase([item.id]); }
  }
  return { checks, ok: true };
}
