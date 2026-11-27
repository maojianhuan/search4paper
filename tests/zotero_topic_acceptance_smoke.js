/* Run against an installed XPI in an empty, explicitly isolated Zotero profile.
 * topics contains query conditions and expected candidates from reviewed local data.
 * The complete source cache must already exist; this test never fetches papers.
 */
async function runSearch4PaperTopicAcceptance(win, { expectedDataDir, topics }) {
  const ui = win.Search4PaperUI, core = win.Search4PaperCore, z = ui.Zotero;
  let checks = 0, networkRequests = 0;
  const assert = (value, message) => { if (!value) throw new Error(message); checks++; };
  assert(z.DataDirectory.dir === expectedDataDir && /search4paper-cross-native-p0/.test(expectedDataDir),
    'Topic acceptance requires the explicitly named isolated library');
  assert((await z.Items.getAll(z.Libraries.userLibraryID, true, false)).length === 0,
    'Topic acceptance requires an empty library');
  const request = ui.request, results = [];
  const change = (id, value) => {
    const input = ui.$(id);
    if (typeof value === 'boolean') input.checked = value; else input.value = value;
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const click = async id => {
    assert(!ui.$(id).disabled, `${id} must be enabled`);
    ui.$(id).click();
    const started = Date.now();
    while (ui.busy) {
      if (Date.now() - started > 20000) throw new Error(`Timed out: ${id}`);
      await new Promise(resolve => win.setTimeout(resolve, 20));
    }
    assert(!ui.$('status').classList.contains('error'), ui.$('status').textContent);
  };
  try {
    ui.request = async () => { networkRequests++; throw new Error('Acceptance must reuse local data'); };
    ui.switchPage('search');
    for (const topic of topics) {
      const { conference, year } = topic.scope;
      const cachePath = PathUtils.join(expectedDataDir, 'search4paper', conference, `${year}.json`);
      const before = await IOUtils.readUTF8(cachePath);
      const metadata = core.validateMetadata(JSON.parse(before), year, conference);
      for (const option of ui.$('conference').options) option.selected = option.value === conference;
      change('year', String(year)); change('terms', topic.query.terms.join('; '));
      change('operator', topic.query.operator);
      for (const field of core.FIELDS) change('field-' + field, topic.query.fields.includes(field));
      await click('fetch');
      const ids = ui.candidates.map(p => p.id).sort();
      assert(JSON.stringify(ids) === JSON.stringify(topic.papers.map(p => p.id).sort()),
        `${topic.topic}: candidates must reproduce the reviewed sample`);
      assert(ui.papers.length === metadata.paperCount && ui.loadedTargets.length === 1,
        'Only the selected complete source is loaded');
      assert(ui.$('coverage').textContent.includes('本地名单')
        && ui.$('coverage').textContent.includes(`${conference} ${year}`), 'Coverage identifies the local source');
      assert(ui.$('results').children.length === ids.length, 'All small-sample candidates are rendered');
      assert(ui.$('abstract').textContent === ui.candidates[0].abstract
        && ui.$('evidence').children.length > 0, 'Abstract and match evidence are visible');

      for (const field of core.FIELDS) change('field-' + field, field === 'title');
      await click('filter');
      assert(ui.candidates.length <= ids.length
        && ui.candidates.every(p => p.evidence.every(hit => hit.field === 'title')), 'Field selection affects evidence');
      for (const field of core.FIELDS) change('field-' + field, topic.query.fields.includes(field));
      await click('filter');
      assert(JSON.stringify(ui.candidates.map(p => p.id).sort()) === JSON.stringify(ids),
        'Restoring fields restores the candidates');

      const picks = topic.papers.filter(p => p.review.judgement === 'relevant').slice(0, 2);
      assert(picks.length === 2, 'Each topic has two reviewed examples for native import');
      for (const paper of picks) {
        const candidate = ui.candidates.find(p => p.id === paper.id);
        const row = [...ui.$('results').children].find(r => r.dataset.id === ui.paperKey(candidate));
        row.querySelector('input').click();
      }
      change('new-collection', 'P0 · ' + topic.topic);
      change('tags', 'P0 acceptance');
      await click('import');
      assert(ui.lastImport.results.length === 2
        && ui.lastImport.results.every(r => r.status === 'created'), 'Selected candidates import as native items');
      const items = ui.lastImport.results.map(r => r.item);
      for (const item of items) {
        assert(item.itemType === 'conferencePaper' && item.getAttachments().length === 0,
          'Import creates conference papers without PDF downloads');
        const notes = await z.Items.getAsync(item.getNotes());
        assert(notes.some(note => note.getNote().includes('Imported by search4paper')), 'Match provenance is saved');
        assert(item.getCollections().length > 0 && item.hasTag('P0 acceptance'), 'Collection and tag are saved');
      }
      items[0].setField('abstractNote', 'P0 user-reviewed abstract'); await items[0].saveTx();
      await click('import');
      assert(ui.lastImport.results.every(r => r.status === 'existing')
        && items[0].getField('abstractNote') === 'P0 user-reviewed abstract', 'Reimport deduplicates and preserves user edits');
      assert(await IOUtils.readUTF8(cachePath) === before, 'Search and import do not rewrite the source cache');
      results.push({ topic: topic.topic, conference, year, sourcePapers: metadata.paperCount,
        candidates: ids.length, candidateIDs: ids, imported: items.length, reviewCounts: topic.reviewCounts });
    }
    assert((await z.Items.getAll(z.Libraries.userLibraryID, true, false)).length === topics.length * 2,
      'Only selected papers were imported across both topics');
    assert(networkRequests === 0, 'No paper retrieval or enrichment requests were made');
    return { ok: true, checks, networkRequests, topics: results };
  }
  finally { ui.request = request; }
}
