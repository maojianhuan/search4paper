const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const core=require('../zotero-plugin/content/core.js');
const scope={URL,TextDecoder,atob,Search4PaperCore:core};
for(const file of ['abstract','materials'])vm.runInNewContext(readFileSync(require.resolve(`../zotero-plugin/content/${file}.js`),'utf8'),scope);
const service=scope.Search4PaperMaterials;
const paper={itemID:1,libraryID:1,title:'Exact Graph Paper',url:'https://openreview.net/forum?id=Note1',extra:'',abstract:'',doi:''};
const note=changes=>({id:'Note1',content:{title:{value:paper.title},code:{value:'https://github.com/example/graph'},...changes}});
const candidate={url:'https://github.com/example/graph',label:'字段 code',evidence:[{source:'OpenReview 论文记录',sourceURL:paper.url,location:'字段 code',quote:'https://github.com/example/graph'}]};
const gitFile=(path,text,index=1)=>({path,type:'blob',mode:'100644',size:Buffer.byteLength(text),sha:String(index).padStart(40,'0'),text});
function githubRequest(files,{truncated=false}={}){
  return async url=>{
    if(url==='https://api.github.com/repos/example/graph')return {html_url:candidate.url,private:false,default_branch:'main'};
    if(url.endsWith('/git/trees/main?recursive=1'))return {sha:'a'.repeat(40),truncated,tree:files};
    const file=files.find(file=>url.endsWith('/git/blobs/'+file.sha));
    assert.ok(file,'unexpected GitHub endpoint '+url);
    return {encoding:'base64',content:Buffer.from(file.text).toString('base64')};
  };
}

test('material discovery uses an exact OpenReview record and preserves the original field evidence',async()=>{
  const calls=[],github=githubRequest([gitFile('train.py','print("training")')]);
  const result=await service.discover({...paper,abstract:'Code: https://github.com/example/graph.'},{request:async(url,signal,type)=>{
    calls.push([url,type]);if(url.startsWith('https://api.github.com/'))return github(url);
    return {notes:[note({link_to_code:{value:'https://github.com/example/graph'},supplementary_material:{value:'/attachment/paper-supp.zip'},
      code_of_ethics:{value:'https://example.org/ethics'},review:{value:'https://example.org/reviewer-code'}})]};
  }});
  assert.equal(calls.length,4);assert.equal(calls[0][1],'json');
  const endpoint=new URL(calls[0][0]);assert.equal(endpoint.pathname,'/notes/search');
  assert.equal(endpoint.searchParams.get('term'),paper.title);assert.equal(endpoint.searchParams.get('type'),'exact');
  assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].evidence.length,3);
  assert.equal(result.candidates[0].evidence[0].quote,'Code: https://github.com/example/graph.');
  assert.equal(result.candidates[0].repository.state,'code');
  assert.equal(result.candidates[0].repository.samples[0].text,'print("training")');
  assert.ok(!result.candidates.some(c=>c.url.includes('ethics')||c.url.includes('reviewer')));
});

test('wrong, ambiguous and mismatched OpenReview records cannot provide candidates',async()=>{
  for(const notes of [[],[{...note(),id:'Other'}],[note(),note()],[note({title:{value:'Another paper'}})]])
    assert.throws(()=>service.fromOpenReview({notes},paper,'Note1'),/指定论文|不一致/);
  await assert.rejects(service.discover({...paper,extra:'OpenReview ID: Other'},
    {request:()=>{throw Error('must not request');}}),/冲突/);
  assert.equal(service.openReviewID({...paper,url:'https://openreview.net.evil.example/forum?id=Other'}),'');
  const match=service.fromOpenReview({notes:[{...note(),id:'Other'},note()]},paper,'Note1');
  assert.equal(match.length,1);assert.equal(match[0].evidence[0].sourceURL,paper.url);
});

test('text links retain evidence, strip sentence delimiters and merge repeated links without losing sources',()=>{
  const raw='Code [repo](https://github.com/org/repo). 数据：https://example.org/data，另见 https://example.org/a_(b)。';
  const links=service.textLinks(raw);
  assert.deepEqual(Array.from(links,l=>l.url),['https://github.com/org/repo','https://example.org/data','https://example.org/a_(b)']);
  const repeated=service.merge([candidate,candidate,{...candidate,evidence:[{...candidate.evidence[0],location:'字段 abstract',quote:'Our code is at '+candidate.url}]}]);
  assert.equal(repeated.length,1);assert.equal(repeated[0].evidence.length,2);
  for(const url of ['javascript:alert(1)','file:///tmp/repo','data:text/html,code','https://user:password@example.org/code',''])assert.equal(service.httpURL(url),'');
  assert.equal(service.httpURL(undefined,'https://example.org/paper'),'');
});

