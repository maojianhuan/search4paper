const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const core=require('../zotero-plugin/content/core.js');

const scope={URL,Search4PaperCore:core};
vm.runInNewContext(readFileSync(require.resolve('../zotero-plugin/content/discovery.js'),'utf8'),scope);
const service=scope.Search4PaperDiscovery;
const graphService=require('../zotero-plugin/content/discovery-graph.js');
const cytoscape=require('../zotero-plugin/content/vendor/cytoscape-3.35.0.min.js');
const work=(id,title,changes={})=>({id:`https://openalex.org/${id}`,doi:null,title,publication_year:2025,type:'article',
  authorships:[{author:{display_name:'Ada Example'}},{author:{display_name:'Jia Li'}}],abstract_inverted_index:{An:[0],abstract:[1]},
  primary_location:{landing_page_url:`https://example.org/${id}`,source:{display_name:'Example Journal',type:'journal'}},
  cited_by_count:3,referenced_works:[],related_works:[],...changes});
const seedItem=()=>({isRegularItem:()=>true,deleted:false,getField:key=>({title:'Seed Paper',DOI:'10.1000/seed',extra:'',date:'2025'}[key]||''),getCreators:()=>[]});
const Zotero={CreatorTypes:{getID:()=>1}};

test('OpenAlex API key is scoped to its official host and rate headers are parsed',()=>{
  const request=service.apiRequest('https://api.openalex.org/works/W1?select=id',' secret key ');
  assert.equal(new URL(request.url).searchParams.has('api_key'),false);
  assert.equal(request.headers.Authorization,'Bearer secret key');
  assert.throws(()=>service.apiRequest('https://example.org/works','secret'),/地址无效/);
  const headers=new Map([['x-ratelimit-limit','10000'],['x-ratelimit-remaining','9990'],['x-ratelimit-reset','42']]);
  const rate=service.rateLimit({getResponseHeader:name=>headers.get(name.toLowerCase())});
  assert.equal(`${rate.limit},${rate.remaining},${rate.reset}`,'10000,9990,42');
  assert.equal(service.rateLimit({getResponseHeader:()=>null}),null);
});

test('seed expansion merges citation relations, explains seeds and excludes seeds',async()=>{
  const seed=work('W1','Seed Paper',{doi:'https://doi.org/10.1000/seed',referenced_works:['https://openalex.org/W2'],related_works:['https://openalex.org/W3']});
  const requests=[];
  const request=async url=>{requests.push(url);
    if(url.includes('/works/https://doi.org/'))return seed;
    if(url.includes('filter=openalex%3AW2'))return {results:[work('W2','Reference')]};
    if(url.includes('filter=openalex%3AW3'))return {results:[work('W3','Related')]};
    if(url.includes('filter=cites:W1'))return {results:[work('W2','Reference'),work('W4','Citation')]};
    throw Error('unexpected '+url);
  };
  const result=await service.expand([seedItem()],Zotero,{request,signal:new AbortController().signal});
  assert.equal(result.papers.length,3);assert.equal(result.papers.some(p=>p.id==='W1'),false);
  const shared=result.papers.find(p=>p.id==='W2');assert.equal([...shared.relations].sort().join(','),'citation,reference');
  assert.equal(shared.seedTitles.join(','),'Seed Paper');assert.equal(shared.abstract,'An abstract');
});

test('title-only OpenAlex resolution requires exact title, year, authors and uniqueness',async()=>{
  const item={isRegularItem:()=>true,deleted:false,getField:key=>({title:'Exact Paper',DOI:'',extra:'',date:'2025'}[key]||''),
    getCreators:()=>[{creatorTypeID:1,firstName:'Ada',lastName:'Example'},{creatorTypeID:1,firstName:'Jia',lastName:'Li'}]};
  const good=work('W9','Exact Paper');
  assert.equal((await service.resolveItem(item,Zotero,async()=>({results:[good]}))).id,'W9');
  for(const results of [[work('W9','Different')],[work('W9','Exact Paper',{publication_year:2024})],
    [work('W9','Exact Paper',{authorships:[{author:{display_name:'Other Person'}}]})],[good,work('W10','Exact Paper')]]) {
    await assert.rejects(()=>service.resolveItem(item,Zotero,async()=>({results})),/未找到|多个/);
  }
});

