/* Paper-linked code candidates and public repository evidence. Discovery never writes to the library. */
var Search4PaperMaterials = {
  marker: "<p>研究材料关联 · search4paper · 用户确认</p>",
  normalize(value) { return Search4PaperAbstract.normalize(value); },
  httpURL(value, base) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value, base);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
    }
    catch { return ""; }
  },
  doi(value) { return String(value || "").trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase(); },
  snapshot(item) {
    if (!item?.isRegularItem() || item.deleted || item.isFeedItem) throw new Error("请在 Zotero 主窗口选择一篇已保存的论文条目。");
    const title = item.getField("title").trim();
    if (!title) throw new Error("所选论文缺少标题，无法核对代码出处。");
    return { itemID: item.id, libraryID: item.libraryID, title, url: item.getField("url"),
      doi: item.getField("DOI"), extra: item.getField("extra"), abstract: item.getField("abstractNote") };
  },
  textLinks(value) {
    const links = [];
    for (const match of String(value || "").matchAll(/https?:\/\/[^\s<>"'`，。；：！？]+/gi)) {
      let raw = match[0].replace(/[.,;:!?。，；：！？]+$/u, "");
      for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
        while (raw.endsWith(close) && raw.split(close).length > raw.split(open).length) raw = raw.slice(0, -1);
      }
      const url = this.httpURL(raw);
      if (url) links.push({ url, index: match.index, length: raw.length });
    }
    return links;
  },
  excerpt(value, index, length) {
    const start = Math.max(0, index - 180), end = Math.min(value.length, index + length + 240);
    return (start ? "…" : "") + value.slice(start, end).trim() + (end < value.length ? "…" : "");
  },
  merge(candidates) {
    const merged = new Map();
    for (const candidate of candidates) {
      const prior = merged.get(candidate.url);
      if (!prior) merged.set(candidate.url, { ...candidate, evidence: [...candidate.evidence] });
      else for (const evidence of candidate.evidence) {
        if (!prior.evidence.some(e => e.sourceURL === evidence.sourceURL && e.location === evidence.location && e.quote === evidence.quote)) prior.evidence.push(evidence);
      }
    }
    return [...merged.values()];
  },
  fromText(value, source, sourceURL, location) {
    return this.textLinks(value).map(link => ({ url: link.url, label: new URL(link.url).host + new URL(link.url).pathname,
      evidence: [{ source, sourceURL, location, quote: this.excerpt(value, link.index, link.length) }] }));
  },
  githubRepo(value) {
    const url = this.httpURL(value);
    if (!url) return null;
    const parsed = new URL(url), [owner, name] = parsed.pathname.split("/").filter(Boolean);
    if (parsed.hostname !== "github.com" || parsed.port || !owner || !name
        || !/^[a-z0-9-]+$/i.test(owner) || !/^[a-z0-9_.-]+$/i.test(name)
        || /^(?:topics|collections|events|marketplace|orgs|users|settings|login|search|about|sponsors|features|explore|site)$/i.test(owner)) return null;
    const repo = name.replace(/\.git$/i, "");
    if (!repo || repo === "." || repo === "..") return null;
    return { url: `https://github.com/${owner}/${repo}`, api: `https://api.github.com/repos/${owner}/${repo}` };
  },
  codeCandidate(candidate) {
    const url = new URL(candidate.url);
    if (url.hostname === "github.com") return Boolean(this.githubRepo(candidate.url));
    if (["gitlab.com", "bitbucket.org"].includes(url.hostname) && url.pathname.split("/").filter(Boolean).length >= 2) return true;
    return candidate.evidence.some(e => /\b(code|implementation|repository|software|project(?:\s+(?:page|website))?)\b|代码|源码|项目主页/i.test(
      e.location.startsWith("字段 ") ? e.location.slice(3).replace(/_/g, " ") : e.location.startsWith("链接文字：") ? e.location : e.quote));
  },
  async inspectGitHub(value, { request, signal }) {
    signal?.throwIfAborted();
    const requested = this.githubRepo(value), checkedAt = new Date().toISOString();
    if (!requested) return { state: "manual", label: "需手动检查", detail: "此链接不是 GitHub 仓库；尚未自动检查其中的代码。", checkedAt };
    let result = { checkedAt, repositoryURL: requested.url };
    try {
      signal?.throwIfAborted();
      const repo = await request(requested.api, signal, "json"), canonical = this.githubRepo(repo?.html_url);
      signal?.throwIfAborted();
      if (!canonical || repo.private !== false || typeof repo.default_branch !== "string" || !repo.default_branch) throw new Error("GitHub 未返回有效的公开仓库信息。");
      result = { ...result, repositoryURL: canonical.url, branch: repo.default_branch };
      let tree;
      try { tree = await request(`${canonical.api}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`, signal, "json"); }
      catch (error) {
        if (error.status === 409 && error.apiMessage === "Git Repository is empty.") {
          return { ...result, state: "empty", label: "空仓库", detail: "GitHub 确认仓库尚无提交，未公开任何文件。" };
        }
        throw error;
      }
      signal?.throwIfAborted();
      if (!Array.isArray(tree?.tree) || typeof tree.truncated !== "boolean" || !/^[a-f0-9]{40}$/i.test(tree.sha)) throw new Error("GitHub 文件清单响应无效。");
      const files = tree.tree.filter(file => file.type === "blob" && ["100644", "100755"].includes(file.mode));
      if (files.some(file => typeof file.path !== "string" || !file.path || !Number.isInteger(file.size) || file.size < 0
          || !/^[a-f0-9]{40}$/i.test(file.sha))) throw new Error("GitHub 文件清单缺少路径、大小或文件标识。");
      const nonempty = files.filter(file => file.size > 0);
      const code = nonempty.filter(file => /\.(?:py|pyx|ipynb|r|jl|m|c|cc|cpp|cxx|h|hpp|cu|cuh|rs|go|java|kt|scala|js|jsx|ts|tsx|sh|bash|pl|rb|lua|f|f90|f95|swift|cs|v|sv|vhd|vhdl|ml|mli|clj|cljs|hs|ex|exs|lean)$/i.test(file.path));
      const external = tree.tree.filter(file => file.type === "commit" || file.mode === "120000").length;
      const docsOnly = nonempty.length > 0 && nonempty.every(file => /\.(?:md|rst)$/i.test(file.path)
        || /(?:^|\/)(?:readme|licen[cs]e|copying|notice)(?:\.[^/]*)?$/i.test(file.path)
        || /^(?:citation\.cff|\.gitignore|\.gitattributes|requirements\.txt|environment\.ya?ml)$/i.test(file.path));
      const state = tree.truncated ? "partial" : code.length ? "code" : external ? "unclassified" : !nonempty.length ? "empty" : docsOnly ? "docs" : "unclassified";
      const labels = { partial: "文件清单不完整", code: "发现非空代码文件", empty: "未发现非空文件", docs: "仅说明或配置文件", unclassified: "有文件，未识别到代码" };
      const detail = tree.truncated ? "GitHub 截断了文件清单；以下仅为已返回部分，不能据此断定未公开代码。"
        : code.length ? "按文件扩展名识别；是否实现论文方法，请结合文件内容核对。"
        : external ? "包含子模块或符号链接，未展开检查其内容。"
        : docsOnly ? "当前分支的非空文件均为说明或配置；尚未发现非空代码文件。"
        : !nonempty.length ? "当前分支没有非空的普通文件。"
        : "当前分支有其他文件，但未识别到常见代码文件；可打开仓库核对。";
      const fileURL = file => `${canonical.url}/blob/${encodeURIComponent(repo.default_branch)}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
      result = { ...result, state, label: labels[state], detail, treeURL: `${canonical.api}/git/trees/${tree.sha}?recursive=1`,
        fileCount: files.length, nonemptyCount: nonempty.length, codeCount: code.length, externalCount: external,
        files: (code.length ? code : nonempty.length ? nonempty : files).slice(0, 6).map(file => ({ path: file.path, size: file.size, url: fileURL(file) })), samples: [] };
      // Read one README and one small source file. Their text is evidence, never executed.
      const readme = nonempty.find(file => /^readme(?:\.[^/]*)?$/i.test(file.path));
      const sampleFiles = [readme, code.find(file => file.size <= 131072)].filter(file => file && file.size <= 131072);
      for (const file of sampleFiles) {
        signal?.throwIfAborted();
        try {
          const blob = await request(`${canonical.api}/git/blobs/${file.sha}`, signal, "json");
          if (blob?.encoding !== "base64" || typeof blob.content !== "string") throw new Error("GitHub 未返回可读取的文件正文。");
          const text = new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\s/g, "")), c => c.charCodeAt(0)));
          result.samples.push({ path: file.path, url: fileURL(file), text: text.slice(0, 900) + (text.length > 900 ? "\n…" : "") });
        }
        catch (error) {
          signal?.throwIfAborted();
          result.samples.push({ path: file.path, url: fileURL(file), error: error.message });
        }
      }
      signal?.throwIfAborted();
      return result;
    }
    catch (error) {
      signal?.throwIfAborted();
      return { ...result, state: "unavailable", label: error.status === 404 ? "无法公开访问" : "暂时无法检查",
        detail: error.status === 404 ? "GitHub 返回 404：仓库可能不存在或已设为私有，不能据此认定论文未公开代码。"
          : [403, 429].includes(error.status) ? "GitHub 请求受限或权限不足；本次未能检查仓库内容，请稍后手动重查。"
          : `仓库检查失败：${error.message}` };
    }
  },
  repositoryFacts(check) {
    return [check.label, check.detail, check.branch ? `检查分支：${check.branch}` : "",
      check.fileCount !== undefined ? `文件 ${check.fileCount} 个，其中非空 ${check.nonemptyCount} 个；按扩展名识别的非空代码文件 ${check.codeCount} 个。` : "",
      check.externalCount ? `另有 ${check.externalCount} 个子模块或符号链接，未展开检查。` : "", `检查时间：${check.checkedAt}`].filter(Boolean);
  },
  openReviewID(paper) {
    const stored = paper.extra?.match(/^OpenReview ID: ([A-Za-z0-9_-]+)\s*$/m)?.[1];
    const url = this.httpURL(paper.url);
    const parsed = url && new URL(url);
    const linked = parsed?.hostname === "openreview.net" && ["/forum", "/pdf"].includes(parsed.pathname)
      ? parsed.searchParams.get("id") : "";
    if (stored && linked && stored !== linked) throw new Error("条目的 OpenReview ID 与论文链接冲突，请先核对条目。");
    const id = stored || linked || "";
    if (id && !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("OpenReview ID 格式无效。");
    return id;
  },
  fromOpenReview(response, paper, id) {
    if (!Array.isArray(response?.notes)) throw new Error("OpenReview 未返回有效的论文记录。");
    const notes = response.notes.filter(note => note?.id === id);
    if (notes.length !== 1) throw new Error("OpenReview 未返回唯一的指定论文记录。");
    const content = notes[0].content || {}, fieldValue = key => Search4PaperAbstract.contentValue(content, key);
    if (!this.normalize(fieldValue("title")) || this.normalize(fieldValue("title")) !== this.normalize(paper.title)) throw new Error("OpenReview 记录标题与所选论文不一致，未提取材料。");
    const sourceURL = `https://openreview.net/forum?id=${encodeURIComponent(id)}`, candidates = [];
    for (const [key] of Object.entries(content)) {
      // These fields explicitly describe material links/files. Other fields, including
      // ethics declarations and reviewer comments, do not establish such a relation.
      const materialField = /^(?:(?:code|data|dataset|datasets|software|repository|repo|github|project|artifact|artifacts)(?:_(?:url|link|repository|page|website))?|link_to_(?:code|data|dataset|project)|supplementary(?:_(?:material|materials|pdf|video))?)$/i.test(key);
      if (!materialField && key !== "abstract") continue;
      const raw = fieldValue(key), values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        if (typeof value !== "string") continue;
        const location = `字段 ${key}`;
        candidates.push(...this.fromText(value, "OpenReview 论文记录", sourceURL, location));
        // Only an attachment path actually supplied by this record is accepted.
        if (materialField && /^\/attachment(?:\/|\?)[^\s]+$/.test(value)) {
          const url = this.httpURL(value, "https://openreview.net/");
          if (url) candidates.push({ url, label: location, evidence: [{ source: "OpenReview 论文记录", sourceURL, location, quote: value }] });
        }
      }
    }
    return candidates;
  },
  fromHTML(raw, sourceURL, paper) {
    if (typeof raw !== "string" || !this.httpURL(sourceURL)) throw new Error("论文页面响应缺少正文或有效来源地址。");
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const values = names => [...doc.querySelectorAll("meta[name], meta[property]")]
      .filter(m => names.includes((m.getAttribute("name") || m.getAttribute("property")).toLowerCase()))
      .map(m => m.getAttribute("content") || "").filter(Boolean);
    const titles = [...new Set(values(["citation_title", "dc.title", "dcterms.title"]).map(t => this.normalize(t)))];
    const dois = [...new Set(values(["citation_doi", "dc.identifier", "dc.identifier.doi", "prism.doi"])
      .map(value => this.doi(value)).filter(value => /^10\.\d{4,9}\//.test(value)))];
    const wantedDOI = this.doi(paper.doi), titleMatches = titles.length === 1 && titles[0] === this.normalize(paper.title);
    if (titles.length > 1 || (titles.length === 1 && !titleMatches)
        || (wantedDOI && dois.length && (dois.length !== 1 || dois[0] !== wantedDOI))) throw new Error("网页的论文标题或 DOI 与所选条目冲突，未提取材料。");
    if (!titleMatches && !(wantedDOI && dois.length === 1 && dois[0] === wantedDOI)) throw new Error("网页缺少可核对的单篇论文标题/DOI 元数据；未扫描该页。会议总表和普通项目页暂不支持。");
    for (const node of doc.querySelectorAll("script, style, template, nav, footer")) node.remove();
    const base = this.httpURL(doc.querySelector("base[href]")?.getAttribute("href"), sourceURL) || sourceURL;
    const root = doc.querySelector("main") || doc.body, candidates = [];
    // CVF renders repository URLs in the abstract as plain text, not anchors.
    const abstracts = root.querySelectorAll("#abstract, .abstract, .acl-abstract, [itemprop=abstract]");
    for (const abstract of abstracts) candidates.push(...this.fromText(abstract.textContent.trim(), "论文网页", sourceURL, "网页摘要"));
    for (const a of root.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href").trim();
      if (!href || href.startsWith("#")) continue;
      const url = this.httpURL(href, base);
      if (!url || url.split("#")[0] === sourceURL.split("#")[0] || (wantedDOI && this.doi(url) === wantedDOI)) continue;
      const label = a.textContent.replace(/\s+/g, " ").trim();
      const parsed = new URL(url), parts = parsed.pathname.split("/").filter(Boolean);
      const materialHost = (["github.com", "gitlab.com", "bitbucket.org"].includes(parsed.hostname) && parts.length >= 2)
        || (parsed.hostname === "huggingface.co" && parts.length >= 2)
        || (parsed.hostname === "zenodo.org" && /^\/records?\/\d+/.test(parsed.pathname))
        || (parsed.hostname === "osf.io" && /^\/[a-z0-9]{5}\/?$/i.test(parsed.pathname));
      if (!materialHost && !/\b(code|data|datasets?|software|repository|artifact|supp(?:lement(?:ary|al)?)?|project(?:\s+(?:page|website))?)\b|代码|数据集|补充材料|项目主页/i.test(label)) continue;
      const block = a.closest("p, li, dd, dt, td, figcaption, #abstract, .abstract, .acl-abstract") || a;
      const text = block.textContent.trim(), index = Math.max(0, text.indexOf(a.textContent.trim()));
      candidates.push({ url, label: label || parsed.hostname, evidence: [{ source: "论文网页", sourceURL,
        location: `链接文字：${label || "（无文字链接）"}`, quote: this.excerpt(text, index, a.textContent.trim().length) || href }] });
    }
    return candidates;
  },
  async discover(paper, { request, signal }) {
    signal?.throwIfAborted();
    const candidates = this.fromText(paper.abstract || "", "Zotero 条目", "", "条目摘要");
    const checked = ["条目摘要"], id = this.openReviewID(paper);
    if (id) {
      // Reuse the public search route used by abstract/PDF enrichment; direct
      // /notes requests currently redirect to a challenge. The saved ID is mandatory.
      const endpoint = "https://api2.openreview.net/notes/search?"
        + `term=${encodeURIComponent(paper.title)}&type=exact&content=title&source=forum&limit=10`;
      const response = await request(endpoint, signal, "json");
      signal?.throwIfAborted();
      candidates.push(...this.fromOpenReview(response, paper, id));
      checked.push("OpenReview 指定论文的公开材料字段及摘要");
    }
    else {
      let url = this.httpURL(paper.url);
      if (url && (/\.pdf$/i.test(new URL(url).pathname)
          || (new URL(url).hostname === "arxiv.org" && /^\/pdf\//.test(new URL(url).pathname)))) url = "";
      if (!url && /^10\.\d{4,9}\/\S+$/.test(this.doi(paper.doi))) url = `https://doi.org/${this.doi(paper.doi)}`;
      if (url) {
        const page = await request(url, signal, "html");
        signal?.throwIfAborted();
        candidates.push(...this.fromHTML(page.body, page.url, paper));
        checked.push(`已核对标题或 DOI 的论文网页：${page.url}`);
      }
      else checked.push("缺少可检查的论文网页地址；本次仅检查条目摘要");
    }
    const links = candidates.filter(candidate => candidate.url !== this.httpURL(paper.url)
      && !(paper.doi && this.doi(candidate.url) === this.doi(paper.doi)) && this.codeCandidate(candidate));
    const repositories = this.merge(links.map(candidate => {
      const repo = this.githubRepo(candidate.url);
      return repo ? { ...candidate, url: repo.url, label: repo.url.slice("https://".length) } : candidate;
    }));
    for (const candidate of repositories) candidate.repository = await this.inspectGitHub(candidate.url, { request, signal });
    signal?.throwIfAborted();
    checked.push("GitHub 仓库的默认分支文件清单及可读取的 README／代码摘录；其他链接需手动检查");
    return { candidates: repositories, checked };
  },
  noteHTML(paper, candidate, confirmedAt) {
    const escape = Search4PaperCore.escapeHTML;
    if (!this.httpURL(candidate.url) || !candidate.evidence?.length) throw new Error("材料缺少有效链接或出处证据，不能关联。");
    let html = `<h2>代码仓库：${escape(candidate.label || candidate.url)}</h2>${this.marker}`
      + `<p>论文：${escape(paper.title)}</p><p>材料地址：<a href="${escape(candidate.url)}">${escape(candidate.url)}</a></p>`
      + `<p>确认时间：${escape(confirmedAt)}</p><p>用户确认了此链接与论文的关联；未验证官方归属、材料完整性或实验可复现性。</p>`;
    if (candidate.repository) {
      html += "<h3>仓库内容检查</h3>" + this.repositoryFacts(candidate.repository).map(line => `<p>${escape(line)}</p>`).join("");
      for (const file of candidate.repository.files || []) html += `<p>${escape(file.path)} · ${file.size} 字节</p>`;
      for (const sample of candidate.repository.samples || []) html += `<p>${escape(sample.path)}</p><blockquote><p>${escape(sample.error ? `正文读取失败：${sample.error}` : sample.text)}</p></blockquote>`;
      if (this.httpURL(candidate.repository.treeURL)) html += `<p>文件清单出处：<a href="${escape(candidate.repository.treeURL)}">${escape(candidate.repository.treeURL)}</a></p>`;
    }
    for (const evidence of candidate.evidence) {
      if (!evidence.quote?.trim() || !evidence.source || !evidence.location
          || (evidence.sourceURL && !this.httpURL(evidence.sourceURL))) throw new Error("材料出处证据不完整或来源地址无效。");
      html += `<h3>${escape(evidence.source)} · ${escape(evidence.location)}</h3>`;
      if (evidence.sourceURL) html += `<p>出处：<a href="${escape(evidence.sourceURL)}">${escape(evidence.sourceURL)}</a></p>`;
      html += `<blockquote><p>${escape(evidence.quote)}</p></blockquote>`;
    }
    return html;
  },
  savedURL(note) {
    if (!note.includes(this.marker)) return "";
    const doc = new DOMParser().parseFromString(note, "text/html");
    const line = [...doc.querySelectorAll("p")].find(p => p.textContent.startsWith("材料地址："));
    return this.httpURL(line?.querySelector("a[href]")?.getAttribute("href"));
  },
  async saveConfirmed(Zotero, target, candidates, { signal } = {}) {
    if (!candidates.length) throw new Error("请先逐项核对证据并勾选要关联的材料。");
    const notes = this.merge(candidates).map(candidate => ({ candidate, html: this.noteHTML(target, candidate, new Date().toISOString()) }));
    signal?.throwIfAborted();
    const item = await Zotero.Items.getAsync(target.itemID);
    if (!item || item.deleted || !item.isRegularItem() || item.isFeedItem || item.libraryID !== target.libraryID) throw new Error("原论文条目已不可用，请重新提取材料候选。");
    if (!Zotero.Libraries.get(item.libraryID)?.editable) throw new Error("该文献库不可编辑，不能保存材料关联。");
    const results = [];
    await Zotero.DB.executeTransaction(async () => {
      const existing = await Zotero.Items.getAsync(item.getNotes());
      const linked = new Set(existing.map(note => this.savedURL(note.getNote())).filter(Boolean));
      for (const { candidate, html } of notes) {
        signal?.throwIfAborted();
        if (linked.has(candidate.url)) { results.push({ url: candidate.url, status: "existing" }); continue; }
        const note = new Zotero.Item("note");
        note.libraryID = item.libraryID; note.parentID = item.id; note.setNote(html);
        await note.save();
        linked.add(candidate.url); results.push({ url: candidate.url, status: "created" });
      }
      signal?.throwIfAborted();
    });
    return results;
  }
};