test('abstract-only coverage is explicit and known PDF sources are not requested',async()=>{
  for(const url of ['', 'https://example.org/paper.pdf', 'https://arxiv.org/pdf/2601.00001']){
    const result=await service.discover({...paper,url,abstract:'Code: https://example.org/code.'},
      {request:()=>{throw Error('must not request a PDF or search engine');}});
    assert.equal(result.candidates.length,1);assert.ok(result.checked.some(s=>s.includes('仅检查条目摘要')));
    assert.equal(result.candidates[0].repository.state,'manual');
  }
  const empty=await service.discover({...paper,url:''},{request:()=>{throw Error('no request');}});
  assert.equal(empty.candidates.length,0);
  const self=await service.discover({...paper,abstract:paper.url},{request:async()=>({notes:[note({code:undefined})]})});
  assert.equal(self.candidates.length,0);
});

test('network failures and cancellation cannot be turned into an empty successful discovery',async()=>{
  await assert.rejects(service.discover(paper,{request:async()=>{throw Error('HTTP 403');}}),/403/);
  const signal=new AbortController();
  await assert.rejects(service.discover(paper,{signal:signal.signal,request:async()=>{
    signal.abort();return {notes:[note()]};
  }}),/abort/i);
});

test('confirmation notes escape quotes and record provenance without claiming reproducibility',()=>{
  const html=service.noteHTML({...paper,title:'<img src=x onerror=alert(1)>'},{...candidate,evidence:[{...candidate.evidence[0],quote:'<script>bad()</script> & "our code"'}]},'2026-09-29T00:00:00Z');
  assert.ok(html.includes('用户确认'));assert.ok(html.includes('未验证官方归属'));
  assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('2026-09-29T00:00:00Z'));assert.ok(html.includes(paper.url));
  for(const changed of [{url:'javascript:alert(1)'},{evidence:[]},{evidence:[{...candidate.evidence[0],quote:''}]},
    {evidence:[{...candidate.evidence[0],sourceURL:'file:///tmp/private'}]}])assert.throws(()=>service.noteHTML(paper,{...candidate,...changed},'now'),/证据|链接|来源/);
});

test('confirmation requires an editable existing parent and writes only child evidence notes',async()=>{
  const written=[],parent={id:1,libraryID:1,deleted:false,isRegularItem:()=>true,getNotes:()=>[]};let transactions=0;
  const Zotero={Items:{getAsync:async id=>Array.isArray(id)?[]:parent},Libraries:{get:()=>({editable:true})},
    DB:{executeTransaction:async fn=>{transactions++;await fn();}},Item:class {constructor(type){assert.equal(type,'note');}setNote(value){this.html=value;}async save(){written.push(this);}}};
  await assert.rejects(service.saveConfirmed(Zotero,paper,[]),/勾选/);assert.equal(transactions,0);
  const saved=await service.saveConfirmed(Zotero,paper,[candidate]);
  assert.equal(saved[0].status,'created');assert.equal(written.length,1);assert.equal(written[0].parentID,1);assert.equal(written[0].libraryID,1);
  Zotero.Libraries.get=()=>({editable:false});
  await assert.rejects(service.saveConfirmed(Zotero,paper,[candidate]),/不可编辑/);
  parent.deleted=true;await assert.rejects(service.saveConfirmed(Zotero,paper,[candidate]),/不可用/);
  assert.equal(written.length,1);
});

test('GitHub identity normalizes deep links and rejects profiles, site routes and lookalike hosts',()=>{
  for(const url of [candidate.url,candidate.url+'.git',candidate.url+'/tree/dev/src',candidate.url+'/blob/main/train.py#L10'])
    assert.equal(service.githubRepo(url).url,candidate.url);
  for(const url of ['https://github.com/example','https://github.com/topics/deep-learning','https://github.com/orgs/example/repositories',
    'https://github.com.evil.example/example/graph','https://github.com:444/example/graph','javascript:alert(1)'])assert.equal(service.githubRepo(url),null);
  assert.equal(service.codeCandidate({...candidate,url:'https://example.org/supp.pdf',evidence:[{location:'链接文字：Supplementary material',quote:'Supplementary material'}]}),false);
});

