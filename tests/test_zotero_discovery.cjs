const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const core=require('../zotero-plugin/content/core.js');

const scope={URL,Search4PaperCore:core};
vm.runInNewContext(readFileSync(require.resolve('../zotero-plugin/content/discovery.js'),'utf8'),scope);
const service=scope.Search4PaperDiscovery;
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

test('reference lookup batches beyond OpenAlex per-request limit without truncation',async()=>{
  const ids=Array.from({length:101},(_,index)=>`W${index+1}`),sizes=[];
  const papers=await service.fetchIDs(ids,async url=>{const filter=decodeURIComponent(new URL(url).searchParams.get('filter'));
    const batch=filter.slice('openalex:'.length).split('|');sizes.push(batch.length);return {results:batch.map(id=>work(id,`Paper ${id}`))};
  },new AbortController().signal);
  assert.equal(papers.length,101);assert.equal(sizes.join(','),'100,1');
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
    relations:['reference','related'],seedTitles:['Seed <Paper>']};
  const result=await service.importPapers(Zotero,[paper],{signal:new AbortController().signal});
  assert.equal(result.results[0].status,'created');assert.equal(saved[0].type,'journalArticle');
  assert.match(saved[0].fields.extra,/OpenAlex ID: W20/);assert.equal(saved[0].tags.includes('search4paper:discovered'),true);
  assert.match(notes[0],/参考文献/);assert.match(notes[0],/Seed &lt;Paper&gt;/);assert.doesNotMatch(notes[0],/Seed <Paper>/);
});
