const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const core=require('../zotero-plugin/content/core.js');
const scope={Search4PaperCore:core,URL,URLSearchParams};
for(const file of ['journal-sources.js','sources.js'])vm.runInNewContext(readFileSync(require.resolve('../zotero-plugin/content/'+file),'utf8'),scope);
const journals=scope.Search4PaperJournalSources,sources=scope.Search4PaperSources;
function record(journal='TPAMI',year=2026,id='example'){
  const config=core.JOURNAL_SOURCES[journal];
  return {DOI:'10.1109/'+journal.toLowerCase()+'.'+id,title:['Time Series Research'],author:[{given:'Ada',family:'Example'}],
    ISSN:[config.issn],type:'journal-article','container-title':[config.title],published:{'date-parts':[[year,2]]},
    'published-print':{'date-parts':[[year+1,1]]},'published-online':{'date-parts':[[year,2]]},volume:'48',issue:'2',page:'1-12'};
}
const reply=(items,total,next='next')=>({status:'ok',message:{'total-results':total,items,'next-cursor':next}});
const options=(request,conference='TPAMI')=>({conference,request,signal:new AbortController().signal});
const metadata=p=>({schemaVersion:1,year:p.year,venueID:p.venueID,fetchedAt:'2026-09-29T00:00:00Z',paperCount:1,papers:[p]});