test('DOI and saved OpenAlex ID resolution reject mismatched, missing or conflicting identities without fallback',async()=>{
  const item=(doi,extra='')=>({...seedItem(),getField:key=>({title:'Seed Paper',DOI:doi,extra,date:'2025'}[key]||'')});
  const matching=work('W1','Seed Paper',{doi:'https://doi.org/10.1000/seed'});
  let requests=[];
  const resolve=(seed,response)=>service.resolveItem(seed,Zotero,async url=>{requests.push(url);return response;});
  assert.equal((await resolve(item('HTTPS://DOI.ORG/10.1000/SEED'),matching)).doi,'10.1000/seed');
  assert.equal((await resolve(item('10.1000/seed','OpenAlex ID: W1  \nDOI: 10.1000/SEED'),matching)).id,'W1');
  assert.equal((await resolve(item('','OpenAlex ID: W1'),{...matching,doi:null})).id,'W1');
  assert.equal(requests.length,3);
  assert.match(requests[0],/\/works\/https:\/\/doi\.org\/10.1000%2Fseed\?/);
  assert.match(requests[1],/\/works\/W1\?/);
  for(const [seed,response,message] of [
    [item('10.1000/seed'),{...matching,doi:'https://doi.org/10.1000/other'},/DOI.*不一致/],
    [item('10.1000/seed'),{...matching,doi:null},/DOI.*不一致/],
    [item('','OpenAlex ID: W1'),{...matching,id:'https://openalex.org/W2'},/ID.*不一致/],
    [item('10.1000/seed','OpenAlex ID: W1'),{...matching,id:'https://openalex.org/W2'},/ID.*不一致/],
    [item('10.1000/seed','OpenAlex ID: W1'),{...matching,doi:'https://doi.org/10.1000/other'},/DOI.*不一致/],
    [item('10.1000/seed'),{...matching,id:null},/缺少有效 ID/],
    [item('','OpenAlex ID: W1'),{...matching,id:'https://example.org/W1'},/缺少有效 ID/],
    [item('10.1000/seed'),null,/缺少有效 ID/]
  ]) {
    requests=[];
    await assert.rejects(()=>resolve(seed,response),message);
    assert.equal(requests.length,1,'Identity failures must not fall back to title or another identifier');
  }
  for(const [seed,message] of [
    [item('10.1000/seed','OpenAlex ID: W1\nOpenAlex ID: W2'),/冲突.*OpenAlex ID/],
    [item('10.1000/seed','DOI: 10.1000/other'),/不同 DOI/],
    [item('10.1000/seed','OpenAlex ID: malformed'),/OpenAlex ID 格式无效/],
    [item('not-a-doi'),/DOI 格式无效/]
  ]) {
    requests=[];
    await assert.rejects(()=>resolve(seed,matching),message);
    assert.equal(requests.length,0,'Conflicting or malformed seed identities fail before a request');
  }
});

test('unknown citation counts stay unknown and sort below known zero without accepting malformed data',()=>{
  const missing=work('W1','A unknown');delete missing.cited_by_count;
  const papers=[missing,work('W2','B null',{cited_by_count:null}),work('W3','Zero',{cited_by_count:0}),
    work('W4','Cited',{cited_by_count:10})].map(raw=>({...service.normalizeWork(raw),relations:['related'],seedTitles:['Seed']}));
  assert.deepEqual(papers.map(paper=>paper.citedByCount),[null,null,0,10]);
  for(const sort of ['cited','latest','recommended']) {
    assert.equal(service.filterAndSort(papers,{sort}).map(paper=>paper.id).join(','),'W4,W3,W1,W2');
  }
  assert.match(service.rankingExplanation(papers[0]),/引用数未知/);
  assert.equal(service.rankingExplanation(papers[1],'cited'),'OpenAlex 引用数未知');
  assert.equal(service.rankingExplanation(papers[2],'cited'),'OpenAlex 引用 0 次');
  for(const count of [-1,1.5,NaN,Infinity,'0','',false,{},Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>service.normalizeWork(work('W9','Invalid',{cited_by_count:count})),/引用数.*非负整数/);
  }
});

test('reference lookup batches beyond OpenAlex per-request limit without truncation',async()=>{
  const ids=Array.from({length:101},(_,index)=>`W${index+1}`),sizes=[];
  const papers=await service.fetchIDs(ids,async url=>{const filter=decodeURIComponent(new URL(url).searchParams.get('filter'));
    const batch=filter.slice('openalex:'.length).split('|');sizes.push(batch.length);return {results:batch.map(id=>work(id,`Paper ${id}`))};
  },new AbortController().signal);
  assert.equal(papers.length,101);assert.equal(sizes.join(','),'100,1');
});

