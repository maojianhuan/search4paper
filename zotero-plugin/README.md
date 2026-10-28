# search4paper · Zotero 10 插件

在 Zotero 内检索、预览和导入会议、期刊论文，支持按专业领域和 CCF 分类筛选，并查找论文代码链接、检查 GitHub 仓库内容。

[已发布的 0.1.6 XPI](https://github.com/maojianhuan/search4paper/releases/download/zotero-v0.1.6/search4paper-0.1.6.xpi) · [Release](https://github.com/maojianhuan/search4paper/releases/tag/zotero-v0.1.6)

当前源码新增的 2026 年份、支持范围界面、代码仓库与期刊功能尚未发布到上述 Release；请按文末步骤打包安装。

## 安装和使用

在 Zotero 10 的 **工具 → 插件 → 从文件安装插件** 中选择 XPI，重启后从工具菜单打开 search4paper。同版本覆盖安装也需重启。同一 XPI 适用于 Windows、Linux、macOS；运行不需要 Python、Node、EXE 或本地服务。

- **论文检索**：会议、期刊支持多选，年份支持分号列表或范围（例如 `2024; 2025`、`2024-2026`）；插件分别验证和缓存每个来源/年份，再合并检索，任一范围失败时不发布不完整结果。关键词以分号分隔，AND 全部满足，OR 任一满足。点击标题预览，勾选论文后可补全摘要或导入目标集合。
- **期刊检索**：类型选择“期刊”、CCF 分类选择“A”，可检索 JMLR、TPAMI、TKDE 的 2025 / 2026 年书目。预览显示期刊、卷、期、页码、出版日期及年份依据；导入原生 `journalArticle`，保留来源提供的书目和 DOI，以 DOI / JMLR 来源 ID 去重。重复导入不覆盖用户修改的书目信息和笔记。具体来源和年份口径见下表。
- **支持范围**：年份下方实时显示所选会议、期刊的可查询年份与来源限制；展开“查看支持范围”可查看当前目录内所有来源的年份规则和论文范围。不支持的年份、ICCV 偶数年、ECCV 奇数年等组合会在读取缓存或联网前提示，并禁用搜索与刷新；不会自动跳过组合中的来源或年份。
- **摘要补全**：仅处理选中且缺少摘要的论文，依次使用精确 OpenReview ID 和 Semantic Scholar。Semantic Scholar 必须满足规范化标题完全一致、作者证据、年份一致且候选唯一。结果写回本地来源缓存；若 Zotero 中存在唯一对应条目且原摘要为空，也写入条目。现有摘要不会被覆盖。
- **文献发现**：在 Zotero 主窗口选择一篇或多篇种子论文，通过 DOI、已保存的 OpenAlex ID或标题/作者/年份严格匹配 OpenAlex，分别查找参考文献、引用种子的后续工作和相关论文。同一候选会合并多个关系与多个种子依据；可按关系、年份、类型、开放全文和 Zotero 库内状态筛选，并按综合推荐、年份、引用数或关联种子数排序。每条结果显示排序依据以及尚未导入、已在库无 PDF 或已在库有 PDF 的状态。参考文献按 OpenAlex 单次上限分批完整读取；后续引用按引用数排序，每篇种子最多取 50 篇。导入条目保留 OpenAlex ID、推荐原因和种子论文，不自动导入种子本身。可在页面中配置免费的 OpenAlex API Key；插件显示响应中的当日剩余额度，并在 HTTP 429 时给出明确提示。
- **全文获取**：先在 Zotero 主窗口选中文献，再点击获取全文。统一按“明确的开放出版商 PDF → 严格匹配的 arXiv 最新版本 → OpenReview 稳定 PDF / ID 地址 → ACM/IEEE 出版商路径 → Zotero 原生全文查找”执行。WWW 缺少 DOI 时，仅在 Crossref 的标题、作者、年份和会议均严格匹配且结果唯一时写回 DOI，再进入 ACM 路径。结果会显示实际取得附件的来源。IEEE 北航订阅访问需在插件窗口手动完成 SSO；同一会话复用 Cookie，机构下载逐篇进行，开始时间至少间隔 10 秒。全文不保证可得；失败时保留书目条目，已知限制见 [TODO](../TODO.md)。
- **代码仓库**：在 Zotero 主窗口选择一篇已保存的论文，打开“代码仓库”页并点击“查找并检查代码”。页面显示论文代码链接，以及 GitHub 仓库是否可公开访问、是否为空、是否只有说明或配置文件、是否有非空代码文件；可查看具体文件名、字节数和 README／代码原文摘录，并展开论文出处核对关联。默认不勾选；点击“确认关联选中链接”后，链接、仓库检查结果、检查时间和论文出处保存为原生子笔记。检查不写库，主窗口选择变化不会改变保存目标；重复确认保留已有笔记及批注，整批保存失败会回滚。

arXiv 自动匹配要求标题规范化后一致、作者姓氏至少匹配一位（多作者论文至少两位）、首次提交年份与条目年份相差不超过一年，且只能有一个候选。下载使用不带 `vN` 的 PDF 地址以取得 arXiv 当前最新版本；该附件是作者版本，不等同于出版商最终版本。没有作者信息或存在歧义时跳过，不按标题单独猜测。

ACM 条目在前述开放路径失败后按 DOI 请求 ACM 官方 PDF；遇到 403 时显示“ACM 访问验证”，在 Zotero 窗口中手动完成验证后，再点击“获取全文”。验证窗口与请求共享独立的临时 Cookie 会话，不保存登录信息。网站验证仍可能阻止后台下载，需在 Windows 上实测。

元数据保存在 `<Zotero 数据目录>/search4paper/<会议或期刊>/<年份>.json`，支持离线筛选。点击“刷新名单”更新；单个来源获取失败或取消不会覆盖该来源的旧名单，组合查询中已完成的来源可以更新缓存。缺失的摘要等字段保持为空。首次欢迎提示仅显示一次，状态保存在 Zotero profile 的 `extensions.search4paper.welcomeShown` 偏好中。

## 代码仓库的检查范围

本版从条目摘要及下面一种论文来源中查找代码链接。保留仓库地址及有明确代码、软件或项目线索的链接；数据集、补充材料链接不会仅因是论文材料就列为代码：

- 有 OpenReview ID 时，查询公开论文记录，要求返回记录的 ID 和规范化标题均一致；只读取摘要与代码、数据、项目、补充材料等明确材料字段，不读取评审评论或推测未提供的附件地址。
- 否则读取条目中的论文网页地址，缺少可用网页地址时可使用 DOI 地址。网页必须有可核对的单篇论文标题或 DOI 元数据；字段冲突时停止。提取网页摘要及正文链接，保留原文上下文。相对链接按最终页面地址解析。

对 GitHub 仓库读取公开仓库信息、默认分支的递归[文件清单](https://docs.github.com/en/rest/git/trees#get-a-tree)，按常见代码扩展名统计非空的普通文件，展示最多六个文件名及大小。README 和一个代码文件各取一份原文样本：仅读取不超过 128 KiB 的文件，展示前 900 个字符。空 `.py` 文件、子模块和符号链接不会计为非空代码；子模块、符号链接、压缩包及其他分支不会展开检查。文件扩展名只能说明发现代码文件，不能判断文件是否为占位、模板、第三方代码或完整实现，原文摘录供用户进一步核对。

仓库内容检查只支持 `github.com`；GitLab、Bitbucket、代码压缩包和项目页等链接标注为需手动检查。API 请求不需配置登录或令牌，但受 [GitHub 公共 API 限流](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)约束；403、429、网络错误显示检查失败，404 显示无法公开访问（不存在或私有），不推断论文未公开代码。文件清单被截断时显示检查不完整；文件正文读取失败单独标注，已取得的文件清单仍可核对。再次点击检查会读取当前状态；已经确认的子笔记保留当时结果和时间。

不扫描 PDF，不搜索同名仓库，不执行网页脚本，不递归访问候选项目页。会议总表、缺少论文元数据的普通项目页和访问验证页不受支持，会明确提示论文来源检查未完成。条目没有可检查的网页或 OpenReview ID 时，仅从本地摘要提取链接并标明范围；“未找到链接”不代表论文没有公开代码。

链接出现于上述来源只提供关联线索；摘要可能由用户编辑，链接也可能引用第三方代码。是否确实属于该论文由用户依据原文确认。保存关联不表示已验证作者官方归属、代码完整性或实验可复现性；插件不克隆仓库或执行代码。

## 支持的来源和年份

共 26 个会议、3 本期刊；分类使用仓库 CCF 2026 目录。下表列出明确核实的年份或按年份查询的适配规则；“某年起”不代表每年均已公开或逐年验证。仅已公开且结构受支持的年份可用；不可用或结构异常明确报错，不以 DBLP 替代录用名单。来源核对日期：2026-09-29。

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

## 开发和发布

在仓库根目录运行：

```sh
node --test tests/test_zotero_plugin.cjs tests/test_zotero_arxiv.cjs tests/test_zotero_abstract.cjs tests/test_zotero_discovery.cjs tests/test_zotero_publication.cjs tests/test_zotero_openreview.cjs tests/test_zotero_ieee.cjs tests/test_zotero_database.cjs tests/test_zotero_systems.cjs tests/test_zotero_acm.cjs tests/test_zotero_materials.cjs tests/test_zotero_journals.cjs
python3 zotero-plugin/build.py
```

Windows 可用 `py -3 zotero-plugin/build.py`。Python 3 标准库仅用于打包，输出 `dist/search4paper-0.1.6.xpi`；不需要 EXE 生成器。源码变化后重新打包一次，跨平台无需重建。

Git 跟踪源码、构建脚本和版本号；XPI 存放在 Release，不提交到 Git。推送带注释的 `zotero-v<版本>` 标签会运行[发布工作流](../.github/workflows/release-zotero.yml)，从标签源码测试、打包，创建或更新同名 Release 和安装包。插件通过 `updates.json` 向已安装用户提供后续版本。

离线测试使用保存的页面片段；`tests/zotero_database_fixtures.js` 和 `tests/zotero_systems_fixtures.js` 在 Zotero 原生 DOMParser 中运行，分别将对应 fixture 目录中的文本按文件名传入。2026 年份更新通过 105 项 Node 测试、167 条原生 DOM 断言（覆盖 2025 / 2026 页面、错误年份、缺失轮次和轨道排除），以及 Linux Zotero 10.0.3 中的 7 项实际 XHTML 界面检查，包括无效组合拦截、修正后恢复搜索和来源限制展示。

2026-09-29 期刊功能验证：全部 133 项 Node 测试通过，覆盖 CCF 分类、ISSN/年份隔离、Crossref 分页、缺失字段、取消、限流及缓存校验。`tests/zotero_journals_fixtures.js` 在 Linux Zotero 10.0.3 中通过 34 条 DOM 断言和 45 项原生流程检查，包含期刊筛选、缓存离线检索、卷期预览、真实 `journalArticle` 字段、与会议混合导入、重复导入保留用户摘要、失败刷新不覆盖该来源缓存。该脚本的 fixture 函数接收 `tests/fixtures/zotero-journals/` 下按文件名映射的文本；smoke 函数必须传入隔离 profile 的 `expectedDataDir` 和 fixture 返回的三篇期刊论文，仅删除自己创建的测试条目与缓存。

下载公开数据后，通过完整适配器在 Zotero 中回放验证：JMLR 2026 共 205 篇，均读取详情并获得摘要；TPAMI 2025 / 2026 分别为 822 / 1,119 条，TKDE 分别为 514 / 585 条，Crossref 返回的这些条目均未提供摘要。另核对 JMLR 2025 的 309 条卷目录及详情样例；该年的整卷详情下载因公网 TLS 连接失败未完成。还通过插件实际 HTTP 请求核验三本期刊的当年来源与单篇记录。上述数量是核对当日的来源快照，2026 年仍会更新；没有验证每篇论文的公开代码、PDF 获取或 Windows/macOS 界面。

代码仓库功能的 Node 测试覆盖来源匹配、证据合并、仓库身份、空仓库、README 占位、空代码文件、非空代码文件、截断清单、限流、取消和确认保存；`tests/zotero_materials_fixtures.js` 在插件窗口中运行，检查原生 DOM 的页面身份核对、相对链接、证据解析及笔记识别。`tests/zotero_materials_smoke.js` 使用真实 Zotero 条目和事务，检查仓库状态及文件摘录展示、默认未选中、检查不写库、确认保存、主窗口选择变化、重复确认保留批注和失败回滚。调用 `runSearch4PaperMaterialsSmoke(win, {expectedDataDir: "隔离测试数据目录的绝对路径"})`，其中 `win` 是已加载的插件窗口；仅在独立测试 profile 中运行，脚本结束时删除自己创建的测试条目。

2026-09-29 代码仓库功能验证：全部 123 项 Node 测试通过；Linux Zotero 10.0.3 中通过 18 条 DOM 断言和 25 项原生确认流程检查。实际联网检查一篇 ICCV 论文指向的 GitHub 仓库，读取文件清单及 README／代码正文；同时验证了真实的 README-only 仓库和不存在地址的 404 状态。此前也通过实际 HTTP 请求检查 OpenReview、CVF 和 ACL 的论文来源，并下载回放 ICML、ICLR、CVPR、ICCV、ACL 共五篇来源的链接和原文证据。样例不代表所有网页均受支持；代码完整性、实验可复现性和 Windows/macOS 界面未验证。

2026-09-29 下载官方页面后，在 Zotero 10.0.3 中通过完整来源适配器回放并校验缓存格式，去重后共 3,558 篇：SIGMOD 349、KDD 785、SIGIR 384、VLDB 280、FAST 44、NSDI 150、OSDI 136、Security 363、CCS 482、NDSS 265、SIGCOMM 109、FSE 211。KDD 两周期原始研究记录共 787 条，其中 2 条重复记录合并。USENIX 的 693 个详情页均参与校验，692 篇有摘要和官方 PDF 地址，另 1 篇的缺失字段保留为空；这些计数描述核对当日的指定轨道，不代表该会议全部活动或最终出版总量。本轮未执行 PDF 下载或 Windows/macOS GUI 验证。

此前 2025 年联网核验结果：FAST 36、NSDI 83、OSDI 53、Security 438、CCS 316、NDSS 211、SIGCOMM 74、FSE 135 篇；USENIX 610 篇均保留摘要和官方 PDF 地址，并在 Linux Zotero 10.0.3 中验证过缓存、预览和导入。


联网 PDF 审计入口为 `tests/zotero_pdf_live_smoke.js`，不纳入普通单元测试。在安装当前 XPI 的全新 Zotero 测试 profile 中运行，保持个人文献库为空，不配置账号或登录；可仅复制由插件正常生成的 `search4paper/<会议>/<年份>.json` 缓存。通过 Run JavaScript 加载此脚本，调用 `runSearch4PaperPDFLiveSmoke({expectedDataDir: Zotero.DataDirectory.dir, reportPath: "测试结果 JSON 的绝对路径"})`。脚本清空测试 profile 的 Cookie 和 HTTP 缓存，按实际注册表逐会选择一篇论文，调用现有全文入口并检查附件 `%PDF-`，随后删除测试条目及附件；日志只保留会议、年份、论文、来源、HTTP 状态和结果。`only` 可用于针对失败会议复测；修复后应省略它完整重跑。每轮需重启 Zotero，禁止在真实个人 profile 中运行。
