/* Bounded remote keyword retrieval. Sessions are memory-only; official lists stay read-only. */
var Search4PaperCrossSearch = {
  pageSize: 50,
  fields: "id,doi,title,publication_year,publication_date,type,authorships,abstract_inverted_index,primary_location,best_oa_location,locations,keywords",

  plan(query, targets, openAlex = "all") {
    Search4PaperCore.validateQuery(query);
    if (!["all", "journals", "off"].includes(openAlex)) throw new Error("未知的 OpenAlex 检索范围。");
    if (!targets.length) throw new Error("请至少选择一个来源和年份。");
    const unique = new Map();
    for (const target of targets) {
      Search4PaperCore.validateYear(target.year);
      if (!Search4PaperCore.VENUES.includes(target.conference)) throw new Error("未知的会议或期刊。");
      unique.set(`${target.conference}:${target.year}`, { ...target });
    }
    targets = [...unique.values()];
    const jobs = [];
    for (const target of targets.filter(t => Search4PaperCore.OPENREVIEW_CONFERENCES.includes(t.conference))) {
      for (const term of query.terms) for (const field of query.fields) {
        // TLDR field names vary between venues; all-content retrieval is only a candidate source.
        jobs.push({ kind: "openreview", ...target, term, field,
          label: `OpenReview · ${target.conference} ${target.year} · ${field} · ${term}` });
      }
    }
    if (openAlex !== "off") {
      if (openAlex === "journals" && !targets.some(t => Search4PaperCore.JOURNAL_SOURCES[t.conference])) {
        throw new Error("OpenAlex 的“仅所选期刊”需要至少选中一本期刊。");
      }
      // OpenAlex does not provide TLDR. Other selected fields are checked locally after broad recall.
      if (query.fields.some(field => field !== "tldr")) {
        const ranges = openAlex === "all" ? [{ years: [...new Set(targets.map(t => t.year))].sort(), label: "不限来源" }]
          : [...new Set(targets.filter(t => Search4PaperCore.JOURNAL_SOURCES[t.conference]).map(t => t.conference))]
            .map(conference => ({ conference, issn: Search4PaperCore.JOURNAL_SOURCES[conference].issn,
              years: targets.filter(t => t.conference === conference).map(t => t.year), label: conference }));
        for (const range of ranges) for (const term of query.terms) {
          jobs.push({ kind: "openalex", ...range, term, label: `OpenAlex · ${range.label} · ${term}` });
        }
      }
    }
    return { query: { terms: [...query.terms], fields: [...query.fields], operator: query.operator }, targets, openAlex,
      jobs: jobs.map((job, index) => ({ ...job, key: String(index), offset: 0, total: null, seen: [], done: false, capped: false })),
      records: [], local: [], startedAt: new Date().toISOString() };
  },

  url(job) {
    if (job.kind === "openreview") {
      const params = new URLSearchParams({ term: job.term, content: job.field === "tldr" ? "all" : job.field,
        type: "terms", venueid: Search4PaperCore.venueID(job.conference, job.year), source: "forum",
        limit: String(this.pageSize), offset: String(job.offset), count: "true" });
      return `https://api2.openreview.net/notes/search?${params}`;
    }
    // Treat the user's phrase as words, not as provider Boolean syntax. Local matching remains authoritative.
    const filter = [`publication_year:${job.years.join("|")}`];
    if (job.issn) filter.push(`primary_location.source.issn:${job.issn}`);
    const params = new URLSearchParams({ "search.title_abstract_keywords": Search4PaperCore.words(job.term).join(" "),
      filter: filter.join(","), select: this.fields, per_page: String(this.pageSize),
      page: String(job.offset / this.pageSize + 1) });
    return `https://api.openalex.org/works?${params}`;
  },

  normalizeWork(work, job) {
    const paper = Search4PaperDiscovery.normalizeWork(work);
    if (!job.years.includes(paper.year)) throw new Error("OpenAlex 返回了指定年份以外的论文。");
    if (job.issn && !(work.primary_location?.source?.issn || []).includes(job.issn)) {
      throw new Error("OpenAlex 返回了指定期刊 ISSN 以外的论文。");
    }
    const extra = new Set([`OpenAlex ID: ${paper.openalexID}`]);
    for (const location of work.locations || []) {
      for (const key of Search4PaperCore.identities({ url: location.landing_page_url })) {
        if (key.startsWith("openreview:")) extra.add(`OpenReview ID: ${key.slice(11)}`);
      }
    }
    return { ...paper, source: "openalex", venueID: `OpenAlex/${paper.year}`, itemType: Search4PaperDiscovery.itemType(paper),
      date: work.publication_date || String(paper.year), yearBasis: "OpenAlex publication_year",
      keywords: (work.keywords || []).map(k => k.display_name).filter(Boolean).join("; "), tldr: "",
      issn: (work.primary_location?.source?.issn || []).join(", "), extra: [...extra].join("\n") };
  },

  provenance(paper, entry, priority) {
    return { ...paper, crossPriority: priority, searchProvenance: [entry] };
  },

  async readLocal(session, { readMetadata, signal }) {
    const records = [], local = [];
    for (const target of session.targets) {
      signal?.throwIfAborted();
      const metadata = await readMetadata(target);
      signal?.throwIfAborted();
      if (metadata === null) {
        local.push({ ...target, available: false, count: 0, matched: 0 });
        continue;
      }
      Search4PaperCore.validateMetadata(metadata, target.year, target.conference);
      const papers = metadata.papers.filter(p => Search4PaperCore.matchPaper(p, session.query));
      local.push({ ...target, available: true, count: metadata.papers.length, matched: papers.length, fetchedAt: metadata.fetchedAt });
      for (const paper of papers) records.push(this.provenance(paper, {
        source: `本地名单 · ${target.conference} ${target.year}`, url: paper.url, fetchedAt: metadata.fetchedAt
      }, 1));
    }
    return { ...session, local, records };
  },

  hasMore(session) { return session.jobs.some(job => !job.done && !job.capped); },

  async next(session, { request, signal, onProgress = () => {} }) {
    // Publish only after the whole bounded batch succeeds. Cancellation/errors leave the last batch untouched.
    const jobs = session.jobs.map(job => ({ ...job, seen: [...job.seen] }));
    const records = [...session.records];
    for (const job of jobs.filter(job => !job.done && !job.capped)) {
      signal?.throwIfAborted();
      onProgress(`${job.label}：读取第 ${job.offset / this.pageSize + 1} 页（最多 ${this.pageSize} 条）`);
      const url = this.url(job), payload = await request(url, signal);
      signal?.throwIfAborted();
      const raw = job.kind === "openreview" ? payload?.notes : payload?.results;
      const total = job.kind === "openreview" ? payload?.count : payload?.meta?.count;
      if (!Array.isArray(raw) || !Number.isInteger(total) || total < 0 || raw.length > this.pageSize) {
        throw new Error(`${job.label}：分页响应格式异常。`);
      }
      if (job.total !== null && job.total !== total) throw new Error(`${job.label}：候选总数发生变化，请重新跨来源搜索。`);
      if (job.offset + raw.length > total || (!raw.length && job.offset < total)) {
        throw new Error(`${job.label}：候选分页提前结束或数量不一致。`);
      }
      // Page-based OpenAlex paging advances by page size; short non-final pages would skip records.
      if (raw.length < this.pageSize && job.offset + raw.length < total) throw new Error(`${job.label}：非末页记录不足，请重新搜索。`);
      const fetchedAt = new Date().toISOString();
      for (const value of raw) {
        const paper = job.kind === "openreview" ? Search4PaperCore.normalizeNote(value, job.year, job.conference) : this.normalizeWork(value, job);
        if (job.seen.includes(paper.id)) throw new Error(`${job.label}：分页出现重复标识，请重新搜索。`);
        job.seen.push(paper.id);
        records.push(this.provenance(paper, { source: job.label, url, fetchedAt }, job.kind === "openreview" ? 0 : 2));
      }
      job.offset += raw.length; job.total = total; job.done = job.offset >= total;
      job.capped = !job.done && job.offset >= 10000;
    }
    return { ...session, jobs, records };
  },

  results(session) {
    const groups = [], index = new Map();
    for (const record of session.records) {
      const keys = Search4PaperCore.identities(record);
      const matches = [...new Set([...keys].map(key => index.get(key)).filter(Boolean))];
      const group = matches[0] || { records: [], keys: new Set(), active: true };
      if (!matches.length) groups.push(group);
      for (const other of matches.slice(1)) {
        group.records.push(...other.records);
        for (const key of other.keys) group.keys.add(key);
        other.active = false;
      }
      group.records.push(record);
      for (const key of keys) group.keys.add(key);
      group.doi = Search4PaperCore.uniqueDOI(group.keys);
      for (const key of group.keys) index.set(key, group);
    }
    const papers = [];
    for (const group of groups.filter(group => group.active)) {
      // A complete query must match one actual source record, never a synthetic mixture of two abstracts/titles.
      const ranked = [...group.records].sort((a, b) => a.crossPriority - b.crossPriority);
      const matched = ranked.map(p => Search4PaperCore.matchPaper(p, session.query)).find(Boolean);
      if (!matched) continue;
      const base = { ...matched }, provenance = new Map();
      for (const record of ranked) {
        for (const field of ["doi", "abstract", "keywords", "tldr", "pdfURL", "openalexID"]) {
          if (!base[field] && record[field]) base[field] = record[field];
        }
        if (record.citation && (!base.citation || record.citation.retrievedAt > base.citation.retrievedAt)) {
          base.citation = record.citation;
        }
        for (const source of record.searchProvenance) provenance.set(`${source.source}\n${source.url}\n${source.fetchedAt}`, source);
      }
      if (!base.doi && group.doi) base.doi = group.doi;
      const aliases = [...group.keys].flatMap(key => key.startsWith("openreview:") ? [`OpenReview ID: ${key.slice(11)}`]
        : key.startsWith("openalex:") ? [`OpenAlex ID: ${key.slice(9)}`]
        : key.startsWith("source:") ? [`Source ID: ${key.slice(7)}`] : []);
      base.extra = [...new Set([...(base.extra || "").split("\n").filter(Boolean), ...aliases])].join("\n");
      base.searchProvenance = [...provenance.values()];
      // Prefer a provider-independent strong key so loading another page does not invalidate selections.
      base.crossKey = [...group.keys].sort((a, b) => Number(b.startsWith("doi:")) - Number(a.startsWith("doi:")) || a.localeCompare(b))[0];
      papers.push(base);
    }
    const titles = new Map();
    for (const paper of papers) {
      const title = Search4PaperDiscovery.normalize(paper.title);
      if (!titles.has(title)) titles.set(title, []);
      titles.get(title).push(paper);
    }
    for (const group of titles.values()) if (group.length > 1) for (const paper of group) {
      paper.duplicateHint = `存在 ${group.length - 1} 条同标题、不同标识的候选，可能为不同版本；未自动合并。`;
    }
    return papers;
  },

  coverage(session, count) {
    const remaining = session.jobs.filter(j => !j.done && !j.capped).length;
    const capped = session.jobs.filter(j => j.capped).length;
    const lines = [`跨来源搜索：本地复核通过 ${count} 篇。${remaining ? `部分结果，${remaining} 个远程查询还有下一页。` : "已读完本次远程查询可读取的结果。"}`,
      "各查询候选可能重复，数量不能相加视作独立论文数；远程索引及匹配规则不保证覆盖官方完整名单。"];
    if (session.openAlex === "all") lines.push("OpenAlex 查询不限会议／期刊，不受上方 CCF 目录筛选限制；年份仍按所选范围。");
    if (session.query.fields.includes("tldr")) lines.push("OpenAlex 不提供 TLDR；OpenReview 的 TLDR 仅在服务端返回候选后复核，不保证由该字段完整召回。");
    for (const row of session.local) {
      lines.push(row.available ? `${row.conference} ${row.year}：本地名单 ${row.count} 篇，命中 ${row.matched} 篇；获取于 ${row.fetchedAt}。`
        : `${row.conference} ${row.year}：没有本地名单，未下载整届数据${Search4PaperCore.OPENREVIEW_CONFERENCES.includes(row.conference) ? "；已安排 OpenReview 关键词查询" : "；官方名单范围未覆盖"}。`);
    }
    for (const job of session.jobs) lines.push(`${job.label}：已读取 ${job.offset} / ${job.total ?? "未查询"} 条；${job.capped ? "达到 10,000 条分页上限，请缩小条件" : job.done ? "已读完" : "部分结果"}。`);
    if (capped) lines.push(`${capped} 个查询达到分页上限，结果不完整。`);
    if (session.jobs.some(j => j.kind === "openreview" && j.total === 0)) lines.push("OpenReview 零候选也可能是名单尚未公开或尚未被其搜索索引收录，不能确认该届没有相关论文。");
    if (session.jobs.some(j => j.kind === "openalex" && j.total === 0)) lines.push("OpenAlex 零候选仅表示当前索引与筛选没有返回；按 ISSN 查询可能未覆盖其他来源记录，不能据此判断期刊没有相关论文。");
    return lines.join("\n");
  }
};
if (typeof module !== "undefined") module.exports = Search4PaperCrossSearch;
