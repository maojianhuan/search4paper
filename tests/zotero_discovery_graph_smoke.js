/* Run in a fresh isolated Zotero window, or in a browser with a mocked Zotero host.
 * Uses the actual search.xhtml and packaged scripts. Import/expansion are mocked;
 * this checks the UI flow without writing library items or requesting papers.
 */
async function runSearch4PaperDiscoveryGraphSmoke(win) {
  const ui = win.Search4PaperUI, service = win.Search4PaperDiscovery;
  let checks = 0;
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  const change = (id, value) => {
    const field = ui.$(id);
    if (typeof value === 'boolean') field.checked = value; else field.value = value;
    field.dispatchEvent(new win.Event(id.startsWith('graph-') ? 'change' : 'input', { bubbles: true }));
  };
  const paper = (id, title, year, refs, related = []) => service.normalizeWork({
    id: `https://openalex.org/${id}`, title, publication_year: year, cited_by_count: year - 2000,
    authorships: [{ author: { display_name: 'Fixture Author' } }], type: 'article',
    primary_location: { source: { type: 'journal' }, landing_page_url: `https://openalex.org/${id}` },
    referenced_works: refs.map(value => `https://openalex.org/${value}`),
    related_works: related.map(value => `https://openalex.org/${value}`)
  });
  const seed = paper('W1', 'Seed <paper> & evidence', 2023, ['W2', 'W90'], ['W3']);
  const a = { ...paper('W2', 'Reference paper', 2020, ['W90', 'W91']), citedByCount: null, relations: ['reference'], seedTitles: [seed.title],
    relationEvidence: [{ seedID: seed.id, seedTitle: seed.title, relation: 'reference' }], libraryStatus: 'new' };
  const b = { ...paper('W3', 'Later related paper', 2025, ['W1', 'W2', 'W90']), citedByCount: 0, relations: ['citation', 'related'], seedTitles: [seed.title],
    relationEvidence: [{ seedID: seed.id, seedTitle: seed.title, relation: 'citation' }, { seedID: seed.id, seedTitle: seed.title, relation: 'related' }], libraryStatus: 'pdf' };
  const original = { expand: service.expand, importPapers: service.importPapers, markLibraryStatus: service.markLibraryStatus };
  try {
    assert(ui.discoveryView === 'list' && ui.discoveryGraph === null, 'List remains the default and no renderer is started at launch');
    ui.papers = ui.candidates = [{ id: 'search-row', venueID: 'fixture', title: 'Existing search' }];
    ui.selected.add('fixture:search-row'); ui.page = 2; ui.filtersDirty = false;
    ui.$('results').textContent = 'Existing search result';
    ui.$('abstract').textContent = 'Existing search abstract';
    ui.$('fulltext-status').textContent = 'Existing full-text status';
    ui.materialTarget = { itemID: 123 }; ui.materialSelected.add('https://example.org/code');
    ui.switchPage('discovery');
    ui.discoverySeeds = [seed]; ui.discoveryPapers = [a, b]; ui.discoverySummary = 'Fixture coverage';
    ui.renderDiscovery();
    assert(ui.$('discovery-results').children.length === 2, 'Existing list still renders all candidates');
    ui.$('discovery-graph-view').click();
    assert(ui.discoveryGraph?.nodes().length === 3, ui.$('graph-summary').textContent);
    assert(ui.$('discovery-graph').querySelectorAll('canvas').length > 0, 'Actual canvas renderer is mounted in XHTML');
    const unknownNode = ui.discoveryGraph.getElementById('W2'), zeroNode = ui.discoveryGraph.getElementById('W3');
    assert(unknownNode.data('citedByCount') === null && unknownNode.hasClass('citations-unknown')
      && unknownNode.data('label').includes('引用未知') && unknownNode.style('border-style') === 'dashed',
      'Unknown citation counts retain their own label and dashed border in the actual renderer');
    assert(zeroNode.data('citedByCount') === 0 && !zeroNode.hasClass('citations-unknown')
      && Number.isFinite(zeroNode.data('size')), 'Known zero citations remain distinct from unknown');
    unknownNode.emit('tap');
    assert(ui.$('discovery-reasons').textContent.includes('引用数未知')
      && ui.$('discovery-results').textContent.includes('引用数未知'), 'Unknown citation counts are explicit in both preview and list');
    const summaryRect = ui.$('graph-summary').getBoundingClientRect();
    assert(summaryRect.height > 0 && summaryRect.bottom <= ui.$('discovery-workspace').getBoundingClientRect().bottom,
      'Graph coverage stays visible below all graph controls and legends');
    assert(ui.discoveryGraph.getElementById('citation:W3:W2').length === 1, 'Candidate cross-citations are shown');
    ui.discoveryGraph.getElementById('W3').emit('tap');
    assert(ui.discoveryActive.id === 'W3' && ui.$('discovery-title').textContent === b.title, 'Node click reuses paper preview');
    ui.$('discovery-pick').click();
    assert(ui.discoverySelected.has('W3') && !ui.$('discovery-import').disabled, 'Preview selection enables existing import');
    assert(ui.discoveryGraph.getElementById('W3').hasClass('queued'), 'Queued nodes have a distinct marker');
    assert(ui.$('discovery-results').children[0].querySelector('input').checked, 'Graph selection reaches the sorted list');
    ui.discoveryGraph.getElementById('W1').emit('tap');
    assert(ui.$('discovery-pick').disabled && !ui.discoverySelected.has('W1'), 'Seed preview cannot add the seed to import');
    assert(ui.$('discovery-title').textContent === seed.title, 'Paper titles stay text rather than HTML');
    ui.discoveryGraph.getElementById('coupling:W1:W2').emit('tap');
    assert(!ui.$('discovery-edge-info').hidden && ui.$('discovery-edge-description').textContent.includes('1 / 3 = 0.333'), 'Edge evidence explains the exact Jaccard calculation');
    assert(ui.$('discovery-edge-evidence').textContent.includes('W90'), 'Shared reference outside the viewport remains inspectable');
    ui.discoveryGraph.getElementById('cocitation:W1:W2').emit('tap');
    assert(ui.$('discovery-edge-description').textContent.includes('已采集论文共同引用')
      && ui.$('discovery-edge-description').textContent.includes('联合分数'), 'Co-citation preview explains both sampled evidence and combined score');
    change('graph-cocitation', false);
    assert(ui.discoveryGraph.edges().every(edge => edge.data('kind') !== 'cocitation'), 'Co-citation layer can be hidden independently');
    change('graph-cocitation', true);
    ui.$('graph-zoom-in').click(); const zoom = ui.discoveryGraph.zoom();
    ui.$('graph-zoom-out').click(); assert(ui.discoveryGraph.zoom() < zoom, 'Zoom controls work');
    ui.$('graph-fit').click(); ui.$('graph-layout').click();
    assert(ui.discoveryGraph.nodes().every(node => Number.isFinite(node.position('x'))), 'Relayout produces finite coordinates');
    change('graph-citations', false);
    assert(ui.discoveryGraph.edges().every(edge => edge.data('kind') !== 'citation'), 'Citation layer can be hidden independently');
    change('graph-citations', true);
    change('discovery-year-from', '2024');
    assert(ui.$('discovery-results').children.length === 1 && ui.discoveryGraph.nodes().length === 2, 'Year filter controls graph candidates while retaining the seed');
    assert(ui.discoveryGraph.getElementById('W2').length === 0 && ui.discoveryGraph.edges().every(edge => edge.source().length && edge.target().length), 'Filtered nodes leave no dangling edges');
    ui.$('discovery-list-view').click();
    assert(ui.discoveryGraph === null && ui.discoverySelected.has('W3') && !ui.$('discovery-list').hidden, 'Returning to list destroys only the renderer and preserves selection');
    ui.$('discovery-graph-view').click();
    change('graph-threshold', '1.1');
    assert(ui.discoveryGraph === null && ui.$('graph-summary').textContent.includes('图谱生成失败'), 'Invalid threshold fails explicitly without breaking the list');
    assert(ui.discoverySelected.has('W3') && ui.$('discovery-results').children.length === 1, 'Graph errors preserve discovery data and selection');
    change('graph-threshold', '0.1');
    assert(ui.discoveryGraph.nodes().length === 2, 'Correcting the threshold allows an explicit redraw');
    let imported;
    service.importPapers = async (_zotero, papers) => { imported = papers; return { results: papers.map(paper => ({ paper, status: 'existing' })), unprocessed: 0 }; };
    service.markLibraryStatus = async (_zotero, papers) => papers;
    await ui.operation(signal => ui.importDiscovery(signal));
    assert(imported.length === 1 && imported[0].id === 'W3', 'Graph import calls the existing importer with selected candidates only');
    ui.$('discovery-clear').click();
    ui.discoveryPapers = Array.from({ length: 51 }, (_, index) => ({ ...b, id: `W${1000 + index}`,
      referencedWorks: [], relatedWorks: [], relationEvidence: [] }));
    ui.discoveryPapers[50].referencedWorks = [...seed.referencedWorks];
    ui.$('graph-limit').value = '50'; ui.renderDiscovery();
    assert(ui.$('discovery-results').children.length === 51 && ui.discoveryGraph.nodes().length === 51
      && ui.$('graph-summary').textContent.includes('50 / 51'), 'Graph cap leaves the full list intact and reports omitted candidates');
    assert(ui.discoveryGraph.getElementById('W1050').length === 1, 'Similarity selection happens before truncating the graph');
    change('graph-selection', 'list');
    assert(ui.discoveryGraph.getElementById('W1050').length === 0, 'Original list-order selection remains available');
    change('graph-selection', 'similarity');
    ui.$('discovery-select').click();
    assert(ui.discoverySelected.size === 51 && ui.$('discovery-import').textContent.includes('51'), 'Select-all retains its original all-filtered-results scope and reports the import count');
    ui.$('discovery-clear').click(); ui.discoveryPapers = [a, b]; ui.$('graph-limit').value = '100'; ui.renderDiscovery();
    ui.switchPage('search');
    assert(ui.page === 2 && ui.selected.has('fixture:search-row') && ui.$('results').textContent === 'Existing search result'
      && ui.$('abstract').textContent === 'Existing search abstract', 'Graph actions preserve search results, selection, preview and page');
    ui.switchPage('fulltext'); assert(ui.$('fulltext-status').textContent === 'Existing full-text status', 'Full-text status is untouched');
    ui.switchPage('materials'); assert(ui.materialTarget.itemID === 123 && ui.materialSelected.has('https://example.org/code'), 'Code-repository state is untouched');
    ui.switchPage('discovery');
    const witness = paper('W800', 'Evidence outside graph', 2026, ['W1', 'W3']);
    ui.$('discovery-deep').checked = true;
    service.expand = async (_items, _zotero, options) => {
      assert(options.deep === true, 'Deep discovery option reaches the query service');
      return { seeds: [seed], papers: [a, b], citationLimitPerSeed: 50, evidencePapers: [witness], coverage: {
        newCandidates: 0, referenceLimit: 100, candidateLimitPerKind: 100, citingLimitPerQuery: 200,
        expansion: [], evidenceQueries: [{ truncated: true }], missingDetails: []
      } };
    };
    await ui.operation(signal => ui.discover(signal));
    assert(ui.discoveryAnalysis.witnesses.has('W800') && ui.$('discovery-summary').textContent.includes('1 组共被引证据达到查询上限'), 'Deep discovery retains external witnesses and reports incomplete coverage');
    ui.discoveryGraph.getElementById('cocitation:W1:W3').emit('tap');
    assert(ui.$('discovery-edge-evidence').textContent.includes('Evidence outside graph'), 'External witness title is available without adding it to the import list');
    ui.discoveryGraph.getElementById('W3').emit('tap');
    assert(ui.$('discovery-reasons').textContent.includes('联合相似度'), 'Paper preview explains its seed similarity');
    const score = ui.discoveryAnalysis.seedScores.get('W3').score;
    change('discovery-year-from', '2025');
    assert(ui.discoveryAnalysis.seedScores.get('W3').score === score, 'Changing filters cannot rebuild a biased evidence corpus');
    service.expand = async () => { throw new Error('Injected discovery failure'); };
    await ui.operation(signal => ui.discover(signal));
    assert(!ui.discoveryPapers.length && !ui.discoverySeeds.length && !ui.discoverySelected.size, 'Failed re-query clears stale discovery data');
    assert(ui.discoveryAnalysis === null, 'Failed re-query also clears the previous evidence corpus');
    assert(ui.discoveryGraph.nodes().length === 0 && ui.$('discovery-import').disabled, 'Failed re-query cannot leave an old graph importable');
    assert(ui.$('discovery-status').textContent.includes('Injected discovery failure'), 'Discovery failure is reported on its own page');
    return { checks, ok: true };
  }
  finally {
    Object.assign(service, original);
  }
}