test('discovery filters and explainable sorts are deterministic',()=>{
  const papers=[
    {id:'W1',title:'Older connected',year:2020,workType:'article',sourceType:'journal',pdfURL:'pdf',citedByCount:30,relations:['reference','related'],seedTitles:['A','B'],libraryStatus:'new'},
    {id:'W2',title:'New conference',year:2025,workType:'article',sourceType:'conference',pdfURL:'',citedByCount:2,relations:['citation'],seedTitles:['A'],libraryStatus:'existing'},
    {id:'W3',title:'Popular preprint',year:2024,workType:'preprint',sourceType:'repository',pdfURL:'pdf',citedByCount:50,relations:['related'],seedTitles:['A'],libraryStatus:'pdf'}
  ];
  assert.equal(service.filterAndSort(papers,{type:'journal',oaOnly:true,library:'new'}).map(p=>p.id).join(','),'W1');
  assert.equal(service.filterAndSort(papers,{yearFrom:2024,relation:'related',sort:'cited'}).map(p=>p.id).join(','),'W3');
  assert.equal(service.filterAndSort(papers,{sort:'latest'}).map(p=>p.id).join(','),'W2,W3,W1');
  assert.match(service.rankingExplanation(papers[0]),/关联 2 篇种子.*命中 2 类关系.*引用 30 次/);
  assert.throws(()=>service.filterAndSort(papers,{sort:'unknown'}),/未知/);
});

test('library markers distinguish new, existing and local PDF papers',async()=>{
  const item=(id,doi,attachments=[])=>({id,isRegularItem:()=>true,getField:key=>key==='DOI'?doi:'',getAttachments:()=>attachments});
  const items=[item(1,'10.1000/existing'),item(2,'10.1000/pdf',[20])];
  const attachment={attachmentContentType:'application/pdf',isFileAttachment:()=>true,fileExists:async()=>true};
  const Zotero={Libraries:{userLibraryID:1},Items:{getAll:async()=>items,getAsync:async ids=>ids.map(()=>attachment)}};
  const papers=[{id:'W1',doi:'10.1000/new'},{id:'W2',doi:'10.1000/existing'},{id:'W3',doi:'10.1000/pdf'}];
  await service.markLibraryStatus(Zotero,papers);
  assert.equal(papers.map(p=>p.libraryStatus).join(','),'new,existing,pdf');
});

test('OpenAlex identity participates in Zotero deduplication',()=>{
  assert.equal(core.identities({openalexID:'W123'}).has('openalex:W123'),true);
  assert.equal(core.identities({extra:'OpenAlex ID: W123'}).has('openalex:W123'),true);
  assert.equal(core.identities({openalexID:'bad'}).size,0);
});

test('discovered papers import with OpenAlex provenance, reasons and deduplication fields',async()=>{
  const saved=[],notes=[];let next=1;
  class Item {
    constructor(type){this.type=type;this.fields={};this.tags=[];this.creators=[];this.id=0;}
    setField(key,value){this.fields[key]=value;}getField(key){return this.fields[key]||'';}
    setCreators(value){this.creators=value;}addTag(value){this.tags.push(value);}addToCollection(){}
    async save(){if(!this.id)this.id=next++;saved.push(this);return this.id;}isRegularItem(){return this.type!=='note';}
    getNotes(){return [];}setNote(value){this.note=value;notes.push(value);}getNote(){return this.note||'';}
  }
  const Zotero={Libraries:{userLibraryID:1},Collections:{get:()=>null},Items:{getAll:async()=>[],getAsync:async()=>[]},
    DB:{executeTransaction:async fn=>fn()},Item};
  const paper={...service.normalizeWork(work('W20','Found Paper',{doi:'https://doi.org/10.1000/found'})),
    relations:['reference','related','coupling','cocitation'],seedTitles:['Seed <Paper>'],
    relationEvidence:[{seedID:'W1',seedTitle:'Seed <Paper>',relation:'reference'},
      {seedID:'W1',seedTitle:'Seed <Paper>',relation:'coupling',via:['W90']},
      {seedID:'W1',seedTitle:'Seed <Paper>',relation:'cocitation',via:['W91']}]};
  const result=await service.importPapers(Zotero,[paper],{signal:new AbortController().signal});
  assert.equal(result.results[0].status,'created');assert.equal(saved[0].type,'journalArticle');
  assert.match(saved[0].fields.extra,/OpenAlex ID: W20/);assert.equal(saved[0].tags.includes('search4paper:discovered'),true);
  assert.match(notes[0],/参考文献/);assert.match(notes[0],/Seed &lt;Paper&gt;/);assert.doesNotMatch(notes[0],/Seed <Paper>/);
  assert.match(notes[0],/种子论文的参考文献：Seed &lt;Paper&gt; \(W1\)/);
  assert.match(notes[0],/与种子共享参考文献.*证据 OpenAlex ID：W90/);
  assert.match(notes[0],/与种子共同被引用.*证据 OpenAlex ID：W91/);
});