test('README-only and empty source files never count as publicly present code',async()=>{
  const files=[gitFile('README.md','# Graph\nCode coming soon. 项目尚未公开代码。'),gitFile('train.py','',2)];
  const result=await service.inspectGitHub(candidate.url,{request:githubRequest(files)});
  assert.equal(result.state,'docs');assert.equal(result.codeCount,0);assert.equal(result.fileCount,2);
  assert.match(result.samples[0].text,/coming soon.*尚未公开代码/s);
  const html=service.noteHTML(paper,{...candidate,repository:result},'now');
  assert.match(html,/仓库内容检查/);assert.match(html,/coming soon/);assert.ok(html.includes(result.treeURL));
  const empty=await service.inspectGitHub(candidate.url,{request:githubRequest([gitFile('train.py','')])});
  assert.equal(empty.state,'empty');assert.equal(empty.codeCount,0);
});

test('nested nonempty code files are shown with byte sizes and literal source excerpts',async()=>{
  const result=await service.inspectGitHub(candidate.url,{request:githubRequest([
    gitFile('README.md','Project instructions'),gitFile('src/model.py','import torch\n# 模型\ndef forward(x): return x',2),
    gitFile('LICENSE','MIT',3),gitFile('assets/model.pt','weights',4)])});
  assert.equal(result.state,'code');assert.equal(result.codeCount,1);assert.equal(result.nonemptyCount,4);
  assert.equal(result.files[0].path,'src/model.py');assert.equal(result.files[0].size,Buffer.byteLength('import torch\n# 模型\ndef forward(x): return x'));
  assert.equal(result.files[0].url,candidate.url+'/blob/main/src/model.py');assert.match(result.samples[1].text,/# 模型/);
  assert.match(result.detail,/扩展名/);assert.ok(!result.label.includes('完整实现'));
});

test('submodules, symlinks, archives and truncated trees cannot be reported as no public code',async()=>{
  for(const files of [[{type:'commit',mode:'160000',path:'external',sha:'b'.repeat(40)}],
    [{...gitFile('train.py','../other.py'),mode:'120000'}],[gitFile('source.zip','zip bytes')],[gitFile('dataset.txt','1,2,3')]]){
    const result=await service.inspectGitHub(candidate.url,{request:githubRequest(files)});
    assert.equal(result.state,'unclassified');assert.equal(result.codeCount,0);
  }
  const partial=await service.inspectGitHub(candidate.url,{request:githubRequest([gitFile('README.md','hello')],{truncated:true})});
  assert.equal(partial.state,'partial');assert.match(partial.detail,/不.*断定/);
});

test('GitHub missing, rate-limited, broken and empty repositories have distinct evidence states',async()=>{
  for(const status of [404,403,429,500]){
    const result=await service.inspectGitHub(candidate.url,{request:async()=>{throw Object.assign(Error('unavailable'),{status});}});
    assert.equal(result.state,'unavailable');assert.equal(result.codeCount,undefined);
    assert.match(result.detail,status===404?/不存在或已设为私有/:[403,429].includes(status)?/请求受限/:/检查失败/);
  }
  for(const apiMessage of ['Git Repository is empty.','Other conflict']){
    const result=await service.inspectGitHub(candidate.url,{request:async url=>{
      if(url===service.githubRepo(candidate.url).api)return {html_url:candidate.url,private:false,default_branch:'main'};
      throw Object.assign(Error('HTTP 409'),{status:409,apiMessage});
    }});
    assert.equal(result.state,apiMessage==='Git Repository is empty.'?'empty':'unavailable');
  }
  const malformed=await service.inspectGitHub(candidate.url,{request:githubRequest([{type:'blob',mode:'100644',path:'train.py'}])});
  assert.equal(malformed.state,'unavailable');assert.match(malformed.detail,/文件清单/);
});

test('file read errors retain verified tree facts and cancellation never becomes a repository result',async()=>{
  const base=githubRequest([gitFile('main.py','print(1)')]);
  const result=await service.inspectGitHub(candidate.url,{request:async url=>{
    if(url.includes('/blobs/'))throw Error('HTTP 403');return base(url);
  }});
  assert.equal(result.state,'code');assert.match(result.samples[0].error,/403/);
  const controller=new AbortController();
  await assert.rejects(service.inspectGitHub(candidate.url,{signal:controller.signal,request:async url=>{
    controller.abort();return base(url);
  }}),/abort/i);
});

test('repository checks preserve paper evidence on failures and combine multiple branch links once',async()=>{
  let calls=0;
  const result=await service.discover({...paper,url:'',abstract:`Code: ${candidate.url}/tree/main and ${candidate.url}.`},
    {request:async()=>{calls++;throw Object.assign(Error('missing'),{status:404});}});
  assert.equal(result.candidates.length,1);assert.equal(calls,1);assert.equal(result.candidates[0].repository.state,'unavailable');
  assert.match(result.candidates[0].evidence[0].quote,/\/tree\/main/);
});
