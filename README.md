# search4paper

[中文](#zh-cn) | [English](#en)

<a id="zh-cn"></a>

## 中文说明

### 项目简介

search4paper 是一个面向文献调研的论文抓取、本地检索和论文整理工具，重点支持以下会议：

- ICML
- NeurIPS / NIPS
- ICLR
- AAAI
- KDD
- WWW / The Web Conference

现已扩展至 CCF 第七版国际推荐目录的全部 A/B/C 会议与期刊：386 个会议、291 个独立期刊，共 677 个来源。多学科重复列出的期刊合并为一个来源，保留全部学科标签。上述六个会议继续使用原有专用采集规则。

### 全目录检索与全文访问

抓取页和搜索页均可点击 **CCF 目录**，按 A/B/C、会议/期刊、学科和名称筛选，使用 Ctrl/Shift 多选或“全选当前筛选”，最后点击“使用所选目录”。抓取时指定年份，完成后在搜索页选择同一范围。界面的 `ALL` 快捷项仍指上述六个核心会议，避免意外抓取整个目录。CLI 的 `--conference ALL` 则选择全部 677 个来源，建议按需指定具体标识。加载主题配置时，以配置里的 targets 为准。

新增来源使用 DBLP 已出版书目；少数不在 DBLP 目录中的期刊按 ISSN 使用 Crossref。期刊无需订阅账号即可检索公开书目信息。DBLP 年份是记录的出版年份；Crossref 使用 `published` 最早发表年份，可能早于纸刊年份。完整分页、来源身份和年份检查通过后才写入成功快照；来源为空或验证无法完成时明确报错，不作为“该年没有论文”。会议来源按 DBLP 返回的 stream 查询范围确认归属，同时保留其中以期刊形式出版的论文；不会用记录编号前缀误排除这些论文。书目不是实时录用名单，也未逐篇认证 CCF 正式长文资格。

搜索结果可以通过界面：

- **查找开放全文**：输入联系邮箱，按 DOI 查询 Unpaywall，展示开放链接和版本；邮箱只随请求发送，不保存。结果仅在本次会话和主动导出的文件中保留。
- **下载选中 PDF**：有直接 PDF 链接时下载；只有开放落地页时使用“打开论文网页”。
- **关联本地 PDF**：选择单篇论文，关联通过机构订阅等方式自行下载的 PDF。关联记录保存在论文目录的 `enrichment/pdf_manifest.jsonl`；原 PDF 不会复制或修改，移动文件后需要重新关联。
- **覆盖范围**：分别显示论文数、摘要缺失数、本地全文数及来源警告。未发现开放版本或下载失败不等于确认存在付费墙。

目录依据 [CCF 官方第七版目录说明](https://www.ccf.org.cn/Academic_Evaluation/By_category/)、[目录 PDF 镜像](https://scdm-shu.github.io/ccf/2026-CCF-Ranking.pdf)，与 [CCF 分类转录](https://ccf.atom.im/)交叉核对。版本、原始链接、页码、学科和来源映射保存在 `code/ccf_venues.json`。它是必须随程序分发的公共资源，不属于个人 `configs/`。本轮不包含中文 T1/T2/T3 目录。

验证范围：目录条目与离线采集逻辑已测试；Crossref JATS 2024 年实测获取 35 条论文记录。DBLP 已支持本次遇到的 Anubis 等待跳转验证：同一采集会话在内存中保留 Cookie，按页面指定时间等待，界面显示验证进度；无需导入浏览器凭据。最多处理两次验证跳转，单次等待最多 10 秒，遇到其他验证类型或反复验证时明确报错。实测通过验证并采集 TODS 2025 年 17 条论文记录，但尚未完成全部来源、年份的联网验证。NCMMSC 按会议名查询，流标识尚未核实；EITEE 使用前身 FITEE 的已注册 ISSN，更名后的覆盖仍需核验，这些限制随采集报告保留。

Windows 打包脚本已包含新目录和采集模块。**仓库现有 EXE 尚未重新构建，不包含本轮功能**；需要在 Windows 重新打包并完成实际操作验收后发布。

典型工作流：

1. 按会议、年份抓取论文元数据；
2. 使用关键词搜索论文标题；
3. 获取论文摘要，判断论文是否值得阅读；
4. 导出适合 AI 阅读的 JSONL 数据；
5. 下载公开可用的论文 PDF。

### 快速开始

#### 在 Zotero 10 内使用独立 XPI

在 Zotero 内检索、预览和导入会议、期刊论文，支持从 Zotero 种子论文扩展参考文献、后续引用和 OpenAlex 相关论文，全文获取和代码仓库检查使用独立页签。当前源码支持 30 个会议、3 本期刊，可按专业领域和 CCF 分类筛选；具体来源、年份和功能范围见 [插件说明](zotero-plugin/README.md)。

当前源码另提供“跨来源搜索”：只读已有名单，向 OpenReview 和 OpenAlex 按关键词分页获取候选，经本地复核后合并、预览和导入；每个查询每轮最多 50 条，后续页需手动加载。不会自动下载支持目录中的全部名单或 PDF；OpenAlex 广域检索和官方完整名单的覆盖口径分别说明，详见[跨来源搜索说明](zotero-plugin/README.md#跨来源搜索的查询与覆盖范围)。

下载 [search4paper-0.1.8.xpi](https://github.com/maojianhuan/search4paper/releases/download/zotero-v0.1.8/search4paper-0.1.8.xpi)（[Release](https://github.com/maojianhuan/search4paper/releases/tag/zotero-v0.1.8)）。在 Zotero 10 的 **工具 → 插件 → 从文件安装插件** 中安装并重启，再从工具菜单打开 search4paper。同一 XPI 适用于 Windows、Linux、macOS；无需 Python、Node 或 EXE。

源码构建：`python3 zotero-plugin/build.py`，输出 `dist/search4paper-0.1.8.xpi`。普通搜索结果现可查询选中论文的 OpenAlex 引用数、排序及导出，详见[引用数说明](zotero-plugin/README.md#普通搜索中的引用数)。Python 仅用于开发打包；下述独立 Windows 应用与 Zotero 插件互不依赖。已安装本地 0.1.8 候选包的用户请手动重新安装本次发布包并重启。

#### 直接运行 Windows EXE

双击项目根目录下的：

```text
search4paper-ui.exe
```

EXE 不要求本机预先安装 Python。源码更新不会自动更新已有 EXE；
本轮新增的搜索界面功能需要在 Windows 上重新构建后才会进入 EXE。

#### 使用 Python 启动 UI

要求 Python 3.10 或更高版本：

```powershell
python .\start_ui.py
```

#### 从源码重新构建 EXE

在 Windows Python 环境中先安装 PyInstaller：

```powershell
pip install pyinstaller
python .\code\build_ui_exe.py
```

构建后的 EXE 会复制到项目根目录。`.pyinstaller/`、`dist/` 和 `*.spec` 是构建产物，已经加入 `.gitignore`，不应提交到仓库。

### 数据源和抓取策略

核心会议使用不同的数据源，结果中的 `source_manifest.json` 会记录实际来源。

- ICML、NeurIPS、ICLR：优先使用 OpenReview 精确 venue ID 查询。
- WWW：优先查询 OpenReview；如果 OpenReview 为空或不可用，则回退到 DBLP。
- AAAI：优先解析官方录用论文页面；如果官方页面不可用或无法解析，则回退到 DBLP。
- KDD：按照当前配置优先使用官方录用列表，官方数据不可用时不会静默替换成 DBLP。
- 其他会议和期刊：按照 `code/ccf_a_conferences.json` 和抓取器中的会议配置执行。

DBLP 回退结果代表已经被 DBLP 收录的出版论文，不等同于实时录用决定列表。回退结果会标记为 `dblp_fallback`，并记录 OpenReview 或官方来源的失败原因。

对于尚未公布录用结果的会议，程序会生成空结果状态，但不会把空结果永久当作有效缓存；下一次运行会重新检查数据源。

### UI 功能

UI 主要包含抓取和搜索两部分：

- 选择会议和年份，抓取论文元数据；
- 在本地快照中进行标题布尔查询或主题多字段检索；
- 直接填写主题词、上下文词，勾选搜索字段，也可加载/保存主题配置；
- 自动读取已有摘要补全数据，查看逐会议年份的覆盖范围和命中统计；
- 查看摘要与命中依据，导出候选论文及覆盖报告；
- 批量获取选中论文摘要；
- 导出适合 AI 阅读的 JSONL；
- 将当前可见且选中的论文导出为 BibTeX；
- 按 DOI 补全选中论文缺失的 BibTeX，并记录来源、获取时间和逐篇失败原因；
- 将选中论文直接导入本机 Zotero 10，支持文献夹、标签、来源笔记和可选 PDF；
- 批量下载公开 PDF；
- 查看抓取来源、警告和失败信息。

### 命令行抓取

示例：

```powershell
python -m code.fetch_openreview_accepted --conference ICML --year 2026 --output-dir .\output
python -m code.fetch_openreview_accepted --conference AAAI --year 2026 --output-dir .\output
python -m code.fetch_openreview_accepted --conference WWW --year 2026 --output-dir .\output
```

常用参数：

```text
--conference       会议名称，例如 ICML、NIPS、ICLR、AAAI、KDD、WWW、ALL
--year             目标年份
--output-dir       输出根目录，默认是项目根目录下的 output/
--page-size        OpenReview 分页大小
--refresh          忽略已有本地快照并重新抓取
--no-iclr-virtual  不进行 ICLR Virtual 补充
```

### 本地缓存

正常运行时，程序会检查本地快照。如果以下条件都满足，就直接复用本地数据，不重复抓取：

- `source_manifest.json` 存在；
- CSV 和 JSONL 文件存在；
- 会议、年份和数据源标识匹配；
- 文件中的论文数量与 manifest 一致；
- 论文 ID 存在且不重复。

完整快照复用时，manifest 的状态为 `reused_local_snapshot`。使用 `--refresh` 可以强制重新抓取。

对于 AAAI 和 WWW 的 DBLP 回退快照，程序会再次检查主要数据源，以便后续官方或 OpenReview 数据发布后自动升级结果。

### 输出目录

默认输出目录：

```text
output/<YEAR>/<CONFERENCE>/
```

主要文件：

```text
<CONFERENCE>_<YEAR>_accepted_papers.csv
<CONFERENCE>_<YEAR>_accepted_papers.jsonl
source_manifest.json
raw/
```

摘要、BibTeX 和 PDF 补全数据位于对应输出目录的 `enrichment/` 下，通常包括：

```text
enrichment/abstracts.jsonl
enrichment/bibtex.jsonl
enrichment/pdf_manifest.jsonl
enrichment/pdf/
```

标题关键词查询结果默认写入：

```text
keyword_query_results/
```

### 标题搜索

UI 的“标题布尔查询”与本地命令行使用同一匹配器。示例：

```powershell
python -m code.paper_search --query '"time series" AND anomal* AND NOT forecasting' --conference ICLR ICML --years 2025 2026 --snapshot-output-root output --output-dir keyword_query_results/my_query
```

保留的采集加查询脚本会获取或复用快照：

```powershell
python -m code.query_target_papers
```

查询支持布尔表达式、短语、通配符和否定条件，具体以脚本当前实现为准。

### 多字段主题搜索

在“搜索论文”页选择“主题多字段”，填写以分号分隔的词组（例如 `episodic memory; memory retrieval`），
勾选标题、摘要、关键词、TLDR。上下文词留空时，任一词组命中即可入选；
填写上下文词后，还需在所选字段中匹配任一上下文词。主题匹配沿用宽松词前缀规则。
可通过界面保存配置，或加载多分组配置；加载后以配置内的会议、年份和字段为准。
标题模式支持布尔表达式；主题词组框不解析 AND/OR/NOT。
主题配置可在词组的 `exact_terms` 中列出需要逐词精确匹配的词条，例如任务缩写和容易因共同词根误中的短语。

“覆盖范围”页区分已检索、未抓取、空快照和未发现公开论文，展示数据来源、采集时间、警告、缺摘要数量。
缺失范围可以与已有结果一起查看，但明确标注覆盖不完整；损坏快照会使本次搜索失败。
“命中统计”按会议、年份、主题组和字段统计；证据条数不等于论文数量，也不能跨字段相加当作总论文数。
缺失范围的零计数不代表该会议没有相关论文。
搜索只读本地文件，不隐式补抓数据；“获取选中摘要”完成后，整体结果导出会禁用，
覆盖范围和统计页会提示需要重新搜索。只有重新搜索成功后才能导出更新后的结果、命中依据和统计。
“导出本次结果与统计”生成候选 CSV/JSONL、`coverage.csv`、`query_summary.csv`、`search_report.json`。
已有摘要优先保留，仅对缺摘要论文读入 `output/enrichment/abstracts.jsonl` 中成功的补全记录。

与界面完全相同的本地主题搜索：

```powershell
python -m code.paper_search --config configs/my_topic.json --snapshot-output-root output --output-dir research_results/my_topic
```

本地 CLI 在覆盖不完整时仍导出明确标记的部分结果，并返回退出码 1；完整本地覆盖不表示远程名单已发布完整。
以下为保留的采集、检索及候选摘要补全流程配置：

主题检索要求显式指定 `--config` 和 `--output-dir`，没有内置的个人调研主题。
自行创建 `configs/my_topic.json`，例如：

```json
{
  "targets": [{"conference": "ICLR", "year": 2025}],
  "search_fields": ["title", "abstract", "keywords", "tldr"],
  "query_groups": {
    "time_series": {
      "direct": true,
      "terms": ["time series"]
    }
  }
}
```

`direct: true` 表示该分组命中任一词语即可入选，无需额外上下文词。
结果是关键词候选集，尚未经过语义相关性审核。

```powershell
python -m code.query_research_topic --config configs/my_topic.json --output-dir research_results/my_topic
```

`--snapshot-output-root` 可指定论文快照目录，默认使用 `output/`。
个人检索配置和 `research_results/` 下的生成结果被 Git 忽略。

#### 空间智能与视觉语言导航

使用 `configs/spatial_intelligence_vln.json` 检索 16 个指定来源。示例包含 ECCV 2024 和其余来源的 2025 年，
可在 `targets` 中加入其他届次或出版年。配置采用会议举办年（CoRL）或相应来源的出版年份口径（见采集报告）。
视觉和室内导航可命中 `spatial_navigation` 词组，语言辅助导航也有对应的视觉语言导航词条。
同一来源的连续年份可写成 `{"conference":"CVPR","from_year":2018,"to_year":2025}`。
隔年举办的会议可指定 `step`，例如 `{"conference":"ICCV","from_year":2019,"to_year":2025,"step":2}`。
范围两端均包含在内，程序会逐个列出实际检索的年份，历史届次的可用性以各来源报告为准。
需求中的 `RA-I` 按 `RA-L`（IEEE Robotics and Automation Letters）处理。
T-RO、IJRR 和 RA-L 按 ISSN 使用 Crossref 的最早出版年。IROS 2025 和 ICRA 2026 使用官方技术日程，可能包含期刊论文的会议展示。
ECCV 2018–2024 使用 ECVA 官方开放主会论文索引。ECCV 2026 的 78 卷分卷目录与 Crossref 共有 2,837 个章节 DOI。排除出版社标注的 2 条勘误后，按逐卷核对得到的 2,835 篇建立索引，出版简介称 2,834 篇。2018 年以前继续使用 DBLP 书目。
ICML 2013–2022 从 PMLR 主会论文集取得书目和摘要。
ICLR 2020–2023 从官方日程采集已录用论文，保留 OpenReview 链接，同一篇的口头报告和海报只计一次。2023 年日程中的 JMLR 展示记录保留其期刊出版身份。
ICLR 2020 日程目录提供书目及短摘要。选用官方摘要扫描时，先按唯一标题及作者核对批量日程中的摘要，再查询剩余的单篇海报页。
ICLR 2017 使用 OpenReview 旧版公开档案，只采集明确标为主会口头报告或海报的记录。
较早的 NeurIPS/NIPS 届次使用官方出版卷索引，保留卷内的赛道标记。
此配置也会加入 NeurIPS 2023–2024 Datasets and Benchmarks 赛道的 OpenReview 书目和摘要。
NeurIPS 2021 的 Datasets and Benchmarks 独立出版卷单独采集。
出版页按赛道、标题和首位作者关联。首位作者写法不同时，要求两边的标题在赛道内均唯一、作者人数相同，且至少两名和过半作者姓名一致。
NeurIPS 2025 另从 OpenReview 精确采集 Datasets and Benchmarks、Position Paper 和 Creative AI 三个赛道。
该届主会、Datasets and Benchmarks 和 Position Paper 也核对官方主出版卷，以保留可用于引用查询的出版页链接。
运行报告列出补入赛道、记录数和已关联出版页的数量。
IJCAI 自 1969 年首届起使用官方出版卷索引，保留卷内栏目，逐篇核对论文、PDF 链接和已提供的 DOI。
AAAI 2010 至 2024 通过 Crossref 采集第 24 至 38 卷，逐条核对 ISSN、出版年、卷号和 DOI 前缀。
AAAI 2012 的数字版在 Crossref 记为 2021 年，按出版方目录归入 2012 年第 26 卷第 1 期。

此需求作为检验通用功能的案例，不以交付该领域全部历史文献为项目目标。
后续优先将已有引用数、机构证据等能力接入日常检索入口，并用小规模、不同主题的样例验收。
历史届次补采和全量相关性复核不再作为默认后续任务；具体优先级见 [任务路线](TODO.md)。

```bash
python -m code.query_research_topic --config configs/spatial_intelligence_vln.json \
  --output-dir keyword_query_results/spatial_intelligence_vln \
  --enrich-openalex --scan-openalex-abstracts
```

批量检索建议在环境中设置 `OPENALEX_API_KEY`，匿名查询的每日额度较低。结果包含 OpenAlex 引用数、匹配方式、记录链接、查询时间、
发表时作者机构及命中机构标签的证据。标签使用出版来源和 OpenAlex 提供的作者机构，通过配置中的
`institution_labels` 调整实验室和公司的名称与别名。未匹配的记录保留匹配状态，引用数留空。
Crossref 期刊快照中的引用数与采集时间分别导出到 `crossref_cited_by_count` 和
`crossref_citations_retrieved_at` 字段，OpenAlex 的引用数保留在 `cited_by_count`。
加上 `--enrich-crossref-citations` 可补齐候选的 Crossref 引用数和可用署名机构。
已知 DOI 的候选会批量查询，所有返回记录仍须与请求 DOI 精确对应。
Crossref 限流后，可将上一轮的 `candidate_papers.jsonl` 传给 `--crossref-citations-from`。
程序在核对论文标识、标题、作者和出版链接后，复用已取得的计数及原查询时间。
对缺 DOI 的 CVPR、ICCV 官方书目，只有标题、首位作者和主会 DOI 的届次都匹配时才写入结果。
ICRA、IROS 技术日程采用同样的核对规则，日程中展示的期刊论文保留其出版身份。
NeurIPS 官方卷记录可从标题核对通过的出版详情页取得 DOI，再用 DOI 查询 Crossref。
ECCV 缺 DOI 时核对标题、首位作者和 Springer 主会卷名，卷名必须对应指定届次。
`--enrich-preprint-citations` 可为缺少正式版引用数的 CVPR 和 ICCV 论文读取 CVF 官方页面链接的 arXiv 预印本引用数。导出单独记录 OpenAlex 计数、预印本 DOI 和查询时间。
经人工核对的清单可以在 `merged_openalex_cited_by_count` 记录同时关联正式出版页和 arXiv DOI 的 OpenAlex 工作级计数。该字段连同记录链接和查询时间单独导出，版本归属未明确时不计入正式出版版本统计。
摘要扫描在主题匹配前合并可用的 CVF 官方日程摘要并从 OpenAlex 补充缺失摘要，运行报告记录各来源仍缺摘要的数量。
CVF 日程请求不可用或没有摘要字段时，运行报告记录原因，并继续执行选定的官方论文页或 OpenAlex 摘要扫描。
也可加 `--scan-official-abstracts`，在关键词筛选前补齐 CVPR、ICCV、ECCV、IJCAI、NeurIPS、IJCV 和带 AAAI 出版 DOI 的摘要。ECCV 2026 和 IJCV 分别从 Springer 章节页和期刊文章页读取摘要及署名机构，并核对标题和 DOI。
CVPR 和 ICCV 在有官方日程数据的届次先使用日程摘要。程序随后逐篇查询剩余记录，复用已有的本地补全记录，并报告失败项。
NeurIPS 2020–2022 也会先通过官方日程补齐摘要。2020–2021 核对论文标识和标题，2022 核对标题和首位作者。
IJCV 和 TPAMI 的 2022–2024 年书目按 Crossref 的 ISSN 和纸刊出版年采集。使用 DBLP 年卷书目的其他年份，可在官方摘要扫描时按 DOI 关联 Crossref 纸刊年份的摘要、引用数及署名机构。
AAAI 先通过出版方 OAI-PMH 批量补齐摘要，按 DOI 与标题核对，并逐篇查询剩余记录。
AAAI 单篇出版页的标题与 DBLP 有小幅转写差异时，仍须核验 DOI 和完整作者顺序。
对命中的候选读取出版页署名机构，原始机构名和出版页链接随结果导出。运行报告包含批量扫描页数、摘要匹配数和机构查询错误。
AAAI 分页中断时，报告保留 `aaai_oai_scan.resumption_token`。用同一配置和快照目录、新的结果目录以及
`--aaai-oai-resumption-token` 续查。
同时启用两种摘要扫描时，先读取官方摘要，再用 OpenAlex 查询仍缺摘要的记录。
OpenAlex 批次返回不同 DOI 时，运行报告记录返回的 DOI，引用数只写入具有精确 DOI 匹配的记录。
OpenAlex 返回 HTTP 429 时，命令保留已查结果并以退出码 1 结束。
运行报告列出各来源未能查询摘要的数量，未完成引用查询的候选标记为 `rate_limited`。
长批次可加 `--openalex-checkpoint output/openalex-resume.sqlite3`。保留同一配置和快照，在额度恢复后
用同一检查点和新的输出目录续跑，已成功的相同查询会复用原响应和获取时间。刷新引用数时使用新的检查点。
加上 `--export-screening` 可导出覆盖所有输入书目的 `screening.csv`，其中包含命中状态、可用摘要和人工复核栏。
为保留填写过的复核结果，重复运行时请使用新的输出目录。
填写 `review_decision` 为 `include` 或 `exclude`，再用相同的主题配置和快照，改传
`--screening-decisions /path/to/screening.csv`。结果包含所有标记纳入的论文，包括关键词未命中的论文。
与 `--export-screening` 一起使用时，新导出的筛选表保留已有决定、备注及所有记录的关键词命中信息。
扩大采集范围后，旧筛选表中缺少的书目自动进入待审。导入的每条书目仍须与当前快照的标识、标题和 DOI 一致。
空白决策计为待审，仍导出已纳入结果，命令返回退出码 1。
省略两个参数可运行基础主题检索。结果是带关键词证据的候选集，完整覆盖还取决于目标届次、书目和摘要，以及后续相关性复核。

### 阅读搜索结果

在“论文结果”页可按年份升序/降序、标题 A–Z/Z–A 排序，并组合勾选“仅缺摘要”和“仅已有本地 PDF”。
PDF 筛选要求文件实际存在；搜索会读取已有下载记录。筛选只改变显示列表，覆盖范围和整体导出仍对应完整搜索结果。
隐藏的论文会取消选中，选中项导出按当前列表顺序排列。

选中论文后，“摘要与命中依据”页会用黄色高亮标题和摘要中实际命中的词组，支持大小写、连字符及词形变体。
标题查询只高亮正向命中，不高亮 NOT 排除词；摘要更新后，需要重新搜索才会恢复命中高亮。
“打开论文网页”和“打开本地 PDF”每次操作一篇选中论文，通过系统默认浏览器或阅读器打开；无链接或文件缺失时明确提示。

“导出选中阅读清单”将当前可见且选中的论文导出为 Markdown，包含标题、会议、年份、作者、摘要及已有网页/PDF链接。
缺失摘要会标明“未提供摘要”；本地 PDF 链接只在相应文件可访问的机器上有效。

“导出选中 BibTeX”按当前列表顺序将可见且选中的论文保存为 UTF-8 `.bib` 文件，保留来源提供的 BibTeX 条目。
若有论文缺少来源 BibTeX，会列出缺失论文并停止导出；条目无法识别或引用键重复时也会报错，已有目标文件不会因此被覆盖。
可取消选中缺失条目的论文后重试，引用键重复的论文可分别导出。此操作只使用本地已有数据，不联网补全或自动生成引用。

点击“补全选中 BibTeX”可通过 [DOI 内容协商](https://www.crossref.org/documentation/retrieve-metadata/content-negotiation/)获取缺失条目，仅处理当前可见且选中的论文，保留已有 BibTeX。
返回条目的 DOI 必须与论文 DOI 一致；无 DOI、格式无效、服务失败或返回身份不匹配时，会逐篇显示原因。
结果及来源链接、获取时间保存在论文目录的 `enrichment/bibtex.jsonl`，不会改写原始会议/期刊快照。
补全成功后可立即导出；重新搜索会读取已有补全结果，搜索本身不联网。详情页展示引用状态、来源、获取时间和失败原因。
每篇每次只查询一次，失败后可手动再次点击补全；已成功的条目直接复用。损坏记录或补全记录与当前 DOI 不一致时明确报错。

### 一键导入 Zotero 10

1. 在运行本工具的同一台电脑上启动 Zotero 10，在“设置 → 高级”中启用“允许此计算机上的其他应用程序与 Zotero 通信”。使用默认端口 23119。
2. 搜索并选中论文，点击结果列表上方的“导入选中到 Zotero”。
3. 选择个人文献库中的目标文献夹；可填写新建子文献夹名称和分号分隔的标签。同一父文献夹下的唯一同名文献夹会直接复用。
4. 按需勾选 PDF，点击“导入”，切换到 Zotero 完成原生授权。批量导入和附件上传涉及多次写入，建议选择“始终允许”。本工具仅在当前进程内保留授权密钥，重启工具后需要再次授权。

导入标题、作者、年份、会议/期刊、摘要和来源链接，并附加包含检索依据及已有 BibTeX 的来源笔记。原始作者姓名保留为 Zotero 单字段姓名，未推断姓/名；用于正式引用前可在 Zotero 中调整。无需 DOI 或 BibTeX 即可导入。

按规范化 DOI、OpenReview ID（包括 Zotero 已有条目的 OpenReview URL）或会议/年份限定的来源记录 ID 检查重复；不按相似标题自动合并。已有条目只追加目标文献夹、标签和缺失的来源笔记，保留已有书目字段。若标识匹配多个条目，该篇明确报错。

PDF 优先使用已关联的本地文件，否则使用现有公开 PDF 下载逻辑，复制到 Zotero 的附件存储中。已保存 PDF 的条目会复用附件。下载、上传或笔记失败会单独列出，成功导入的论文条目仍保留；连接或授权错误会停止本批次的后续处理。再次点击导入可处理尚未完成的内容。

此功能使用 [Zotero 10 本地 API](https://www.zotero.org/support/dev/web_api/v3/local_api)，首版支持个人文献库，暂不提供群组库选择。Linux 和 Windows 使用同一接口；仓库现有 Windows EXE 需要重新构建。

验证记录（2026-09-20）：131 项自动化测试通过；在 Linux + Xvfb 的独立 Zotero 10.0.3 资料库中，从界面导入 11 篇 ICML 2026 候选，核对元数据、去重、用户修改保留及原生授权允许/拒绝。有效 PDF 测试文件通过本地路径和 HTTP 下载两种方式上传，并核对存储内容和中文带空格文件名。OpenReview 当前对这台机器的 PDF 请求返回浏览器验证/HTTP 403，已验证其逐篇失败提示；遇到此情况可在浏览器下载后关联本地 PDF。Windows EXE 尚未实测。

### 项目结构

```text
search4paper/
├─ code/                         # Python 界面、采集、搜索与补全
│  ├─ fetch_openreview_accepted.py
│  ├─ fetch_venue_metadata.py
│  ├─ openalex_metadata.py
│  ├─ paper_enrichment.py
│  ├─ paper_search.py
│  ├─ paper_ui.py
│  ├─ query_research_topic.py
│  ├─ query_target_papers.py
│  ├─ zotero_import.py
│  ├─ ccf_venues.json
│  └─ ...
├─ configs/
│  └─ spatial_intelligence_vln.json
├─ zotero-plugin/
│  ├─ content/                   # 插件界面、来源适配、检索与发现
│  │  └─ vendor/                # Cytoscape 及其许可证
│  ├─ bootstrap.js
│  ├─ manifest.json
│  ├─ build.py
│  ├─ updates.json
│  └─ README.md
├─ tests/                        # Python / Node 测试与原生验收脚本
│  └─ fixtures/
├─ .github/workflows/release-zotero.yml
├─ start_ui.py
├─ search4paper-ui.exe           # 既有 Windows 构建
├─ output/                      # 本地来源快照与研究输出
├─ dist/                        # 本地安装包与验收报告
├─ README.md
├─ TODO.md
├─ LICENSE
└─ .gitignore
```

源码、测试、公开示例配置和第三方库许可证纳入 Git。`output/`、`dist/`、研究结果及个人配置保持本地；`configs/spatial_intelligence_vln.json` 是唯一已纳入版本管理的主题示例。既有 EXE 保留，当前源码的新功能以文档中的验收范围为准。

日常提交不自动发布。仅在用户明确要求发布时统一升版、打标签和发布安装包；任务状态及验收记录见 [TODO.md](TODO.md)。

### 说明

- 抓取结果依赖目标会议的公开发布节奏和网络可用性。
- 摘要补充和 PDF 下载只使用程序能够找到的公开来源。
- DBLP 适合做出版论文兜底，不应被理解为实时录用数据库。

<a href="#en">English version</a>

<a id="en"></a>

## English

### Overview

search4paper is a Windows-friendly tool for collecting conference paper metadata, searching local snapshots, enriching abstracts, exporting AI-readable records, and downloading public PDFs.

The primary conferences are:

- ICML
- NeurIPS / NIPS
- ICLR
- AAAI
- KDD
- WWW / The Web Conference

The bundled seventh-edition CCF international catalogue now includes all A/B/C venues: 386 conferences and 291 distinct journals. Multi-field journal listings are merged while preserving their fields. The six core conferences retain their specialized collection rules.

Typical workflow:

1. Fetch metadata by conference and year.
2. Search paper titles locally with keywords.
3. Retrieve abstracts and decide which papers are worth reading.
4. Export selected records as JSONL for AI-assisted reading.
5. Download publicly available PDFs.

### Quick start

#### Standalone Zotero 10 XPI

Search, preview and import conference and journal papers inside Zotero, with separate pages for full-text retrieval and code repository checks. The current source supports 30 conferences and 3 journals; see [supported sources, years, features and build instructions](zotero-plugin/README.md).

Download [search4paper-0.1.8.xpi](https://github.com/maojianhuan/search4paper/releases/download/zotero-v0.1.8/search4paper-0.1.8.xpi) ([Release](https://github.com/maojianhuan/search4paper/releases/tag/zotero-v0.1.8)). In Zotero 10, use **Tools → Plugins → Install Plugin From File**, then restart. The same XPI works across Windows, Linux and macOS; no Python, Node or EXE is required.

Developers build with `python3 zotero-plugin/build.py`, producing `dist/search4paper-0.1.8.xpi`. Ordinary search now supports on-demand OpenAlex counts for selected papers, count sorting and JSON export. The separate Windows application below is not an XPI builder. If you installed a local 0.1.8 candidate, reinstall this release manually and restart Zotero.

#### Run the Windows executable

Double-click:

```text
search4paper-ui.exe
```

The executable does not require Python to be installed. Source changes do not update
the existing binary: rebuild on Windows to include the new search interface.

#### Run the UI with Python

Python 3.10 or newer is recommended:

```powershell
python .\start_ui.py
```

#### Build the executable

In a Windows Python environment, install PyInstaller and run:

```powershell
pip install pyinstaller
python .\code\build_ui_exe.py
```

The executable is copied to the repository root. `.pyinstaller/`, `dist/`, and `*.spec` are generated build artifacts and are ignored by Git.

### Data sources and fallback policy

The actual source is recorded in `source_manifest.json`.

- ICML, NeurIPS, and ICLR primarily use exact OpenReview venue-ID queries.
- WWW queries OpenReview first and falls back to DBLP when OpenReview is empty or unavailable.
- AAAI tries the official accepted-paper page first and falls back to DBLP when the official page is unavailable or cannot be parsed.
- KDD follows its configured official accepted-paper source and does not silently replace an unavailable official source with DBLP.
- Other venues follow the configuration in `code/ccf_a_conferences.json` and the collector implementation.

A DBLP fallback represents published proceedings indexed by DBLP, not a live submission-decision feed. Such results are marked as `dblp_fallback`, together with the reason why the primary source was not selected.

Empty results for an unpublished venue are not treated as permanent valid snapshots; later runs check the source again.

### UI features

The UI provides:

- Conference and year selection;
- Metadata collection;
- Boolean title search and multi-field topic search;
- Editable topic terms, context anchors and search fields, with configuration loading/saving;
- Existing abstract enrichment loaded before searching;
- Per-conference/year coverage, match statistics, abstracts and match evidence;
- Export of candidates, coverage and statistics;
- Batch abstract enrichment;
- AI-friendly JSONL export;
- BibTeX export of visible selected papers;
- DOI-based completion of missing BibTeX with provenance and per-paper failures;
- Direct import into local Zotero 10 with collections, tags, provenance notes and optional PDFs;
- Public PDF downloads;
- Source, warning, and failure reporting.

### Command-line collection

Examples:

```powershell
python -m code.fetch_openreview_accepted --conference ICML --year 2026 --output-dir .\output
python -m code.fetch_openreview_accepted --conference AAAI --year 2026 --output-dir .\output
python -m code.fetch_openreview_accepted --conference WWW --year 2026 --output-dir .\output
```

Useful options:

```text
--conference       ICML, NIPS, ICLR, AAAI, KDD, WWW, or ALL
--year             Target year
--output-dir       Output root; defaults to output/ in the repository root
--page-size        OpenReview page size
--refresh          Ignore local snapshots and fetch again
--no-iclr-virtual  Disable ICLR Virtual enrichment
```

### Local cache

With the default settings, a complete local snapshot is reused when:

- `source_manifest.json` exists;
- the CSV and JSONL outputs exist;
- the conference, year, and source identifiers match;
- the stored paper count matches the manifest;
- paper identifiers are present and unique.

A reused snapshot is reported as `reused_local_snapshot`. Use `--refresh` to force a new collection.

For AAAI and WWW DBLP fallback snapshots, the primary source is checked again so a later official or OpenReview release can replace the fallback data.

### Output layout

The default layout is:

```text
output/<YEAR>/<CONFERENCE>/
```

Main files:

```text
<CONFERENCE>_<YEAR>_accepted_papers.csv
<CONFERENCE>_<YEAR>_accepted_papers.jsonl
source_manifest.json
raw/
```

Abstract, BibTeX and PDF enrichment data are normally stored under:

```text
enrichment/abstracts.jsonl
enrichment/bibtex.jsonl
enrichment/pdf_manifest.jsonl
enrichment/pdf/
```

Title-query results are written to:

```text
keyword_query_results/
```

### Title search

The UI Boolean title mode and local CLI share the same matcher:

```powershell
python -m code.paper_search --query '"time series" AND anomal* AND NOT forecasting' --conference ICLR ICML --years 2025 2026 --snapshot-output-root output --output-dir keyword_query_results/my_query
```

The existing collection-plus-query script fetches or reuses snapshots:

```powershell
python -m code.query_target_papers
```

The query implementation supports Boolean expressions, phrases, wildcards, and negation.

### Multi-field topic search

Select topic mode on the search page, enter semicolon-separated phrases and optional context anchors,
and select title, abstract, keywords or TLDR. Without context anchors, any phrase can qualify;
otherwise a context anchor must also match a selected field. Topic matching uses permissive word prefixes.
The phrase box does not parse Boolean operators. Save the configuration in the UI or load a multi-group
configuration; loaded targets and fields take precedence over manual controls.

Coverage distinguishes searched, missing, empty and unpublished snapshots and displays source, collection time,
warnings and missing abstracts. Missing targets produce explicitly incomplete results; corrupt snapshots fail the search.
Statistics separate conference, year, group and field: evidence counts are not paper counts and must not be summed
across fields as unique papers. Zero counts for missing targets do not establish absence of relevant papers.
Search only reads local files. After fetching selected abstracts, full-result export is disabled and
coverage/statistics are marked as requiring a new search. A successful search restores export with
updated abstracts, match evidence and statistics.
Export writes candidate CSV/JSONL, `coverage.csv`, `query_summary.csv` and `search_report.json`.
Existing snapshot abstracts take precedence; missing abstracts are filled from successful entries in
`output/enrichment/abstracts.jsonl` before matching.

The identical local topic search is available from the CLI:

```powershell
python -m code.paper_search --config configs/my_topic.json --snapshot-output-root output --output-dir research_results/my_topic
```

Incomplete local coverage exports clearly marked partial results and returns exit code 1.
Complete local coverage does not prove remote publication is complete.
The existing collection, search and candidate-abstract-enrichment pipeline remains available below:

Topic retrieval requires explicit `--config` and `--output-dir` arguments;
there is no built-in personal research topic. Create `configs/my_topic.json`, for example:

```json
{
  "targets": [{"conference": "ICLR", "year": 2025}],
  "search_fields": ["title", "abstract", "keywords", "tldr"],
  "query_groups": {
    "time_series": {
      "direct": true,
      "terms": ["time series"]
    }
  }
}
```

`direct: true` accepts a match on any term in the group without additional context anchors.
The output is a keyword candidate set, without semantic relevance review.

```powershell
python -m code.query_research_topic --config configs/my_topic.json --output-dir research_results/my_topic
```

Use `--snapshot-output-root` to select a snapshot directory (default: `output/`).
Personal configurations in `configs/` and generated results in `research_results/`
are ignored by Git. The public `configs/spatial_intelligence_vln.json` example is tracked;
create other configurations locally.

### Reading search results

The results tab offers ascending/descending year and title sorting and combinable filters for missing abstracts
and existing local PDFs. PDF filtering checks actual files and restores existing download records on search.
Filters only change the visible list; coverage and full-result exports still describe the complete search.
Hidden rows are deselected, and selected-row exports follow the visible sort order.

The detail tab highlights actual title/abstract matches in yellow, including case, hyphen and inflection variants.
Title queries only highlight positive matches, not NOT terms. After abstract enrichment, search again to restore
current highlighting. Open the selected paper's webpage or local PDF with the system browser/reader;
these actions require exactly one selected paper and report missing links/files.

Export selected reading list writes Markdown containing visible selected papers' titles, venues, years,
authors, abstracts and available webpage/PDF links. Missing abstracts are explicitly marked.
Local PDF links only work on machines where those files are accessible.

Export selected BibTeX writes a UTF-8 `.bib` file in visible selection order, preserving the source-provided entries.
Missing BibTeX records are listed and stop the export. Unrecognized entries or duplicate citation keys also stop it,
without overwriting an existing destination. Deselect papers with missing entries to retry, or export papers with
conflicting keys separately. This uses local data only; it does not fetch or generate citations.

Complete selected BibTeX retrieves missing citations through DOI content negotiation for visible selected papers,
preserving existing entries. The returned DOI must match the paper's DOI. Missing/invalid DOIs, service errors,
and identity mismatches are reported per paper. Results, source URLs and retrieval times are saved in
`enrichment/bibtex.jsonl`, leaving the original venue snapshots unchanged. Export is available immediately;
later searches restore saved results without network requests. The detail pane shows citation status and provenance.
Each paper gets one lookup per attempt; failed items can be retried explicitly, while successful results are reused.
Corrupt records or saved results associated with a different DOI fail explicitly.

### Import into Zotero 10

Run Zotero 10 on the same computer and enable Settings → Advanced → “Allow other applications on this computer to communicate with Zotero”, using the default port 23119. Select papers and click “导入选中到 Zotero” above the results. Choose a personal-library collection, optionally name a new subcollection, enter semicolon-separated tags, and choose whether to include PDFs. An unambiguous collection with the same parent and name is reused.

Click Import and authorize the application in Zotero's native dialog. “Always Allow” is recommended for batches and attachments, which need multiple write requests. The tool keeps the key only in process memory; restarting it requires another authorization.

Import includes bibliographic metadata, abstracts, source links and a child note with match evidence and available BibTeX. Author names are preserved as single-field creators, without guessing family/given names; review these before formal citation. Neither DOI nor BibTeX is required. Exact normalized DOI, OpenReview ID/URL, or venue/year-scoped source record IDs identify existing papers. Existing bibliographic fields are preserved while collections, tags and missing provenance notes are added. Ambiguous identities fail explicitly instead of merging by title similarity.

Optional PDFs are copied into Zotero storage from existing local files or downloaded through the existing public-PDF workflow. Stored PDFs are reused. Note/PDF errors are reported separately from successful parent items; connection or authorization errors stop the remaining batch. An explicit reimport can complete unfinished work. This uses the [Zotero 10 Local API](https://www.zotero.org/support/dev/web_api/v3/local_api) and currently supports personal libraries. Windows requires rebuilding the existing EXE.

Verified on 2026-09-20: 131 automated tests passed. An isolated Linux/Xvfb Zotero 10.0.3 library received 11 ICML 2026 candidates through the UI; metadata, deduplication, preservation of user edits and native authorization allow/deny were checked. Valid PDF fixtures were imported from local paths and HTTP downloads, with stored bytes and Unicode/space filenames verified. OpenReview currently returns a browser challenge/HTTP 403 for PDF requests from this machine; per-paper failure reporting was verified. Such PDFs can be downloaded in a browser and linked locally before importing. The Windows EXE has not been tested.

### Repository layout

```text
search4paper/
├─ code/                         # Python UI, collectors, search and enrichment
│  ├─ fetch_openreview_accepted.py
│  ├─ fetch_venue_metadata.py
│  ├─ openalex_metadata.py
│  ├─ paper_enrichment.py
│  ├─ paper_search.py
│  ├─ paper_ui.py
│  ├─ query_research_topic.py
│  ├─ query_target_papers.py
│  ├─ zotero_import.py
│  ├─ ccf_venues.json
│  └─ ...
├─ configs/
│  └─ spatial_intelligence_vln.json
├─ zotero-plugin/
│  ├─ content/                   # UI, source adapters, search and discovery
│  │  └─ vendor/                # Cytoscape and its license
│  ├─ bootstrap.js
│  ├─ manifest.json
│  ├─ build.py
│  ├─ updates.json
│  └─ README.md
├─ tests/                        # Python / Node tests and native smoke scripts
│  └─ fixtures/
├─ .github/workflows/release-zotero.yml
├─ start_ui.py
├─ search4paper-ui.exe           # Existing Windows build
├─ output/                      # Local source snapshots and research outputs
├─ dist/                        # Local packages and acceptance reports
├─ README.md
├─ TODO.md
├─ LICENSE
└─ .gitignore
```

Source, tests, the public example configuration and vendor licenses are tracked. `output/`, `dist/`, research results and personal configurations stay local; `configs/spatial_intelligence_vln.json` is the tracked topic example. The existing EXE is retained; see the documented validation scope for newer source features.

Routine commits do not publish a release. Version changes, release tags and package publication require an explicit release request. See [TODO.md](TODO.md) for task status and validation records.

### Notes

- Collection depends on the venue's public release schedule and network availability.
- Abstract enrichment and PDF downloads use public sources available to the program.
- DBLP is a proceedings fallback and should not be interpreted as a real-time acceptance database.

<a href="#zh-cn">中文版本</a>

## License

See [LICENSE](LICENSE).