test('multi-seed evidence retains exact seed IDs and relationship pairings, including same-title seeds',async()=>{
  const seeds=[work('W1','Same seed',{referenced_works:['https://openalex.org/W3']}),work('W2','Same seed')];
  const items=seeds.map(seed=>({isRegularItem:()=>true,deleted:false,getField:key=>({extra:`OpenAlex ID: ${service.id(seed.id)}`,title:seed.title}[key]||'')}));
  const candidate=work('W3','Candidate',{referenced_works:['https://openalex.org/W2']});
  const result=await service.expand(items,Zotero,{request:async url=>{
    if(url.includes('/works/W1?'))return seeds[0];
    if(url.includes('/works/W2?'))return seeds[1];
    if(url.includes('filter=openalex%3AW3')||url.includes('filter=cites:W2'))return {results:[candidate]};
    if(url.includes('filter=cites:W1'))return {results:[]};
    throw Error('Unexpected request '+url);
  }});
  const evidence=result.papers[0].relationEvidence;
  assert.equal(evidence.map(entry=>`${entry.seedID}:${entry.relation}`).join(','),'W1:reference,W2:citation');
  assert.equal(result.papers[0].seedTitles.length,1,'Legacy title-based ordering remains unchanged');
  const graph=graphService.build(result.seeds,result.papers,{coupling:false,related:false});
  assert.deepEqual(graph.edges.map(edge=>`${edge.source}->${edge.target}`).sort(),['W1->W3','W3->W2']);
  assert.equal(graph.nodes.length,3);
});

const normalized=(id,title,changes={})=>service.normalizeWork(work(id,title,changes));

test('graph exposes unknown citation counts explicitly while keeping zero known and node geometry finite',()=>{
  const seed=normalized('W1','Unknown seed',{cited_by_count:null});
  const missing=normalized('W2','Unknown candidate',{cited_by_count:undefined});
  const zero=normalized('W3','Zero citations',{cited_by_count:0});
  const cited=normalized('W4','Known citations',{cited_by_count:100});
  const cy=cytoscape({headless:true,elements:graphService.elements(graphService.build([seed],[missing,zero,cited]))});
  try {
    for(const id of ['W1','W2']) {
      const node=cy.getElementById(id);
      assert.equal(node.data('citedByCount'),null);
      assert.equal(node.hasClass('citations-unknown'),true);
      assert.match(node.data('label'),/引用未知/);
    }
    const knownZero=cy.getElementById('W3');
    assert.equal(knownZero.data('citedByCount'),0);
    assert.equal(knownZero.hasClass('citations-unknown'),false);
    assert.doesNotMatch(knownZero.data('label'),/引用未知/);
    assert.ok(cy.getElementById('W4').data('size')>knownZero.data('size'));
    graphService.layout(cy);
    for(const node of cy.nodes())assert.ok(Number.isFinite(node.data('size'))&&Number.isFinite(node.position('x'))&&Number.isFinite(node.position('y')));
  } finally {cy.destroy();}
});

