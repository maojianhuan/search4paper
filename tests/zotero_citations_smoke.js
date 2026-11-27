/* Installed-XPI acceptance with synthetic ICLR records and mocked remote responses.
 * File export and Zotero imports are real and require an empty, isolated library.
 */
async function runSearch4PaperCitationsSmoke(win, { expectedDataDir, exportPath }) {
  const ui = win.Search4PaperUI, core = win.Search4PaperCore, z = ui.Zotero;
  const cross = win.Search4PaperCrossSearch, chrome = win.ChromeUtils;
  let checks = 0, zeroCount = 0, cancel = false, importedItem;
  const assert = (value, message) => { if (!value) throw new Error(message); checks++; };
  assert(z.DataDirectory.dir === expectedDataDir && /search4paper-citations-native-/.test(expectedDataDir),
    'Citation acceptance requires the explicitly named isolated profile');
  assert((await z.Items.getAll(z.Libraries.userLibraryID, true, false)).length === 0, 'Use an empty isolated library');
  assert(typeof exportPath === 'string' && exportPath.endsWith('.json'), 'Supply the explicit JSON export destination');
  const original = { request: ui.request, readLocal: cross.readLocal, importModule: chrome.importESModule };
  const calls = [];
  const note = (id, title = 'Citation fixture ' + id) => ({ id, content: {
    venueid: { value: 'ICLR.cc/2026/Conference' }, title: { value: title },
    authors: { value: ['Ada Example', 'Jia Li'] }, abstract: { value: 'Citation fixture abstract.' },
    doi: { value: '10.1000/citation-' + id }
  } });
  const work = id => ({ id: 'https://openalex.org/W' + (id === 'zero' ? '1' : '2'),
    title: 'Citation fixture ' + id, doi: 'https://doi.org/10.1000/citation-' + id,
    publication_year: 2026, cited_by_count: id === 'zero' ? zeroCount : id === 'missing' ? null : 9,
    authorships: [{ author: { display_name: 'Ada Example' } }, { author: { display_name: 'Jia Li' } }] });
  const change = (id, value) => {
    const input = ui.$(id);
    if (typeof value === 'boolean') input.checked = value; else input.value = value;
    input.dispatchEvent(new win.Event(['result-sort', 'cross-openalex'].includes(id) ? 'change' : 'input', { bubbles: true }));
  };
  const click = async id => {
    assert(!ui.$(id).disabled, `${id} must be enabled`);
    ui.$(id).click();
    const started = Date.now();
    while (ui.busy) {
      if (Date.now() - started > 15000) throw new Error('Timed out: ' + id);
      await new Promise(resolve => win.setTimeout(resolve, 15));
    }
  };
  const paper = id => ui.candidates.find(candidate => candidate.id === id);
  const row = id => [...ui.$('results').children].find(r => r.dataset.id === ui.paperKey(paper(id)));
  const choose = ids => {
    ui.selected.clear(); ui.render();
    for (const id of ids) row(id).querySelector('input').click();
  };
  try {
    ui.switchPage('search');
    for (const option of ui.$('conference').options) option.selected = option.value === 'ICLR';
    change('year', '2026'); change('terms', 'citation fixture'); change('operator', 'OR');
    for (const field of core.FIELDS) change('field-' + field, field === 'title');
    change('result-sort', 'source');
    ui.searchMode = 'official'; ui.crossSession = null;
    ui.papers = ['zero', 'high', 'absent', 'mismatch', 'missing', 'failure', 'after', 'unselected']
      .map(id => core.normalizeNote(note(id), 2026, 'ICLR'));
    ui.loadedTargets = [{ conference: 'ICLR', year: 2026 }]; ui.controls();
    await click('filter');
    ui.request = async (url, signal) => {
      if (new URL(url).hostname === 'api2.openreview.net') {
        const offset = new URL(url).searchParams.get('offset');
        return { count: 51, notes: offset === '0' ? [note('zero'), ...Array.from({ length: 49 },
          (_, i) => note('other' + i, 'Unrelated bibliography'))] : [note('next')] };
      }
      const id = decodeURIComponent(new URL(url).pathname).match(/citation-([^/]+)$/)?.[1];
      assert(Boolean(id), 'Citation queries identify an explicit fixture DOI'); calls.push(id);
      if (cancel) { ui.$('cancel').click(); signal.throwIfAborted(); }
      if (id === 'absent' || id === 'failure') throw Object.assign(new Error('Fixture HTTP ' + (id === 'absent' ? 404 : 503)),
        { status: id === 'absent' ? 404 : 503 });
      return id === 'mismatch' ? { ...work(id), doi: 'https://doi.org/10.1000/another' } : work(id);
    };
    choose(['zero', 'high', 'absent', 'mismatch', 'missing']);
    await click('enrich-citations');
    assert(calls.join(',') === 'zero,high,absent,mismatch,missing', 'Only selected papers are queried once');
    assert(paper('zero').citation.count === 0 && row('zero').querySelector('.citation-count').textContent === '0', 'True zero is displayed as zero');
    assert(paper('missing').citation.count === null && row('missing').querySelector('.citation-count').textContent === '未提供', 'Missing count is unknown');
    assert(paper('absent').citation.status === 'not_found' && paper('mismatch').citation.status === 'unmatched', 'Missing and mismatched DOI stay distinct');
    assert(!paper('unselected').citation && row('unselected').querySelector('.citation-count').textContent === '未查询', 'Unselected paper remains unqueried');
    ui.preview(paper('zero'));
    assert(ui.$('citation-info').textContent.includes(paper('zero').citation.retrievedAt)
      && ui.$('citation-info').textContent.includes('https://openalex.org/W1') && !ui.$('citation-source').disabled,
    'Preview exposes source and retrieval time');
    const selection = [...ui.selected].sort().join('|');
    change('result-sort', 'cited-desc');
    assert(ui.orderedCandidates().slice(0, 2).map(p => p.id).join(',') === 'high,zero', 'Descending counts put unknowns last');
    change('result-sort', 'cited-asc');
    assert(ui.orderedCandidates().slice(0, 2).map(p => p.id).join(',') === 'zero,high', 'Ascending counts put unknowns last');
    assert([...ui.selected].sort().join('|') === selection, 'Sorting preserves paper selection');
    const expected = ui.selectedExport();
    // Zotero freezes FilePicker.prototype; replace only this module import during the save click.
    chrome.importESModule = function (url, ...args) {
      if (url !== 'chrome://zotero/content/modules/filePicker.mjs') return original.importModule.call(this, url, ...args);
      return { FilePicker: class {
        constructor() { this.modeSave = 1; this.returnOK = 0; this.returnReplace = 2; this.file = exportPath; }
        init() {} appendFilter() {} async show() { return this.returnOK; }
      } };
    };
    await click('export-selected');
    chrome.importESModule = original.importModule;
    const exported = await IOUtils.readJSON(exportPath);
    assert(JSON.stringify(exported.papers) === JSON.stringify(expected.papers), 'Saved JSON matches displayed citation data and selected order');
    assert(exported.papers.length === 5 && exported.papers[0].citation.count === 0, 'Export preserves selection and zero');
    await click('filter');
    assert(paper('zero').citation.count === 0 && paper('high').citation.count === 9, 'Refiltering preserves session citation data');
    change('result-sort', 'source'); choose(['failure', 'after']);
    const beforeFailure = calls.length; await click('enrich-citations');
    assert(calls.length === beforeFailure + 1 && paper('failure').citation.status === 'error'
      && paper('failure').citation.count === null && !paper('after').citation, 'Request failure stops the batch without inventing later counts');
    assert(ui.$('status').textContent.includes('未处理 1'), 'Stopped batch reports unprocessed papers');
    choose(['after', 'unselected']); cancel = true; await click('enrich-citations'); cancel = false;
    assert(!paper('after').citation && !paper('unselected').citation && ui.$('status').textContent.includes('取消'), 'Cancellation leaves unprocessed papers unknown');

    choose(['zero']); await click('import');
    assert(ui.lastImport.results[0]?.status === 'created', ui.lastImport.results[0]?.error || 'Native import succeeded');
    importedItem = ui.lastImport.results[0].item;
    let notes = await z.Items.getAsync(importedItem.getNotes());
    assert(notes.length === 1 && notes[0].getNote().includes('OpenAlex work citations: 0')
      && notes[0].getNote().includes('https://openalex.org/W1'), 'Native import stores citation count and source');
    importedItem.setField('abstractNote', 'P1 user abstract'); await importedItem.saveTx();
    notes[0].setNote(notes[0].getNote() + '<p>P1 user annotation</p>'); await notes[0].saveTx();
    zeroCount = 4; await click('enrich-citations'); await click('import');
    notes = await z.Items.getAsync(importedItem.getNotes());
    assert(ui.lastImport.results[0].status === 'existing' && importedItem.getField('abstractNote') === 'P1 user abstract', 'Reimport preserves edited item fields');
    const refreshedNote = notes[0].getNote();
    assert(notes.length === 1 && refreshedNote.includes('P1 user annotation')
      && refreshedNote.includes('OpenAlex work citations: 0') && refreshedNote.includes('OpenAlex work citations: 4'), 'New citation evidence is appended without replacing notes');
    await click('import');
    assert((await z.Items.getAsync(importedItem.getNotes()))[0].getNote() === refreshedNote, 'Repeated same citation snapshot does not duplicate evidence');

    cross.readLocal = (session, options) => original.readLocal.call(cross, session,
      { signal: options.signal, readMetadata: async () => null });
    change('cross-openalex', 'off'); await click('cross-search');
    choose(['zero']); await click('enrich-citations');
    assert(paper('zero').citation.count === 4 && !ui.$('cross-more').disabled, 'Cross-source candidate supports explicit citation lookup');
    await click('cross-more');
    assert(paper('zero').citation.count === 4 && !paper('next').citation && ui.selected.size === 1,
      'Loading another page preserves citations and identity-based selection');
    return { ok: true, checks, citationRequests: calls.length, exportedPapers: exported.papers.length,
      nativeImports: 1, exportPath };
  }
  finally {
    ui.request = original.request; cross.readLocal = original.readLocal;
    chrome.importESModule = original.importModule;
    if (importedItem) await z.Items.erase([importedItem.id]);
  }
}
