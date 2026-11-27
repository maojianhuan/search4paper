# search4paper · Zotero 10 插件

在 Zotero 内检索、预览和导入会议、期刊论文，支持按专业领域和 CCF 分类筛选，并查找论文代码链接、检查 GitHub 仓库内容。

[0.1.8 XPI](https://github.com/maojianhuan/search4paper/releases/download/zotero-v0.1.8/search4paper-0.1.8.xpi) · [Release](https://github.com/maojianhuan/search4paper/releases/tag/zotero-v0.1.8)

0.1.8 包含 2026 年份、支持范围界面、代码仓库、期刊、关系图谱、跨来源搜索、普通搜索引用数及后续问题修复。机构标签和检索条件保存仍待开发。

## 安装和使用

在 Zotero 10 的 **工具 → 插件 → 从文件安装插件** 中选择 XPI，重启后从工具菜单打开 search4paper。已安装本地 0.1.8 候选包的用户请手动重新安装此发布包；同版本覆盖安装也需重启。同一 XPI 适用于 Windows、Linux、macOS；运行不需要 Python、Node、EXE 或本地服务。

- **论文检索**：会议、期刊支持多选，年份支持分号列表或范围（例如 `2024; 2025`、`2024-2026`）；插件分别验证和缓存每个来源/年份，再合并检索，任一范围失败时不发布不完整结果。关键词以分号分隔，AND 全部满足，OR 任一满足。点击标题预览，勾选论文后可补全摘要或导入目标集合。
- **跨来源搜索**：在论文检索页展开“跨来源搜索”，沿用上方关键词、字段、年份和来源选择。只读已有名单，并向 OpenReview / OpenAlex 发送分页关键词查询；不会下载全部会议名单或 PDF。每个远程查询每轮最多读取 50 条，通过“继续加载候选”读取下一页。结果复用预览、选择和导入，保留查询出处及时间；具体范围见下文。
- **期刊检索**：类型选择“期刊”、CCF 分类选择“A”，可检索 JMLR、TPAMI、TKDE 的 2025 / 2026 年书目。预览显示期刊、卷、期、页码、出版日期及年份依据；导入原生 `journalArticle`，保留来源提供的书目和 DOI，以 DOI / JMLR 来源 ID 去重。重复导入不覆盖用户修改的书目信息和笔记。具体来源和年份口径见下表。
- **支持范围**：年份下方实时显示所选会议、期刊的可查询年份与来源限制；展开“查看支持范围”可查看当前目录内所有来源的年份规则和论文范围。不支持的年份、ICCV 偶数年、ECCV 奇数年等组合会在读取缓存或联网前提示，并禁用搜索与刷新；不会自动跳过组合中的来源或年份。
- **摘要补全**：仅处理选中且缺少摘要的论文，依次使用精确 OpenReview ID 和 Semantic Scholar。Semantic Scholar 必须满足规范化标题完全一致、作者证据、年份一致且候选唯一。结果写回本地来源缓存；若 Zotero 中存在唯一对应条目且原摘要为空，也写入条目。现有摘要不会被覆盖。
- **文献发现**：在 Zotero 主窗口选择一篇或多篇种子论文，通过 DOI、已保存的 OpenAlex ID或标题/作者/年份严格匹配 OpenAlex，分别查找参考文献、引用种子的后续工作和相关论文。同一候选会合并多个关系与多个种子依据；可按关系、年份、类型、开放全文和 Zotero 库内状态筛选，并按综合推荐、年份、引用数或关联种子数排序。每条结果显示排序依据以及尚未导入、已在库无 PDF 或已在库有 PDF 的状态。缺失引用数显示未知，按引用数排序时排在真实零之后；已有 DOI / OpenAlex ID 与返回记录不一致时停止该种子查询。参考文献按 OpenAlex 单次上限分批完整读取；后续引用按引用数排序，每篇种子最多取 50 篇。导入条目保留 OpenAlex ID、推荐原因和种子论文，不自动导入种子本身。可在页面中配置免费的 OpenAlex API Key；插件显示响应中的当日剩余额度，并在 HTTP 429 时给出明确提示。
- **深入发现**：勾选“深入发现”后再扩展，可沿共享参考文献、共同引用者寻找二跳候选，并补充图外的共被引证据。额外查询有明确上限，界面报告截断和缺失详情；基础模式保持原有查询范围。
- **关系图谱**：在“文献发现”中切换“列表 / 图谱”。共用筛选和待导入选择，图谱默认按与种子的联合相似度选点，也可切换为原来的列表顺序。点击节点查看摘要，在预览区勾选后使用原有导入按钮。菱形代表种子；节点大小随已知被引数对数缩放；缺失计数使用最小尺寸、虚线边框及“引用未知”标记。颜色从浅到深表示年份从早到晚，灰色表示年份未知；绿色边框表示库内已有 PDF，橙色边框表示待导入。可拖动节点、平移、缩放、适应画布及重新布局。点击连线查看引用方向、推荐来源、共同参考文献或共同引用者及评分依据。
- **全文获取**：先在 Zotero 主窗口选中文献，再点击获取全文。统一按“明确的开放出版商 PDF → 严格匹配的 arXiv 最新版本 → OpenReview 稳定 PDF / ID 地址 → ACM/IEEE 出版商路径 → Zotero 原生全文查找”执行。WWW 缺少 DOI 时，仅在 Crossref 的标题、作者、年份和会议均严格匹配且结果唯一时写回 DOI，再进入 ACM 路径。已有的 OpenReview 稳定 PDF 地址在标题查询失败或未命中时仍会使用。结果会显示实际取得附件的来源。IEEE 北航订阅访问需在插件窗口手动完成 SSO；同一会话复用 Cookie，机构下载逐篇进行，开始时间至少间隔 10 秒。全文不保证可得；失败时保留书目条目，已知限制见 [TODO](../TODO.md)。
- **代码仓库**：在 Zotero 主窗口选择一篇已保存的论文，打开“代码仓库”页并点击“查找并检查代码”。页面显示论文代码链接，以及 GitHub 仓库是否可公开访问、是否为空、是否只有说明或配置文件、是否有非空代码文件；可查看具体文件名、字节数和 README／代码原文摘录，并展开论文出处核对关联。默认不勾选；点击“确认关联选中链接”后，链接、仓库检查结果、检查时间和论文出处保存为原生子笔记。检查不写库，主窗口选择变化不会改变保存目标；重复确认保留已有笔记及批注，整批保存失败会回滚。

arXiv 自动匹配要求标题规范化后一致、作者姓氏至少匹配一位（多作者论文至少两位）、首次提交年份与条目年份相差不超过一年，且只能有一个候选。下载使用不带 `vN` 的 PDF 地址以取得 arXiv 当前最新版本；该附件是作者版本，不等同于出版商最终版本。没有作者信息或存在歧义时跳过，不按标题单独猜测。

ACM 条目在前述开放路径失败后按 DOI 请求 ACM 官方 PDF；遇到 403 时显示“ACM 访问验证”，在 Zotero 窗口中手动完成验证后，再点击“获取全文”。验证窗口与请求共享独立的临时 Cookie 会话，不保存登录信息。网站验证仍可能阻止后台下载，需在 Windows 上实测。

元数据保存在 `<Zotero 数据目录>/search4paper/<会议或期刊>/<年份>.json`，支持离线筛选。点击“刷新名单”更新；单个来源获取失败或取消不会覆盖该来源的旧名单，组合查询中已完成的来源可以更新缓存。缺失的摘要等字段保持为空。首次欢迎提示仅显示一次，状态保存在 Zotero profile 的 `extensions.search4paper.welcomeShown` 偏好中。

## 普通搜索中的引用数

在原名单检索或跨来源搜索结果中勾选论文，点击“查询选中引用数”。列表显示 OpenAlex 引用数；点击论文后可查看来源链接、查询时间及未匹配 / 失败原因。可按引用数升序或降序排列，未知值始终排在最后，零引用保留为 `0`。查询共用“文献发现”页的 OpenAlex Key。

每篇选中论文最多一次请求：先按 DOI 或已有 OpenAlex ID 查询并核对返回标识；没有这些标识时，按完整标题检索前 10 条候选，要求规范化标题、年份和作者证据一致，且返回候选中只有一个匹配。不会在身份冲突后换用另一种查询补数；OpenAlex 合并 ID 导致返回标识变化时也保留为未匹配。引用数是 [OpenAlex 工作记录的被引次数](https://help.openalex.org/data/works/citations/)，不代表仅正式出版版本或全网总引用数。

未找到、身份未匹配、来源缺失计数和请求失败分别保留状态，计数为空。请求失败时停止当前批次，已完成结果保留，未处理论文不改写；取消同样不生成零值。再次点击是显式重新查询，不自动重试。

“导出选中结果”保存 JSON，按当前排序导出所选论文的书目、摘要、命中证据及同一份 `citation` 信息（计数、来源、时间、匹配方式和状态）。导出取消不写文件。导入 Zotero 时，将引用信息追加到来源笔记；重复导入同一快照不重复追加，新查询的证据不会覆盖用户修改的书目或笔记。

引用结果仅随当前检索保留，切换排序、重新应用字段筛选或继续加载跨来源分页会保留；重新搜索 / 刷新名单后需重新查询或使用已导出、已导入的记录。查询本身不写入完整会刊缓存、不自动修改已在 Zotero 中的条目、不下载 PDF。

## 跨来源搜索的查询与覆盖范围

原“搜索论文 / 刷新名单 / 应用筛选”继续使用完整来源名单流程。新增入口采用以下查询：

- 本地：读取所选来源、年份的已有完整名单，不联网补抓、不创建或修改缓存。缺失名单逐项说明；损坏名单明确报错。
- OpenReview：对 ICML、NeurIPS、ICLR、WWW 按精确会议年份 `venueid` 查询，每个关键词、每个所选字段分别分页。标题、摘要、关键词使用相应服务端字段；TLDR 因来源字段名不一致，使用 `all` 获取候选后本地复核，不保证从 TLDR 完整召回。仅接收属于指定录用 venue 的记录，不混入投稿、拒稿或 Workshop。
- OpenAlex：选择“不限会议／期刊”时，检索全部来源中指定年份的候选，**不受上方专业领域、类型或 CCF 目录筛选限制**；选择“仅所选期刊”时，按 JMLR、TPAMI、TKDE 的登记 ISSN 限定 `primary_location.source.issn`。也可选择“不查询 OpenAlex”。每个关键词单独查询标题、摘要、关键词索引，再复核勾选字段；OpenAlex 不提供 TLDR，仅勾选 TLDR 时不发 OpenAlex 查询。Key 复用“文献发现”页设置。
- 其他会议没有新增远程官方关键词适配器，仅读取其已有本地名单；OpenAlex 广域结果不代表已完整覆盖该会议。未使用名称猜测会议与出版系列的对应关系。新入口的年份表示查询范围，不承诺该年官方名单或平台索引已经公开。

每次点击只读取每个未结束查询的一页，最多 50 条；预先显示请求数与单页上限，不自动翻页补足最终命中数量。覆盖区分别显示本地名单时间、服务端候选总数、已读取数、未读分页和复核后的独立论文数。服务端候选在不同字段、词组之间可能重复，不能把总数相加当作独立论文数。每个远程查询最多读取前 10,000 条，达到上限时明确标为不完整并要求缩小条件。

候选必须在某一条实际返回记录内满足原有 AND／OR、词组、字段规则，AND 允许词组分别出现在标题和摘要。不会拼接不同来源的字段来制造命中，也不会因为来源的相关度分数高就跳过本地匹配。服务端召回规则与本地词前缀规则不同，本地复核不能找回未被服务端返回的论文；完整名单检索仍用于重点会议范围核对。零候选也可能来自未公开、索引缺失、摘要缺失或来源映射不完整，不能证明没有相关论文。

合并使用规范化 DOI、OpenReview ID、OpenAlex ID 和已识别的官方来源标识；OpenAlex 明确提供的 OpenReview 落地页也参与身份匹配。保留各次命中的来源、查询 URL 和获取时间，优先使用满足完整查询条件的官方返回记录。同标识出现相互冲突的 DOI 时停止并报错；仅规范化标题相同但标识不同的论文保持独立，标注可能存在不同版本。查询 URL 不包含 API Key。

结果仅保存在当前窗口内存中，不会被写成完整会议名单。新查询失败或取消不发布部分结果；继续加载失败或取消保留上次成功结果及分页位置，不自动重试。更改关键词、字段、来源、年份或 OpenAlex 范围后需重新跨来源搜索。跨来源结果禁用原名单的摘要补全按钮，防止局部候选写回整届缓存；原名单检索中的摘要补全保持原样。

导入使用已有的集合、标签与标识去重流程；OpenAlex 来源按返回类型创建期刊论文、会议论文、预印本或文档，缺失字段不生成。来源证据保存为子笔记，重复导入保留用户书目及笔记修改。导入后可在 Zotero 主窗口选种子使用已有“文献发现 / 图谱”，全文获取仍需单独触发。

## 关系图谱的含义与范围

四种连线可独立显示：实线箭头从引用论文指向被引用论文；紫色点线是 OpenAlex `related_works` 推荐关系，不表示引用；蓝色虚线是文献耦合（共同参考文献）；绿色虚线是共被引（被同一批已采集论文引用）。两种相似度各自采用 Jaccard：集合交集大小除以并集大小，空并集记为 0。蓝线使用全部已返回参考文献 ID，包括图外文献；绿线使用整个查询会话中已采集、提供参考文献的论文构成的引用者集合，按 ID 去重并排除自引。绿线的分母不是 OpenAlex 全库被引次数，不能解释为全库共被引相似度。参考文献列表也可能不覆盖原论文的全部文献，见 [OpenAlex 引用数据说明](https://help.openalex.org/data/works/citations/)。

联合分数固定为 `(参考文献 Jaccard + 已采集引用者 Jaccard) / 2`；多种子取与任一种子的最高联合分数，同分保留当前列表顺序。这是本项目明确规定的评分，没有拟合 Connected Papers 的私有公式。参考文献字段缺失时，文献耦合与联合分数保持未知，不改成 0，也不重分配权重；仍可查看已有共被引证据。已知空列表与字段缺失分别处理。节点预览显示最近种子和分项分数，连线预览列出共同参考文献或共同引用者，可打开对应 OpenAlex 页面。

图谱默认从全部筛选候选中按联合分数选取前 100 篇，再计算展示连线；可选择 50 / 100 / 200 篇，或切换为沿用列表顺序，始终保留种子。筛选、图谱上限和连线开关不重建引用证据集合，也不改变原列表的排序与导入选择。连线阈值默认 0.1，分别作用于蓝、绿连线的单项分数，不筛掉低分节点。布局使用联合分数调节相似度边的目标距离；联合分数未知的共被引边使用其单项分数。力导向位置仍受其他边影响，图上距离不是精确的相似度量。

深入发现的采样规则（勾选时才联网执行）：

1. 保留基础查询：种子参考文献完整分批读取，推荐关系及每种子引用数最高的前 50 篇后续引用保持原样。
2. 每种子的参考文献按 OpenAlex 返回顺序去重，最多使用前 100 个作为入口；查询引用其中任一文献的前 200 篇论文，在返回的样本中按与种子的参考文献 Jaccard 排序，最多新增 100 篇候选。已有候选仍可补充关系。
3. 从基础查询中实际引用种子的论文出发，收集它们的其他参考文献，按共同引用者数量、ID 排序，最多再请求 100 篇新候选的详情；未返回详情的 ID 会报告数量。每条新增关系保存对应种子 ID、关系类型与中间证据 ID。
4. 将所有种子及候选按 ID 排序，每 100 个一组查询共同的引用者样本，每组最多读取被引数最高的 200 篇（两页，每页 100）。这些论文作为证据，不自动加入待导入候选。采样总数、达到上限的查询组、缺少参考文献的证据记录均在界面中报告。

上述范围有意受限，引用数排序会偏向高被引论文。未连线或分数为 0 不代表全库中没有关联；OpenAlex 中不同 ID 的预印本和正式版本仍可能分别出现，不按标题猜测合并。本版尚无图谱级前序/后续工作聚合、相似度最短路径或历史保存，也不声称达到 Connected Papers 的发现质量。

默认仍打开列表，只有切换到图谱才创建渲染器，切回列表或关闭窗口即释放。绘图使用随 XPI 本地打包的 [Cytoscape.js 3.35.0](https://js.cytoscape.org/)（MIT，许可位于 `content/vendor/cytoscape-LICENSE.txt`），不需要 CDN、Node、Python 或本地服务。关系数据仅在发现会话内使用，导入笔记继续保留来源，并补充对应种子 ID 和关系类型。

真实数据评估可使用 Node 18+ 运行 `node tests/evaluate_zotero_discovery.cjs /tmp/discovery-evaluation.json`，可选通过环境变量 `OPENALEX_API_KEY` 提供 Key。默认使用 BERT 和 Isolation Forest 的 DOI，比较原列表前 20 篇与深入发现后联合评分前 20 篇；输出查询次数、候选覆盖变化、两组结果重合数、每项分数与证据，以及供复核的已采集论文（省略不参与计算的摘要）。也可在输出路径后传入其他 DOI。脚本只读 OpenAlex，不访问 Zotero，不覆盖已有输出。它没有人工相关性真值，覆盖增加和排序变化不能当作准确率、召回率或优于 Connected Papers 的证明。

## 代码仓库的检查范围

本版从条目摘要及下面一种论文来源中查找代码链接。保留仓库地址及有明确代码、软件或项目线索的链接；数据集、补充材料链接不会仅因是论文材料就列为代码：

- 有 OpenReview ID 时，查询公开论文记录，要求返回记录的 ID 和规范化标题均一致；只读取摘要与代码、数据、项目、补充材料等明确材料字段，不读取评审评论或推测未提供的附件地址。
- 否则读取条目中的论文网页地址，缺少可用网页地址时可使用 DOI 地址。网页必须有可核对的单篇论文标题或 DOI 元数据；字段冲突时停止。提取网页摘要及正文链接，保留原文上下文。相对链接按最终页面地址解析。

对 GitHub 仓库读取公开仓库信息、默认分支的递归[文件清单](https://docs.github.com/en/rest/git/trees#get-a-tree)，按常见代码扩展名统计非空的普通文件，展示最多六个文件名及大小。README 和一个代码文件各取一份原文样本：仅读取不超过 128 KiB 的文件，展示前 900 个字符。空 `.py` 文件、子模块和符号链接不会计为非空代码；子模块、符号链接、压缩包及其他分支不会展开检查。文件扩展名只能说明发现代码文件，不能判断文件是否为占位、模板、第三方代码或完整实现，原文摘录供用户进一步核对。

仓库内容检查只支持 `github.com`；GitLab、Bitbucket、代码压缩包和项目页等链接标注为需手动检查。API 请求不需配置登录或令牌，但受 [GitHub 公共 API 限流](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)约束；403、429、网络错误显示检查失败，404 显示无法公开访问（不存在或私有），不推断论文未公开代码。文件清单被截断时显示检查不完整；文件正文读取失败单独标注，已取得的文件清单仍可核对。再次点击检查会读取当前状态；已经确认的子笔记保留当时结果和时间。

不扫描 PDF，不搜索同名仓库，不执行网页脚本，不递归访问候选项目页。会议总表、缺少论文元数据的普通项目页和访问验证页不受支持，会明确提示论文来源检查未完成。条目没有可检查的网页或 OpenReview ID 时，仅从本地摘要提取链接并标明范围；“未找到链接”不代表论文没有公开代码。

链接出现于上述来源只提供关联线索；摘要可能由用户编辑，链接也可能引用第三方代码。是否确实属于该论文由用户依据原文确认。保存关联不表示已验证作者官方归属、代码完整性或实验可复现性；插件不克隆仓库或执行代码。

## 支持的来源和年份

共 30 个会议、3 本期刊；分类使用仓库 CCF 2026 目录。下表列出明确核实的年份或按年份查询的适配规则；“某年起”不代表每年均已公开或逐年验证。仅已公开且结构受支持的年份可用；不可用或结构异常明确报错，不以 DBLP 替代录用名单。来源核对日期：2026-09-29；IJCAI / ACM MM / IROS / ICRA 于 2026-10-29 补充核对。

本次仅接入已确认的 CCF A 期刊。此前建议的两批期刊并非全部为 A：JMLR、TPAMI 为人工智能 A 类，TKDE 为数据库/数据挖掘/内容检索 A 类；TNNLS 为 B 类，TMLR 未列入核对目录，均不纳入本次支持范围。依据：[CCF 人工智能目录](https://www.ccf.org.cn/Academic_Evaluation/AI/)、[CCF 数据库目录](https://www.ccf.org.cn/Academic_Evaluation/DM_CS/)，并与 [2026 第七版目录 PDF](https://scdm-shu.github.io/ccf/2026-CCF-Ranking.pdf) 交叉核对。

| 期刊 | 来源及范围 | 支持年份与年份口径 |
| --- | --- | --- |
| JMLR | 官方卷目录与逐篇详情，保留作者、摘要和官网 PDF 链接；包含 MLOSS 等栏目 | 2025：[卷 26](https://jmlr.org/papers/v26/)；2026：[卷 27](https://jmlr.org/papers/v27/)；逐条核对目录及详情的出版年 |
| TPAMI | [Crossref 的 IEEE 登记书目](https://api.crossref.org/journals/0162-8828/works)，ISSN 0162-8828，类型 `journal-article` | 2025、2026；按 `published` 登记的最早出版年，可能与卷期年不同 |
| TKDE | [Crossref 的 IEEE 登记书目](https://api.crossref.org/journals/1041-4347/works)，ISSN 1041-4347，类型 `journal-article` | 2025、2026；按 `published` 登记的最早出版年，可能与卷期年不同 |

期刊查询是已出版书目检索，不是录用名单或投稿状态跟踪。JMLR 采用明确的卷年映射，不用“年份减常数”推断历史卷号；更早年份尚未适配。Crossref 的[出版年定义](https://community.crossref.org/t/what-does-pub-date-mean-as-endpoint-for-filters/3785)取已登记出版日期中最早的日期，并不保证 IEEE 已登记实际首次 Early Access 日期。导入日期保留该口径，另在预览和来源笔记保留可得的在线、卷期出版日期。

Crossref 可能尚未收录部分论文，`journal-article` 也可能包含社论或勘误；插件不按标题猜测并排除这些条目。按 ISSN、期刊全称、类型和年份核对每条记录，读取全部分页并核对 API 声明总数；分页缺失、重复 DOI、总数变化或 HTTP 错误会停止本次获取。这里的“完整”仅指本次来源返回的书目，不保证期刊全年全部论文。缺失的摘要、卷期或页码保持为空，界面显示缺摘要数量，可使用已有的“补全选中摘要”。不会把 Crossref 的相似性检测链接当作公开 PDF；全文仍使用已有全文获取流程。

| 会议 | 官方来源与范围 | 当前支持年份 |
| --- | --- | --- |
| ICML / NeurIPS / ICLR | OpenReview API v2，`会议.cc/年份/Conference` 录用名单 | 所选年份须已公开 |
| WWW / The Web Conference | OpenReview API v2，`ACM.org/TheWebConf/年份/Conference` 录用名单 | 所选年份须已公开 |
| IROS | [PaperPlaza 官方技术日程](https://ras.papercept.net/conferences/conferences/IROS25/program/)，Regular Session 论文；含主会论文展示，可能含期刊展示 | 2025 |
| ICRA | [PaperPlaza 官方技术日程](https://ras.papercept.net/conferences/conferences/ICRA26/program/)，Regular / Interactive / Award Session 论文 | 2026 |
| IJCAI | [2025](https://ijcai.org/proceedings/2025/) / [2026](https://ijcai.org/proceedings/2026/) 官方论文集 Main Track 与详情摘要；排除专题、Survey、Journal、Demo 等轨道 | 2025、2026 |
| ACM MM | [2025 官方 Regular Papers 录用名单](https://acmmm2025.org/accepted-regular-papers/)；缺失摘要、DOI、PDF 保持为空 | 2025；2026 尚未适配 |
| AAAI | AAAI Proceedings，Technical Tracks | 2010 起 |
| ACL | ACL Anthology，2020 起主会 long；更早为 Pyy 第 1 卷 | 2000 起 |
| EMNLP | ACL Anthology，2020 起主会 main；更早为 Dyy 第 1 卷 | 2007 起 |
| CVPR / ICCV | CVF 主会论文集 | 2013 起；ICCV 仅奇数年 |
| ECCV | ECVA 主会论文集 | 2018 起，仅偶数年 |
| CRYPTO / EUROCRYPT / ASIACRYPT | IACR CryptoDB 年度目录与详情，排除邀请报告 | 2000 起，目录须公开 |
| ICDE | [2025](https://ieee-icde.org/2025/research-papers/) / [2026](https://icde2026.github.io/accepted-papers.html) 官方 Research Papers | 2025、2026 |
| SIGMOD | [2025](https://sigmodconf.hosting.acm.org/2025/sigmod_papers.shtml) / [2026](https://2026.sigmod.org/sigmod_papers.shtml)，四轮 Research Papers | 2025、2026 |
| KDD | 2025：OpenReview Research Track 两周期，不可访问时标注使用[官方名单](https://kdd.org/kdd2025/research-track-papers-2/)；2026：[官网两周期论文数据](https://kdd2026.kdd.org/papers/)，仅 Research Track | 2025、2026 |
| SIGIR | [2025](https://sigir2025.dei.unipd.it/accepted-papers.html) / [2026](https://sigir2026.org/en-AU/pages/program/accepted-papers)，仅 Full / Short Papers | 2025、2026 |
| VLDB | 2025 对应 [PVLDB 18](https://www.vldb.org/pvldb/volumes/18/)；2026 对应 [PVLDB 19](https://www.vldb.org/pvldb/volumes/19/)，均仅第 1–11 期 Research Track | 2025、2026 |
| FAST | [2025](https://www.usenix.org/conference/fast25/technical-sessions) / [2026](https://www.usenix.org/conference/fast26/technical-sessions)，研究论文 | 2025、2026 |
| NSDI | [2025](https://www.usenix.org/conference/nsdi25/technical-sessions) / [2026](https://www.usenix.org/conference/nsdi26/technical-sessions)，研究论文 | 2025、2026 |
| OSDI | [2025](https://www.usenix.org/conference/osdi25/technical-sessions) / [2026](https://www.usenix.org/conference/osdi26/technical-sessions)，研究论文 | 2025、2026 |
| USENIX Security | [2025](https://www.usenix.org/conference/usenixsecurity25/technical-sessions) / [2026](https://www.usenix.org/conference/usenixsecurity26/technical-sessions)，研究论文 | 2025、2026 |
| CCS | [2025](https://www.sigsac.org/ccs/CCS2025/accepted-papers/) 的[两周期 JSON](https://www.sigsac.org/ccs/CCS2025/assets/accepted-papers.json)；[2026](https://www.sigsac.org/ccs/CCS2026/program/accepted-papers.html) 的两周期 HTML 表格 | 2025、2026 |
| NDSS | [2025](https://www.ndss-symposium.org/ndss2025/accepted-papers/) / [2026](https://www.ndss-symposium.org/ndss2026/accepted-papers/)，Summer / Fall 两周期主会论文 | 2025、2026 |
| SIGCOMM | [2025 录用名单](https://conferences.sigcomm.org/sigcomm/2025/accepted-papers/)的 Full papers；[2026 最终日程](https://conferences.sigcomm.org/sigcomm/2026/program/papers/)的 Research / Experience Sessions | 2025、2026 |
| FSE | Researchr [2025](https://conf.researchr.org/track/fse-2025/fse-2025-research-papers) / [2026](https://conf.researchr.org/track/fse-2026/fse-2026-research-papers)，仅 Research Papers | 2025、2026 |

USENIX 四会共用解析路径，并读取详情中的作者、摘要和 PDF 地址，不下载 PDF。Security 优先最终技术日程；仅当其返回 404 时，读取同届官网链接的已公布周期名单，合并去重并标注“非最终完整 proceedings”。CCS 合并 firstCycle / secondCycle；NDSS 官网已合并两周期，页面给出计数时核对完整性。缓存和导入笔记记录实际来源、周期及名单类型，不混入旧缓存。

SIGIR 2026 官网说明该页为初始录用快照，后续标题与作者修订不会更新；界面和缓存均保留此提示，不视为最终出版元数据。仅纳入 Full / Short Papers，排除 Perspective、Reproducibility、Resource、Demo、Industry 等轨道。

SIGCOMM shorts 按 [2025 CFP](https://conferences.sigcomm.org/sigcomm/2025/cfp/) 不属于正式会议论文，故排除；2025 官网 Full papers 未逐篇区分 research / experience。2026 最终日程纳入 18 个 Research 和 6 个 Experience Session，排除 Sponsored / Special Sessions。[2026 录用页](https://conferences.sigcomm.org/sigcomm/2026/accepted/)标注 110 篇，但逐条名单及最终日程主会论文均为 109 篇；插件展示这一来源差异，不虚构缺失记录。FSE 排除 Industry、Journal First、演示等轨道；此处 FSE 指软件工程会议。

KDD 2025 周期为 `KDD.org/2025/Research_Track_August`、`KDD.org/2025/Research_Track_February`；2026 直接解析官方页面的 `cycle1Papers` / `cycle2Papers` 数据，仅取 `rtp`，排除 ADS、Datasets / Benchmarks 等轨道，不执行网页脚本、不推测 OpenReview 周期名。VLDB 年份按 [2025 卷期归属](https://www.vldb.org/pvldb/vol18/FrontMatterVol18No12.pdf)和 [2026 卷期归属](https://www.vldb.org/pvldb/vol19/FrontMatterVol19No11.pdf)，不按出版日历年推断；均只纳入第 1–11 期研究论文，排除后续期号与 Front Matter。新来源均导入 `conferencePaper`，保留官方可得的作者、规范会议名、出版物名、DOI、页码、摘要与链接，不生成缺失元数据。

IJCAI 按官方 Main Track 分组获取论文，逐篇核对标题、作者、DOI 和轨道并读取摘要、关键词；首次获取需请求各论文详情页。ACM MM 2025 仅提供录用名单，论文用“年份＋投稿编号”区分，共用名单页面 URL 不参与单篇去重。两者均支持本地缓存检索、组合筛选和导入；不支持的年份在联网前报错，不以其他年份或 DBLP 代替。

IROS / ICRA 当前读取上述年份全部三个技术日程日，逐条保留作者、关键词、摘要和日程定位链接；按年份与投稿编号去重，重复展示内容不一致时报错。排除 Late Breaking Results、Workshop、Tutorial、Keynote、Plenary 等记录。来源是技术日程，可能包含期刊论文的会议展示，不等同于纯主会新录用论文集；导入来源笔记保留这一口径。未公开摘要、DOI 和 PDF 不生成。ICRA 2025 与 IROS 2026 的候选官方页面本次访问失败，未适配，也不以 DBLP 或其他年份替代。

## 开发和发布

在仓库根目录运行：

```sh
node --test tests/test_zotero_plugin.cjs tests/test_zotero_arxiv.cjs tests/test_zotero_abstract.cjs tests/test_zotero_discovery.cjs tests/test_zotero_citations.cjs tests/test_zotero_cross_search.cjs tests/test_zotero_publication.cjs tests/test_zotero_openreview.cjs tests/test_zotero_ieee.cjs tests/test_zotero_database.cjs tests/test_zotero_systems.cjs tests/test_zotero_acm.cjs tests/test_zotero_materials.cjs tests/test_zotero_journals.cjs tests/test_zotero_ai.cjs
python3 zotero-plugin/build.py
```

Windows 可用 `py -3 zotero-plugin/build.py`。Python 3 标准库仅用于打包，输出 `dist/search4paper-0.1.8.xpi`；不需要 EXE 生成器。源码变化后重新打包一次，跨平台无需重建。发布需用户明确授权；安装包上传成功后再启用对应自动更新清单。

Git 跟踪源码、构建脚本和版本号；XPI 存放在 Release，不提交到 Git。推送带注释的 `zotero-v<版本>` 标签会运行[发布工作流](../.github/workflows/release-zotero.yml)，从标签源码测试、打包，创建或更新同名 Release 和安装包。插件通过 `updates.json` 向已安装用户提供后续版本。

2026-11-27 发布准备：按用户指令统一发布 0.1.8，包含以下验收后的修复。重新运行 174 项 Node 测试通过；本地构建包含 29 个文件、256,520 字节，包内源码与通过 138 项 Linux Zotero 10.0.3 原生检查的版本逐文件一致。原 P1 候选包已保留在 `dist/p1-acceptance/search4paper-0.1.8.xpi`，发布验证记录位于 `dist/release-0.1.8/`。

2026-11-27 问题修复验收：174 项 Node 测试通过；当前源码在隔离 Linux Zotero 10.0.3 中通过图谱 45 项、跨来源 46 项和引用数 47 项原生检查。远程查询使用模拟响应，实际执行图谱渲染、导入及 JSON 导出。另用两篇真实论文核验全文路径，确认公开 PDF 可取得、OpenReview 仍存在 HTTP 403 / challenge 限制；该联网诊断使用修复前启动的包，已存地址保留行为由新增回归测试验证。记录在 `dist/fixes-acceptance/`，具体范围与未验证项见 [TODO](../TODO.md)。源码版本保持 0.1.8，仅在临时目录打包测试，未覆盖此前验收包或发布。

2026-11-27 P1 本地候选验收：0.1.8 XPI 为 255,881 字节，包完整性、29 个文件与源码一致性和 20 处资源引用检查通过；169 项 Node 测试通过。隔离 Linux Zotero 10.0.3 中，`tests/zotero_citations_smoke.js` 的 47 项检查与既有跨来源 smoke 的 39 项检查通过。引用测试采用合成论文和模拟 API 响应，核对零与未知、身份冲突、错误停批、取消、排序、选择和续页保留；真实写出 JSON 并导入 Zotero，核对来源笔记追加、重复导入去重及用户修改保留。文件选址使用模拟对话框，未操作个人文献库，未验证 Windows/macOS。

独立联网检查使用当前引用模块发出 2 次请求：`10.1038/nature14539` 精确匹配并返回计数；一个已有 ICLR 2026 VLN 标题查询触发 HTTP 429，未重试。记录保存在本地 `dist/p1-acceptance/`，不作为实时 API 全面可用或领域覆盖完整的结论。原生复验调用 `runSearch4PaperCitationsSmoke(win, { expectedDataDir, exportPath })`，仅在目录名含 `search4paper-citations-native-` 的空隔离库运行；`exportPath` 指定合成候选的 JSON 输出位置，测试结束仅清理自身创建的 Zotero 条目。

2026-11-27 P0 本地候选验收：0.1.7 XPI 为 252,055 字节，包完整性、所有本地资源引用和与源码逐文件一致性检查通过；158 项 Node 测试通过。在隔离的 Linux Zotero 10.0.3 无头窗口中安装并加载此包，跨来源 smoke 通过 46 项检查，两个真实主题的本地检索与导入通过 58 项检查。

主题验收只复用已有 ICLR 2026 的 5,351 条原始 OpenReview 记录。VLN 使用 `vision language navigation; vision and language navigation; visual navigation` 的 OR 查询，得到 13 篇；时间序列异常检测使用 `time series; anomaly` 的 AND 查询，得到 19 篇，均检查标题、摘要、关键词和 TLDR。32 篇候选按标题 / 摘要审读，包含邻近工作和误命中，不视为全部相关论文。实际界面核对了覆盖说明、预览、字段筛选和恢复、集合 / 标签、每主题选中 2 篇的原生导入、重复导入与用户修改保留；主题流程没有论文网络请求、PDF 下载或来源缓存改写。

小规模记录保存在本地 `dist/p0-acceptance/`。`tests/zotero_topic_acceptance_smoke.js` 提供 `runSearch4PaperTopicAcceptance(win, { expectedDataDir, topics })`：仅在路径含 `search4paper-cross-native-p0` 的空隔离库运行，预先准备完整来源缓存；`topics` 使用审读记录中的查询、范围和候选 ID。先完成现有跨来源 smoke，再执行主题验收；后者会在隔离库保留 4 篇验收条目。跨来源远程响应为模拟数据，P0 没有重新验证实时 API 或 Windows/macOS。后续工作见 [任务路线](../TODO.md)。

离线测试使用保存的页面片段；`tests/zotero_database_fixtures.js` 和 `tests/zotero_systems_fixtures.js` 在 Zotero 原生 DOMParser 中运行，分别将对应 fixture 目录中的文本按文件名传入。2026 年份更新通过 105 项 Node 测试、167 条原生 DOM 断言（覆盖 2025 / 2026 页面、错误年份、缺失轮次和轨道排除），以及 Linux Zotero 10.0.3 中的 7 项实际 XHTML 界面检查，包括无效组合拦截、修正后恢复搜索和来源限制展示。

2026-11-13 跨来源搜索验证：全部 158 项插件 Node 测试通过，其中新增 12 项覆盖有界分页、跨字段 AND、身份桥接去重、版本保留、来源证据、缺失和损坏缓存、失败／取消不推进分页，以及原名单读取与导入行为。`tests/zotero_cross_search_smoke.js` 在 Chromium 中通过 39 项界面断言，在隔离的 Linux Zotero 10.0.3 中通过 46 项（包括真实条目和来源笔记写入、重复导入保留用户摘要、清理自建测试条目）。原关系图谱的 42 项断言在两种环境均继续通过。浏览器默认使用模拟查询和导入；原生真实导入仅在空测试文献库中传入 `expectedDataDir`，目录名必须含 `search4paper-cross-native-`。未操作个人 Zotero 文献库，Windows/macOS 未实测。

同日通过当前跨来源模块执行只读联网检查：`time series`、2026 年、ICLR 四字段加 OpenAlex 广域查询，每个查询最多读 50 条，去重及本地复核后得到 130 篇；手动加载下一页后为 214 篇。ICML 2026 标题查询首批 50 条均通过复核；TPAMI 2025、`learning`、ISSN 限定查询首批 50 条均通过复核，逐条核对了年份和 ISSN。JMLR 2025 的 `learning`、JMLR 2026 的 `time series` 在当时指定 ISSN 查询下均返回零候选，这不表示官网没有相关论文。上述数字仅为检索当时的分页样本，无人工相关性真值，不评价全库召回率。

2026-11-13 关系图谱验证：全部 140 项插件 Node 测试通过，新增检查覆盖同名多种子的关系对应、候选之间的引用方向、推荐去重、Jaccard 集合计算、缺失参考文献、图谱上限及图引擎布局。`tests/zotero_discovery_graph_smoke.js` 在 Chromium XHTML 和隔离的 Linux Zotero 10.0.3 无头窗口中各通过 31 项交互断言，覆盖节点/边预览、缩放、筛选、视图切换、选择与导入入口、显示上限不截断列表、失败重查清空旧图，以及原检索、全文和代码仓库页面状态保留。仅在新建隔离窗口调用 `runSearch4PaperDiscoveryGraphSmoke(win)`；使用合成论文，临时替换并恢复查询和导入函数，不执行实际文献导入或联网发现。另检查浅色/深色界面和窗口缩放，并完成 200 篇合成候选的渲染检查。Windows/macOS 界面及真实大文献库未实测；这些测试不评价文献发现的召回率或相似度质量。

2026-11-13 深入发现扩展验证：全部 146 项插件 Node 测试通过，新增范围包括二跳路径与证据、查询及候选上限、取消和失败传播、完整观察集合中的共被引、多种子联合评分、缺失字段保持未知，以及先评分后截取。Chromium 与隔离的 Linux Zotero 10.0.3 各通过 42 项界面断言，包含共被引预览、选点方式切换、图外引用者、深度查询参数传递、筛选不改变证据集合、覆盖提示可见及失败查询清理。另完成真实 Isolation Forest 样本的 101 节点、2,655 连线渲染及证据预览检查。测试继续覆盖原检索、全文、代码仓库及导入入口；未测试 Windows/macOS 或对真实 Zotero 文献库的写入。

同日执行只读真实 OpenAlex 评估（单种子、前 20 条候选；数字为查询当日的记录快照）：

| 种子 | HTTP 查询次数（含基础查询） | 基础候选 → 深入候选 | 已采集证据记录 | 新前 20 中原基础查询没有的记录 | 与原列表前 20 的重合数 |
| --- | --- | --- | --- | --- | --- |
| BERT，DOI `10.18653/v1/N19-1423` | 15 | 108 → 302 | 671 | 8 | 6 |
| Isolation Forest，DOI `10.1109/ICDM.2008.17` | 13 | 70 → 267 | 705 | 15 | 4 |

BERT 的 4 组、Isolation Forest 的 3 组共被引证据查询均达到采样上限。BERT 前列包含 RoBERTa、ELMo、Attention、T5、ALBERT，也出现种子的 arXiv 版本（与正式发表版本的 OpenAlex ID 不同）；Isolation Forest 前列包含 Isolation-Based Anomaly Detection、LOF、One-Class SVM、Deep One-Class Classification、HBOS 等。这里只核对了返回记录和证据，没有相关性标注、完整领域真值或 Connected Papers 对照，不能据此声称提高了准确率或召回率。

2026-09-29 期刊功能验证：全部 133 项 Node 测试通过，覆盖 CCF 分类、ISSN/年份隔离、Crossref 分页、缺失字段、取消、限流及缓存校验。`tests/zotero_journals_fixtures.js` 在 Linux Zotero 10.0.3 中通过 34 条 DOM 断言和 45 项原生流程检查，包含期刊筛选、缓存离线检索、卷期预览、真实 `journalArticle` 字段、与会议混合导入、重复导入保留用户摘要、失败刷新不覆盖该来源缓存。该脚本的 fixture 函数接收 `tests/fixtures/zotero-journals/` 下按文件名映射的文本；smoke 函数必须传入隔离 profile 的 `expectedDataDir` 和 fixture 返回的三篇期刊论文，仅删除自己创建的测试条目与缓存。

下载公开数据后，通过完整适配器在 Zotero 中回放验证：JMLR 2026 共 205 篇，均读取详情并获得摘要；TPAMI 2025 / 2026 分别为 822 / 1,119 条，TKDE 分别为 514 / 585 条，Crossref 返回的这些条目均未提供摘要。另核对 JMLR 2025 的 309 条卷目录及详情样例；该年的整卷详情下载因公网 TLS 连接失败未完成。还通过插件实际 HTTP 请求核验三本期刊的当年来源与单篇记录。上述数量是核对当日的来源快照，2026 年仍会更新；没有验证每篇论文的公开代码、PDF 获取或 Windows/macOS 界面。

代码仓库功能的 Node 测试覆盖来源匹配、证据合并、仓库身份、空仓库、README 占位、空代码文件、非空代码文件、截断清单、限流、取消和确认保存；`tests/zotero_materials_fixtures.js` 在插件窗口中运行，检查原生 DOM 的页面身份核对、相对链接、证据解析及笔记识别。`tests/zotero_materials_smoke.js` 使用真实 Zotero 条目和事务，检查仓库状态及文件摘录展示、默认未选中、检查不写库、确认保存、主窗口选择变化、重复确认保留批注和失败回滚。调用 `runSearch4PaperMaterialsSmoke(win, {expectedDataDir: "隔离测试数据目录的绝对路径"})`，其中 `win` 是已加载的插件窗口；仅在独立测试 profile 中运行，脚本结束时删除自己创建的测试条目。

2026-09-29 代码仓库功能验证：全部 123 项 Node 测试通过；Linux Zotero 10.0.3 中通过 18 条 DOM 断言和 25 项原生确认流程检查。实际联网检查一篇 ICCV 论文指向的 GitHub 仓库，读取文件清单及 README／代码正文；同时验证了真实的 README-only 仓库和不存在地址的 404 状态。此前也通过实际 HTTP 请求检查 OpenReview、CVF 和 ACL 的论文来源，并下载回放 ICML、ICLR、CVPR、ICCV、ACL 共五篇来源的链接和原文证据。样例不代表所有网页均受支持；代码完整性、实验可复现性和 Windows/macOS 界面未验证。

2026-09-29 下载官方页面后，在 Zotero 10.0.3 中通过完整来源适配器回放并校验缓存格式，去重后共 3,558 篇：SIGMOD 349、KDD 785、SIGIR 384、VLDB 280、FAST 44、NSDI 150、OSDI 136、Security 363、CCS 482、NDSS 265、SIGCOMM 109、FSE 211。KDD 两周期原始研究记录共 787 条，其中 2 条重复记录合并。USENIX 的 693 个详情页均参与校验，692 篇有摘要和官方 PDF 地址，另 1 篇的缺失字段保留为空；这些计数描述核对当日的指定轨道，不代表该会议全部活动或最终出版总量。本轮未执行 PDF 下载或 Windows/macOS GUI 验证。

此前 2025 年联网核验结果：FAST 36、NSDI 83、OSDI 53、Security 438、CCS 316、NDSS 211、SIGCOMM 74、FSE 135 篇；USENIX 610 篇均保留摘要和官方 PDF 地址，并在 Linux Zotero 10.0.3 中验证过缓存、预览和导入。


联网 PDF 审计入口为 `tests/zotero_pdf_live_smoke.js`，不纳入普通单元测试。在安装当前 XPI 的全新 Zotero 测试 profile 中运行，保持个人文献库为空，不配置账号或登录；可仅复制由插件正常生成的 `search4paper/<会议>/<年份>.json` 缓存。通过 Run JavaScript 加载此脚本，调用 `runSearch4PaperPDFLiveSmoke({expectedDataDir: Zotero.DataDirectory.dir, reportPath: "测试结果 JSON 的绝对路径"})`。脚本清空测试 profile 的 Cookie 和 HTTP 缓存，按实际注册表逐会选择一篇论文，调用现有全文入口并检查附件 `%PDF-`，随后删除测试条目及附件；日志只保留会议、年份、论文、来源、HTTP 状态和结果。`only` 可用于针对失败会议复测；修复后应省略它完整重跑。每轮需重启 Zotero，禁止在真实个人 profile 中运行。

2026-10-29 IJCAI / ACM MM 验证：新增 `tests/test_zotero_ai.cjs` 检查来源身份、缓存隔离、共用 URL 的多论文导入及重复导入保留用户修改。`tests/zotero_ai_fixtures.js` 接收 `tests/fixtures/zotero-ai/` 下按文件名映射的文本，可在加载 core.js / sources.js 的原生 DOMParser 环境中调用 `runSearch4PaperAIFixtures(files)` 执行；覆盖轨道排除、错误年份、详情身份、字段缺失、重复记录、取消和 HTTP 错误。本轮全部 135 项 Node 测试和 32 条 Chromium 原生 DOM 断言通过；在 Chromium 原生 DOM 中回放下载的官方完整目录，解析 IJCAI 2025 Main Track 1,014 篇、2026 Main Track 678 篇、ACM MM 2025 Regular Papers 1,250 篇；未逐篇联网获取全部 IJCAI 摘要，未执行真实 Zotero GUI 导入或 PDF 下载。

2026-10-29 IROS / ICRA 验证：全部 135 项 Node 测试和 39 条 Chromium 原生 DOM 断言通过。`tests/zotero_robotics_fixtures.js` 在加载 core.js / sources.js 的原生 DOMParser 环境中调用 `runSearch4PaperRoboticsFixtures(files)`，其中 files 为 `tests/fixtures/zotero-robotics/` 下按文件名映射的文本。覆盖全部技术日、轨道排除、错误会议/年份/日期、缺标题、摘要编号不一致、无摘要的官方格式、重复展示、后续日期 HTTP 失败及取消。下载的官方完整日程在 Chromium 原生 DOM 中回放并通过缓存校验：IROS 2025 为 2,672 篇（均有摘要），ICRA 2026 为 2,820 篇（2,639 篇有摘要）；这些是核对当日技术日程范围的记录数，不代表纯录用论文数。未执行真实 Zotero GUI 导入或 PDF 下载。
