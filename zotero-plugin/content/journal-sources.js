/* Published journal metadata, separate from conference acceptance lists. */
var Search4PaperJournalSources = (() => {
  const text = node => (node?.textContent || "").replace(/\s+/g, " ").trim();
  const html = raw => new DOMParser().parseFromString(raw, "text/html");
  const plain = value => {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw new Error("期刊书目字段不是文本。");
    return /[<&]/.test(value) ? text(html(value).body) : value.replace(/\s+/g, " ").trim();
  };
  function configFor(journal, year) {
    const config = Search4PaperCore.JOURNAL_SOURCES[journal];
    if (!config) throw new Error("请选择受支持的期刊。");
    Search4PaperCore.validateYear(year);
    const error = Search4PaperCore.sourceYearError(journal, year);
    if (error) throw new Error(error);
    return config;
  }
  function paper(journal, year, fields) {
    const config = configFor(journal, year);
    return { year, venueID: Search4PaperCore.venueID(journal, year), itemType: "journalArticle",
      source: config.source, sourceURL: journal === "JMLR" ? `https://jmlr.org/papers/v${config.volumes[year]}/`
        : `https://api.crossref.org/journals/${config.issn}/works`,
      publicationTitle: config.title, journalAbbreviation: journal, issn: config.issn,
      yearBasis: config.yearBasis, retrievalWarning: config.warning,
      abstract: "", keywords: "", tldr: "", doi: "", pdfURL: "", bibtex: "", number: null,
      volume: "", issue: "", pages: "", date: String(year), onlineDate: "", printDate: "", ...fields };
  }
  function date(value) {
    if (value === undefined) return "";
    const parts = value?.["date-parts"]?.[0];
    if (!Array.isArray(parts) || parts.length < 1 || parts.length > 3 || !parts.every(Number.isInteger)
      || parts[0] < 1000 || parts[0] > 9999 || (parts.length > 1 && (parts[1] < 1 || parts[1] > 12))
      || (parts.length > 2 && (parts[2] < 1 || parts[2] > new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate()))) {
      throw new Error("Crossref 出版日期格式异常。");
    }
    return parts.map((n, i) => String(n).padStart(i ? 2 : 4, "0")).join("-");
  }
  function normalizeCrossref(record, journal, year) {
    const config = configFor(journal, year), published = date(record.published);
    const doi = plain(record.DOI).toLowerCase(), title = plain(record.title?.[0]);
    if (config.source !== "crossref-journal" || record.type !== "journal-article"
      || !Array.isArray(record.ISSN) || !record.ISSN.includes(config.issn)
      || plain(record["container-title"]?.[0]) !== config.title || Number(published.slice(0, 4)) !== year) {
      throw new Error(`${journal} 返回了其他期刊、类型或出版年份的记录。`);
    }
    if (!/^10\.\d{4,9}\/\S+$/.test(doi) || !title) throw new Error("Crossref 期刊记录缺少 DOI 或标题。");
    if (record.author !== undefined && !Array.isArray(record.author)) throw new Error("Crossref 作者格式异常。");
    const authors = (record.author || []).map(author => {
      const name = plain(author.name || [author.given, author.family].filter(Boolean).join(" "));
      if (!name) throw new Error("Crossref 作者姓名为空。");
      return name;
    });
    return paper(journal, year, { id: doi, doi, title, authors, url: `https://doi.org/${doi}`,
      abstract: plain(record.abstract), volume: plain(record.volume), issue: plain(record.issue), pages: plain(record.page),
      date: published, onlineDate: date(record["published-online"]), printDate: date(record["published-print"]) });
  }
  async function fetchCrossref(journal, year, { request, signal, onProgress = () => {} }) {
    const config = configFor(journal, year), papers = [], ids = new Set();
    let cursor = "*", total;
    while (true) {
      signal?.throwIfAborted();
      const params = new URLSearchParams({ filter: `from-pub-date:${year}-01-01,until-pub-date:${year}-12-31,type:journal-article`,
        rows: "1000", cursor,
        select: "DOI,title,author,ISSN,container-title,published,published-print,published-online,volume,issue,page,abstract,type" });
      const response = await request(`https://api.crossref.org/journals/${config.issn}/works?${params}`, signal, "json");
      signal?.throwIfAborted();
      const message = response?.message, count = message?.["total-results"];
      if (response?.status !== "ok" || !Number.isInteger(count) || count < 0 || !Array.isArray(message?.items)
        || (total !== undefined && count !== total)) throw new Error("Crossref 分页总数变化或响应格式异常，请重新刷新名单。");
      total = count;
      for (const record of message.items) {
        const p = normalizeCrossref(record, journal, year);
        if (ids.has(p.id)) throw new Error("Crossref 分页返回重复 DOI，未取得完整书目。");
        ids.add(p.id); papers.push(p);
      }
      onProgress(papers.length, total, "Crossref 已索引期刊书目");
      if (papers.length > total) throw new Error("Crossref 返回数量超过声明的书目总数。");
      if (papers.length === total) return papers;
      if (!message.items.length || typeof message["next-cursor"] !== "string" || !message["next-cursor"]) {
        throw new Error("Crossref 分页提前结束，未取得完整书目。");
      }
      // Some Crossref deployments keep the same cursor while advancing its results.
      // Duplicate DOI and count checks above verify progress without rejecting that protocol.
      cursor = message["next-cursor"];
    }
  }
  function jmlrURL(value, base) {
    const url = new URL(value, base);
    if (!["http:", "https:"].includes(url.protocol) || !["jmlr.org", "www.jmlr.org"].includes(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash) throw new Error("JMLR 论文链接来源异常。");
    return `https://jmlr.org${url.pathname}`;
  }
  function parseJMLRIndex(raw, year) {
    const config = configFor("JMLR", year), volume = config.volumes[year], base = `https://jmlr.org/papers/v${volume}/`;
    const doc = html(raw);
    if (text(doc.querySelector("#content h1")) !== `JMLR Volume ${volume}`) throw new Error("JMLR 返回了其他卷或无效目录。");
    const rows = [...doc.querySelectorAll("#content dl")];
    if (!rows.length) throw new Error("JMLR 卷目录未提供论文。");
    const ids = new Set();
    return rows.map(row => {
      const title = text(row.querySelector("dt")), detail = row.querySelector("dd");
      const links = [...(detail?.querySelectorAll("a[href]") || [])], abs = links.filter(a => text(a) === "abs");
      const citation = text(detail).match(/;\s*\((\d+)\):\s*(\d+)\s*[-−–]\s*(\d+),\s*(\d{4})\./);
      if (!title || abs.length !== 1 || !citation || Number(citation[4]) !== year) throw new Error("JMLR 目录的标题、页码或出版年异常。");
      const url = jmlrURL(abs[0].getAttribute("href"), base), id = url.match(new RegExp(`/papers/(v${volume}/[a-zA-Z0-9_-]+)\\.html$`))?.[1];
      const pdf = links.find(a => text(a) === "pdf");
      if (!id || ids.has(id)) throw new Error("JMLR 目录论文 ID 无效或重复。");
      ids.add(id);
      return paper("JMLR", year, { id, title, url, authors: [], volume: String(volume), issue: citation[1],
        pages: `${citation[2]}-${citation[3]}`, pdfURL: pdf ? jmlrURL(pdf.getAttribute("href"), base) : "" });
    });
  }
  function completeJMLR(p, raw) {
    const doc = html(raw), meta = name => doc.querySelector(`meta[name="citation_${name}"]`)?.getAttribute("content")?.trim() || "";
    if (jmlrURL(meta("public_url"), p.url) !== p.url || !meta("public_url")
      || Search4PaperCore.words(meta("title")).join(" ") !== Search4PaperCore.words(p.title).join(" ")
      || meta("journal_title") !== p.publicationTitle || meta("volume") !== p.volume || meta("issue") !== p.issue
      || meta("publication_date") !== String(p.year) || meta("issn") !== p.issn
      || `${meta("firstpage")}-${meta("lastpage")}` !== p.pages) throw new Error(`JMLR 详情的论文身份或书目信息与目录不一致：${p.url}`);
    const authors = [...doc.querySelectorAll('meta[name="citation_author"]')].map(n => n.getAttribute("content")?.trim());
    if (!authors.length || authors.some(n => !n)) throw new Error(`JMLR 论文作者不完整：${p.url}`);
    return { ...p, authors, abstract: text(doc.querySelector(".abstract")) };
  }
  async function fetchPublished(journal, year, options) {
    configFor(journal, year);
    let papers;
    if (journal !== "JMLR") papers = await fetchCrossref(journal, year, options);
    else {
      const { request, signal, onProgress = () => {} } = options;
      signal?.throwIfAborted();
      const volume = Search4PaperCore.JOURNAL_SOURCES.JMLR.volumes[year];
      papers = parseJMLRIndex(await request(`https://jmlr.org/papers/v${volume}/`, signal, "text"), year);
      for (let i = 0; i < papers.length; i++) {
        signal?.throwIfAborted();
        papers[i] = completeJMLR(papers[i], await request(papers[i].url, signal, "text"));
        signal?.throwIfAborted();
        onProgress(i + 1, papers.length, "读取 JMLR 论文摘要与书目");
      }
    }
    if (!papers.length) throw new Error(`${journal} ${year} 来源未返回已出版书目；这不表示没有相关论文。`);
    return papers;
  }
  return { fetchPublished, normalizeCrossref, parseJMLRIndex, completeJMLR };
})();