test('graph contains candidate cross-citations, deduplicated recommendations and no self or dangling edges',()=>{
  const seed=normalized('W1','Seed',{referenced_works:['https://openalex.org/W2'],related_works:['https://openalex.org/W3']});
  const a=normalized('W2','A',{referenced_works:['https://openalex.org/W2','https://openalex.org/W3','https://openalex.org/W99']});
  const b=normalized('W3','B',{related_works:['https://openalex.org/W1']});
  const graph=graphService.build([seed],[a,b],{coupling:false});
  assert.deepEqual(graph.edges.filter(edge=>edge.kind==='citation').map(edge=>`${edge.source}->${edge.target}`),['W1->W2','W2->W3']);
  const related=graph.edges.filter(edge=>edge.kind==='related');
  assert.equal(related.length,1);assert.deepEqual(related[0].evidence,['W1','W3']);
  assert.equal(graph.edges.some(edge=>edge.source===edge.target||edge.target==='W99'),false);
  assert.equal(a.referencedWorks.length,3,'Graph construction must not rewrite discovery metadata');
});

test('Jaccard uses unique full reference sets, including evidence outside the displayed graph',()=>{
  const a=normalized('W1','A',{referenced_works:['https://openalex.org/W10','https://openalex.org/W20','https://openalex.org/W20']});
  const b=normalized('W2','B',{referenced_works:['https://openalex.org/W20','https://openalex.org/W30']});
  const graph=graphService.build([a],[b],{citations:false,related:false,minSimilarity:1/3});
  assert.equal(graph.edges.length,1);
  assert.equal(graph.edges[0].score,1/3);assert.equal(graph.edges[0].unionCount,3);
  assert.deepEqual(graph.edges[0].evidence,['W20']);
  assert.equal(graphService.build([a],[b],{minSimilarity:0.34}).edges.length,0);
  const missing=normalized('W3','Missing',{referenced_works:undefined});
  const empty=normalized('W4','Known empty');
  const partial=graphService.build([a],[missing,empty],{minSimilarity:0});
  assert.equal(partial.missingReferences,1);assert.equal(partial.edges.length,0);
});

test('node cap applies only to ordered candidates and filters cannot drop seeds or invent edges',()=>{
  const seed=normalized('W1','Seed',{referenced_works:['https://openalex.org/W3']});
  const a=normalized('W2','A'),b=normalized('W3','B');
  const graph=graphService.build([seed,seed],[a,b],{limit:1});
  assert.deepEqual(graph.nodes.map(node=>node.paper.id),['W1','W2']);
  assert.equal(graph.seedCount,1);assert.equal(graph.candidateCount,2);assert.equal(graph.shownCandidates,1);
  assert.equal(graph.edges.length,0);assert.equal(graphService.build([seed],[]).nodes.length,1);
  assert.deepEqual(graphService.build([seed],[b,a],{limit:1}).nodes.map(node=>node.paper.id),['W1','W3']);
  for(const options of [{limit:0},{limit:201},{limit:1.2},{minSimilarity:NaN},{minSimilarity:-1},{minSimilarity:1.1}]) {
    assert.throws(()=>graphService.build([seed],[a],options),/图谱|相似度/);
  }
});

test('graph layers remain independent and Cytoscape preserves node IDs, directions and finite positions',()=>{
  const seed=normalized('W1','<Seed>',{referenced_works:['https://openalex.org/W2','https://openalex.org/W9'],related_works:['https://openalex.org/W2']});
  const candidate=normalized('W2','Candidate',{referenced_works:['https://openalex.org/W9']});
  for(const kind of ['citation','related','coupling']) {
    const graph=graphService.build([seed],[candidate],{citations:kind==='citation',related:kind==='related',coupling:kind==='coupling'});
    assert.equal(graph.edges.length,1);assert.equal(graph.edges[0].kind,kind);
  }
  const graph=graphService.build([seed],[candidate]);
  const cy=cytoscape({headless:true,elements:graphService.elements(graph)});
  try {
    graphService.layout(cy);
    assert.equal(cy.nodes().length,2);assert.equal(cy.edges().length,3);
    assert.equal(cy.getElementById('citation:W1:W2').source().id(),'W1');
    assert.equal(cy.getElementById('citation:W1:W2').target().id(),'W2');
    assert.equal(cy.getElementById('W1').data('title'),'<Seed>');
    for(const node of cy.nodes())assert.ok(Number.isFinite(node.position('x'))&&Number.isFinite(node.position('y')));
  } finally { cy.destroy(); }
});

