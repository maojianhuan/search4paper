/* Run after core.js / sources.js with a native DOMParser.
 * files maps tests/fixtures/zotero-robotics filenames to text. */
async function runSearch4PaperRoboticsFixtures(files) {
  let assertions=0;
  const core=Search4PaperCore,sources=Search4PaperSources;
  const check=(ok,message)=>{assertions++;if(!ok)throw Error(message);};
  const rejects=async(fn,message)=>{let failed=false;try{await fn();}catch{failed=true;}check(failed,message);};
  const edit=(raw,fn)=>{const doc=new DOMParser().parseFromString(raw,'text/html');fn(doc);return doc.documentElement.outerHTML;};
  const result={};
  for(const [conference,year] of [['IROS',2025],['ICRA',2026]]){
    const config=core.ROBOTICS_SOURCES[conference][year],calls=[];
    const rawFor=day=>files[`${conference.toLowerCase()}-${year}-day${day}.html`];
    const papers=await sources.fetchAccepted(year,{conference,request:async url=>{
      const day=config.days[calls.length];calls.push(url);
      check(url===`https://ras.papercept.net/conferences/conferences/${config.code}/program/${config.code}_ContentListWeb_${day}.html`,'exact technical-day endpoint');
      return rawFor(day);
    }});
    check(calls.length===3,'all technical days fetched');
    check(papers.length>=3,'papers from every day retained');
    check(papers.every(p=>['Regular Session','Interactive Session','Award Session'].includes(p.track)),'LBR excluded');
    check(papers.every(p=>p.authors.length&&p.doi===''&&p.pdfURL==='')&&papers.some(p=>p.abstract&&p.keywords),'official fields preserved without invented DOI/PDF');
    check(!!core.matchPaper(papers[0],{terms:[papers[0].title],operator:'AND',fields:['title']}),'papers searchable');
    const meta={schemaVersion:1,year,venueID:papers[0].venueID,fetchedAt:'2026-10-29T00:00:00Z',paperCount:papers.length,papers};
    core.validateMetadata(JSON.parse(JSON.stringify(meta)),year,conference);
    const day=config.days[0],raw=rawFor(day);
    await rejects(()=>sources.parseRoboticsProgram(raw,conference,year-1,day),'wrong year fails');
    await rejects(()=>sources.parseRoboticsProgram(raw,conference,year,config.days[1]),'same-year wrong day fails');
    const missing=edit(raw,d=>d.querySelector('.pTtl').remove());
    await rejects(()=>sources.parseRoboticsProgram(missing,conference,year,day),'missing title fails without dropping a paper');
    const wrongAbstract=edit(raw,d=>d.querySelector('div[id^=Ab]').id='Ab999999');
    await rejects(()=>sources.parseRoboticsProgram(wrongAbstract,conference,year,day),'mismatched abstract fails');
    let requests=0;
    await rejects(()=>sources.fetchAccepted(year,{conference,request:async()=>{
      requests++;if(requests===2)throw Error('HTTP 403');return raw;
    }}),'failed later day cannot publish a partial list');
    check(requests===2,'HTTP error is not retried');
    const controller=new AbortController();requests=0;
    await rejects(()=>sources.fetchAccepted(year,{conference,signal:controller.signal,request:async()=>{
      requests++;controller.abort();return raw;
    }}),'cancellation stops publication');
    check(requests===1,'cancellation stops remaining days');
    requests=0;
    await rejects(()=>sources.fetchAccepted(year===2025?2026:2025,{conference,request:async()=>{requests++;return raw;}}),'unsupported year rejected');
    check(requests===0,'unsupported year fails before network');
    if(conference==='ICRA'){
      const absent=edit(raw,d=>{
        const title=d.querySelector('.pTtl'),link=title.querySelector('a');link.replaceWith(link.textContent);
        d.querySelector('div[id^=Ab]').remove();
      });
      const parsed=sources.parseRoboticsProgram(absent,conference,year,day);
      check(parsed[0].abstract===''&&parsed[0].keywords===''&&parsed[0].id===papers[0].id,'official plain-title variant retains identity without a summary');
      const mismatch=edit(raw,d=>d.querySelector('tr.pHdr input').name='modify999999');
      await rejects(()=>sources.parseRoboticsProgram(mismatch,conference,year,day),'conflicting official submission IDs fail');
      const dup=edit(raw,d=>{
        const table=d.querySelector('table.trk'),rows=[...table.querySelectorAll('tr')];
        const first=rows.findIndex(row=>row.matches('.pHdr'));
        for(const row of rows.slice(first))table.tBodies[0].append(row.cloneNode(true));
      });
      let calls=0;
      const merged=await sources.fetchAccepted(year,{conference,request:async()=>calls++===0?dup:rawFor(config.days[calls-1])});
      check(merged.length===papers.length,'repeated presentation does not duplicate a paper');
    }
    result[conference]=papers.length;
  }
  return {ok:true,assertions,fixturePapers:result};
}
