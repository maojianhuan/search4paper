const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const vm = require('node:vm');
const core = require('../zotero-plugin/content/core.js');
const scope = {Search4PaperCore:core,URL};
vm.runInNewContext(readFileSync(require.resolve('../zotero-plugin/content/import.js'),'utf8'),scope);
function paper(conference, id = '1') {
  if (core.ROBOTICS_SOURCES[conference]) {
    const year = Number(Object.keys(core.ROBOTICS_SOURCES[conference])[0]),config=core.ROBOTICS_SOURCES[conference][year],day=config.days[0];
    const sourceURL=`https://ras.papercept.net/conferences/conferences/${config.code}/program/`;
    return {id:`${year}:${id}`,year,venueID:core.venueID(conference,year),source:conference.toLowerCase(),sourceURL,
      url:`${sourceURL}${config.code}_ContentListWeb_${day}.html#tuat1_01`,programDay:day,programAnchor:'tuat1_01',
      title:`Paper ${id}`,authors:['Example, Author'],track:'Regular Session',sessions:['TuAT1: Robot Learning'],
      abstract:'',keywords:'',tldr:'',doi:'',pdfURL:'',bibtex:''};
  }
  const ijcai = conference === 'IJCAI', year = 2025;
  const sourceURL = ijcai ? `https://ijcai.org/proceedings/${year}/` : `https://acmmm${year}.org/accepted-regular-papers/`;
  return {id:`${year}:${id}`,year,venueID:core.venueID(conference,year),source:ijcai?'ijcai':'acmmm',sourceURL,
    track:ijcai?'Main Track':'Regular Papers',title:`Paper ${id}`,authors:['Example Author'],abstract:'',keywords:'',tldr:'',bibtex:'',
    url:ijcai?sourceURL+id:sourceURL,doi:ijcai?`10.24963/ijcai.${year}/${id}`:'',pdfURL:ijcai?sourceURL+id.padStart(4,'0')+'.pdf':'',pages:ijcai?'3–11':''};
}
const metadata = p => ({schemaVersion:1,year:p.year,venueID:p.venueID,fetchedAt:'2026-10-29T00:00:00Z',paperCount:1,papers:[p]});

test('new-source caches reject substituted provenance and retain distinct year-qualified identities',()=>{
  for (const conference of ['IJCAI','ACM MM','ICRA','IROS']) {
    const p = paper(conference), meta = metadata(p);
    assert.deepEqual(core.validateMetadata(JSON.parse(JSON.stringify(meta)),p.year,conference),meta);
    assert.ok(core.identities({extra:`Source ID: ${p.source}:${p.id}`}).has(`source:${p.source}:${p.id}`));
    for (const change of [{source:'cvf'},{sourceURL:'https://example.org/'},{id:'2024:1'},
      {track:'Demo Track'},{authors:[]},{url:'javascript:alert(1)'},{doi:'10.24963/ijcai.2024/1'},{pdfURL:'https://example.org/test.pdf'}]) {
      assert.throws(()=>core.validateMetadata(metadata({...p,...change}),p.year,conference));
    }
  }
  assert.ok(core.identities({url:'https://www.ijcai.org/proceedings/2025/0001.pdf'}).has('source:ijcai:2025:1'));
  assert.equal(core.identities({url:'https://acmmm2025.org/accepted-regular-papers/'}).size,0,'a shared list URL is not a paper identity');
});

test('import preserves IJCAI fields and distinct ACM papers on one list URL; repeat import preserves user edits',async()=>{
  const items = [];
  class Item {
    constructor(type) { this.type=type;this.fields={};this.notes=[]; }
    setField(key,value) { this.fields[key]=value; }
    getField(key) { return this.fields[key] || ''; }
    setCreators(authors) { this.creators=authors; }
    setNote(note) { this.note=note; }
    getNote() { return this.note; }
    getNotes() { return this.notes; }
    isRegularItem() { return this.type !== 'note'; }
    async save() { if (!this.id) { this.id=items.length+1;items.push(this);if(this.parentID)items.find(i=>i.id===this.parentID).notes.push(this.id); } }
  }
  const zotero = {Item,Libraries:{userLibraryID:1},Collections:{getByLibrary:()=>[]},
    Items:{getAll:async()=>items.filter(i=>i.isRegularItem()),getAsync:async ids=>items.filter(i=>ids.includes(i.id))},
    DB:{executeTransaction:async fn=>fn()}};
  const options={query:{terms:['Paper'],operator:'AND',fields:['title']}};
  const papers=[paper('IJCAI'),paper('ACM MM'),paper('ACM MM','2'),paper('ICRA'),paper('IROS')];
  const first=await scope.Search4PaperImport.papers(zotero,papers,options);
  assert.deepEqual(Array.from(first.results,r=>r.status),Array(papers.length).fill('created'));
  const records=items.filter(i=>i.isRegularItem());
  assert.equal(records.length,papers.length);assert.ok(records.every(i=>i.type==='conferencePaper'));
  assert.equal(records[0].getField('conferenceName'),core.CONFERENCE_NAMES.IJCAI);
  assert.equal(records[0].getField('pages'),'3–11');
  assert.equal(records[3].getField('conferenceName'),core.CONFERENCE_NAMES.ICRA);
  assert.equal(records[4].getField('conferenceName'),core.CONFERENCE_NAMES.IROS);
  records[1].setField('title','My edited title');
  const second=await scope.Search4PaperImport.papers(zotero,papers,options);
  assert.deepEqual(Array.from(second.results,r=>r.status),Array(papers.length).fill('existing'));
  assert.equal(items.filter(i=>i.isRegularItem()).length,papers.length);
  assert.equal(records[1].getField('title'),'My edited title');
});
