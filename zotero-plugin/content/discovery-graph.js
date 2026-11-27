/* Graphs of the current OpenAlex discovery result. No requests or Zotero writes. */
var Search4PaperGraph = {
  overlap(left, right) {
    if (left === null || right === null) return null;
    const evidence = [...left].filter(id => right.has(id)).sort();
    const unionCount = left.size + right.size - evidence.length;
    return { score: unionCount ? evidence.length / unionCount : 0, evidence, unionCount };
  },

  pair(left, right, analysis) {
    const bibliographic = this.overlap(analysis.references.get(left), analysis.references.get(right));
    const cocitation = this.overlap(analysis.citers.get(left), analysis.citers.get(right));
    // Missing references are unknown, not a zero score or a change of weights.
    return { bibliographic, cocitation,
      score: bibliographic === null ? null : (bibliographic.score + cocitation.score) / 2 };
  },

  analyze(seeds, papers, evidencePapers = []) {
    const targets = new Map([...seeds, ...papers].map(paper => [paper.id, paper]));
    const witnesses = new Map([...evidencePapers, ...targets.values()].map(paper => [paper.id, paper]));
    const observedReferences = new Map();
    for (const paper of [...seeds, ...papers, ...evidencePapers]) {
      if (paper.referencesAvailable === false) continue;
      if (!observedReferences.has(paper.id)) observedReferences.set(paper.id, new Set());
      const refs = observedReferences.get(paper.id);
      for (const id of paper.referencedWorks) refs.add(id);
    }
    const references = new Map([...targets.keys()].map(id => [id, observedReferences.get(id) ?? null]));
    const citers = new Map([...targets.keys()].map(id => [id, new Set()]));
    for (const [witnessID, refs] of observedReferences) {
      witnesses.set(witnessID, { ...witnesses.get(witnessID), referencedWorks: [...refs], referencesAvailable: true });
      for (const id of refs) if (id !== witnessID) citers.get(id)?.add(witnessID);
    }
    const analysis = { references, citers, witnesses, missingWitnessReferences: witnesses.size - observedReferences.size,
      seedScores: new Map() };
    const seedIDs = new Set(seeds.map(seed => seed.id));
    for (const paper of papers) {
      if (seedIDs.has(paper.id)) continue;
      let best = null;
      for (const seed of seeds) {
        const pair = this.pair(seed.id, paper.id, analysis);
        if (!best || (pair.score ?? -1) > (best.score ?? -1)
          || (pair.score === best.score && seed.id < best.seedID)) {
          best = { ...pair, seedID: seed.id, seedTitle: seed.title };
        }
      }
      analysis.seedScores.set(paper.id, best);
    }
    return analysis;
  },

  build(seeds, papers, { limit = 100, citations = true, related = true,
    coupling = true, cocitation = false, minSimilarity = 0.1, selection = "list", analysis = null } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("图谱候选上限必须是 1–200 的整数。");
    if (!Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1) {
      throw new Error("共同参考文献相似度阈值必须在 0–1 之间。");
    }
    if (!["list", "similarity"].includes(selection)) throw new Error("未知的图谱选点方式。");
    analysis ||= this.analyze(seeds, papers);
    const seedIDs = new Set(seeds.map(paper => paper.id));
    const candidates = papers.filter(paper => !seedIDs.has(paper.id));
    if (selection === "similarity") candidates.sort((a, b) =>
      (analysis.seedScores.get(b.id)?.score ?? -1) - (analysis.seedScores.get(a.id)?.score ?? -1));
    const byID = new Map(seeds.map(paper => [paper.id, paper]));
    for (const paper of candidates.slice(0, limit)) byID.set(paper.id, paper);
    const nodes = [...byID.values()].map(paper => ({ paper, isSeed: seedIDs.has(paper.id) }));
    const edges = new Map();
    const add = (source, target, kind, evidence) => {
      if (source === target || !byID.has(source) || !byID.has(target)) return;
      if (kind !== "citation" && source > target) [source, target] = [target, source];
      const id = `${kind}:${source}:${target}`;
      if (!edges.has(id)) edges.set(id, { id, source, target, kind, evidence: [] });
      const edge = edges.get(id);
      if (!edge.evidence.includes(evidence)) edge.evidence.push(evidence);
    };
    for (const { paper } of nodes) {
      if (citations) for (const target of analysis.references.get(paper.id) || []) add(paper.id, target, "citation", "参考文献记录");
      if (related) for (const target of paper.relatedWorks) add(paper.id, target, "related", paper.id);
      // Preserve the seed/relationship pairing; relations × seedTitles is not an edge list.
      for (const entry of paper.relationEvidence || []) {
        if (citations && entry.relation === "reference") add(entry.seedID, paper.id, "citation", "种子参考文献查询");
        if (citations && entry.relation === "citation") add(paper.id, entry.seedID, "citation", "引用种子查询");
        if (related && entry.relation === "related") add(entry.seedID, paper.id, "related", entry.seedID);
      }
    }
    if (coupling || cocitation) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const [source, target] = [nodes[i].paper.id, nodes[j].paper.id].sort();
          const pair = this.pair(source, target, analysis);
          for (const [kind, enabled, metric] of [["coupling", coupling, pair.bibliographic],
            ["cocitation", cocitation, pair.cocitation]]) {
            if (!enabled || !metric?.evidence.length || metric.score < minSimilarity) continue;
            const id = `${kind}:${source}:${target}`;
            edges.set(id, { id, source, target, kind, ...metric, combinedScore: pair.score,
              bibliographicScore: pair.bibliographic?.score ?? null, cocitationScore: pair.cocitation.score });
          }
        }
      }
    }
    return { nodes, edges: [...edges.values()], candidateCount: candidates.length,
      shownCandidates: Math.min(candidates.length, limit), seedCount: seedIDs.size,
      missingReferences: nodes.filter(node => analysis.references.get(node.paper.id) === null).length,
      witnessCount: analysis.witnesses.size, missingWitnessReferences: analysis.missingWitnessReferences, selection };
  },

  elements(graph) {
    const years = graph.nodes.map(node => node.paper.year).filter(Number.isFinite);
    const firstYear = Math.min(...years), lastYear = Math.max(...years);
    return [
      ...graph.nodes.map(({ paper, isSeed }) => ({
        data: { id: paper.id, title: paper.title,
          label: `${paper.title.length > 26 ? paper.title.slice(0, 25) + "…" : paper.title}\n${paper.year || "年份未知"}${paper.citedByCount == null ? " · 引用未知" : ""}`,
          citedByCount: paper.citedByCount ?? null,
          size: paper.citedByCount == null ? 22 : 22 + 10 * Math.log10(1 + paper.citedByCount),
          color: paper.year ? `hsl(212, 65%, ${lastYear === firstYear ? 58 : 82 - 42 * (paper.year - firstYear) / (lastYear - firstYear)}%)` : "#a3a9b2" },
        classes: [isSeed ? "seed" : "", paper.libraryStatus === "pdf" ? "has-pdf" : "",
          paper.citedByCount == null ? "citations-unknown" : ""].filter(Boolean).join(" ")
      })),
      ...graph.edges.map(edge => ({ data: { ...edge, width: ["coupling", "cocitation"].includes(edge.kind) ? 1 + 4 * edge.score : 1.4 } }))
    ];
  },

  create(container, graph, { onPaper, onEdge }) {
    const byID = new Map(graph.nodes.map(node => [node.paper.id, node.paper]));
    const cy = cytoscape({ container, elements: this.elements(graph), layout: { name: "preset" },
      minZoom: 0.03, maxZoom: 4, autounselectify: true, boxSelectionEnabled: false,
      style: [
        { selector: "node", style: { "background-color": "data(color)", width: "data(size)", height: "data(size)",
          label: "data(label)", "font-size": 11, "text-valign": "bottom", "text-margin-y": 7,
          "text-wrap": "wrap", "min-zoomed-font-size": 6, color: "#263449",
          "text-background-color": "#ffffff", "text-background-opacity": 0.85, "text-background-padding": "2px",
          "border-color": "#66758a", "border-width": 1 } },
        { selector: "node.seed", style: { shape: "diamond", "border-width": 3, "border-color": "#253f65" } },
        { selector: "node.citations-unknown", style: { "border-style": "dashed" } },
        { selector: "node.has-pdf", style: { "border-color": "#188353", "border-width": 3 } },
        { selector: "node.queued", style: { "border-color": "#b0600c", "border-width": 5 } },
        { selector: "node.active", style: { "overlay-color": "#e6a534", "overlay-opacity": 0.2, "overlay-padding": 8 } },
        { selector: "edge", style: { width: "data(width)", "curve-style": "bezier",
          "line-color": "#8995a6", "target-arrow-color": "#8995a6", "arrow-scale": 0.8, opacity: 0.65 } },
        { selector: 'edge[kind = "citation"]', style: { "target-arrow-shape": "triangle" } },
        { selector: 'edge[kind = "related"]', style: { "line-style": "dotted", "line-color": "#9866a6" } },
        { selector: 'edge[kind = "coupling"]', style: { "line-style": "dashed", "line-color": "#3878b9" } },
        { selector: 'edge[kind = "cocitation"]', style: { "line-style": "dashed", "line-color": "#188353" } },
        { selector: "edge.active", style: { opacity: 1, "overlay-color": "#e6a534", "overlay-opacity": 0.15, "overlay-padding": 5 } }
      ]
    });
    cy.on("tap", "node", event => onPaper(byID.get(event.target.id())));
    cy.on("tap", "edge", event => {
      cy.edges().removeClass("active"); event.target.addClass("active"); onEdge(event.target.data());
    });
    cy.on("resize", () => this.fit(cy));
    // Theme changes can invalidate the canvas even when the graph data is unchanged.
    const host = container.ownerDocument.defaultView;
    const theme = host.matchMedia("(prefers-color-scheme: dark)");
    let paintFrame;
    const repaint = () => {
      host.cancelAnimationFrame(paintFrame);
      paintFrame = host.requestAnimationFrame(() => cy.forceRender());
    };
    theme.addEventListener("change", repaint);
    cy.one("destroy", () => { theme.removeEventListener("change", repaint); host.cancelAnimationFrame(paintFrame); });
    this.layout(cy);
    return cy;
  },

  fit(cy) {
    cy.fit(undefined, 35);
    if (cy.zoom() > 1.2) cy.zoom(1.2);
    cy.center();
  },

  layout(cy) {
    if (!cy.nodes().length) return;
    cy.layout({ name: "circle", animate: false }).run();
    cy.layout({ name: "cose", animate: false, randomize: false, numIter: 300, fit: false,
      nodeRepulsion: () => 8000, nodeOverlap: 20, initialTemp: 200, coolingFactor: 0.95,
      gravity: 0.3, componentSpacing: 70,
      idealEdgeLength: edge => ["coupling", "cocitation"].includes(edge.data("kind"))
        ? 60 + 140 * (1 - (edge.data("combinedScore") ?? edge.data("score"))) : 140
    }).run();
    this.fit(cy);
  }
};
if (typeof module !== "undefined") module.exports = Search4PaperGraph;
