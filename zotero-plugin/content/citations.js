/* On-demand OpenAlex counts. No source records or caches are modified. */
var Search4PaperCitations = {
  fields: "id,doi,title,publication_year,authorships,cited_by_count",

  async lookup(paper, { request, signal, now = () => new Date().toISOString() } = {}) {
    signal?.throwIfAborted();
    const discovery = Search4PaperDiscovery;
    const identities = Search4PaperCore.identities(paper);
    const doi = Search4PaperCore.uniqueDOI(identities);
    const ids = [...identities].filter(key => key.startsWith("openalex:")).map(key => key.slice(9));
    const result = (status, matchMethod, sourceURL, message, count = null) => ({
      source: "OpenAlex", status, count, retrievedAt: now(), sourceURL, matchMethod, message
    });
    if (ids.length > 1) return result("unmatched", "", "", "已有 OpenAlex 标识相互冲突，请先核对来源。");
    const savedID = ids[0] || "";
    if (paper.openalexID && !/^W\d+$/.test(paper.openalexID)) {
      return result("unmatched", "", "", "已有 OpenAlex 标识格式无效。");
    }
    if (doi && !/^10\.\d{4,9}\/\S+$/.test(doi)) {
      return result("unmatched", "doi", "", "已有 DOI 格式无效。");
    }

    let method, endpoint;
    if (doi || savedID) {
      method = doi ? "doi" : "openalex_id";
      const identifier = doi ? `https://doi.org/${encodeURIComponent(doi)}` : savedID;
      endpoint = `https://api.openalex.org/works/${identifier}?select=${this.fields}`;
    }
    else {
      const title = typeof paper.title === "string" ? paper.title.trim() : "";
      if (!discovery.normalize(title) || !Number.isInteger(Number(paper.year)) || Number(paper.year) < 1
        || !Array.isArray(paper.authors) || !paper.authors.length
        || paper.authors.some(author => typeof author !== "string" || !author.trim())) {
        return result("unmatched", "", "", "缺少 DOI / OpenAlex ID，且标题、作者或年份不足以核对论文。");
      }
      method = "title_authors_year";
      endpoint = `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per-page=10&select=${this.fields}`;
    }

    let response;
    try { response = await request(endpoint, signal, "json"); }
    catch (error) {
      signal?.throwIfAborted();
      if (error.status === 404) return result("not_found", method, endpoint, "OpenAlex 未收录此查询对应的记录。");
      throw error;
    }
    signal?.throwIfAborted();
    const workID = work => {
      if (!work || typeof work !== "object" || typeof work.title !== "string" || !work.title.trim()
        || !/^(?:https:\/\/openalex\.org\/)?W\d+$/.test(work.id || "")) {
        throw new Error("OpenAlex 引用查询返回了缺少有效 ID 或标题的记录。");
      }
      return discovery.id(work.id);
    };
    let work = response;
    if (method === "title_authors_year") {
      if (!Array.isArray(response?.results)) throw new Error("OpenAlex 引用查询返回的候选格式无效。");
      const matches = response.results.filter(candidate => {
        workID(candidate);
        return discovery.normalize(candidate.title) === discovery.normalize(paper.title)
          && Number(candidate.publication_year) === Number(paper.year)
          && discovery.authorMatch(paper.authors, discovery.workAuthors(candidate));
      });
      // This bounded lookup only establishes uniqueness among the returned first 10 candidates.
      if (!matches.length) return result("not_found", method, endpoint, "本次前 10 条候选中未找到标题、作者和年份一致的记录。");
      if (matches.length !== 1) return result("unmatched", method, endpoint, "本次候选中存在多个标题、作者和年份一致的记录，未采用引用数。");
      work = matches[0];
    }
    const id = workID(work), sourceURL = `https://openalex.org/${id}`;
    const returnedDOI = Search4PaperCore.uniqueDOI(Search4PaperCore.identities({ doi: work.doi }));
    if (doi && returnedDOI !== doi) return result("unmatched", method, endpoint, "OpenAlex 返回的 DOI 与所选论文不一致，未采用引用数。");
    if (savedID && id !== savedID) return result("unmatched", method, endpoint, "OpenAlex 返回的 ID 与已有标识不一致，未采用引用数。");
    const count = work.cited_by_count;
    if (count !== null && count !== undefined && (!Number.isSafeInteger(count) || count < 0)) {
      throw new Error("OpenAlex 返回的引用数不是有效的非负整数。");
    }
    const evidence = method === "title_authors_year" ? "仅在本次前 10 条候选中核对标题、作者和年份。" : "";
    return result("matched", method, sourceURL,
      (count === null || count === undefined ? "已匹配记录，但来源未提供引用数。" : "") + evidence,
      count ?? null);
  }
};
