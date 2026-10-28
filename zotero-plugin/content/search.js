/* Runs only in the privileged plugin window; no localhost service is used. */
var Search4PaperUI = {
  Zotero: window.arguments[0].Zotero,
  ieee: window.arguments[0].ieeeSession,
  acm: window.arguments[0].acmSession,
  activePage: "search", operationPage: null,
  papers: [], candidates: [], selected: new Set(), active: null,
  discoveryPapers: [], discoverySeeds: [], discoverySelected: new Set(), discoveryActive: null,
  materialTarget: null, materialCandidates: [], materialSelected: new Set(), materialSaved: new Set(),
  discoverySummary: "", openAlexRate: null, supportError: "",
  page: 0, pageSize: 100, busy: false, controller: null, query: null, loadedTargets: [], coverageRows: [], filtersDirty: true,
  labels: { title: "标题", abstract: "摘要", keywords: "关键词", tldr: "TLDR" },
  $(id) { return document.getElementById(id); },
  selectedConferences() {
    const select = this.$("conference");
    const selected = [...(select.selectedOptions || [])].map(option => option.value).filter(Boolean);
    return selected.length ? selected : select.value ? [select.value] : [];
  },
  selectedYears() {
    const years = new Set();
    for (const part of String(this.$("year").value || "").split(/[;；,，\s]+/).filter(Boolean)) {
      const range = part.match(/^((?:19|20)\d{2})-((?:19|20)\d{2})$/);
      if (range) {
        const first = Number(range[1]), last = Number(range[2]);
        if (first > last || last - first > 10) throw new Error("年份范围必须递增且最多跨 10 年。");
        for (let year = first; year <= last; year++) years.add(year);
      }
      else {
        const year = Number(part); Search4PaperCore.validateYear(year); years.add(year);
      }
    }
    if (!years.size) throw new Error("请至少输入一个年份。");
    return [...years].sort((a, b) => a - b);
  },
  selectedTargets() {
    const conferences = this.selectedConferences();
    if (!conferences.length) throw new Error("请至少选择一个会议或期刊。");
    const years = this.selectedYears();
    const targets = conferences.flatMap(conference => years.map(year => ({ conference, year })));
    const unsupported = targets.map(({ conference, year }) => Search4PaperCore.sourceYearError(conference, year)).filter(Boolean);
    if (unsupported.length) throw new Error(unsupported.join("\n"));
    return targets;
  },
  updateSourceSupport() {
    const names = [...this.$("conference").options].map(option => option.value);
    const selected = new Set(this.selectedConferences()), escape = Search4PaperCore.escapeHTML;
    names.sort((a, b) => Number(selected.has(b)) - Number(selected.has(a)));
    this.$("support-rows").innerHTML = names.map(name => {
      const support = Search4PaperCore.sourceSupport(name);
      return `<tr${selected.has(name) ? ' class="selected-source"' : ""}><td>${escape(name)}</td>`
        + `<td>${support.conditional ? "规则：" : "已核实："}${escape(support.label)}</td><td>${escape(support.scope)}</td></tr>`;
    }).join("");
    this.$("support-summary").textContent = `查看支持范围（当前目录 ${names.length} 个会议 / 期刊）`;
    const labels = [...selected].map(name => `${name}：${Search4PaperCore.sourceSupport(name).label}`);
    this.supportError = "";
    let warnings = [];
    try {
      const targets = this.selectedTargets();
      warnings = targets.map(({ conference, year }) => {
        const config = Search4PaperCore.JOURNAL_SOURCES[conference] || Search4PaperCore.DATABASE_SOURCES[conference]?.[year] || Search4PaperCore.SYSTEMS_SOURCES[conference]?.[year];
        return config?.warning ? `${conference} ${year}：${config.warning}` : "";
      }).filter(Boolean);
    }
    catch (error) { this.supportError = error.message; }
    this.$("year-support").textContent = [this.supportError || `可查询年份：${labels.join("；")}。`, ...warnings].join("\n");
    this.$("year-support").classList.toggle("error", Boolean(this.supportError));
  },
  targetKey(target) { return `${target.conference}:${target.year}`; },
  paperKey(paper) { return `${paper.venueID}:${paper.id}`; },
  switchPage(page) {
    this.activePage = page;
    for (const name of ["search", "discovery", "fulltext", "materials"]) {
      this.$("page-" + name).hidden = name !== page;
      this.$("tab-" + name).setAttribute("aria-selected", String(name === page));
      this.$("tab-" + name).tabIndex = name === page ? 0 : -1;
    }
    this.$("page-title").textContent = { search: "论文检索", discovery: "文献发现", fulltext: "全文获取", materials: "代码仓库" }[page];
  },
  status(text, error = false) {
    const page = this.operationPage || this.activePage;
    const id = page === "search" ? "status" : `${page}-status`;
    this.$(id).textContent = text;
    this.$(id).classList.toggle("error", error);
  },
  controls() {
    for (const element of document.querySelectorAll("input, select, button")) element.disabled = this.busy;
    this.$("tab-search").disabled = this.$("tab-discovery").disabled = this.$("tab-fulltext").disabled = this.$("tab-materials").disabled = false;
    this.$("cancel").disabled = !this.busy || this.operationPage !== "search";
    this.$("fulltext-cancel").disabled = !this.busy || this.operationPage !== "fulltext";
    this.$("discovery-cancel").disabled = !this.busy || this.operationPage !== "discovery";
    this.$("materials-cancel").disabled = !this.busy || this.operationPage !== "materials";
    if (this.busy) return;
    const noConference = !this.selectedConferences().length;
    this.$("conference").disabled = noConference;
    this.$("fetch").disabled = this.$("refresh-papers").disabled = noConference || Boolean(this.supportError);
    this.$("filter").disabled = noConference || Boolean(this.supportError) || !this.papers.length;
    this.$("import").disabled = !this.selected.size || this.filtersDirty;
    this.$("import").title = this.filtersDirty ? "检索条件已修改，请先搜索论文或应用筛选。"
      : !this.selected.size ? "请勾选论文左侧的复选框，或点击“选中本页”。" : "导入到所选文献库位置。";
    this.$("select-page").disabled = !this.candidates.length;
    this.$("clear").disabled = !this.selected.size;
    this.$("enrich-abstracts").disabled = !this.selected.size;
    this.$("previous").disabled = this.page === 0;
    this.$("next").disabled = (this.page + 1) * this.pageSize >= this.candidates.length;
    this.$("source").disabled = !this.active;
    this.$("discovery-import").disabled = !this.discoverySelected.size;
    this.$("discovery-source").disabled = !this.discoveryActive;
    this.$("materials-save").disabled = !this.materialTarget || !this.materialSelected.size;
  },
  updateConferenceOptions() {
    const select = this.$("conference"), previous = new Set(this.selectedConferences());
    const names = Search4PaperCore.filterConferences({ field: this.$("venue-field").value,
      type: this.$("venue-type").value, rank: this.$("venue-rank").value });
    select.replaceChildren();
    for (const name of names) {
      const option = new Option(name, name); option.selected = previous.has(name); select.add(option);
    }
    select.size = Math.min(6, Math.max(2, names.length));
    if (!names.some(name => previous.has(name)) && names.length) {
      select.value = names[0]; select.options[0].selected = true;
    }
    if (!names.length) select.value = "";
    this.$("venue-summary").textContent = names.length
      ? `CCF 2026 · 当前可选 ${names.length} / ${Search4PaperCore.VENUES.length} 个来源（共 ${Search4PaperCore.CONFERENCES.length} 个会议、${Object.keys(Search4PaperCore.JOURNAL_SOURCES).length} 本期刊）。三个目录条件同时满足。`
      : "当前组合暂无已支持来源，请调整目录筛选。";
    const changed = [...previous].sort().join("\n") !== this.selectedConferences().sort().join("\n");
    if (changed && this.loadedTargets.length) {
      this.filtersDirty = true;
      this.status("会议 / 期刊选择已改变；已有结果保留，更换来源后请重新搜索。");
    }
    this.updateSourceSupport();
    this.controls();
  },
  async operation(action) {
    if (this.busy) return;
    this.busy = true;
    this.operationPage = this.activePage;
    this.controller = new AbortController();
    this.controls();
    try { await action(this.controller.signal); }
    catch (error) {
      if (!window.closed) this.status(this.controller.signal.aborted ? "操作已取消。" : error.message, !this.controller.signal.aborted);
      if (!this.controller.signal.aborted) this.Zotero.logError(error);
    }
    finally {
      this.busy = false;
      this.operationPage = null;
      this.controller = null;
      if (!window.closed) this.controls();
    }
  },
  readQuery() {
    const query = { terms: Search4PaperCore.splitTerms(this.$("terms").value),
      operator: this.$("operator").value,
      fields: Search4PaperCore.FIELDS.filter(field => this.$("field-" + field).checked) };
    Search4PaperCore.validateQuery(query);
    return query;
  },
  updateQuerySummary() {
    const terms = Search4PaperCore.splitTerms(this.$("terms").value);
    const operator = this.$("operator").value;
    this.$("query-expression").textContent = terms.length
      ? terms.map(term => `“${term}”`).join(` ${operator} `)
      : "请填写至少一个关键词。";
    const fields = Search4PaperCore.FIELDS.filter(field => this.$("field-" + field).checked);
    this.$("field-rule").textContent = fields.length
      ? `查找位置：${fields.map(field => this.labels[field]).join(" / ")}。关键词可在任一勾选字段中命中，不同关键词可出现在不同字段。`
      : "请至少勾选一个查找位置。";
  },
  async request(url, signal, responseType = "json") {
    signal.throwIfAborted();
    const openAlex = URL.canParse(url) && new URL(url).hostname === "api.openalex.org";
    const github = URL.canParse(url) && new URL(url).hostname === "api.github.com";
    const openAlexRequest = openAlex ? Search4PaperDiscovery.apiRequest(url,
      this.Zotero.Prefs.get("extensions.search4paper.openAlexAPIKey", true) || "") : null;
    const requestURL = openAlexRequest?.url || url;
    let cancel;
    const abort = () => cancel?.();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.Zotero.HTTP.request("GET", requestURL, {
        // Official proceedings XML/program files can exceed 10 MB on a slow connection.
        responseType: responseType === "html" ? "text" : responseType,
        timeout: url.startsWith("https://api2.openreview.net/") ? 60000 : 300000,
        errorDelayMax: 0, noRetryOnThrottle: true,
        // A live ICML page at offset 5000 returned a cached empty response;
        // Cache-Control: no-cache returned the complete page and correct total.
        noCache: true, headers: { "Cache-Control": "no-cache", ...openAlexRequest?.headers,
          ...(github ? { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } : {}) },
        cancellerReceiver(fn) { cancel = fn; if (signal.aborted) fn(); }
      });
      if (openAlex) {
        this.openAlexRate = Search4PaperDiscovery.rateLimit(response);
        this.updateOpenAlexQuota();
      }
      // Relative material links must resolve against the final page after redirects.
      return responseType === "html" ? { body: response.response, url: response.responseURL } : response.response;
    }
    catch (error) {
      signal.throwIfAborted();
      if (github) throw Object.assign(new Error(`GitHub 请求失败${error.status ? `（HTTP ${error.status}）` : ""}：${error.message}`),
        { status: error.status, apiMessage: error.xmlhttp?.response?.message });
      if (openAlex && error.status === 429) throw new Error("OpenAlex API 今日额度已用尽或请求过快（HTTP 429）。请配置免费 API Key，或等待额度在 UTC 00:00 重置。");
      const missing = responseType === "html" ? "该论文来源地址不存在或已移除。" : "该来源年份的数据尚不可用。";
      throw new Error(`论文来源请求失败${error.status ? `（HTTP ${error.status}）` : ""}：${url}\n${error.status === 404 ? missing : error.message}`);
    }
    finally { signal.removeEventListener("abort", abort); }
  },
  async fetchPapers(signal, refresh = false) {
    const query = this.readQuery();
    const targets = this.selectedTargets();
    this.papers = []; this.loadedTargets = []; this.coverageRows = []; this.query = null;
    this.candidates = []; this.selected.clear(); this.active = null; this.page = 0;
    this.render(); this.preview(null);
    this.$("coverage").textContent = `正在读取 ${targets.length} 个来源/年份范围的论文名单…`;
    this.status("正在读取本地元数据…");
    const loaded = [];
    try {
      for (let index = 0; index < targets.length; index++) {
        const { conference, year } = targets[index], venueID = Search4PaperCore.venueID(conference, year);
        const source = Search4PaperCore.sourceName(conference);
        const path = PathUtils.join(this.Zotero.DataDirectory.dir, "search4paper", conference, `${year}.json`);
        let metadata, local = false;
        if (!refresh && await IOUtils.exists(path)) {
          local = true;
          try { metadata = Search4PaperCore.validateMetadata(await IOUtils.readJSON(path), year, conference); }
          catch (error) { throw new Error(`读取本地元数据失败：${error.message}\n${path}\n请点击“刷新名单”重新获取。`); }
        }
        else {
          this.status(`正在连接 ${source}（${index + 1} / ${targets.length}）…`);
          const papers = await Search4PaperSources.fetchAccepted(year, { conference, signal,
            request: (url, requestSignal, type) => this.request(url, requestSignal, type),
            onProgress: (done, total, detail = "") => this.status(`获取 ${conference} ${year}（${index + 1} / ${targets.length}）：${done}${total == null ? "" : ` / ${total}`} 篇${detail ? ` · ${detail}` : ""}`) });
          metadata = { schemaVersion: 1, venueID, year, fetchedAt: new Date().toISOString(), paperCount: papers.length, papers };
          signal.throwIfAborted();
          await IOUtils.makeDirectory(PathUtils.parent(path), { createAncestors: true });
          await IOUtils.writeJSON(path, metadata, { tmpPath: `${path}.tmp` });
        }
        loaded.push({ target: { conference, year }, metadata, local, source, path });
        signal.throwIfAborted();
      }
    }
    catch (error) {
      this.$("coverage").textContent = `本次未加载完整范围（已完成 ${loaded.length} / ${targets.length}）；未发布部分结果。`;
      throw error;
    }
    this.papers = loaded.flatMap(entry => entry.metadata.papers);
    this.loadedTargets = targets;
    this.coverageRows = loaded.map(entry => ({ ...entry.target, source: entry.source,
      paperCount: entry.metadata.paperCount,
      missingAbstracts: entry.metadata.papers.filter(paper => !paper.abstract.trim()).length,
      local: entry.local, fetchedAt: entry.metadata.fetchedAt,
      warning: entry.metadata.papers[0]?.retrievalWarning || "" }));
    this.$("coverage").textContent = `已加载 ${loaded.length} 个来源/年份范围、${this.papers.length} 篇论文；缺少摘要 ${this.coverageRows.reduce((sum, row) => sum + row.missingAbstracts, 0)} 篇。\n`
      + this.coverageRows.map(row => `${row.conference} ${row.year} · ${row.source} · ${row.paperCount} 篇 · 缺摘要 ${row.missingAbstracts} · ${row.local ? "本地名单" : "已保存到本地"}${row.warning ? ` · ${row.warning}` : ""}`).join("\n");
    await this.filterPapers(signal, query);
  },
  async filterPapers(signal, query = this.readQuery()) {
    const selected = this.selectedTargets().map(target => this.targetKey(target)).sort();
    const loaded = this.loadedTargets.map(target => this.targetKey(target)).sort();
    if (selected.join("\n") !== loaded.join("\n")) throw new Error("会议、期刊或年份已更改，请点击“搜索论文”获取对应名单。");
    const candidates = [];
    for (let i = 0; i < this.papers.length; i++) {
      if (i % 100 === 0) {
        this.status(`筛选论文：${i} / ${this.papers.length}`);
        await new Promise(resolve => window.setTimeout(resolve, 0));
        signal.throwIfAborted();
      }
      const matched = Search4PaperCore.matchPaper(this.papers[i], query);
      if (matched) candidates.push(matched);
    }
    this.query = query; this.candidates = candidates; this.page = 0; this.selected.clear(); this.filtersDirty = false;
    this.render(); this.preview(candidates[0] || null);
    this.status(`找到 ${candidates.length} 篇候选论文。请查看摘要与命中依据。`);
  },
  render() {
    const tbody = this.$("results"); tbody.replaceChildren();
    for (const paper of this.candidates.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize)) {
      const key = this.paperKey(paper);
      const tr = document.createElementNS("http://www.w3.org/1999/xhtml", "tr"); tr.dataset.id = key;
      tr.classList.toggle("active", this.active && this.paperKey(this.active) === key);
      const choice = document.createElementNS("http://www.w3.org/1999/xhtml", "td"), text = document.createElementNS("http://www.w3.org/1999/xhtml", "td");
      const checkbox = document.createElementNS("http://www.w3.org/1999/xhtml", "input"); checkbox.type = "checkbox";
      checkbox.checked = this.selected.has(key); checkbox.setAttribute("aria-label", `选择 ${paper.title}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(key); else this.selected.delete(key);
        this.selection();
      });
      const title = document.createElementNS("http://www.w3.org/1999/xhtml", "button"); title.className = "paper-button"; title.textContent = paper.title;
      title.addEventListener("click", () => this.preview(paper));
      const fields = document.createElementNS("http://www.w3.org/1999/xhtml", "span"); fields.className = "match-fields";
      fields.textContent = `${paper.venueID.split("/")[0]} ${paper.year} · ` + [...new Set(paper.evidence.map(hit => this.labels[hit.field]))].join(" · ");
      choice.append(checkbox); text.append(title, fields); tr.append(choice, text); tbody.append(tr);
    }
    this.$("count").textContent = `候选论文 ${this.candidates.length} 篇`;
    this.$("empty").hidden = this.candidates.length > 0;
    this.$("empty").textContent = this.papers.length ? "没有匹配的论文。可以调整词组或扩大搜索字段。" : "检索后在这里预览候选论文；点击标题查看摘要与命中依据。";
    this.$("page").textContent = `${this.candidates.length ? this.page + 1 : 0} / ${Math.ceil(this.candidates.length / this.pageSize)}`;
    this.selection();
  },
  selection() {
    this.$("selection").textContent = `已选 ${this.selected.size} 篇`;
    this.controls();
  },
  preview(paper) {
    this.active = paper;
    this.$("paper-title").textContent = paper?.title || "论文预览";
    this.$("authors").textContent = paper ? paper.authors.join("; ") : "";
    this.$("publication-info").hidden = paper?.itemType !== "journalArticle";
    this.$("publication-info").textContent = paper?.itemType === "journalArticle" ? [paper.publicationTitle,
      paper.volume && `卷 ${paper.volume}`, paper.issue && `期 ${paper.issue}`, paper.pages && `页 ${paper.pages}`,
      `出版日期 ${paper.date}`, `年份依据：${paper.yearBasis}`,
      paper.onlineDate && `在线出版 ${paper.onlineDate}`, paper.printDate && `卷期出版 ${paper.printDate}`].filter(Boolean).join(" · ") : "";
    this.$("abstract").textContent = paper ? paper.abstract || "来源未提供摘要。" : "选择一篇候选论文。";
    this.$("evidence").replaceChildren();
    for (const hit of paper?.evidence || []) {
      const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li"), label = document.createElementNS("http://www.w3.org/1999/xhtml", "strong");
      label.textContent = `${this.labels[hit.field]} · ${hit.term}：`;
      li.append(label, document.createTextNode(hit.text)); this.$("evidence").append(li);
    }
    for (const row of this.$("results").children) row.classList.toggle("active", paper && row.dataset.id === this.paperKey(paper));
    this.controls();
  },
  refreshCollections() {
    const select = this.$("collection"), current = select.value;
    select.replaceChildren(new Option("我的文献库（根目录）", ""));
    for (const collection of this.Zotero.Collections.getByLibrary(this.Zotero.Libraries.userLibraryID, true)) {
      const path = [collection.name];
      let parent = collection.parentID;
      while (parent) { const c = this.Zotero.Collections.get(parent); path.unshift(c.name); parent = c.parentID; }
      select.add(new Option(path.join(" / "), String(collection.id)));
    }
    select.value = current;
    if (select.selectedIndex < 0) select.value = "";
  },
  async importPapers(signal) {
    const papers = this.candidates.filter(p => this.selected.has(this.paperKey(p)));
    if (!papers.length) throw new Error("请先选择论文。");
    if (this.filtersDirty) throw new Error("检索条件已修改，请先应用筛选。");
    this.status("正在检查文献库中的已有条目…");
    const outcome = await Search4PaperImport.papers(this.Zotero, papers, {
      parentID: Number(this.$("collection").value) || null, name: this.$("new-collection").value,
      tags: Search4PaperCore.splitTerms(this.$("tags").value), query: this.query, signal,
      onProgress: (done, total, title) => this.status(`正在导入 ${done + 1} / ${total}：${title}`)
    });
    this.lastImport = outcome;
    const count = status => outcome.results.filter(result => result.status === status).length;
    let summary = `导入结果：新增 ${count("created")}，已有 ${count("existing")}，失败 ${count("failed")}，未处理 ${outcome.unprocessed}。`;
    this.refreshCollections();
    if (outcome.collectionID) this.$("collection").value = String(outcome.collectionID);
    this.$("new-collection").value = "";
    const failed = outcome.results.find(result => result.error);
    if (failed) summary += `\n${failed.paper.title}：${failed.error}`;
    if (signal.aborted) summary += " 已取消后续处理。";
    this.status(summary, Boolean(failed));
  },
  async enrichAbstracts(signal) {
    const papers = this.candidates.filter(paper => this.selected.has(this.paperKey(paper)) && !paper.abstract.trim());
    if (!papers.length) throw new Error("选中的论文均已有摘要。");
    const items = (await this.Zotero.Items.getAll(this.Zotero.Libraries.userLibraryID, true, false))
      .filter(item => item.isRegularItem() && !item.deleted);
    const results = [], changedTargets = new Set();
    for (const paper of papers) {
      if (signal.aborted) break;
      this.status(`补全摘要 ${results.length + 1} / ${papers.length}：${paper.title}`);
      try {
        const resolved = await Search4PaperAbstract.resolve(paper, {
          signal, request: (url, requestSignal, type) => this.request(url, requestSignal, type)
        });
        if (!resolved) throw new Error("未找到标题、作者和年份均严格匹配的摘要。");
        const sourcePaper = this.papers.find(candidate => this.paperKey(candidate) === this.paperKey(paper));
        if (!sourcePaper) throw new Error("当前候选已不属于已加载的来源/年份范围。");
        for (const target of [sourcePaper, paper]) {
          target.abstract = resolved.abstract;
          target.abstractSource = resolved.source;
          target.abstractSourceURL = resolved.sourceURL;
        }
        changedTargets.add(this.loadedTargets.find(target => Search4PaperCore.venueID(target.conference, target.year) === paper.venueID));
        const identities = Search4PaperCore.identities(paper), matches = items.filter(item => {
          const existing = Search4PaperCore.identities({ doi: item.getField("DOI"), url: item.getField("url"), extra: item.getField("extra") });
          return [...identities].some(identity => existing.has(identity));
        });
        if (matches.length > 1) throw new Error("Zotero 中存在多个相同来源标识的条目，摘要未写回条目。");
        let written = false;
        if (matches.length === 1 && !matches[0].getField("abstractNote").trim()) {
          matches[0].setField("abstractNote", paper.abstract); await matches[0].saveTx(); written = true;
        }
        results.push({ paper, source: resolved.source, written });
      }
      catch (error) { results.push({ paper, error: error.message }); }
    }
    for (const target of [...changedTargets].filter(Boolean)) {
      const venueID = Search4PaperCore.venueID(target.conference, target.year);
      const rows = this.papers.filter(paper => paper.venueID === venueID);
      const coverage = this.coverageRows.find(row => row.conference === target.conference && row.year === target.year);
      const path = PathUtils.join(this.Zotero.DataDirectory.dir, "search4paper", target.conference, `${target.year}.json`);
      await IOUtils.writeJSON(path, { schemaVersion: 1, venueID, year: target.year,
        fetchedAt: coverage.fetchedAt, paperCount: rows.length, papers: rows }, { tmpPath: `${path}.tmp` });
      coverage.missingAbstracts = rows.filter(paper => !paper.abstract.trim()).length;
    }
    await this.filterPapers(signal, this.query);
    const success = results.filter(result => !result.error).length;
    const written = results.filter(result => result.written).length;
    const failures = results.filter(result => result.error);
    this.status(`摘要补全：成功 ${success}，失败 ${failures.length}，写回已有 Zotero 条目 ${written}。${failures.length ? "\n" + failures.map(result => `${result.paper.title}：${result.error}`).join("\n") : ""}`, Boolean(failures.length));
  },
  discoveryVisible() {
    const readYear = id => {
      const value = this.$(id).value.trim();
      if (!value) return null;
      const year = Number(value);
      if (!/^\d{4}$/.test(value) || year < 1000 || year > 2100) throw new Error("文献发现年份必须是 1000–2100 之间的四位年份。");
      return year;
    };
    const yearFrom = readYear("discovery-year-from"), yearTo = readYear("discovery-year-to");
    if (yearFrom && yearTo && yearFrom > yearTo) throw new Error("文献发现的起始年份不能晚于结束年份。");
    return Search4PaperDiscovery.filterAndSort(this.discoveryPapers, {
      relation: this.$("discovery-relation").value, type: this.$("discovery-type").value,
      library: this.$("discovery-library").value, oaOnly: this.$("discovery-oa").checked,
      sort: this.$("discovery-sort").value, yearFrom, yearTo
    });
  },
  updateOpenAlexQuota() {
    const target = this.$("openalex-quota");
    if (!target) return;
    const keyed = Boolean(this.Zotero.Prefs.get("extensions.search4paper.openAlexAPIKey", true));
    target.textContent = this.openAlexRate
      ? `${keyed ? "API Key" : "匿名访问"} · 今日剩余额度 ${this.openAlexRate.remaining} / ${this.openAlexRate.limit}`
      : `${keyed ? "已配置 API Key" : "匿名访问"} · 尚未读取额度`;
  },
  saveOpenAlexKey() {
    const key = this.$("openalex-key").value.trim();
    this.Zotero.Prefs.set("extensions.search4paper.openAlexAPIKey", key, true);
    this.$("openalex-key").value = "";
    this.openAlexRate = null; this.updateOpenAlexQuota();
    this.status(key ? "OpenAlex API Key 已保存到本机 Zotero 配置。" : "已切换为 OpenAlex 匿名访问。");
  },
  async discover(signal) {
    const items = [...(this.Zotero.getActiveZoteroPane()?.getSelectedItems() || [])];
    this.discoveryPapers = []; this.discoverySeeds = []; this.discoverySelected.clear(); this.discoveryActive = null;
    this.renderDiscovery();
    const result = await Search4PaperDiscovery.expand(items, this.Zotero, {
      signal, request: (url, requestSignal, type) => this.request(url, requestSignal, type),
      onProgress: message => this.status(message)
    });
    signal.throwIfAborted();
    await Search4PaperDiscovery.markLibraryStatus(this.Zotero, result.papers);
    signal.throwIfAborted();
    this.discoverySeeds = result.seeds; this.discoveryPapers = result.papers;
    const count = relation => result.papers.filter(paper => paper.relations.includes(relation)).length;
    this.discoverySummary = `种子 ${result.seeds.length} 篇 · 相关结果 ${result.papers.length} 篇 · 参考文献 ${count("reference")} · 后续引用 ${count("citation")} · 相关论文 ${count("related")}。参考文献完整分批读取；后续引用按每篇种子的引用数排序，最多取 ${result.citationLimitPerSeed} 篇。`;
    this.renderDiscovery(); this.previewDiscovery(this.discoveryVisible()[0] || null);
    this.status("相关文献扩展完成。可按关系筛选并选择导入。", false);
  },
  renderDiscovery() {
    const tbody = this.$("discovery-results"), papers = this.discoveryVisible(); tbody.replaceChildren();
    const labels = { reference: "参考文献", citation: "后续引用", related: "相关论文" };
    const libraryLabels = { new: "尚未导入", existing: "已在库、无 PDF", pdf: "已在库、有 PDF" };
    for (const paper of papers) {
      const tr = document.createElementNS("http://www.w3.org/1999/xhtml", "tr"); tr.dataset.id = paper.id;
      tr.classList.toggle("active", this.discoveryActive?.id === paper.id);
      const choice = document.createElementNS("http://www.w3.org/1999/xhtml", "td");
      const checkbox = document.createElementNS("http://www.w3.org/1999/xhtml", "input"); checkbox.type = "checkbox";
      checkbox.checked = this.discoverySelected.has(paper.id); checkbox.setAttribute("aria-label", `选择 ${paper.title}`);
      checkbox.addEventListener("change", () => { if (checkbox.checked) this.discoverySelected.add(paper.id); else this.discoverySelected.delete(paper.id); this.controls(); });
      choice.append(checkbox);
      const text = document.createElementNS("http://www.w3.org/1999/xhtml", "td");
      const title = document.createElementNS("http://www.w3.org/1999/xhtml", "button"); title.className = "paper-button"; title.textContent = paper.title;
      title.addEventListener("click", () => this.previewDiscovery(paper));
      const reason = document.createElementNS("http://www.w3.org/1999/xhtml", "span"); reason.className = "match-fields";
      reason.textContent = `${paper.year || "年份未知"} · ${paper.relations.map(value => labels[value]).join(" / ")} · ${libraryLabels[paper.libraryStatus]} · 排序依据：${Search4PaperDiscovery.rankingExplanation(paper, this.$("discovery-sort").value)}`;
      text.append(title, reason); tr.append(choice, text); tbody.append(tr);
    }
    this.$("discovery-empty").hidden = papers.length > 0;
    this.$("discovery-empty").textContent = this.discoveryPapers.length ? "当前关系筛选下没有论文。" : "点击“扩展相关文献”开始。";
    if (this.discoverySummary) this.$("discovery-summary").textContent = `${this.discoverySummary} 当前筛选显示 ${papers.length} 篇。`;
    this.controls();
  },
  previewDiscovery(paper) {
    this.discoveryActive = paper;
    this.$("discovery-title").textContent = paper?.title || "论文预览";
    this.$("discovery-authors").textContent = paper ? `${paper.authors.join("; ")}${paper.publicationTitle ? ` · ${paper.publicationTitle}` : ""}` : "";
    this.$("discovery-abstract").textContent = paper?.abstract || (paper ? "OpenAlex 未提供摘要。" : "选择一篇相关论文。");
    this.$("discovery-reasons").replaceChildren();
    const labels = { reference: "是种子论文的参考文献", citation: "引用了种子论文", related: "OpenAlex 判定为相关论文" };
    for (const relation of paper?.relations || []) {
      const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li"); li.textContent = `${labels[relation]}：${paper.seedTitles.join("；")}`; this.$("discovery-reasons").append(li);
    }
    if (paper) {
      const li = document.createElementNS("http://www.w3.org/1999/xhtml", "li");
      li.textContent = `当前排序依据：${Search4PaperDiscovery.rankingExplanation(paper, this.$("discovery-sort").value)}`;
      this.$("discovery-reasons").append(li);
    }
    for (const row of this.$("discovery-results").children) row.classList.toggle("active", row.dataset.id === paper?.id);
    this.controls();
  },
  async importDiscovery(signal) {
    const papers = this.discoveryPapers.filter(paper => this.discoverySelected.has(paper.id));
    if (!papers.length) throw new Error("请先选择需要导入的相关论文。");
    const collections = this.Zotero.getActiveZoteroPane()?.getSelectedCollections() || [];
    const collectionID = collections.length === 1 && collections[0].libraryID === this.Zotero.Libraries.userLibraryID ? collections[0].id : null;
    const outcome = await Search4PaperDiscovery.importPapers(this.Zotero, papers, { collectionID, signal,
      onProgress: (done, total, title) => this.status(`导入相关论文 ${done} / ${total}：${title}`) });
    const count = status => outcome.results.filter(result => result.status === status).length;
    const failure = outcome.results.find(result => result.error);
    await Search4PaperDiscovery.markLibraryStatus(this.Zotero, this.discoveryPapers); this.renderDiscovery();
    this.status(`相关文献导入：新增 ${count("created")}，已有 ${count("existing")}，失败 ${count("failed")}，未处理 ${outcome.unprocessed}。${failure ? `\n${failure.paper.title}：${failure.error}` : ""}`, Boolean(failure));
  },
  async getFullText(signal) {
    const items = [...(this.Zotero.getActiveZoteroPane()?.getSelectedItems() || [])];
    if (!items.length) throw new Error("请先在 Zotero 主窗口选择需要全文的文献条目。");
    const outcomes = [];
    for (const item of items) {
      if (signal.aborted) break;
      const title = item.getField("title");
      this.status(`获取全文 ${outcomes.length + 1} / ${items.length}：${title}`);
      try {
        if (!item.isRegularItem() || item.deleted || !this.Zotero.Libraries.get(item.libraryID).filesEditable) {
          throw new Error("请选择可添加附件的文献条目。");
        }
        // Each stage is explicit so a publisher access failure cannot hide an
        // available author version, and Zotero's broad resolver remains last.
        let result, institutional = this.ieee.context && this.ieee.hasPaperURL(item.getField("url"));
        const errors = [];
        const remember = value => { if (value?.error) errors.push(value.error); return value; };
        const savedFullText = item.getField("extra").match(/^Full Text URL: (https?:\/\/\S+)\s*$/m)?.[1] || "";
        const paper = this.lastImport?.results.find(r => r.item?.id === item.id)?.paper || { title, pdfURL: savedFullText };
        const isHost = (value, hosts) => value && URL.canParse(value)
          && hosts.includes(new URL(value).hostname);
        const explicitOA = paper.pdfURL && !isHost(paper.pdfURL, ["openreview.net", "www.openreview.net",
          "arxiv.org", "www.arxiv.org", "dl.acm.org", "ieeexplore.ieee.org"]);
        if (explicitOA) {
          [result] = await Search4PaperImport.findPDFs(this.Zotero, [{ item, paper }], {
            signal, direct: paper.pdfURL, directLabel: "开放出版商 PDF", native: false
          });
          remember(result);
        }

        if (!item.getField("DOI") && Search4PaperPublication.isWWW(item, paper) && !signal.aborted) {
          try {
            await Search4PaperPublication.resolveWWWDOI(item, paper, {
              signal, request: (url, requestSignal, type) => this.request(url, requestSignal, type)
            });
          }
          catch (error) { errors.push(error.message); }
        }

        if (!result?.hasPDF && !signal.aborted) {
          try {
            const arxiv = await Search4PaperArxiv.resolve(item, paper, {
              signal, request: (url, requestSignal, type) => this.request(url, requestSignal, type),
              wait: milliseconds => this.Zotero.Promise.delay(milliseconds)
            });
            if (arxiv) {
              [result] = await Search4PaperImport.findPDFs(this.Zotero, [{ item, paper }], {
                signal, direct: arxiv.pdfURL, directLabel: `arXiv 最新版本（${arxiv.arxivID}）`, native: false
              });
              remember(result);
            }
          }
          catch (error) { errors.push(`arXiv 查询：${error.message}`); }
        }

        let openReviewURLs = [];
        const openReviewFallback = Search4PaperImport.openReviewPDFURL?.(item)
          || (isHost(paper.pdfURL, ["openreview.net", "www.openreview.net"]) ? paper.pdfURL : "");
        if (!result?.hasPDF && openReviewFallback && !signal.aborted) {
          try {
            openReviewURLs = await Search4PaperOpenReview.URLs(item, {
              signal, request: (url, requestSignal, type) => this.request(url, requestSignal, type)
            });
          }
          catch (error) { errors.push(`OpenReview 稳定地址解析：${error.message}`); }
          if (!openReviewURLs.length) openReviewURLs = [openReviewFallback];
          for (const url of [...new Set(openReviewURLs)]) {
            if (result?.hasPDF || signal.aborted) break;
            const stable = /^https:\/\/openreview\.net\/pdf\/[a-f0-9]{40}\.pdf$/i.test(url);
            [result] = await Search4PaperImport.findPDFs(this.Zotero, [{ item, paper }], {
              signal, direct: url, directLabel: stable ? "OpenReview 稳定 PDF" : "OpenReview PDF", native: false
            });
            remember(result);
          }
        }

        const acm = this.acm.canHandle(item);
        if (acm && !result?.hasPDF && !signal.aborted) {
          result = await this.acm.download(item, { signal });
          remember(result);
          this.updateACMStatus();
        }

        const icde = /^Source ID: icde:/m.test(item.getField("extra"));
        let resolutionError = "";
        if (!result?.hasPDF && !signal.aborted && !this.ieee.hasPaperURL(item.getField("url")) && this.ieee.canResolve(item)) {
          this.status(`正在查找 IEEE 论文地址：${title}`);
          try {
            await this.ieee.resolvePaperURL(item, { signal });
            institutional = this.ieee.context && this.ieee.hasPaperURL(item.getField("url"));
          }
          catch (error) { resolutionError = error.message; }
        }
        if (institutional && !result?.hasPDF && !signal.aborted) {
          [result] = await this.ieee.download([item], { signal, onProgress: progress => {
            this.$("ieee-status").textContent = this.ieee.status;
            this.status(`获取全文 ${outcomes.length + 1} / ${items.length}：${title} · ${progress.phase === "waiting" ? "等待下载间隔" : progress.phase === "downloading" ? "开始下载 " + progress.startedAt : progress.hasPDF ? "附件已取得" : progress.error}`);
          } });
          remember(result);
        }
        if (!result?.hasPDF && !institutional && !signal.aborted && (icde || resolutionError || this.ieee.hasPaperURL(item.getField("url")))) {
          const reason = resolutionError || (this.ieee.hasPaperURL(item.getField("url"))
            ? "尚未启动 IEEE 机构登录；如需订阅访问，请先完成北航登录后重试。"
            : "未取得 IEEE 单篇论文地址；请核实条目元数据后重试。");
          errors.push(reason);
        }

        if (!result?.hasPDF && !signal.aborted) {
          [result] = await Search4PaperImport.findPDFs(this.Zotero, [{ item, paper: { title } }], {
            signal, direct: false, native: true
          });
          remember(result);
        }
        if (result && !result.hasPDF) result.error = [...new Set(errors)].join("；");
        if (result) outcomes.push(result);
      }
      catch (error) { outcomes.push({ itemID: item.id, title, hasPDF: false, error: error.message }); }
    }
    this.lastPDFs = outcomes;
    this.$("ieee-status").textContent = this.ieee.status;
    this.status(`全文获取：成功 ${outcomes.filter(r => r.hasPDF).length}，失败 ${outcomes.filter(r => !r.hasPDF).length}，未处理 ${items.length - outcomes.length}。文献条目已保留。${signal.aborted ? " 已取消后续处理。" : ""}\n`
      + outcomes.map(r => `${r.title}：${r.reused ? "复用已有 PDF" : r.hasPDF ? `附件已取得（${r.source || "来源未标记"}）` : r.error || "未取得可用全文"}${r.startedAt ? `（请求开始 ${r.startedAt}）` : ""}`).join("\n"));
  },
  updateACMStatus() {
    this.$("acm-access").hidden = !this.acm.verificationURL;
    this.$("acm-status").textContent = this.acm.status;
  },
  async findMaterials(signal) {
    this.materialTarget = null; this.materialCandidates = []; this.materialSelected.clear(); this.materialSaved.clear();
    this.$("materials-target").textContent = "尚未选择论文。";
    this.$("materials-coverage").textContent = "尚未检查代码链接。";
    this.renderMaterials();
    const items = this.Zotero.getActiveZoteroPane()?.getSelectedItems() || [];
    if (items.length !== 1) throw new Error("请在 Zotero 主窗口只选择一篇论文，再检查代码仓库。");
    const target = Search4PaperMaterials.snapshot(items[0]);
    this.materialTarget = target;
    this.$("materials-target").textContent = `本次论文（确认后保存到此条目）：${target.title}`;
    this.status("正在查找论文代码链接并检查 GitHub 仓库内容…");
    this.$("materials-coverage").textContent = "正在检查条目摘要、论文来源和仓库文件；尚未产生检查结果。";
    let result;
    try {
      result = await Search4PaperMaterials.discover(target, { signal,
        request: (url, requestSignal, type) => this.request(url, requestSignal, type) });
      signal.throwIfAborted();
    }
    catch (error) {
      this.$("materials-coverage").textContent = "论文来源检查未完成；这不表示论文没有公开代码。";
      throw error;
    }
    this.materialCandidates = result.candidates;
    this.$("materials-coverage").textContent = `本次已检查：${result.checked.join("；")}。`;
    this.renderMaterials();
    const withCode = result.candidates.filter(candidate => candidate.repository?.codeCount > 0).length;
    this.status(result.candidates.length ? `找到 ${result.candidates.length} 个代码相关链接；${withCode} 个 GitHub 仓库发现非空代码文件。请核对文件内容与论文出处后确认关联。`
      : "本次检查范围内未找到代码链接；这不代表论文未公开代码。");
  },
  renderMaterials() {
    const body = this.$("materials-results"); body.replaceChildren();
    const element = (tag, text) => {
      const node = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
      if (text !== undefined) node.textContent = text;
      return node;
    };
    for (const candidate of this.materialCandidates) {
      const row = element("tr"), choice = element("td"), material = element("td"), contents = element("td"), evidence = element("td");
      if (this.materialSaved.has(candidate.url)) choice.append(element("span", "已关联"));
      else {
        const checkbox = element("input"); checkbox.type = "checkbox"; checkbox.checked = this.materialSelected.has(candidate.url);
        checkbox.setAttribute("aria-label", `确认关联代码链接 ${candidate.url}`);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) this.materialSelected.add(candidate.url); else this.materialSelected.delete(candidate.url);
          this.$("materials-save").textContent = `确认关联选中链接（${this.materialSelected.size}）`;
          this.controls();
        });
        choice.append(checkbox);
      }
      material.append(element("strong", candidate.label), element("p", candidate.url));
      const open = element("button", "打开代码链接");
      open.addEventListener("click", () => this.Zotero.launchURL(candidate.url)); material.append(open);
      const check = candidate.repository;
      if (check) {
        const facts = Search4PaperMaterials.repositoryFacts(check);
        const label = element("strong", facts[0]); label.className = `repository-state repository-${check.state}`; contents.append(label);
        for (const fact of facts.slice(1)) contents.append(element("p", fact));
        for (const file of check.files || []) {
          const line = element("p"), button = element("button", file.path);
          button.addEventListener("click", () => this.Zotero.launchURL(file.url));
          line.append(button, element("span", ` · ${file.size} 字节`)); contents.append(line);
        }
        if (check.samples?.length) {
          const samples = element("details"); samples.append(element("summary", "查看 README / 代码原文摘录"));
          for (const sample of check.samples) samples.append(element("p", sample.path),
            element("blockquote", sample.error ? `正文读取失败：${sample.error}` : sample.text));
          contents.append(samples);
        }
      }
      const sources = element("details"); sources.append(element("summary", `出处与原文（${candidate.evidence.length}）`));
      for (const source of candidate.evidence) {
        sources.append(element("p", `${source.source} · ${source.location}`), element("blockquote", source.quote));
        if (source.sourceURL) {
          sources.append(element("p", source.sourceURL));
          const origin = element("button", "打开出处");
          origin.addEventListener("click", () => this.Zotero.launchURL(source.sourceURL)); sources.append(origin);
        }
      }
      evidence.append(sources); row.append(choice, material, contents, evidence); body.append(row);
    }
    this.$("materials-empty").hidden = Boolean(this.materialCandidates.length);
    this.$("materials-save").textContent = `确认关联选中链接（${this.materialSelected.size}）`;
    this.controls();
  },
  async saveMaterials(signal) {
    const selected = this.materialCandidates.filter(candidate => this.materialSelected.has(candidate.url) && !this.materialSaved.has(candidate.url));
    if (!this.materialTarget || !selected.length) throw new Error("请先核对仓库内容及论文出处，并勾选要关联的代码链接。");
    // Use the extraction target even if the main-window selection has changed.
    const results = await Search4PaperMaterials.saveConfirmed(this.Zotero, this.materialTarget, selected, { signal });
    for (const result of results) { this.materialSaved.add(result.url); this.materialSelected.delete(result.url); }
    this.renderMaterials();
    this.status(`已为“${this.materialTarget.title}”新增 ${results.filter(r => r.status === "created").length} 条代码仓库笔记；`
      + `已有 ${results.filter(r => r.status === "existing").length} 条关联保持不变。链接和原文证据已保存在该论文的子笔记中。`);
  },
  init() {
    const pages = ["search", "fulltext", "discovery", "materials"];
    for (const page of pages) {
      const tab = this.$("tab-" + page);
      tab.addEventListener("click", () => this.switchPage(page));
      tab.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = pages.indexOf(page);
        const next = event.key === "Home" ? pages[0] : event.key === "End" ? pages.at(-1)
          : pages[(index + (event.key === "ArrowRight" ? 1 : pages.length - 1)) % pages.length];
        this.switchPage(next); this.$("tab-" + next).focus();
      });
    }
    this.$("ieee-status").textContent = this.ieee.status;
    this.$("ieee-login").addEventListener("click", () => this.operation(async () => {
      this.ieee.login();
      this.$("ieee-status").textContent = this.ieee.status;
    }));
    this.updateACMStatus();
    this.$("acm-verify").addEventListener("click", () => this.operation(async () => {
      this.acm.verify();
      this.updateACMStatus();
    }));
    this.$("get-fulltext").addEventListener("click", () => this.operation(signal => this.getFullText(signal)));
    this.$("fulltext-cancel").addEventListener("click", () => {
      if (this.operationPage === "fulltext") this.controller?.abort();
    });
    this.$("discover").addEventListener("click", () => this.operation(signal => this.discover(signal)));
    this.$("openalex-save").addEventListener("click", () => this.saveOpenAlexKey());
    this.$("openalex-clear").addEventListener("click", () => { this.$("openalex-key").value = ""; this.saveOpenAlexKey(); });
    this.$("discovery-cancel").addEventListener("click", () => { if (this.operationPage === "discovery") this.controller?.abort(); });
    for (const id of ["discovery-relation", "discovery-year-from", "discovery-year-to", "discovery-type",
      "discovery-library", "discovery-oa", "discovery-sort"]) {
      this.$(id).addEventListener("input", () => {
        try { this.renderDiscovery(); if (this.discoveryActive) this.previewDiscovery(this.discoveryActive); }
        catch (error) { this.status(error.message, true); }
      });
    }
    this.$("discovery-select").addEventListener("click", () => { for (const paper of this.discoveryVisible()) this.discoverySelected.add(paper.id); this.renderDiscovery(); });
    this.$("discovery-clear").addEventListener("click", () => { this.discoverySelected.clear(); this.renderDiscovery(); });
    this.$("discovery-import").addEventListener("click", () => this.operation(signal => this.importDiscovery(signal)));
    this.$("discovery-source").addEventListener("click", () => this.Zotero.launchURL(this.discoveryActive.url));
    this.$("materials-find").addEventListener("click", () => this.operation(signal => this.findMaterials(signal)));
    this.$("materials-save").addEventListener("click", () => this.operation(signal => this.saveMaterials(signal)));
    this.$("materials-cancel").addEventListener("click", () => { if (this.operationPage === "materials") this.controller?.abort(); });
    for (const field of new Set(Object.values(Search4PaperCore.CONFERENCE_CATEGORIES).map(venue => venue.field))) {
      this.$("venue-field").add(new Option(field, field));
    }
    for (const id of ["venue-field", "venue-type", "venue-rank"]) {
      this.$(id).addEventListener("change", () => this.updateConferenceOptions());
    }
    this.updateConferenceOptions();
    for (const input of document.querySelectorAll(".query input, .query select, .filter input")) {
      input.addEventListener("input", () => {
        this.updateQuerySummary();
        if (input.id === "conference" || input.id === "year") this.updateSourceSupport();
        this.filtersDirty = true; this.controls();
        this.status("检索条件已修改，请应用筛选；更换会议、期刊或年份后请重新搜索。");
      });
    }
    this.$("fetch").addEventListener("click", () => this.operation(signal => this.fetchPapers(signal)));
    this.$("refresh-papers").addEventListener("click", () => this.operation(signal => this.fetchPapers(signal, true)));
    this.$("filter").addEventListener("click", () => this.operation(signal => this.filterPapers(signal)));
    this.$("import").addEventListener("click", () => this.operation(signal => this.importPapers(signal)));
    this.$("enrich-abstracts").addEventListener("click", () => this.operation(signal => this.enrichAbstracts(signal)));
    this.$("cancel").addEventListener("click", () => {
      if (this.operationPage === "search") this.controller?.abort();
    });
    this.$("refresh").addEventListener("click", () => this.refreshCollections());
    this.$("select-page").addEventListener("click", () => {
      for (const paper of this.candidates.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize)) this.selected.add(this.paperKey(paper));
      this.render();
    });
    this.$("clear").addEventListener("click", () => { this.selected.clear(); this.render(); });
    this.$("previous").addEventListener("click", () => { this.page--; this.render(); });
    this.$("next").addEventListener("click", () => { this.page++; this.render(); });
    this.$("source").addEventListener("click", () => this.Zotero.launchURL(this.active.url));
    window.addEventListener("unload", () => this.controller?.abort());
    this.refreshCollections();
    const selected = this.Zotero.getActiveZoteroPane()?.getSelectedCollections() || [];
    if (selected.length === 1 && selected[0].libraryID === this.Zotero.Libraries.userLibraryID) this.$("collection").value = String(selected[0].id);
    this.updateQuerySummary();
    this.updateOpenAlexQuota();
    this.controls();
  }
};
window.addEventListener("DOMContentLoaded", () => Search4PaperUI.init(), { once: true });