test('co-citation uses unique observed witnesses outside the displayed graph and ranks before the node cap',()=>{
  const seed=normalized('W1','Seed',{referenced_works:['W8']});
  const close=normalized('W2','Close',{referenced_works:['W9']});
  const popular=normalized('W3','Popular',{referenced_works:['W7'],cited_by_count:10000});
  const witness=normalized('W100','Witness',{referenced_works:['W1','W2','W2']});
  const another=normalized('W101','Another',{referenced_works:['W1','W2']});
  const unrelated=normalized('W102','Other witness',{referenced_works:['W3']});
  const candidates=[popular,close];
  const analysis=graphService.analyze([seed],candidates,[witness,witness,another,unrelated]);
  const pair=analysis.seedScores.get('W2');
  assert.equal(pair.bibliographic.score,0);assert.equal(pair.cocitation.score,1);assert.equal(pair.score,0.5);
  assert.deepEqual(pair.cocitation.evidence,['W100','W101']);
  const options={analysis,selection:'similarity',limit:1,citations:false,related:false,coupling:false,cocitation:true};
  const graph=graphService.build([seed],candidates,options);
  assert.deepEqual(graph.nodes.map(node=>node.paper.id),['W1','W2']);
  assert.equal(graph.edges[0].kind,'cocitation');assert.equal(graph.edges[0].unionCount,2);
  assert.deepEqual(graph.edges[0].evidence,['W100','W101']);
  assert.deepEqual(candidates.map(paper=>paper.id),['W3','W2'],'Ranking must not mutate the original list');
  assert.equal(graphService.build([seed],[close],options).edges[0].score,1,'Filtering nodes preserves the observed corpus');
  assert.equal(graphService.build([seed],candidates,{...options,selection:'list'}).nodes[1].paper.id,'W3');
  const cy=cytoscape({headless:true,elements:graphService.elements(graph)});
  try { graphService.layout(cy);assert.ok(cy.nodes().every(node=>Number.isFinite(node.position('x')))); }
  finally { cy.destroy(); }
});

test('missing references leave joint similarity unknown without erasing observed co-citation',()=>{
  const seed=normalized('W1','Seed'), missing=normalized('W2','Missing',{referenced_works:undefined});
  const witness=normalized('W100','Witness',{referenced_works:['W1','W2']});
  const unavailable=normalized('W101','Unavailable witness',{referenced_works:undefined});
  const analysis=graphService.analyze([seed],[missing],[witness,unavailable]);
  const score=analysis.seedScores.get('W2');
  assert.equal(score.bibliographic,null);assert.equal(score.cocitation.score,1);assert.equal(score.score,null);
  assert.equal(analysis.missingWitnessReferences,2);
  const graph=graphService.build([seed],[missing],{analysis,cocitation:true});
  assert.equal(graph.edges.length,1);assert.equal(graph.edges[0].kind,'cocitation');
  assert.equal(graph.edges[0].combinedScore,null);
  assert.throws(()=>graphService.build([seed],[missing],{selection:'unknown'}),/选点/);
});

test('joint score weights are fixed and multi-seed ranking records the actual closest seed ID',()=>{
  const a=normalized('W1','Same seed',{referenced_works:['W10']});
  const b=normalized('W2','Same seed',{referenced_works:['W20']});
  const candidate=normalized('W3','Candidate',{referenced_works:['W20']});
  const analysis=graphService.analyze([a,b],[candidate]);
  const score=analysis.seedScores.get('W3');
  assert.equal(score.seedID,'W2');assert.equal(score.bibliographic.score,1);
  assert.equal(score.cocitation.score,0);assert.equal(score.score,0.5);
});

test('bounded citing queries use two 100-result pages, expose truncation and propagate failures/cancellation',async()=>{
  const pages=[];
  const result=await service.fetchCiting(['W1'],async url=>{
    const params=new URL(url).searchParams,page=Number(params.get('page'));pages.push(page);
    assert.equal(params.get('per-page'),'100');assert.equal(params.get('filter'),'cites:W1');
    return {meta:{count:250},results:Array.from({length:100},(_,i)=>work(`W${page*1000+i}`,'Citer',{referenced_works:['W1']}))};
  });
  assert.equal(pages.join(','),'1,2');assert.equal(result.papers.length,200);assert.equal(result.total,250);assert.equal(result.truncated,true);
  await assert.rejects(()=>service.fetchCiting(['W1'],async()=>({results:[]})),/总数无效/);
  await assert.rejects(()=>service.fetchCiting(['W1'],async()=>{throw Error('HTTP failure');}),/HTTP failure/);
  const controller=new AbortController();let calls=0;
  await assert.rejects(()=>service.fetchCiting(['W1'],async()=>{
    calls++;controller.abort();return {meta:{count:0},results:[]};
  },controller.signal),{name:'AbortError'});
  assert.equal(calls,1);
});