test('only the verified CCF A journals are selectable, with explicit years and journal identities',()=>{
  assert.deepEqual(core.filterConferences({type:'期刊',rank:'A'}),['JMLR','TPAMI','TKDE']);
  assert.deepEqual(core.filterConferences({field:'人工智能',type:'期刊'}),['JMLR','TPAMI']);
  for(const journal of ['JMLR','TPAMI','TKDE']){
    assert.equal(core.venueID(journal,2026),journal+'/2026/Journal');
    assert.deepEqual(core.sourceSupport(journal).years,[2025,2026]);
    assert.equal(core.sourceYearError(journal,2025),'');
    assert.match(core.sourceYearError(journal,2024),/尚未适配/);
  }
  for(const journal of ['TMLR','TNNLS'])assert.throws(()=>core.venueID(journal,2026),/受支持/);
});
test('journal dispatch follows every Crossref cursor with exact ISSN, type and publication-year filters',async()=>{
  const calls=[],progress=[];
  const papers=await sources.fetchAccepted(2026,{...options(async(url,signal,type)=>{
    calls.push(url);const u=new URL(url);
    assert.equal(u.pathname,'/journals/0162-8828/works');assert.equal(type,'json');
    assert.equal(u.searchParams.get('filter'),'from-pub-date:2026-01-01,until-pub-date:2026-12-31,type:journal-article');
    assert.equal(u.searchParams.get('rows'),'1000');
    assert.equal(u.searchParams.get('cursor'),calls.length===1?'*':'next+/=');
    return calls.length===1?reply([record('TPAMI',2026,'a')],2,'next+/='):reply([record('TPAMI',2026,'b')],2);
  }),onProgress:(done,total)=>progress.push([done,total])});
  assert.equal(calls.length,2);assert.equal(papers.length,2);assert.equal(papers[0].itemType,'journalArticle');
  assert.equal(papers[0].date,'2026-02');assert.equal(papers[0].printDate,'2027-01');
  assert.equal(papers[0].abstract,'');assert.equal(papers[0].pdfURL,'');
  assert.equal(papers[0].publicationTitle,core.JOURNAL_SOURCES.TPAMI.title);assert.deepEqual(progress.at(-1),[2,2]);
});
test('Crossref normalization rejects other journals, wrong dates, other types and malformed identities',()=>{
  const mutations=[r=>r.ISSN=['1041-4347'],r=>r['container-title']=['Different Journal'],r=>r.type='proceedings-article',
    r=>r.published={'date-parts':[[2025]]},r=>r.published={'date-parts':[[2026,2,30]]},r=>delete r.published,
    r=>r.DOI='not a doi',r=>r.title=[],r=>r.author='Ada',r=>r.author=[{}]];
  for(const change of mutations){const r=record();change(r);assert.throws(()=>journals.normalizeCrossref(r,'TPAMI',2026));}
});
test('missing journal metadata stays empty; absent authors do not invent authors for editorials',()=>{
  const r=record('TKDE');for(const key of ['volume','issue','page','author','published-online','published-print'])delete r[key];
  const p=journals.normalizeCrossref(r,'TKDE',2026);
  for(const key of ['abstract','volume','issue','pages','onlineDate','printDate','pdfURL'])assert.equal(p[key],'');
  assert.equal(p.authors.length,0);assert.match(p.retrievalWarning,/社论、勘误/);
  assert.equal(core.validateMetadata(metadata(p),2026,'TKDE').papers[0],p);
});
test('Crossref refuses incomplete, duplicate, overfull and changing-total pages',async()=>{
  for(const pages of [
    [reply([record()],2),reply([],2)],
    [reply([record()],2),reply([record()],2)],
    [reply([record()],2),reply([record('TPAMI',2026,'b')],3)],
    [reply([record()],0)],
    [reply([record()],2,'')],
    [{status:'error',message:{'total-results':0,items:[]}}]
  ]){
    let n=0;await assert.rejects(sources.fetchAccepted(2026,options(async()=>pages[n++])),/Crossref/);
    assert.ok(n<=2);
  }
});
test('an unchanged Crossref cursor is allowed only while unique records advance',async()=>{
  let n=0;const papers=await sources.fetchAccepted(2026,options(async()=>reply([record('TPAMI',2026,String(++n))],3,'same')));
  assert.equal(papers.length,3);assert.equal(n,3);
});
test('unverified journal years fail before requests; zero indexed results are not a successful empty list',async()=>{
  let calls=0;
  for(const conference of ['JMLR','TPAMI','TKDE'])await assert.rejects(sources.fetchAccepted(2027,options(async()=>{calls++;},conference)),/尚未适配/);
  assert.equal(calls,0);
  await assert.rejects(sources.fetchAccepted(2026,options(async()=>reply([],0))),/未返回已出版书目/);
});
test('journal network failures and cancellation never publish partial results or retry',async()=>{
  let n=0;
  await assert.rejects(sources.fetchAccepted(2026,options(async()=>{n++;throw Error('HTTP 429');})),/429/);assert.equal(n,1);
  const controller=new AbortController();n=0;
  await assert.rejects(sources.fetchAccepted(2026,{conference:'TPAMI',signal:controller.signal,request:async()=>{
    n++;controller.abort();return reply([record()],2);
  }}));assert.equal(n,1);
});
test('journal caches preserve bibliographic fields and reject conference typing, spoofed sources and years',()=>{
  const p=journals.normalizeCrossref(record(),'TPAMI',2026),m=metadata(p);
  assert.deepEqual(core.validateMetadata(JSON.parse(JSON.stringify(m)),2026,'TPAMI'),JSON.parse(JSON.stringify(m)));
  for(const patch of [{itemType:'conferencePaper'},{source:'jmlr'},{issn:'1041-4347'},{yearBasis:'print year'},
    {sourceURL:'https://example.org'},{url:'javascript:alert(1)'},{date:'2025-02'},{volume:48},{doi:'10.1109/other'},
    {publicationTitle:'TKDE'},{pdfURL:'https://ieeexplore.ieee.org/fake.pdf'}]){
    assert.throws(()=>core.validateMetadata({...m,papers:[{...p,...patch}]},2026,'TPAMI'),/期刊缓存/);
  }
  assert.throws(()=>core.validateMetadata(m,2026,'TKDE'),/期刊或年份/);
});
test('journal DOI and JMLR canonical URL identities survive restart and evidence records the year basis',()=>{
  const p=journals.normalizeCrossref(record(),'TPAMI',2026);
  assert.ok(core.identities(p).has('doi:'+p.doi));
  assert.ok(core.identities({extra:`Source ID: ${p.source}:${p.id}`}).has(`source:${p.source}:${p.id}`));
  for(const host of ['jmlr.org','www.jmlr.org'])assert.ok(core.identities({url:`https://${host}/papers/v27/22-0483.html`}).has('source:jmlr:v27/22-0483'));
  assert.equal(core.identities({url:'https://evil.example/papers/v27/22-0483.html'}).size,0);
  const note=core.evidenceNote(p,{terms:['time series'],operator:'OR',fields:['title']});
  for(const value of [p.yearBasis,p.sourceURL,p.publicationTitle,p.issn,p.printDate])assert.ok(note.includes(value));
});
