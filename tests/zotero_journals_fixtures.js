/* Load in the plugin window; files maps names in fixtures/zotero-journals to their text. */
function runSearch4PaperJournalFixtures(files) {
  const service=Search4PaperJournalSources,core=Search4PaperCore;
  let assertions=0;const check=(ok,message)=>{assertions++;if(!ok)throw Error(message);};
  const rejects=(fn,message)=>{let failed=false;try{fn();}catch{failed=true;}check(failed,message);};
  const samples=[];
  for(const year of [2025,2026]){
    const raw=files[`jmlr-${year}-index.html`],detail=files[`jmlr-${year}-detail.html`];
    const list=service.parseJMLRIndex(raw,year),p=service.completeJMLR(list[0],detail);
    check(list.length===2,'both index entries retained');
    check(p.authors.length>0&&p.abstract.length>0,'detail supplies actual authors and abstract');
    check(p.itemType==='journalArticle'&&p.year===year&&p.volume===String(year-1999),'journal identity, year and volume');
    check(p.issn==='1533-7928'&&p.issue&&p.pages&&p.pdfURL.startsWith('https://jmlr.org/'),'source bibliographic fields');
    const metadata={schemaVersion:1,year,venueID:p.venueID,fetchedAt:new Date().toISOString(),paperCount:1,papers:[p]};
    check(core.validateMetadata(metadata,year,'JMLR')===metadata,'native cache validation');
    rejects(()=>service.parseJMLRIndex(raw,year===2025?2026:2025),'wrong volume rejected');
    rejects(()=>service.parseJMLRIndex(raw.replace(/(20\d{2})\./g,'2024.'),year),'wrong publication year rejected');
    rejects(()=>service.parseJMLRIndex(raw.replace('>abs<','>missing<'),year),'missing paper link rejected');
    rejects(()=>service.parseJMLRIndex(raw.replace('href="/papers/v','href="https://example.org/papers/v'),year),'offsite paper link rejected');
    rejects(()=>service.completeJMLR(p,detail.replace('name="citation_volume"','name="missing_volume"')),'missing detail volume rejected');
    rejects(()=>service.completeJMLR(p,detail.replace('name="citation_public_url"','name="missing_url"')),'missing identity rejected');
    rejects(()=>service.completeJMLR(p,detail.replace('1533-7928','1234-5678')),'wrong journal ISSN rejected');
    rejects(()=>core.validateMetadata({...metadata,papers:[{...p,pdfURL:'javascript:alert(1)'}]},year,'JMLR'),'unsafe PDF cache rejected');
    rejects(()=>core.validateMetadata({...metadata,papers:[{...p,volume:'1'}]},year,'JMLR'),'wrong cached volume rejected');
    if(year===2026)samples.push(p);
  }
  for(const journal of ['TPAMI','TKDE']){
    const record=JSON.parse(files[`${journal.toLowerCase()}-2026.json`]);
    const p=service.normalizeCrossref(record,journal,2026);samples.push(p);
    check(p.doi===record.DOI.toLowerCase()&&p.issn===core.JOURNAL_SOURCES[journal].issn,'real IEEE identity and journal');
    check(p.date.startsWith('2026')&&p.volume&&p.issue&&p.pages,'real IEEE publication fields');
    record.abstract='<jats:p>Graphs &amp; <jats:italic>learning</jats:italic>.</jats:p>';
    check(service.normalizeCrossref(record,journal,2026).abstract==='Graphs & learning.','JATS and entities become plain searchable text');
  }
  return {assertions,papers:samples};
}

