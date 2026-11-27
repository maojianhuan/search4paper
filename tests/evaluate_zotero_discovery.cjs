/* Live, read-only evaluation. Not included in the offline test suite.
 * node tests/evaluate_zotero_discovery.cjs /tmp/discovery-evaluation.json [DOI ...]
 * Optional: OPENALEX_API_KEY. The output records the observed corpus for inspection.
 */
const fs = require('node:fs');
const vm = require('node:vm');
const graph = require('../zotero-plugin/content/discovery-graph.js');
const scope = { URL, Search4PaperCore: require('../zotero-plugin/content/core.js') };
vm.runInNewContext(fs.readFileSync(require.resolve('../zotero-plugin/content/discovery.js'), 'utf8'), scope);
const discovery = scope.Search4PaperDiscovery;

async function main() {
  const [output, ...requested] = process.argv.slice(2);
  if (!output) throw new Error('Provide a new output JSON path; this command requests live OpenAlex data.');
  if (fs.existsSync(output)) throw new Error('Output already exists; choose a new path to preserve previous results.');
  const dois = requested.length ? requested : ['10.18653/v1/N19-1423', '10.1109/ICDM.2008.17'];
  const report = { startedAt: new Date().toISOString(), source: 'OpenAlex',
    protocol: 'Single-seed, original list top 20 versus deep-discovery joint-similarity top 20; fixed equal weights. No relevance ground truth or Connected Papers benchmark.',
    runs: [] };
  for (const doi of dois) {
    let requests = 0;
    const request = async url => {
      requests++;
      const options = discovery.apiRequest(url, process.env.OPENALEX_API_KEY || '');
      const response = await fetch(options.url, { headers: options.headers, signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`OpenAlex HTTP ${response.status}: ${await response.text()}`);
      return response.json();
    };
    const item = { isRegularItem: () => true, deleted: false,
      getField: key => ({ DOI: doi, title: doi, extra: '' }[key] || '') };
    const basic = await discovery.expand([item], {}, { request });
    const deep = await discovery.expandSimilarity(basic, { request,
      onProgress: message => console.log(message) });
    const analysis = graph.analyze(deep.seeds, deep.papers, deep.evidencePapers);
    const baseline = discovery.filterAndSort(basic.papers).slice(0, 20);
    const selected = graph.build(deep.seeds, discovery.filterAndSort(deep.papers), {
      analysis, selection: 'similarity', limit: 20, cocitation: true
    }).nodes.filter(node => !node.isSeed).map(node => node.paper);
    const originalIDs = new Set(basic.papers.map(paper => paper.id));
    const baselineIDs = new Set(baseline.map(paper => paper.id));
    const top = selected.map(paper => {
      const score = analysis.seedScores.get(paper.id);
      return { id: paper.id, title: paper.title, doi: paper.doi, year: paper.year,
        newlyDiscovered: !originalIDs.has(paper.id), joint: score.score,
        bibliographic: score.bibliographic, cocitation: score.cocitation };
    });
    const summary = { doi, title: deep.seeds[0].title, requests,
      basicCandidates: basic.papers.length, deepCandidates: deep.papers.length,
      witnesses: analysis.witnesses.size, missingWitnessReferences: analysis.missingWitnessReferences,
      newlyDiscoveredInTop20: top.filter(paper => paper.newlyDiscovered).length,
      overlapWithOriginalTop20: selected.filter(paper => baselineIDs.has(paper.id)).length };
    report.runs.push({ summary, baseline: baseline.map(paper => ({ id: paper.id, title: paper.title })), top, basic, deep });
    console.log(JSON.stringify(summary));
    console.log(JSON.stringify(top.slice(0, 10).map(({ title, joint, newlyDiscovered }) => ({ title, joint, newlyDiscovered }))));
  }
  report.completedAt = new Date().toISOString();
  // Abstracts do not participate in this algorithm; retain the bibliographic evidence, not full abstracts.
  fs.writeFileSync(output, JSON.stringify(report, (key, value) => key === 'abstract' ? undefined : value, 2), { flag: 'wx' });
  console.log('Saved evaluation corpus and results:', output);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
