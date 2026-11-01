/* Run with core.js and sources.js in a native DOMParser context.
 * files maps tests/fixtures/zotero-ai filenames to their text. */
async function runSearch4PaperAIFixtures(files) {
  const core = Search4PaperCore, sources = Search4PaperSources;
  let assertions = 0;
  const check = (ok, message) => { assertions++; if (!ok) throw Error(message); };
  const rejects = async (fn, message) => { let failed = false; try { await fn(); } catch { failed = true; } check(failed, message); };
  const metadata = papers => ({schemaVersion:1,year:papers[0].year,venueID:papers[0].venueID,
    fetchedAt:'2026-10-29T00:00:00Z',paperCount:papers.length,papers});
  for (const year of [2025, 2026]) {
    const raw = files[`ijcai-${year}-index.html`], papers = sources.parseIJCAIIndex(raw, year);
    check(papers.length === 1 && papers[0].track === 'Main Track', 'IJCAI excludes Survey Track');
    check(papers[0].doi === `10.24963/ijcai.${year}/1`, 'IJCAI official DOI and year');
    core.validateMetadata(metadata(papers), year, 'IJCAI');
    const complete = sources.completeIJCAIPaper(files[`ijcai-${year}-detail.html`], papers[0]);
    check(complete.abstract.length > 100, 'both years provide official abstracts');
    await rejects(() => sources.parseIJCAIIndex(raw, year - 1), 'wrong IJCAI year fails');
    await rejects(() => sources.parseIJCAIIndex(raw.replace('Main Track','Unknown Track'), year), 'missing Main Track fails');
    await rejects(() => sources.parseIJCAIIndex(raw.replace(/0001\.pdf/g,'0002.pdf'), year), 'mismatched PDF fails');
  }
  const calls = [];
  const papers = await sources.fetchAccepted(2025, {conference:'IJCAI',request:async url => {
    calls.push(url);return files[calls.length === 1 ? 'ijcai-2025-index.html' : 'ijcai-2025-detail.html'];
  }});
  check(calls.join('|') === 'https://ijcai.org/proceedings/2025/|https://ijcai.org/proceedings/2025/1', 'IJCAI dispatches official index and detail');
  check(papers[0].abstract.includes('normative multi-agent systems') && papers[0].keywords.includes('Formal verification'), 'official abstract and keywords');
  const detail = files['ijcai-2025-detail.html'];
  for (const raw of [detail.replace('ijcai.2025/1','ijcai.2024/1'),detail.replace('Main Track.','Survey Track.'),detail.replace('Synthesising Minimum','Other Minimum')]) {
    await rejects(() => sources.completeIJCAIPaper(raw,papers[0]), 'wrong detail cannot contaminate selected paper');
  }
  const raw = files['acmmm-2025.html'];
  const mm = await sources.fetchAccepted(2025,{conference:'ACM MM',request:async url => {
    check(url === 'https://acmmm2025.org/accepted-regular-papers/', 'ACM official Regular Papers endpoint');return raw;
  }});
  check(mm.length === 2 && mm[0].id === '2025:3783' && mm[1].id === '2025:2254', 'all ACM records retain their submission IDs');
  check(mm[0].authors[0] === 'Xuanliu Zhu' && mm[0].authors.length === 5, 'ACM authors preserved');
  check(mm.every(p => p.abstract === '' && p.doi === '' && p.pdfURL === ''), 'missing fields stay empty');
  check(core.matchPaper(mm[0],{terms:['CrossMind'],operator:'AND',fields:['title']})?.evidence.length > 0, 'new papers are searchable');
  core.validateMetadata(JSON.parse(JSON.stringify(metadata(mm))),2025,'ACM MM');
  for (const bad of [raw.replace('2025 ACM','2024 ACM'),raw.replace('Accepted Regular Papers','Accepted Dataset Papers'),raw.replace('<br/>',''),raw.replace('2254','3783')]) {
    await rejects(() => sources.fetchAccepted(2025,{conference:'ACM MM',request:async()=>bad}), 'wrong year, track, missing authors or duplicate ID fails');
  }
  for (const [conference,year] of [['ACM MM',2026],['IJCAI',2024]]) {
    let requests = 0;
    await rejects(() => sources.fetchAccepted(year,{conference,request:async()=>{requests++;throw Error('unexpected request');}}), 'unsupported year fails');
    check(requests === 0, 'unsupported year rejected before network');
  }
  const controller = new AbortController();
  await rejects(() => sources.fetchAccepted(2025,{conference:'IJCAI',signal:controller.signal,request:async()=>{
    controller.abort();return files['ijcai-2025-index.html'];
  }}), 'cancellation stops before detail requests');
  await rejects(() => sources.fetchAccepted(2025,{conference:'ACM MM',request:async()=>{throw Error('HTTP 403');}}), 'HTTP failure propagates');
  return {ok:true,assertions};
}