/* Use only with an isolated profile. Deletes only the items and caches created by this test. */
async function runSearch4PaperJournalSmoke(win,{expectedDataDir,papers}) {
  const ui=win.Search4PaperUI,Zotero=ui.Zotero,core=win.Search4PaperCore;
  if(!expectedDataDir||Zotero.DataDirectory.dir!==expectedDataDir)throw Error('An explicit isolated test data directory is required');
  let assertions=0;const check=(ok,message)=>{assertions++;if(!ok)throw Error(message);};
  const created=[],paths=[],request=ui.request,fetch=win.Search4PaperSources.fetchAccepted;
  const query={terms:['research'],operator:'OR',fields:['title']};
  try{
    for(const p of papers){
      const path=PathUtils.join(expectedDataDir,'search4paper',p.journalAbbreviation,`${p.year}.json`);
      if(await IOUtils.exists(path))throw Error('Smoke test requires absent journal caches: '+path);
      paths.push(path);
    }
    ui.$('venue-type').value='期刊';ui.$('venue-rank').value='A';ui.$('year').value='2026';ui.updateConferenceOptions();
    check([...ui.$('conference').options].map(o=>o.value).join(',')==='JMLR,TPAMI,TKDE','only the three verified A journals');
    for(const option of ui.$('conference').options)option.selected=true;
    ui.updateSourceSupport();ui.controls();
    check(!ui.$('fetch').disabled&&ui.selectedTargets().length===3,'all journals queryable');
    check(ui.$('year-support').textContent.includes('最早出版年')&&ui.$('support-rows').textContent.includes('MLOSS'),'source and year limitations visible');
    ui.$('year').value='2024';ui.updateSourceSupport();ui.controls();
    check(ui.$('fetch').disabled&&ui.$('refresh-papers').disabled,'unverified year blocked');
    ui.$('year').value='2026';ui.updateSourceSupport();ui.controls();
    ui.$('terms').value=papers.map(p=>p.title.split(/\s+/)[0]).join('; ');ui.$('operator').value='OR';
    win.Search4PaperSources.fetchAccepted=async(year,{conference})=>papers.filter(p=>p.year===year&&p.journalAbbreviation===conference);
    await ui.fetchPapers(new win.AbortController().signal,true);
    check(ui.papers.length===3&&ui.candidates.length===3,'all journal caches combine and filter');
    check(ui.$('coverage').textContent.includes('缺少摘要 2')&&ui.$('coverage').textContent.includes('Crossref'),'coverage reports missing abstracts and index');
    win.Search4PaperSources.fetchAccepted=async()=>{throw Error('offline test must use the saved cache');};
    await ui.fetchPapers(new win.AbortController().signal);
    check(ui.coverageRows.every(r=>r.local),'journal caches work offline');
    ui.preview(ui.papers[1]);
    check(!ui.$('publication-info').hidden&&ui.$('publication-info').textContent.includes('卷 '+papers[1].volume),'preview shows journal volume');
    check(ui.$('publication-info').textContent.includes(papers[1].yearBasis),'preview explains publication date');
    const conference={id:'search4paper-journal-smoke',year:2026,venueID:core.venueID('ICML',2026),source:'openreview',title:'Journal smoke conference counterpart',
      authors:['Test Author'],abstract:'',doi:'',url:'https://openreview.net/forum?id=search4paper-journal-smoke',pdfURL:'',bibtex:''};
    const result=await win.Search4PaperImport.papers(Zotero,[...papers,conference],{query});
    for(const r of result.results)if(r.status==='created')created.push(r.item.id);
    check(result.results.length===4&&result.results.every(r=>r.status==='created'),'three journals and a conference import');
    for(let i=0;i<3;i++){
      const item=result.results[i].item,p=papers[i];
      check(item.itemType==='journalArticle','native Zotero journalArticle');
      for(const [field,expected] of Object.entries({publicationTitle:p.publicationTitle,journalAbbreviation:p.journalAbbreviation,ISSN:p.issn,volume:p.volume,issue:p.issue,pages:p.pages,DOI:p.doi}))
        check(item.getField(field)===expected,'native journal field '+field);
      check(item.getField('date',true,true).includes(p.date),'source publication date retained');
      const note=await Zotero.Items.getAsync(item.getNotes()[0]);
      check(note.getNote().includes(p.sourceURL)&&note.getNote().includes(p.yearBasis),'source and date provenance saved');
      item.setField('abstractNote','USER ABSTRACT');await item.saveTx();
    }
    check(result.results[3].item.itemType==='conferencePaper','conference import unchanged');
    const again=await win.Search4PaperImport.papers(Zotero,papers,{query});
    check(again.results.length===3&&again.results.every(r=>r.status==='existing'),'DOI and JMLR identity deduplicate after rebuilding library index');
    check(again.results.every(r=>r.item.getField('abstractNote')==='USER ABSTRACT'&&r.item.getNotes().length===1),'repeat imports preserve user metadata and notes');
    // A failed refresh must preserve the saved list and not expose partial merged results.
    const before=await IOUtils.readJSON(paths[1]);
    win.Search4PaperSources.fetchAccepted=async(year,{conference})=>{
      if(conference==='TPAMI')throw Error('Injected Crossref HTTP 429');return papers.filter(p=>p.journalAbbreviation===conference);
    };
    let failed=false;try{await ui.fetchPapers(new win.AbortController().signal,true);}catch(e){failed=e.message.includes('429');}
    check(failed&&ui.papers.length===0&&ui.candidates.length===0,'failed refresh publishes no partial results');
    check(JSON.stringify(await IOUtils.readJSON(paths[1]))===JSON.stringify(before),'failed journal cache unchanged');
    return {assertions};
  }finally{
    ui.request=request;win.Search4PaperSources.fetchAccepted=fetch;
    if(created.length)await Zotero.Items.erase(created);
    for(const path of paths)if(await IOUtils.exists(path))await IOUtils.remove(path);
  }
}
