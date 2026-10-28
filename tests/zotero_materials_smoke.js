/* In an isolated Zotero 10 profile, pass the loaded plugin window and exact data directory.
 * Uses real child notes and transactions, with deterministic source responses; erases only its own test items.
 */
async function runSearch4PaperMaterialsSmoke(win, { expectedDataDir }) {
  const ui=win.Search4PaperUI,Zotero=ui.Zotero,service=win.Search4PaperMaterials;
  if(!expectedDataDir||Zotero.DataDirectory.dir!==expectedDataDir)throw Error('An explicit isolated test data directory is required');
  let assertions=0;const created=[],request=ui.request;
  const check=(ok,message)=>{assertions++;if(!ok)throw Error(message);};
  const untilIdle=async()=>{
    const start=Date.now();while(ui.busy){if(Date.now()-start>10000)throw Error('Material operation timed out');await Zotero.Promise.delay(20);}
  };
  try{
    const paper=new Zotero.Item('conferencePaper');paper.libraryID=Zotero.Libraries.userLibraryID;
    paper.setField('title','search4paper material smoke graph method');paper.setField('url','https://example.org/papers/graph/');
    paper.setField('abstractNote','Our code: https://github.com/example/graph.');await paper.saveTx();created.push(paper.id);
    const other=new Zotero.Item('conferencePaper');other.libraryID=paper.libraryID;other.setField('title','Another selected paper');
    await other.saveTx();created.push(other.id);
    const page='<meta name="citation_title" content="search4paper material smoke graph method"><main>'
      +'<p>We release our implementation at <a href="https://github.com/example/graph">Code</a>.</p>'
      +'<p>Extra experiments: <a href="supplement.zip">Supplementary material</a>.</p></main>';
    let docsOnly=false;
    const repositoryRequest=async(url,_signal,type)=>{
      if(type==='html')return {body:page,url:paper.getField('url')};
      if(url==='https://api.github.com/repos/example/graph')return {html_url:'https://github.com/example/graph',private:false,default_branch:'main'};
      if(url.includes('/git/trees/'))return {sha:'a'.repeat(40),truncated:false,tree:[
        {path:'README.md',type:'blob',mode:'100644',size:30,sha:'b'.repeat(40)},
        ...docsOnly?[]:[{path:'src/train.py',type:'blob',mode:'100644',size:12,sha:'c'.repeat(40)}]
      ]};
      if(url.includes('/git/blobs/'))return {encoding:'base64',content:win.btoa(url.endsWith('b'.repeat(40))
        ? docsOnly?'Code coming soon.':'Training instructions':'print("train")')};
      throw Error('Unexpected request '+url);
    };
    ui.request=repositoryRequest;
    await Zotero.getActiveZoteroPane().selectItems([paper.id]);ui.$('tab-materials').click();ui.$('materials-find').click();await untilIdle();
    check(ui.materialCandidates.length===1,ui.$('materials-status').textContent);
    check(ui.materialCandidates[0].evidence.length===2,'same link from abstract and page retains both sources');
    check(ui.$('materials-results').children.length===1,'only code links render; supplements are excluded');
    check(ui.$('materials-results').querySelectorAll('td')[3].textContent.includes('Our code:'),'original paper evidence visible');
    check(ui.$('page-title').textContent==='代码仓库','feature name focuses on code repositories');
    check(ui.$('materials-results').textContent.includes('发现非空代码文件'),'repository status visible');
    check(ui.$('materials-results').textContent.includes('src/train.py')&&ui.$('materials-results').textContent.includes('print("train")'),'actual file names and source text visible');
    check(ui.materialSelected.size===0&&ui.$('materials-save').disabled,'no automatic confirmation');
    check(paper.getNotes().length===0,'discovery never writes to library');
    const candidate=ui.materialCandidates[0],target=ui.materialTarget;
    const checkbox=ui.$('materials-results').querySelector('input');checkbox.click();
    check(ui.materialSelected.size===1&&!ui.$('materials-save').disabled,'checkbox enables explicit confirmation');
    await Zotero.getActiveZoteroPane().selectItems([other.id]);ui.$('materials-save').click();await untilIdle();
    check(paper.getNotes().length===1&&other.getNotes().length===0,'main-window selection change cannot redirect the saved note');
    const saved=await Zotero.Items.getAsync(paper.getNotes()[0]);
    check(saved.getNote().includes('We release our implementation at Code.'),'native note preserves exact source text');
    check(service.savedURL(saved.getNote())===candidate.url,'native note round trip retains material identity');
    check(saved.getNote().includes('https://example.org/papers/graph/'),'native note preserves source URL');
    check(saved.getNote().includes('发现非空代码文件')&&saved.getNote().includes('检查时间'),'native note preserves repository check and time');
    saved.setNote(saved.getNote()+'<p>USER ANNOTATION: preserve this text</p>');await saved.saveTx();
    const before=saved.getNote(),duplicate=await service.saveConfirmed(Zotero,target,[candidate]);
    check(duplicate[0].status==='existing'&&paper.getNotes().length===1,'repeat confirmation does not duplicate notes');
    check(saved.getNote()===before,'repeat confirmation preserves user annotations');
    check(ui.$('materials-save').disabled&&ui.$('materials-results').textContent.includes('已关联'),'confirmed state shown and selection cleared');

    const count=()=>Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM itemNotes WHERE parentItemID=?',[paper.id]);
    const initial=await count(),save=Zotero.Item.prototype.save;let failed=false;
    try{
      Zotero.Item.prototype.save=async function(...args){
        if(this.isNote()&&this.parentID===paper.id&&this.getNote().includes('rollback-second'))throw Error('Injected note write failure');
        return save.apply(this,args);
      };
      await service.saveConfirmed(Zotero,target,[{...candidate,url:'https://example.org/rollback-first'},{...candidate,url:'https://example.org/rollback-second'}]);
    }catch(error){failed=error.message.includes('Injected');}
    finally{Zotero.Item.prototype.save=save;}
    check(failed&&await count()===initial,'failed confirmation rolls back the whole selected batch');

    await Zotero.getActiveZoteroPane().selectItems([paper.id]);
    docsOnly=true;ui.$('materials-find').click();await untilIdle();
    check(ui.materialCandidates[0].repository.state==='docs'&&ui.$('materials-results').textContent.includes('coming soon'),'fresh check distinguishes README-only placeholder');
    check(ui.$('materials-status').textContent.includes('0 个 GitHub 仓库发现非空代码文件'),'README presence never counts as released code');
    check(saved.getNote()===before,'rechecking the repository does not rewrite a confirmed note');
    ui.request=async()=>{throw Error('Injected HTTP 403');};ui.$('materials-find').click();await untilIdle();
    check(!ui.materialCandidates.length&&ui.$('materials-save').disabled,'failed new extraction clears stale candidates');
    check(ui.$('materials-status').textContent.includes('403')&&ui.$('materials-coverage').textContent.includes('未完成'),'failure is visible, not an empty successful search');
    ui.request=async(_url,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));
    ui.$('materials-find').click();ui.$('materials-cancel').click();await untilIdle();
    check(ui.$('materials-status').textContent.includes('取消')&&!ui.materialCandidates.length,'cancel leaves no unconfirmed candidate set');
    return {ok:true,assertions,zotero:Zotero.version};
  }finally{
    ui.request=request;
    if(created.length)await Zotero.Items.erase(created);
  }
}