test('deep expansion finds both second-hop paths with exact evidence while leaving basic results unchanged',async()=>{
  const seed=normalized('W1','Seed',{referenced_works:['W10']});
  const citer={...normalized('W2','Seed citer',{referenced_works:['W1','W20']}),
    relations:['citation'],seedTitles:['Seed'],relationEvidence:[{seedID:'W1',seedTitle:'Seed',relation:'citation'}]};
  const basic={seeds:[seed],papers:[citer],citationLimitPerSeed:50};
  const before=JSON.stringify(basic),requests=[];
  const result=await service.expandSimilarity(basic,{request:async url=>{
    requests.push(url);const params=new URL(url).searchParams,filter=params.get('filter');
    if(filter==='cites:W10')return {meta:{count:1},results:[work('W3','Shared reference',{referenced_works:['W10']})]};
    if(filter==='openalex:W20')return {results:[work('W20','Co-cited',{referenced_works:['W30']})]};
    if(params.get('select')==='id,title,referenced_works')return {meta:{count:1},results:[work('W90','External witness',{referenced_works:['W1','W3','W20']})]};
    throw Error('Unexpected request '+url);
  }});
  assert.equal(JSON.stringify(basic),before);
  assert.equal(result.coverage.newCandidates,2);assert.equal(requests.length,3);
  const coupled=result.papers.find(p=>p.id==='W3'),cocited=result.papers.find(p=>p.id==='W20');
  assert.equal(coupled.relations.join(','),'coupling');assert.equal(coupled.relationEvidence[0].via.join(','),'W10');
  assert.equal(cocited.relations.join(','),'cocitation');assert.equal(cocited.relationEvidence[0].via.join(','),'W2');
  assert.equal(result.papers.some(p=>p.id==='W90'),false,'Citing evidence is not automatically imported as a candidate');
  const analysis=graphService.analyze(result.seeds,result.papers,result.evidencePapers);
  assert.equal(analysis.seedScores.get('W20').cocitation.evidence.join(','),'W2,W90');
  assert.equal(result.coverage.evidenceQueries[0].truncated,false);
  await assert.rejects(()=>service.expandSimilarity(basic,{request:async()=>{throw Error('Network failure');}}),/Network failure/);
  assert.equal(JSON.stringify(basic),before,'A failed deep query must not mutate the original result');
});

test('deep expansion reports entry, candidate, and citing-evidence caps plus unresolved metadata',async()=>{
  const seed=normalized('W1','Seed',{referenced_works:Array.from({length:101},(_,i)=>`W${1000+i}`)});
  const citer={...normalized('W2','Citer',{referenced_works:['W1',...Array.from({length:101},(_,i)=>`W${3000+i}`)]}),
    relations:['citation'],seedTitles:['Seed'],relationEvidence:[]};
  let evidenceCalls=0;
  const result=await service.expandSimilarity({seeds:[seed],papers:[citer],citationLimitPerSeed:50},{request:async url=>{
    const p=new URL(url).searchParams,filter=p.get('filter');
    if(p.get('select')==='id,title,referenced_works') {
      evidenceCalls++;
      return {meta:{count:500},results:[work('W9000','Witness',{referenced_works:['W1']})]};
    }
    if(filter.startsWith('cites:')) {
      assert.equal(filter.slice(6).split('|').length,100);
      return {meta:{count:101},results:Array.from({length:p.get('page')==='1'?100:1},(_,i)=>work(
        `W${2000+(p.get('page')==='1'?i:100)}`,'Coupled',{referenced_works:['W1000']}))};
    }
    const ids=filter.slice('openalex:'.length).split('|');assert.equal(ids.length,100);
    return {results:ids.slice(0,99).map(id=>work(id,'Co-cited'))};
  }});
  const row=result.coverage.expansion[0];
  assert.equal(row.referenceCount,101);assert.equal(row.queriedReferences,100);
  assert.equal(row.couplingOmitted,1);assert.equal(row.cocitedOmitted,1);
  assert.equal(result.coverage.missingDetails.length,1);assert.equal(result.coverage.newCandidates,199);
  assert.equal(evidenceCalls,6);assert.ok(result.coverage.evidenceQueries.every(row=>row.truncated));
});
