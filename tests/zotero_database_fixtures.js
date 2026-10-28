/* Offline parser regression checks using Zotero's native DOMParser.
 * Load after core.js/database-sources.js and pass saved fixture strings by basename.
 */
function runSearch4PaperDatabaseFixtures(fixtures) {
  let assertions = 0;
  const check = (value, message) => { assertions++; if (!value) throw new Error(message); };
  const throws = (fn, message) => { let failed=false; try { fn(); } catch { failed=true; } check(failed,message); };
  const db = Search4PaperDatabaseSources, core = Search4PaperCore;
  const mod = db.parseSIGMOD(fixtures['sigmod-2025.html'],2025);
  check(mod.length===4,'all four SIGMOD rounds');check(mod[0].authors[0]==='Yuxuan Zhu','strip affiliation and duplicate author');
  check(mod[0].authors.length===6,'semicolons inside affiliations do not split names');
  check(!mod.some(p=>p.title==='Not research'),'exclude demos');
  const duplicate=fixtures['sigmod-2025.html'].replace('</ul>',new DOMParser().parseFromString(fixtures['sigmod-2025.html'],'text/html').querySelector('li').outerHTML+'</ul>');
  check(db.parseSIGMOD(duplicate,2025).length===4,'SIGMOD de-duplicates');
  const across=new DOMParser().parseFromString(fixtures['sigmod-2025.html'],'text/html');
  across.getElementById('round3').nextElementSibling.appendChild(across.querySelector('li').cloneNode(true));
  const merged=db.parseSIGMOD(across.documentElement.outerHTML,2025);
  check(merged.length===4&&merged[0].rounds.length===2,'duplicates across rounds retain both round memberships');
  throws(()=>db.parseSIGMOD(fixtures['sigmod-2025.html'].replace('id="round1"','id="unknown"'),2025),'missing round fails');
  const ir=db.parseSIGIR(fixtures['sigir-2025.html'],2025);
  check(ir.length===2&&ir[0].track==='Full Papers'&&ir[1].track==='Short Papers','SIGIR only main full/short papers');
  throws(()=>db.parseSIGIR(fixtures['sigir-2025.html'].replace('id="short-papers"','id="missing"'),2025),'missing SIGIR track fails');
  const kdd=db.parseKDDOfficial(fixtures['kdd-2025.html'],2025);
  check(kdd.length===2&&new Set(kdd.flatMap(p=>p.cycles)).size===2,'official KDD two research cycles');
  check(kdd.every(p=>p.doi.startsWith('10.1145/')&&p.abstract===''),'actual DOI preserved; no invented abstract');
  const vldb=db.parseVLDB(fixtures['pvldb-18.html'],2025);
  check(vldb.length===11,'VLDB research issues 1 through 11 only');
  check(vldb.every(p=>p.issue<=11)&&!vldb.some(p=>/Front Matter/.test(p.title)),'exclude front matter and issues 12/13');
  check(vldb[0].title.startsWith('The Key to Effective UDF'),'known title');
  const doc=new DOMParser().parseFromString(fixtures['pvldb-18.html'],'text/html'),data=JSON.parse(doc.getElementById('__NEXT_DATA__').textContent);
  data.props.pageProps.groupedIssues['1'][1].date='2024-09';
  data.props.pageProps.groupedIssues['1'][1].doi='10.14778/fixture';
  data.props.pageProps.groupedIssues['1'][1].abstract='Fixture abstract about anomaly detection';
  data.props.pageProps.groupedIssues['13'][1].date='2025-08';
  const boundary=db.parseVLDB(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`,2025);
  check(boundary[0].year===2025&&boundary[0].date==='2024-09','2024 publication belongs to 2025 conference');
  check(!boundary.some(p=>p.issue===13),'2025 publication in following-conference issue excluded');
  check(boundary[0].doi==='10.14778/fixture'&&boundary[0].abstract.includes('anomaly'),'preserve optional PVLDB DOI/abstract');
  delete data.props.pageProps.groupedIssues['2'];
  throws(()=>db.parseVLDB(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`,2025),'missing required issue fails');
  for(const [conference,papers] of [['SIGMOD',mod],['KDD',kdd],['SIGIR',ir],['VLDB',vldb]]){
    const meta={schemaVersion:1,year:2025,venueID:core.venueID(conference,2025),fetchedAt:new Date().toISOString(),paperCount:papers.length,papers};
    check(core.validateMetadata(JSON.parse(JSON.stringify(meta)),2025,conference).paperCount===papers.length,'cache round trip '+conference);
    check(!!core.matchPaper(papers[0],{terms:[papers[0].title],operator:'AND',fields:['title']}),'known title searchable '+conference);
    check(papers.every(p=>typeof p.abstract==='string'&&typeof p.keywords==='string'&&typeof p.tldr==='string'),'optional metadata '+conference);
    throws(()=>core.validateMetadata(meta,2026,conference),'cache year isolated '+conference);
  }
  const mod26=db.parseSIGMOD(fixtures['sigmod-2026.html'],2026);
  check(mod26.length===4&&mod26.some(p=>p.rounds.includes('round3')&&p.authors.length>1),'SIGMOD 2026 mixed heading levels and authors without br');
  throws(()=>db.parseSIGMOD(fixtures['sigmod-2026.html'].replace('Round 4','Round 5'),2026),'SIGMOD 2026 missing round fails');
  const kdd26=db.parseKDDOfficial(fixtures['kdd-2026.html'],2026);
  check(kdd26.length===4&&kdd26.every(p=>p.track==='Research Track'&&p.doi.startsWith('10.1145/')),'KDD 2026 two JSON arrays contain research and non-research tracks');
  check(new Set(kdd26.flatMap(p=>p.cycles)).size===2,'KDD 2026 retains both cycles');
  throws(()=>db.parseKDDOfficial(fixtures['kdd-2026.html'].replace('const cycle2Papers','const unrelatedPapers'),2026),'KDD 2026 missing second cycle fails');
  throws(()=>db.parseKDDOfficial(fixtures['kdd-2026.html'].replaceAll('"rtp"','"ads"'),2026),'KDD non-research tracks cannot stand in for Research Track');
  const ir26=db.parseSIGIR(fixtures['sigir-2026.html'],2026);
  check(ir26.length===2&&ir26[0].track==='Full Papers'&&ir26[1].track==='Short Papers','SIGIR 2026 decodes repeated embedded HTML and excludes other tracks');
  check(ir26.every(p=>p.retrievalWarning.includes('初始录用名单')),'SIGIR snapshot limitation survives parsing');
  throws(()=>db.parseSIGIR(fixtures['sigir-2026.html'].replaceAll('Short Papers','Missing Papers'),2026),'SIGIR 2026 incomplete list fails');
  const vldb26=db.parseVLDB(fixtures['pvldb-19.html'],2026);
  check(vldb26.length===11&&vldb26.every(p=>p.volume===19&&p.issue<=11&&p.pdfURL.includes('/vol19/')),'VLDB 2026 maps to volume 19 research issues and excludes issue 12');
  throws(()=>db.parseVLDB(fixtures['pvldb-18.html'],2026),'VLDB rejects previous conference volume');
  throws(()=>db.parseVLDB(fixtures['pvldb-19.html'].replace('/vol19/p','/vol18/p'),2026),'VLDB rejects PDF from another volume');
  for(const [conference,papers,file,parse] of [['SIGMOD',mod26,'sigmod',db.parseSIGMOD],['KDD',kdd26,'kdd',db.parseKDDOfficial],['SIGIR',ir26,'sigir',db.parseSIGIR],['VLDB',vldb26,'pvldb',db.parseVLDB]]){
    const meta={schemaVersion:1,year:2026,venueID:core.venueID(conference,2026),fetchedAt:new Date().toISOString(),paperCount:papers.length,papers};
    check(core.validateMetadata(JSON.parse(JSON.stringify(meta)),2026,conference).paperCount===papers.length,'2026 cache round trip '+conference);
    throws(()=>core.validateMetadata(meta,2025,conference),'2026 cache cannot enter 2025 '+conference);
    throws(()=>parse(fixtures[file==='pvldb'?'pvldb-19.html':file+'-2026.html'],2025),'2026 official page cannot enter 2025 '+conference);
  }
  return {assertions,counts:{SIGMOD:mod26.length,KDD:kdd26.length,SIGIR:ir26.length,VLDB:vldb26.length}};
}
