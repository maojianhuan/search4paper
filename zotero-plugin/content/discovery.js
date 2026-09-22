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
    const id = this.id(work.id), doi = String(work.doi || "").replace(/^https:\/\/doi\.org\//i, "");
    if (!id || !String(work.title || "").trim()) throw new Error("OpenAlex 返回了缺少 ID 或标题的记录。");
    const source = work.primary_location?.source;
    const landing = work.primary_location?.landing_page_url || work.best_oa_location?.landing_page_url || work.id;
    const pdfURL = work.best_oa_location?.pdf_url || "";
    return { id, openalexID: id, title: work.title, year: Number(work.publication_year) || null,
      authors: this.workAuthors(work), abstract: this.abstract(work.abstract_inverted_index), doi,
      url: landing, pdfURL, publicationTitle: source?.display_name || "", sourceType: source?.type || "",
      workType: work.type || "", citedByCount: Number(work.cited_by_count) || 0,
      referencedWorks: (work.referenced_works || []).map(value => this.id(value)).filter(Boolean),
      relatedWorks: (work.related_works || []).map(value => this.id(value)).filter(Boolean) };
  },

  async resolveItem(item, Zotero, request, signal) {
    if (!item.isRegularItem() || item.deleted) throw new Error("请选择有效的普通文献条目作为种子论文。");
    const saved = item.getField("extra").match(/^OpenAlex ID: (W\d+)\s*$/m)?.[1];
    const doi = item.getField("DOI").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    if (saved || doi) {
      const identifier = saved || `https://doi.org/${encodeURIComponent(doi)}`;
      const work = await request(`https://api.openalex.org/works/${identifier}?select=${this.fields}`, signal, "json");
      return this.normalizeWork(work);
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

  async expand(items, Zotero, { request, signal, onProgress = () => {} } = {}) {
    if (!items.length) throw new Error("请先在 Zotero 主窗口选择至少一篇种子论文。");
    const seeds = [];
    for (const item of items) {
      signal?.throwIfAborted();
      onProgress(`正在匹配种子论文：${item.getField("title")}`);
      seeds.push(await this.resolveItem(item, Zotero, request, signal));
    }
    const seedIDs = new Set(seeds.map(seed => seed.id)), found = new Map();
    const add = (paper, relation, seed) => {
      if (seedIDs.has(paper.id)) return;
      if (!found.has(paper.id)) found.set(paper.id, { ...paper, relations: new Set(), seedTitles: new Set() });
      found.get(paper.id).relations.add(relation); found.get(paper.id).seedTitles.add(seed.title);
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
    const priority = paper => paper.seedTitles.length * 1000000 + paper.relations.length * 100000 + paper.citedByCount;
    papers.sort((a, b) => priority(b) - priority(a) || (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title));
    return { seeds, papers, citationLimitPerSeed: 50 };
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
          if (collection) item.addToCollection(collection.id);
          item.addTag("search4paper:discovered"); await item.save();
          const notes = created ? [] : await Zotero.Items.getAsync(item.getNotes());
          if (!notes.some(note => note.getNote().includes("<p>Imported by search4paper discovery</p>"))) {
            const note = new Zotero.Item("note"); note.libraryID = libraryID; note.parentID = item.id;
            const labels = { reference: "种子论文的参考文献", citation: "引用种子论文的后续工作", related: "OpenAlex 相关论文" };
            note.setNote(["Imported by search4paper discovery", `OpenAlex: https://openalex.org/${paper.openalexID}`,
              `Reason: ${paper.relations.map(value => labels[value]).join("；")}`, `Seeds: ${paper.seedTitles.join("；")}`]
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
