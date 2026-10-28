/* Load after core.js, abstract.js and materials.js in Zotero's native DOM context. */
function runSearch4PaperMaterialsFixtures() {
  const service=Search4PaperMaterials;let assertions=0;
  const check=(ok,message)=>{assertions++;if(!ok)throw Error(message);};
  const throws=(fn,message)=>{let failed=false;try{fn();}catch{failed=true;}check(failed,message);};
  const paper={title:'A Graph Method',doi:'10.1234/graph',url:'https://example.org/papers/graph/'};
  const html=`<meta name="citation_title" content="A Graph Method"><meta name="citation_doi" content="10.1234/graph">
    <nav><a href="https://github.com/site/navigation">Code</a></nav><main>
    <p>We provide our implementation at <a href="https://github.com/team/graph">Code</a>.</p>
    <p>Additional experiments: <a href="supplement.zip">Supplementary material</a>.</p>
    <p><a href="https://example.org/dataset">Dataset</a><a href="https://example.org/ordinary">References</a></p>
    <p><a href="https://github.com/author">Author profile</a><a href="javascript:alert(1)">Code</a></p>
    <script>throw Error('Never execute source scripts');</script>
    <p><a href="https://doi.org/10.1234/graph">Data</a><a href="#code">Code</a></p></main>
    <footer><a href="https://github.com/site/footer">Code</a></footer>`;
  const candidates=service.fromHTML(html,paper.url,paper);
  check(candidates.length===3,'only material-labelled or repository links in the paper content');
  check(candidates[0].evidence[0].quote==='We provide our implementation at Code.','exact surrounding source text');
  check(candidates[0].evidence[0].sourceURL===paper.url,'source page retained');
  check(candidates[1].url==='https://example.org/papers/graph/supplement.zip','relative URL uses final page directory');
  check(candidates.filter(candidate=>service.codeCandidate(candidate)).length===1,'code workflow excludes supplements and datasets while retaining explicit repository');
  const cvf=service.fromHTML(html.replace('</main>','<div id="abstract">Our code is at https://github.com/team/plain-text.</div></main>'),paper.url,paper);
  check(cvf.some(c=>c.url==='https://github.com/team/plain-text'&&c.evidence[0].quote.includes('Our code is at')),'plain-text repository in CVF abstract retains original context');
  // The main element limits page-link scanning; CVF itself uses the body as content.
  const supplemental=service.fromHTML('<meta name="citation_title" content="A Graph Method"><a href="extra.pdf">supp</a>',paper.url,paper);
  check(supplemental[0].url==='https://example.org/papers/graph/extra.pdf','CVF supp label identifies an explicitly linked supplement');
  const based=service.fromHTML('<base href="https://cdn.example.org/materials/">'+html,paper.url,paper);
  check(based[1].url==='https://cdn.example.org/materials/supplement.zip','explicit HTML base respected');
  throws(()=>service.fromHTML(html.replace('content="A Graph Method"','content="Other Paper"'),paper.url,paper),'reject wrong article title');
  throws(()=>service.fromHTML(html.replace('content="10.1234/graph"','content="10.1234/other"'),paper.url,paper),'reject conflicting DOI');
  throws(()=>service.fromHTML('<a href="https://github.com/a/b">Code</a>',paper.url,paper),'reject unidentifiable page');
  throws(()=>service.fromHTML(html+'<meta name="citation_title" content="Another Paper">',paper.url,paper),'reject conference-wide metadata');
  check(service.fromHTML(html.replace('<meta name="citation_title" content="A Graph Method">',''),paper.url,paper).length===3,'exact DOI can identify a page without title metadata');
  check(service.fromHTML(html.replace('<meta name="citation_doi" content="10.1234/graph">',''),paper.url,paper).length===3,'explicit selected URL and matching citation title');
  const note=service.noteHTML(paper,candidates[0],'2026-09-29T00:00:00Z');
  check(service.savedURL(note)===candidates[0].url,'confirmation note identifies material URL');
  check(service.savedURL('<div data-schema-version="9">'+note+'</div>')===candidates[0].url,'native note wrapper preserves duplicate identity');
  check(service.savedURL(note.replace(service.marker,''))==='','ordinary user notes are not treated as plugin confirmations');
  check(service.savedURL(note)!==paper.url,'source URL cannot be mistaken for material URL');
  return {ok:true,assertions};
}
