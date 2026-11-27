/* Seed-paper expansion through OpenAlex citation and related-work links. */
var Search4PaperDiscovery = {
  fields: "id,doi,title,publication_year,type,authorships,abstract_inverted_index,primary_location,cited_by_count,referenced_works,related_works,best_oa_location",

  apiRequest(value, apiKey = "") {
    const url = new URL(value);
    if (url.hostname !== "api.openalex.org") throw new Error("OpenAlex 请求地址无效。");
    const key = String(apiKey).trim();
    return { url: url.href, headers: key ? { Authorization: `Bearer ${key}` } : {} };
  },

  rateLimit(response) {
    const read = name => response?.getResponseHeader?.(name) || null;
    const limit = read("X-RateLimit-Limit"), remaining = read("X-RateLimit-Remaining");
    return limit && remaining ? { limit, remaining, reset: read("X-RateLimit-Reset") } : null;
  },

  normalize(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  },

  surname(value) {
    return (String(value || "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).at(-1) || "";
  },

  authorMatch(wanted, actual) {
    const left = new Set(wanted.map(value => this.surname(value)).filter(Boolean));
    const right = new Set(actual.map(value => this.surname(value)).filter(Boolean));
    return left.size > 0 && [...left].filter(value => right.has(value)).length >= Math.min(2, left.size);
  },

  id(value) {
    return String(value || "").match(/(?:^|\/)(W\d+)$/)?.[1] || "";
  },

  itemAuthors(item, Zotero) {
    const authorID = Zotero.CreatorTypes.getID("author");
    return item.getCreators().filter(creator => creator.creatorTypeID === authorID)
      .map(creator => [creator.firstName, creator.lastName].filter(Boolean).join(" "));
  },

  workAuthors(work) {
    return (work.authorships || []).map(entry => entry.author?.display_name).filter(Boolean);
  },

  abstract(index) {
    if (!index || typeof index !== "object") return "";
    const words = [];
    for (const [word, positions] of Object.entries(index)) {
      if (!Array.isArray(positions)) return "";
      for (const position of positions) if (Number.isInteger(position) && position >= 0) words[position] = word;
    }
    return words.filter(value => value !== undefined).join(" ");
  },

  normalizeWork(work) {
    if (!/^(?:https:\/\/openalex\.org\/)?W\d+$/.test(work?.id || "") || !String(work?.title || "").trim()) {
      throw new Error("OpenAlex 返回了缺少有效 ID 或标题的记录。");
    }
    const id = this.id(work.id), doi = Search4PaperCore.uniqueDOI(Search4PaperCore.identities({ doi: work.doi }));
    const count = work.cited_by_count;
    if (count != null && (!Number.isSafeInteger(count) || count < 0)) {
      throw new Error("OpenAlex 返回的引用数不是有效的非负整数。");
    }
    const source = work.primary_location?.source;
    const landing = work.primary_location?.landing_page_url || work.best_oa_location?.landing_page_url || work.id;
    const pdfURL = work.best_oa_location?.pdf_url || "";
    return { id, openalexID: id, title: work.title, year: Number(work.publication_year) || null,
      authors: this.workAuthors(work), abstract: this.abstract(work.abstract_inverted_index), doi,
      url: landing, pdfURL, hasOpenAccess: Boolean(work.best_oa_location),
      publicationTitle: source?.display_name || "", sourceType: source?.type || "",
      workType: work.type || "", citedByCount: count ?? null,
      referencesAvailable: Array.isArray(work.referenced_works),
      referencedWorks: (work.referenced_works || []).map(value => this.id(value)).filter(Boolean),
      relatedWorks: (work.related_works || []).map(value => this.id(value)).filter(Boolean) };
  },

  mergeReferences(previous, observed) {
    if (!previous) return observed;
    if (observed.referencesAvailable === false) return previous;
    return { ...previous, referencesAvailable: true,
      referencedWorks: [...new Set([...previous.referencedWorks, ...observed.referencedWorks])] };
  },

  paperType(paper) {
    if (paper.workType === "preprint") return "preprint";
    if (paper.sourceType === "conference") return "conference";
    if (paper.sourceType === "journal") return "journal";
    return "other";
  },

  rankingExplanation(paper, sort = "recommended") {
    const citations = paper.citedByCount == null ? "引用数未知" : `引用 ${paper.citedByCount} 次`;
    if (sort === "latest") return `发表年份 ${paper.year || "未知"}`;
    if (sort === "cited") return `OpenAlex ${citations}`;
    if (sort === "seeds") return `检索时关联 ${paper.seedTitles.length} 篇种子论文`;
    return `检索时关联 ${paper.seedTitles.length} 篇种子 · 命中 ${paper.relations.length} 类关系 · ${citations}`;
  },

  hasRelation(paper, relation) {
    return paper.relations.includes(relation) || (relation === "cocitation" && Boolean(paper.observedCocitations?.length));
  },

  withObservedRelations(paper) {
    const observed = paper.observedCocitations;
    if (!observed?.length) return paper;
    return { ...paper,
      relations: [...new Set([...paper.relations, "cocitation"])],
      seedTitles: [...new Set([...paper.seedTitles, ...observed.map(entry => entry.seedTitle)])],
      relationEvidence: [...(paper.relationEvidence || []).filter(entry => entry.relation !== "cocitation"), ...observed] };
  },

  filterAndSort(papers, options = {}) {
    const { relation = "", type = "", oaOnly = false, library = "", yearFrom = null,
      yearTo = null, sort = "recommended" } = options;
    const result = papers.filter(paper => (!relation || this.hasRelation(paper, relation))
      && (!type || this.paperType(paper) === type)
      && (!oaOnly || Boolean(paper.hasOpenAccess ?? paper.pdfURL))
      && (!library || paper.libraryStatus === library)
      && (!yearFrom || paper.year >= yearFrom) && (!yearTo || paper.year <= yearTo));
    const citations = (a, b) => (b.citedByCount ?? -1) - (a.citedByCount ?? -1);
    const compare = {
      latest: (a, b) => (b.year || 0) - (a.year || 0) || citations(a, b),
      cited: (a, b) => citations(a, b) || (b.year || 0) - (a.year || 0),
      seeds: (a, b) => b.seedTitles.length - a.seedTitles.length || b.relations.length - a.relations.length,
      recommended: (a, b) => b.seedTitles.length - a.seedTitles.length
        || b.relations.length - a.relations.length || citations(a, b) || (b.year || 0) - (a.year || 0)
    }[sort];
    if (!compare) throw new Error("未知的文献发现排序方式。");
    return result.sort((a, b) => compare(a, b) || a.title.localeCompare(b.title));
  },

  async markLibraryStatus(Zotero, papers) {
    const existing = (await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, true, false)).filter(item => item.isRegularItem());
    const index = new Map();
    for (const item of existing) for (const key of Search4PaperCore.identities({ doi: item.getField("DOI"), url: item.getField("url"), extra: item.getField("extra") })) {
      if (!index.has(key)) index.set(key, new Map()); index.get(key).set(item.id, item);
    }
    for (const paper of papers) {
      const matches = new Map();
      for (const key of Search4PaperCore.identities(paper)) for (const [id, item] of index.get(key) || []) matches.set(id, item);
      paper.libraryStatus = matches.size ? "existing" : "new";
      for (const item of matches.values()) {
        const attachments = await Zotero.Items.getAsync(item.getAttachments());
        for (const attachment of attachments) if (attachment.attachmentContentType === "application/pdf"
          && attachment.isFileAttachment() && await attachment.fileExists()) paper.libraryStatus = "pdf";
      }
    }
    return papers;
  },

  async resolveItem(item, Zotero, request, signal) {
    if (!item.isRegularItem() || item.deleted) throw new Error("请选择有效的普通文献条目作为种子论文。");
    signal?.throwIfAborted();
    const extra = item.getField("extra").split("\n").map(line => line.trim()).join("\n");
    for (const line of extra.split("\n")) {
      if (line.startsWith("OpenAlex ID:") && !/^OpenAlex ID: W\d+$/.test(line)) {
        throw new Error("种子论文 OpenAlex ID 格式无效，请先核对条目。");
      }
    }
    const identities = Search4PaperCore.identities({ doi: item.getField("DOI"), extra });
    const savedIDs = [...identities].filter(key => key.startsWith("openalex:")).map(key => key.slice(9));
    if (savedIDs.length > 1) throw new Error("种子论文保存了相互冲突的 OpenAlex ID，请先核对条目。");
    const saved = savedIDs[0], doi = Search4PaperCore.uniqueDOI(identities);
    if (doi && !/^10\.\d{4,9}\/\S+$/.test(doi)) throw new Error("种子论文 DOI 格式无效，请先核对条目。");
    if (saved || doi) {
      const identifier = saved || `https://doi.org/${encodeURIComponent(doi)}`;
      const work = await request(`https://api.openalex.org/works/${identifier}?select=${this.fields}`, signal, "json");
      signal?.throwIfAborted();
      const paper = this.normalizeWork(work);
      if (saved && paper.id !== saved) throw new Error("OpenAlex 返回的 ID 与种子论文保存的标识不一致，未扩展此种子。");
      if (doi && paper.doi !== doi) throw new Error("OpenAlex 返回的 DOI 与种子论文不一致，未扩展此种子。");
      return paper;
    }
    const title = item.getField("title"), year = item.getField("date").match(/\b(?:19|20)\d{2}\b/)?.[0];
    const authors = this.itemAuthors(item, Zotero);
    if (!title || !year || !authors.length) throw new Error("缺少 DOI/OpenAlex ID，且标题、年份或作者不足以严格匹配 OpenAlex。");
    const response = await request(`https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=10&select=${this.fields}`, signal, "json");
    const matches = (response?.results || []).filter(work => this.normalize(work.title) === this.normalize(title)
      && Number(work.publication_year) === Number(year) && this.authorMatch(authors, this.workAuthors(work)));
    const unique = [...new Map(matches.map(work => [this.id(work.id), work])).values()];
    if (unique.length !== 1) throw new Error(unique.length ? "OpenAlex 存在多个严格匹配记录。" : "OpenAlex 未找到标题、作者和年份一致的记录。");
    return this.normalizeWork(unique[0]);
  },

  async fetchIDs(ids, request, signal) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const papers = [];
    for (let offset = 0; offset < unique.length; offset += 100) {
      signal?.throwIfAborted();
      const filter = encodeURIComponent(`openalex:${unique.slice(offset, offset + 100).join("|")}`);
      const response = await request(`https://api.openalex.org/works?filter=${filter}&per-page=100&select=${this.fields}`, signal, "json");
      if (!Array.isArray(response?.results)) throw new Error("OpenAlex 返回的关联论文格式无效。");
      papers.push(...response.results.map(work => this.normalizeWork(work)));
    }
    return papers;
  },

  async expand(items, Zotero, { request, signal, onProgress = () => {}, deep = false } = {}) {
    if (!items.length) throw new Error("请先在 Zotero 主窗口选择至少一篇种子论文。");
    const seeds = [];
    for (const item of items) {
      signal?.throwIfAborted();
      onProgress(`正在匹配种子论文：${item.getField("title")}`);
      seeds.push(await this.resolveItem(item, Zotero, request, signal));
    }
    const seedRecords = new Map(), found = new Map();
    for (const seed of seeds) seedRecords.set(seed.id, this.mergeReferences(seedRecords.get(seed.id), seed));
    const add = (paper, relation, seed) => {
      if (seedRecords.has(paper.id)) {
        seedRecords.set(paper.id, this.mergeReferences(seedRecords.get(paper.id), paper));
        return;
      }
      const previous = found.get(paper.id);
      const candidate = previous ? this.mergeReferences(previous, paper)
        : { ...paper, relations: new Set(), seedTitles: new Set(), relationEvidence: [] };
      found.set(paper.id, candidate);
      candidate.relations.add(relation); candidate.seedTitles.add(seed.title);
      if (!candidate.relationEvidence.some(entry => entry.seedID === seed.id && entry.relation === relation)) {
        candidate.relationEvidence.push({ seedID: seed.id, seedTitle: seed.title, relation });
      }
    };
    for (let index = 0; index < seeds.length; index++) {
      const seed = seeds[index]; signal?.throwIfAborted();
      onProgress(`扩展 ${index + 1} / ${seeds.length}：${seed.title}`);
      for (const paper of await this.fetchIDs(seed.referencedWorks, request, signal)) add(paper, "reference", seed);
      for (const paper of await this.fetchIDs(seed.relatedWorks, request, signal)) add(paper, "related", seed);
      const response = await request(`https://api.openalex.org/works?filter=cites:${seed.id}&sort=cited_by_count:desc&per-page=50&select=${this.fields}`, signal, "json");
      if (!Array.isArray(response?.results)) throw new Error("OpenAlex 返回的被引论文格式无效。");
      for (const work of response.results) add(this.normalizeWork(work), "citation", seed);
    }
    const papers = [...found.values()].map(paper => ({ ...paper,
      relations: [...paper.relations], seedTitles: [...paper.seedTitles] }));
    const priority = paper => paper.seedTitles.length * 1000000 + paper.relations.length * 100000 + (paper.citedByCount ?? -1);
    papers.sort((a, b) => priority(b) - priority(a) || (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title));
    const result = { seeds: seeds.map(seed => seedRecords.get(seed.id)), papers, citationLimitPerSeed: 50 };
    return deep ? this.expandSimilarity(result, { request, signal, onProgress }) : this.recordCocitations(result);
  },

  async fetchCiting(ids, request, signal, fields = this.fields) {
    if (!ids.length || ids.length > 100) throw new Error("引用查询需要 1–100 个论文 ID。");
    const found = new Map();
    let total = 0;
    // Two supported 100-result pages, not the deprecated per_page=200.
    for (let page = 1; page <= 2; page++) {
      signal?.throwIfAborted();
      const filter = encodeURIComponent(`cites:${ids.join("|")}`);
      const response = await request(`https://api.openalex.org/works?filter=${filter}&sort=cited_by_count:desc&per-page=100&page=${page}&select=${fields}`, signal, "json");
      signal?.throwIfAborted();
      if (!Array.isArray(response?.results) || !Number.isInteger(response?.meta?.count) || response.meta.count < 0) {
        throw new Error("OpenAlex 返回的引用查询结果或总数无效。");
      }
      if (page === 1) total = response.meta.count;
      for (const work of response.results) {
        const paper = this.normalizeWork(work);
        found.set(paper.id, this.mergeReferences(found.get(paper.id), paper));
      }
      if (!response.results.length || page * 100 >= total) break;
    }
    return { papers: [...found.values()], total, truncated: total > found.size };
  },

  cocitedWorks(seedID, witnesses, include) {
    const cocited = new Map();
    for (const witness of witnesses) {
      if (witness.id === seedID || witness.referencesAvailable === false || !witness.referencedWorks.includes(seedID)) continue;
      for (const id of witness.referencedWorks) {
        if (id === witness.id || !include(id)) continue;
        if (!cocited.has(id)) cocited.set(id, new Set());
        cocited.get(id).add(witness.id);
      }
    }
    return cocited;
  },

  recordCocitations(result) {
    // Keep the sampled retrieval paths used for ranking, and record all observed co-citations for display and import.
    const candidates = new Map(result.papers.map(paper => [paper.id, { ...paper, observedCocitations: [] }]));
    const seeds = new Map(result.seeds.map(seed => [seed.id, seed]));
    const witnesses = result.evidencePapers || [...seeds.values(), ...result.papers];
    for (const seed of seeds.values()) {
      const observed = this.cocitedWorks(seed.id, witnesses, id => candidates.has(id));
      for (const [id, via] of observed) candidates.get(id).observedCocitations.push({
        relation: "cocitation", seedID: seed.id, seedTitle: seed.title, via: [...via].sort()
      });
    }
    return { ...result, papers: [...candidates.values()] };
  },

  async expandSimilarity(result, { request, signal, onProgress = () => {} }) {
    const referenceLimit = 100, candidateLimit = 100;
    const seedIDs = new Set(result.seeds.map(seed => seed.id));
    const found = new Map(result.papers.map(paper => [paper.id, { ...paper,
      relations: [...paper.relations], seedTitles: [...paper.seedTitles], relationEvidence: [...paper.relationEvidence] }]));
    const evidence = new Map();
    const coverage = { referenceLimit, candidateLimitPerKind: candidateLimit, citingLimitPerQuery: 200,
      expansion: [], evidenceQueries: [], missingDetails: [] };
    const remember = papers => {
      for (const paper of papers) evidence.set(paper.id, this.mergeReferences(evidence.get(paper.id), paper));
    };
    remember([...result.seeds, ...result.papers]);
    const seeds = [...seedIDs].map(id => evidence.get(id));
    const add = (paper, relation, seed, via) => {
      if (seedIDs.has(paper.id)) return;
      if (!found.has(paper.id)) found.set(paper.id, { ...paper, relations: [], seedTitles: [], relationEvidence: [] });
      const candidate = found.get(paper.id);
      if (!candidate.relations.includes(relation)) candidate.relations.push(relation);
      if (!candidate.seedTitles.includes(seed.title)) candidate.seedTitles.push(seed.title);
      candidate.relationEvidence.push({ seedID: seed.id, seedTitle: seed.title, relation, via: [...via].sort() });
    };
    for (const seed of seeds) {
      signal?.throwIfAborted();
      onProgress(`深入发现：查找与“${seed.title}”共享参考文献的论文`);
      const refs = [...new Set(seed.referencedWorks)];
      const row = { seedID: seed.id, referenceCount: refs.length, queriedReferences: Math.min(refs.length, referenceLimit),
        couplingTotal: 0, couplingObserved: 0, couplingOmitted: 0, cocitedOmitted: 0, missingReferences: 0 };
      if (refs.length && seed.referencesAvailable !== false) {
        const response = await this.fetchCiting(refs.slice(0, referenceLimit), request, signal);
        remember(response.papers); row.couplingTotal = response.total; row.couplingObserved = response.papers.length;
        row.missingReferences = response.papers.filter(paper => paper.referencesAvailable === false).length;
        const referenceSet = new Set(refs);
        const matches = response.papers.filter(paper => !seedIDs.has(paper.id) && paper.referencesAvailable !== false)
          .map(paper => {
            const own = new Set(paper.referencedWorks), via = [...own].filter(id => referenceSet.has(id));
            return { paper, via, score: via.length / (own.size + referenceSet.size - via.length) };
          }).filter(match => match.via.length)
          .sort((a, b) => b.score - a.score || a.paper.id.localeCompare(b.paper.id));
        let added = 0;
        for (const match of matches) {
          if (!found.has(match.paper.id)) {
            if (added === candidateLimit) { row.couplingOmitted++; continue; }
            added++;
          }
          add(match.paper, "coupling", seed, match.via);
        }
      }
      onProgress(`深入发现：查找与“${seed.title}”共同被引用的论文`);
      // Use the original one-hop sample, so expansion order cannot change this path.
      const cocited = this.cocitedWorks(seed.id, result.papers, id => !seedIDs.has(id));
      const ranked = [...cocited].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
      const unknown = ranked.filter(([id]) => !found.has(id));
      row.cocitedOmitted = Math.max(0, unknown.length - candidateLimit);
      const requested = unknown.slice(0, candidateLimit).map(([id]) => id);
      const fetched = await this.fetchIDs(requested, request, signal);
      remember(fetched);
      const fetchedByID = new Map(fetched.map(paper => [paper.id, paper]));
      coverage.missingDetails.push(...requested.filter(id => !fetchedByID.has(id)));
      for (const [id, via] of ranked) {
        const paper = found.get(id) || fetchedByID.get(id);
        if (paper) add(paper, "cocitation", seed, via);
      }
      coverage.expansion.push(row);
    }
    // Enrich the observed citing corpus for all candidates, independently of graph filters and node cap.
    const targetIDs = [...new Set([...seedIDs, ...found.keys()])].sort();
    for (let offset = 0; offset < targetIDs.length; offset += 100) {
      onProgress(`共被引证据：查询第 ${Math.floor(offset / 100) + 1} / ${Math.ceil(targetIDs.length / 100)} 组论文`);
      const ids = targetIDs.slice(offset, offset + 100);
      const response = await this.fetchCiting(ids, request, signal, "id,title,referenced_works");
      remember(response.papers);
      coverage.evidenceQueries.push({ ids, total: response.total, observed: response.papers.length, truncated: response.truncated });
    }
    coverage.newCandidates = found.size - result.papers.length;
    coverage.missingDetails = [...new Set(coverage.missingDetails)];
    const withReferences = paper => {
      const { referencesAvailable, referencedWorks } = evidence.get(paper.id);
      return { ...paper, referencesAvailable, referencedWorks };
    };
    return this.recordCocitations({ ...result, seeds: result.seeds.map(withReferences),
      papers: [...found.values()].map(withReferences), evidencePapers: [...evidence.values()], coverage });
  },

  itemType(paper) {
    if (paper.workType === "preprint") return "preprint";
    if (paper.sourceType === "conference") return "conferencePaper";
    if (paper.sourceType === "journal") return "journalArticle";
    return "document";
  },

  async importPapers(Zotero, papers, { collectionID = null, signal, onProgress = () => {} } = {}) {
    const libraryID = Zotero.Libraries.userLibraryID;
    const collection = collectionID ? Zotero.Collections.get(collectionID) : null;
    if (collectionID && (!collection || collection.deleted || collection.libraryID !== libraryID)) throw new Error("目标集合已不存在。");
    const existing = (await Zotero.Items.getAll(libraryID, true, false)).filter(item => item.isRegularItem());
    const index = new Map();
    for (const item of existing) for (const key of Search4PaperCore.identities({ doi: item.getField("DOI"), url: item.getField("url"), extra: item.getField("extra") })) {
      if (!index.has(key)) index.set(key, new Map()); index.get(key).set(item.id, item);
    }
    const results = [];
    for (const paper of papers) {
      if (signal?.aborted) break;
      onProgress(results.length + 1, papers.length, paper.title);
      try {
        const keys = Search4PaperCore.identities(paper), matches = new Map();
        for (const key of keys) for (const [id, item] of index.get(key) || []) matches.set(id, item);
        if (matches.size > 1) throw new Error("Zotero 中存在多个相同 DOI/OpenAlex ID 的条目。");
        const created = !matches.size, item = created ? new Zotero.Item(this.itemType(paper)) : [...matches.values()][0];
        await Zotero.DB.executeTransaction(async () => {
          if (created) {
            item.libraryID = libraryID; item.setField("title", paper.title); item.setField("date", String(paper.year || ""));
            item.setField("abstractNote", paper.abstract); item.setField("url", paper.url); item.setField("DOI", paper.doi);
            if (paper.publicationTitle && this.itemType(paper) === "conferencePaper") item.setField("proceedingsTitle", paper.publicationTitle);
            if (paper.publicationTitle && this.itemType(paper) === "journalArticle") item.setField("publicationTitle", paper.publicationTitle);
            item.setCreators(paper.authors.map(name => ({ lastName: name, fieldMode: 1, creatorType: "author" })));
            item.setField("extra", [`OpenAlex ID: ${paper.openalexID}`, paper.pdfURL ? `Full Text URL: ${paper.pdfURL}` : ""].filter(Boolean).join("\n"));
          }
          Search4PaperCore.reconcileItemDOI(item, keys);
          if (collection) item.addToCollection(collection.id);
          item.addTag("search4paper:discovered"); await item.save();
          const notes = created ? [] : await Zotero.Items.getAsync(item.getNotes());
          if (!notes.some(note => note.getNote().includes("<p>Imported by search4paper discovery</p>"))) {
            const note = new Zotero.Item("note"); note.libraryID = libraryID; note.parentID = item.id;
            const reasons = this.withObservedRelations(paper);
            const labels = { reference: "种子论文的参考文献", citation: "引用种子论文的后续工作", related: "OpenAlex 相关论文",
              coupling: "与种子共享参考文献", cocitation: "与种子共同被引用（已采集范围）" };
            note.setNote(["Imported by search4paper discovery", `OpenAlex: https://openalex.org/${paper.openalexID}`,
              `Reason: ${reasons.relations.map(value => labels[value]).join("；")}`, `Seeds: ${reasons.seedTitles.join("；")}`,
              ...(reasons.relationEvidence || []).map(entry => `${labels[entry.relation]}：${entry.seedTitle} (${entry.seedID})`
                + (entry.via?.length ? `；证据 OpenAlex ID：${entry.via.join("、")}` : ""))]
              .map(value => `<p>${Search4PaperCore.escapeHTML(value)}</p>`).join(""));
            await note.save();
          }
        });
        for (const key of keys) { if (!index.has(key)) index.set(key, new Map()); index.get(key).set(item.id, item); }
        results.push({ paper, item, status: created ? "created" : "existing" });
      }
      catch (error) { results.push({ paper, status: "failed", error: error.message }); break; }
    }
    return { results, unprocessed: papers.length - results.length };
  }
};
