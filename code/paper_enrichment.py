"""Enrich selected paper rows with abstracts, DOI citations and public PDFs.

The collector remains responsible for conference membership and normalized
metadata.  This module operates on selected rows from the local CSV snapshots,
so enrichment never changes the canonical accepted-paper collection.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlencode, urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from . import fetch_openreview_accepted as collector


SEMANTIC_SCHOLAR_SEARCH_URL = (
    "https://api.semanticscholar.org/graph/v1/paper/search"
)
USER_AGENT = "Search4PaperEnrichment/1.0 (public scholarly metadata)"
DOWNLOAD_CHUNK_SIZE = 1024 * 256
MAX_PDF_BYTES = 100 * 1024 * 1024


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict) and "value" in value:
        return _as_text(value.get("value"))
    return str(value).strip()


def normalize_title(value: str) -> str:
    value = value.casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()


def cvf_title_text(title: str) -> str:
    title = (title.replace(r"\textasciicircum", "^").replace(r"\ensuremath", "")
             .replace(r"\textbackslash", "\\").replace(r"\%", "%").replace(r"\$", "$"))
    return re.sub(r"\\Omega\b", "Ω", title)


def paper_key(row: dict[str, Any]) -> str:
    """Return a stable filesystem-safe identity for one normalized paper row."""
    conference = _as_text(row.get("conference") or "paper")
    year = _as_text(row.get("year") or "unknown")
    identity = _as_text(
        row.get("openreview_id")
        or row.get("source_record_id")
        or row.get("doi")
        or row.get("title")
        or "unknown"
    )
    value = f"{conference}_{year}_{identity}"
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")
    return value[:180] or "paper_unknown"


def _enrichment_root(output_root: Path) -> Path:
    return output_root / "enrichment"


def _read_jsonl_map(path: Path, *, strict: bool = False) -> dict[str, dict[str, Any]]:
    if not path.is_file():
        return {}
    result: dict[str, dict[str, Any]] = {}
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                value = json.loads(line)
                if isinstance(value, dict) and value.get("paper_id"):
                    result[str(value["paper_id"])] = value
                elif strict:
                    raise ValueError(f"Invalid enrichment record in {path}: missing paper_id")
    except (OSError, json.JSONDecodeError) as exc:
        if strict:
            raise ValueError(f"Cannot read enrichment cache {path}: {exc}") from exc
        return {}
    return result


def load_cached_abstracts(
    rows: Iterable[dict[str, Any]], output_root: Path
) -> list[dict[str, Any]]:
    """Fill missing abstracts from existing cache only; never fetch or write."""
    cache = _read_jsonl_map(_enrichment_root(output_root) / "abstracts.jsonl", strict=True)
    result = []
    for source in rows:
        row = dict(source)
        cached = cache.get(paper_key(row), {})
        if cached.get("publisher_affiliations"):
            row["publisher_affiliations"] = cached["publisher_affiliations"]
            row["publisher_affiliations_url"] = cached["publisher_affiliations_url"]
        if not _as_text(row.get("abstract")) and cached.get("status") == "success" and _as_text(cached.get("abstract")):
            row["abstract"] = cached["abstract"]
            row["abstract_status"] = "success"
            for name in ("source", "source_url", "retrieved_at", "match_confidence", "matched_title"):
                row[f"abstract_{name}"] = cached.get(name, "")
        result.append(row)
    return result


def _write_jsonl_map(path: Path, values: dict[str, dict[str, Any]]) -> None:
    collector.write_jsonl(path, [values[key] for key in sorted(values)])


def load_cached_pdfs(rows: Iterable[dict[str, Any]], output_root: Path) -> list[dict[str, Any]]:
    """Restore download information only for PDFs still present in the library."""
    cache = _read_jsonl_map(_enrichment_root(output_root) / "pdf_manifest.jsonl", strict=True)
    result = []
    for source in rows:
        row = dict(source)
        cached = cache.get(paper_key(row), {})
        path = _enrichment_root(output_root) / "pdf" / f"{paper_key(row)}.pdf"
        if cached.get("status") == "linked":
            path = Path(cached["local_path"])
        if cached.get("status") in {"downloaded", "linked"} and path.is_file():
            row.update(pdf_status=cached["status"], pdf_local_path=str(path.resolve()),
                       pdf_url_resolved=cached.get("final_url") or cached.get("requested_url", ""),
                       pdf_sha256=cached.get("sha256", ""))
        result.append(row)
    return result


def export_reading_list(rows: Iterable[dict[str, Any]], output_path: Path) -> Path:
    """Write selected papers as a human-readable Markdown reading list."""
    def escape(value: Any) -> str:
        text = _as_text(value).replace("\r", " ").replace("\n", " ")
        return re.sub(r"([\\`*_{}\[\]()<>#!|])", r"\\\1", text)

    lines = ["# 论文阅读清单", ""]
    for index, row in enumerate(rows, 1):
        lines.extend([f"## {index}. {escape(row.get('title'))}", "",
                      f"会议或期刊 / 年份：{escape(row.get('conference'))} / {escape(row.get('year'))}", "",
                      f"作者：{escape(row.get('authors')) or '未提供'}", "",
                      "摘要：", "", escape(row.get("abstract")) or "未提供摘要", ""])
        for label, url in (("论文网页", row.get("source_url") or row.get("paper_url") or row.get("openreview_url")),
                           ("PDF", row.get("pdf_url_resolved") or row.get("pdf_url")),
                           ("开放全文页面", row.get("oa_landing_url")),
                           ("开放 PDF", row.get("oa_pdf_url"))):
            if url:
                lines.extend([f"[{label}](<{quote(str(url), safe=':/?=&%#@+;,~') }>)", ""])
        if row.get("oa_version"):
            lines.extend([f"开放版本：{escape(row['oa_version'])}", ""])
        local = _as_text(row.get("pdf_local_path"))
        if local and Path(local).is_file():
            lines.extend([f"[本地 PDF](<{Path(local).resolve().as_uri()}>)", ""])
    output_path.write_text("\n".join(lines), encoding="utf-8")
    return output_path


def export_bibtex(rows: Iterable[dict[str, Any]], output_path: Path) -> Path:
    """Export source BibTeX in selection order, checking all rows before writing."""
    records = []
    citation_keys = {}
    missing = []
    for row in rows:
        title = _as_text(row.get("title")) or paper_key(row)
        bibtex = _as_text(row.get("bibtex"))
        if not bibtex:
            missing.append(title)
            continue
        entries = collector.parse_bibtex_entries(bibtex.encode("utf-8"))
        if (len(entries) != 1 or entries[0]["_raw_bibtex"] != bibtex
                or not entries[0]["_citation_key"]):
            raise ValueError(f"无法识别论文「{title}」的单条来源 BibTeX；未写入文件。")
        key = entries[0]["_citation_key"]
        if key in citation_keys:
            raise ValueError(f"BibTeX 引用键重复：{key}\n{citation_keys[key]}\n{title}\n"
                             "请分别导出这些论文；未写入文件。")
        citation_keys[key] = title
        records.append(bibtex)
    if missing:
        raise ValueError(f"以下 {len(missing)} 篇论文缺少来源 BibTeX，请取消选中后重试；未写入文件。\n"
                         + "\n".join(missing))
    if not records:
        raise ValueError("请先选择论文；未写入文件。")
    output_path.write_text("\n\n".join(records) + "\n", encoding="utf-8")
    return output_path


def _normalize_doi(value: Any) -> str:
    doi = _as_text(value)
    if re.match(r"^https?://(?:dx\.)?doi\.org/", doi, flags=re.I):
        doi = unquote(re.sub(r"^https?://(?:dx\.)?doi\.org/", "", doi, flags=re.I))
    return re.sub(r"^doi:\s*", "", doi, flags=re.I).strip().casefold()


def _crossref_citation_record(row: dict[str, Any], doi: str) -> tuple[dict[str, Any] | None, str]:
    base = "https://api.crossref.org/works"
    method = "doi"
    publisher_url = _as_text(row.get("publisher_paper_url"))
    if not doi and (row.get("source_type") == "official_neurips"
                    or (row.get("conference") == "NIPS" and publisher_url)):
        page_row = ({**row, "paper_url": publisher_url, "source_record_id": urlsplit(publisher_url).path}
                    if publisher_url else row)
        page, _ = _fetch_neurips_page(page_row)
        match = re.search(r'<meta name="citation_doi" content="(10\.\d{4,9}/[^"\s]+)"', page)
        if match:
            doi = _normalize_doi(unescape(match[1]))
            method = "neurips_publisher_doi"
    if doi:
        raw, _ = collector.request_bytes(f"{base}/{quote(doi, safe='/')}", timeout=20, retries=1)
        record = json.loads(raw)["message"]
        if _normalize_doi(record.get("DOI")) != doi:
            raise RuntimeError("Crossref response DOI differs from the requested DOI")
        return record, method

    conference = str(row.get("conference") or "").casefold()
    author = _as_text(row.get("authors")).split(";", 1)[0].strip()
    title = _as_text(row.get("title"))
    source = row.get("source_type")
    cvf = conference in {"cvpr", "iccv"} and (
        source == "official_cvf_openaccess"
        or (not source and any(
            urlsplit(_as_text(row.get(field))).hostname == "openaccess.thecvf.com"
            for field in ("paper_url", "publisher_paper_url")
        ))
    )
    papercept = source == "official_papercept" and conference in {"icra", "iros"}
    ecva = source == "official_ecva" and conference == "eccv"
    if not (cvf or papercept or ecva) or not author or not title:
        return None, "missing_doi"
    surname, comma, given = author.partition(",")
    author = f"{given.strip()} {surname.strip()}" if comma else author
    year = int(row["year"])
    last_year = year + 1 if papercept or ecva else year
    prefix = "10.1007" if ecva else "10.1109"
    params = urlencode({
        "query.bibliographic": title, "query.author": author,
        "filter": f"from-pub-date:{year}-01-01,until-pub-date:{last_year}-12-31,prefix:{prefix}",
        "rows": 5, "select": "DOI,title,author,is-referenced-by-count" + (",container-title" if ecva else ""),
    })
    raw, _ = collector.request_bytes(f"{base}?{params}", timeout=20, retries=1)
    works = json.loads(raw)["message"]["items"]
    pattern = r"10\.1007/978-[\d-]+_\d+$" if ecva else rf"10\.1109/{conference}\d*\.{year}\."
    matches = []
    for record in works:
        names = record.get("author") or []
        first = names[0] if names else {}
        first_author = " ".join(filter(None, (first.get("given"), first.get("family"))))
        if (re.match(pattern, _normalize_doi(record.get("DOI")))
                and (not ecva or any(normalize_title(value) == f"computer vision eccv {year}"
                                     for value in record.get("container-title", [])))
                and any(normalize_title(candidate) == normalize_title(title) for candidate in record.get("title", []))
                and normalize_title(first_author) == normalize_title(author)):
            matches.append(record)
    if len(matches) != 1:
        return None, "ambiguous" if matches else "unmatched"
    return matches[0], "title_year_first_author_venue_doi"


def crossref_affiliations(record: dict[str, Any]) -> list[str]:
    return sorted({
        collector.strip_html_fragment(affiliation["name"])
        for author in (record.get("author") or [])
        for affiliation in (author.get("affiliation") or [])
        if affiliation.get("name")
    } - {""})


def enrich_cvf_preprint_citation(row: dict[str, Any]) -> None:
    """Record OpenAlex citations for a preprint explicitly linked by CVF."""
    url = _as_text(row.get("paper_url"))
    parsed = urlsplit(url)
    if (row.get("conference") not in {"CVPR", "ICCV"} or parsed.scheme != "https"
            or parsed.netloc != "openaccess.thecvf.com"
            or row.get("source_type") != "official_cvf_openaccess"
            or not parsed.path.endswith(".html")
            or any(str(row.get(field, "")).isdigit() for field in ("cited_by_count", "crossref_cited_by_count"))):
        return
    raw, _ = collector.request_bytes(url, timeout=20, retries=1)
    identifiers = set(re.findall(
        r"""href=["']https://arxiv\.org/abs/(\d{4}\.\d{4,5})(?:v\d+)?["']""", raw.decode("utf-8"), re.I
    ))
    if len(identifiers) != 1:
        return
    doi = f"10.48550/arxiv.{identifiers.pop()}"
    doi_url = f"https://doi.org/{doi}"
    fields = "id,doi,display_name,cited_by_count,authorships,type"
    lookup = f"https://api.openalex.org/works/{doi_url}?{urlencode({'select': fields})}"
    try:
        raw, _ = collector.request_bytes(lookup, timeout=20, retries=1)
    except RuntimeError as exc:
        if str(exc).startswith("HTTP 404 "):
            return
        raise
    work = json.loads(raw)
    author = _as_text(row.get("authors")).split(";", 1)[0].strip()
    surname, comma, given = author.partition(",")
    if comma:
        author = f"{given.strip()} {surname.strip()}"
    authorships = work.get("authorships") or []
    first = authorships[0]["author"]["display_name"] if authorships else ""
    count = work.get("cited_by_count")
    if (work.get("type") == "preprint" and _as_text(work.get("doi")).casefold() == doi_url
            and normalize_title(work["display_name"]) == normalize_title(row["title"])
            and author and normalize_title(first) == normalize_title(author)
            and type(count) is int and count >= 0):
        row.update(preprint_doi=doi, preprint_openalex_url=work["id"], preprint_openalex_cited_by_count=count,
                   preprint_openalex_retrieved_at=utc_now())


def _crossref_publication_doi(row: dict[str, Any]) -> str:
    doi = _normalize_doi(row.get("doi"))
    paper_url = _as_text(row.get("paper_url"))
    if not doi and re.match(r"^https?://(?:dx\.)?doi\.org/", paper_url, re.I):
        doi = _normalize_doi(paper_url)
    return doi


def _crossref_doi_batch(dois: list[str]) -> dict[str, dict[str, Any]]:
    params = urlencode({"filter": ",".join(f"doi:{doi}" for doi in dois),
                        "rows": len(dois), "select": "DOI,author,is-referenced-by-count"})
    raw, _ = collector.request_bytes(f"https://api.crossref.org/works?{params}", timeout=20, retries=1)
    message = json.loads(raw)["message"]
    items = message["items"]
    by_doi = {_normalize_doi(record["DOI"]): record for record in items}
    if len(items) != message["total-results"] or len(by_doi) != len(items) or not by_doi.keys() <= set(dois):
        raise RuntimeError("Crossref DOI batch returned an incomplete or unexpected result")
    return by_doi


def enrich_crossref_citations(rows: Iterable[dict[str, Any]]) -> dict[str, str]:
    """Add Crossref counts without replacing publication IDs or OpenAlex metadata."""
    rows = list(rows)
    errors = {}
    by_doi = {}
    rate_limited = False
    pending = list(dict.fromkeys(
        doi for row in rows if not str(row.get("crossref_cited_by_count", "")).isdigit()
        and (doi := _crossref_publication_doi(row))
        and "," not in doi
    ))
    batch_records = {}
    batch_errors = {}
    for start in range(0, len(pending), 20):
        batch = pending[start:start + 20]
        if len(batch) == 1 and not rate_limited:
            continue
        if rate_limited:
            batch_errors.update((doi, ("rate_limited", "")) for doi in batch)
            continue
        try:
            registered = _crossref_doi_batch(batch)
            batch_records.update((doi, registered.get(doi)) for doi in batch)
        except (RuntimeError, ValueError, KeyError) as exc:
            message = str(exc)
            rate_limited = message.startswith("HTTP 429 ")
            status = "rate_limited" if rate_limited else "request_error"
            batch_errors.update((doi, (status, message)) for doi in batch)
    for row in rows:
        if str(row.get("crossref_cited_by_count", "")).isdigit():
            row["crossref_citation_status"] = "snapshot"
            continue
        doi = _crossref_publication_doi(row)
        if doi in by_doi:
            row.update(by_doi[doi])
            continue
        if doi in batch_errors:
            status, message = batch_errors[doi]
            row["crossref_citation_status"] = status
            if message:
                errors[paper_key(row)] = message
            continue
        if rate_limited and doi not in batch_records:
            row["crossref_citation_status"] = "rate_limited"
            continue
        try:
            if doi in batch_records:
                record = batch_records[doi]
                method = "doi" if record is not None else "unmatched"
            else:
                record, method = _crossref_citation_record(row, doi)
        except (RuntimeError, ValueError, KeyError) as exc:
            message = str(exc)
            rate_limited = message.startswith("HTTP 429 ")
            errors[paper_key(row)] = message
            row["crossref_citation_status"] = "rate_limited" if rate_limited else "request_error"
            continue
        count = (record or {}).get("is-referenced-by-count")
        if record is not None and type(count) is int and count >= 0:
            fields = dict(crossref_citation_status="matched", crossref_cited_by_count=count,
                          crossref_citation_doi=_normalize_doi(record["DOI"]),
                          crossref_citation_match_method=method, crossref_citations_retrieved_at=utc_now())
        else:
            fields = {"crossref_citation_status": "missing_count" if record is not None else method}
        if record is not None:
            fields["crossref_affiliations"] = crossref_affiliations(record)
        row.update(fields)
        if doi:
            by_doi[doi] = fields
    return errors


def _fetch_doi_bibtex(doi: str) -> tuple[str, str]:
    url = "https://doi.org/" + quote(doi, safe="/")
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/x-bibtex"})
    try:
        with urlopen(request, timeout=30) as response:
            bibtex = response.read().decode("utf-8").strip()
            source_url = response.geturl()
    except HTTPError as exc:
        raise RuntimeError(f"DOI BibTeX 查询失败：HTTP {exc.code}") from exc
    except (URLError, OSError) as exc:
        raise RuntimeError(f"DOI BibTeX 查询失败：{exc}") from exc
    entries = collector.parse_bibtex_entries(bibtex.encode("utf-8"))
    if (len(entries) != 1 or entries[0]["_raw_bibtex"] != bibtex
            or not entries[0]["_citation_key"] or not entries[0].get("title")):
        raise ValueError("DOI 服务未返回可识别的单条 BibTeX")
    returned_doi = _normalize_doi(entries[0].get("doi"))
    if not returned_doi:
        raise ValueError("返回的 BibTeX 缺少 DOI，无法确认论文身份")
    if returned_doi != doi:
        raise ValueError(f"返回的 BibTeX DOI 不匹配：请求 {doi}，返回 {returned_doi}")
    return bibtex, source_url


def _apply_bibtex_record(row: dict[str, Any], record: dict[str, Any]) -> dict[str, Any]:
    if record.get("doi") != _normalize_doi(row.get("doi")):
        raise ValueError(f"BibTeX 补全记录与当前论文 DOI 不匹配：{paper_key(row)}")
    if record.get("status") == "success" and not _as_text(record.get("bibtex")):
        raise ValueError(f"BibTeX 成功记录缺少引用内容：{paper_key(row)}")
    updated = dict(row, bibtex=record.get("bibtex", ""))
    for field in ("status", "source", "source_url", "retrieved_at", "error"):
        updated[f"bibtex_{field}"] = record.get(field, "")
    return updated


def load_cached_bibtex(rows: Iterable[dict[str, Any]], output_root: Path) -> list[dict[str, Any]]:
    """Restore DOI enrichment without replacing source-provided bibliography."""
    cache = _read_jsonl_map(_enrichment_root(output_root) / "bibtex.jsonl", strict=True)
    result = []
    for source in rows:
        row = dict(source)
        cached = cache.get(paper_key(row))
        if not _as_text(row.get("bibtex")) and cached:
            row = _apply_bibtex_record(row, cached)
        result.append(row)
    return result


def enrich_bibtex(
    rows: Iterable[dict[str, Any]], output_root: Path,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Fetch missing citations by DOI and retain per-paper results and provenance."""
    cache_path = _enrichment_root(output_root) / "bibtex.jsonl"
    cache = _read_jsonl_map(cache_path, strict=True)
    enriched_rows = []
    failures = {}
    changed = False
    for source in rows:
        row = dict(source)
        if _as_text(row.get("bibtex")):
            enriched_rows.append(row)
            continue
        key = paper_key(row)
        doi = _normalize_doi(row.get("doi"))
        cached = cache.get(key)
        if cached and cached.get("status") == "success":
            record = cached
        else:
            record = dict(paper_id=key, title=_as_text(row.get("title")), doi=doi,
                          status="failed", bibtex="", source="", source_url="", retrieved_at="", error="")
            if not doi:
                record.update(status="no_doi", error="缺少 DOI，无法补全 BibTeX")
            elif not re.fullmatch(r"10\.\d+(?:\.\d+)*/\S+", doi):
                record.update(status="invalid_doi", error=f"DOI 格式无效：{doi}")
            else:
                record.update(source="doi_content_negotiation", source_url="https://doi.org/" + quote(doi, safe="/"))
                try:
                    bibtex, source_url = _fetch_doi_bibtex(doi)
                    record.update(status="success", bibtex=bibtex, source_url=source_url, retrieved_at=utc_now())
                except (RuntimeError, ValueError) as exc:
                    record["error"] = str(exc)
            cache[key] = record
            changed = True
        row = _apply_bibtex_record(row, record)
        if record["status"] != "success":
            failures[key] = record["error"]
        enriched_rows.append(row)
    if changed:
        _write_jsonl_map(cache_path, cache)
    return enriched_rows, failures


def _abstract_from_openreview(payload: Any) -> str:
    notes = payload.get("notes", []) if isinstance(payload, dict) else []
    if not isinstance(notes, list) or not notes:
        return ""
    note = notes[0] if isinstance(notes[0], dict) else {}
    content = note.get("content", {})
    if not isinstance(content, dict):
        return ""
    for key in ("abstract", "Abstract"):
        value = content.get(key, "")
        text = _as_text(value)
        if text:
            return text
    return ""


def _fetch_openreview_abstract(openreview_id: str) -> tuple[str, str]:
    url = "https://api2.openreview.net/notes?" + urlencode({"id": openreview_id})
    payload, _raw, _headers = collector.request_json(url)
    abstract = _abstract_from_openreview(payload)
    return abstract, url


def _fetch_ijcai_abstract(row: dict[str, Any]) -> tuple[str, str]:
    url = _as_text(row.get("paper_url"))
    year, identifier = str(row["year"]), str(row["source_record_id"])
    if not (year.isdecimal() and identifier.isdecimal()
            and url == f"https://ijcai.org/proceedings/{year}/{identifier}"):
        raise ValueError("Invalid official IJCAI paper URL in snapshot")
    raw, _ = collector.request_bytes(url, timeout=20, retries=1)
    page = raw.decode("utf-8")
    title = re.search(r'<h1 class="article__title">(.*?)</h1>', page, re.S)
    if not title or normalize_title(collector.strip_html_fragment(title[1])) != normalize_title(row["title"]):
        raise ValueError(f"IJCAI detail title does not match snapshot: {url}")
    doi = _normalize_doi(row.get("doi"))
    if doi and f'href="https://doi.org/{doi}"' not in page.casefold():
        raise ValueError(f"IJCAI detail DOI does not match snapshot: {url}")
    block = re.search(r'<div class="article__abstract">\s*<p class="eyebrow">Abstract</p>(.*?)</div>', page, re.S)
    return (collector.strip_html_fragment(block[1]) if block else ""), url


def _fetch_cvf_or_ecva_abstract(row: dict[str, Any]) -> tuple[str, str]:
    url = _as_text(row.get("paper_url"))
    conference, year = row["conference"], str(row["year"])
    parsed = urlsplit(url)
    if row["source_type"] == "official_ecva":
        identifier = str(row["source_record_id"])
        expected = f"papers/eccv_{year}/papers_ECCV/html/"
        valid = (conference == "ECCV" and identifier.startswith(expected)
                 and identifier.endswith("_paper.php") and url == f"https://www.ecva.net/{identifier}")
    else:
        prefixes = (f"/content/{conference}{year}/html/", f"/content_{conference}_{year}/html/",
                    f"/content_{conference.lower()}_{year}/html/")
        valid = (parsed.netloc == "openaccess.thecvf.com" and conference in {"CVPR", "ICCV"}
                 and parsed.path.startswith(prefixes) and re.search(r"_paper(?:Original)?\.html$", parsed.path))
    if not valid or not year.isdecimal() or parsed.scheme != "https" or parsed.query or parsed.fragment:
        raise ValueError("Invalid official CVF or ECVA paper URL in snapshot")
    try:
        raw, _ = collector.request_bytes(url, timeout=20, retries=1)
    except RuntimeError:
        if row["source_type"] != "official_ecva" or year != "2018":
            raise
        filename = Path(identifier).with_suffix(".html").name
        url = f"https://openaccess.thecvf.com/content_ECCV_2018/html/{filename}"
        raw, _ = collector.request_bytes(url, timeout=20, retries=1)
    page = raw.decode("utf-8")
    title = re.search(r'<div id="papertitle"\s*>(.*?)</div>', page, re.S)
    expected_title = row["title"] if row["source_type"] == "official_ecva" else cvf_title_text(row["title"])
    if not title or normalize_title(collector.strip_html_fragment(title[1])) != normalize_title(expected_title):
        raise RuntimeError(f"CVF or ECVA detail title does not match snapshot: {url}")
    block = re.search(r'<div id="abstract"\s*>(.*?)</div>', page, re.S)
    return (collector.strip_html_fragment(block[1]) if block else ""), url


def _fetch_eccv_springer_metadata(row: dict[str, Any]) -> tuple[str, str, list[str]]:
    doi = _normalize_doi(row.get("doi"))
    url = f"https://link.springer.com/chapter/{doi}"
    if (row.get("conference") != "ECCV"
            or not re.fullmatch(r"10\.1007/978[\d-]+_\d+", doi) or row.get("paper_url") != url):
        raise ValueError("Invalid ECCV Springer chapter URL in snapshot")
    return _fetch_springer_metadata(row, doi, url)


IJCV_SPRINGER_DOI = re.compile(r"10\.1007/s11263-\d+-\d+-[a-z0-9]")


def _fetch_ijcv_springer_metadata(row: dict[str, Any]) -> tuple[str, str, list[str]]:
    doi = _normalize_doi(row.get("doi"))
    if row.get("conference") != "J_IJCV" or not IJCV_SPRINGER_DOI.fullmatch(doi):
        raise ValueError("Invalid IJCV Springer article DOI in snapshot")
    return _fetch_springer_metadata(row, doi, f"https://link.springer.com/article/{doi}")


def _fetch_springer_metadata(row: dict[str, Any], doi: str, url: str) -> tuple[str, str, list[str]]:
    raw, _ = collector.request_bytes(url, timeout=20, retries=1)
    page = raw.decode("utf-8")
    fields = dict(re.findall(r'<meta name="(citation_doi|citation_title)" content="([^"]*)"', page))
    if (_normalize_doi(fields.get("citation_doi")) != doi
            or normalize_title(unescape(fields.get("citation_title", ""))) != normalize_title(unescape(row["title"]))):
        raise RuntimeError(f"Springer DOI or title does not match snapshot: {url}")
    block = re.search(r'<div\b[^>]*\bid="Abs1-content"[^>]*>(.*?)</div>', page, re.S)
    affiliations = sorted({
        unescape(name).strip() for name in re.findall(
            r'<meta name="citation_author_institution" content="([^"]*)"', page
        ) if unescape(name).strip()
    })
    return (collector.strip_html_fragment(block[1]) if block else ""), url, affiliations


def _fetch_neurips_page(row: dict[str, Any]) -> tuple[str, str]:
    url = _as_text(row.get("paper_url"))
    year, identifier = str(row["year"]), str(row["source_record_id"])
    if (not year.isdecimal() or not re.fullmatch(
            rf"/paper_files/paper/{year}/hash/[0-9a-f]{{32}}-Abstract(?:-[\w-]+)?\.html", identifier)
            or url != f"https://proceedings.neurips.cc{identifier}"):
        raise ValueError("Invalid official NeurIPS paper URL in snapshot")
    raw, _ = collector.request_bytes(url, timeout=20, retries=1)
    page = raw.decode("utf-8")
    title = re.search(r'<h1 class="paper-title">(.*?)</h1>', page, re.S)
    if not title or normalize_title(collector.strip_html_fragment(title[1])) != normalize_title(row["title"]):
        raise ValueError(f"NeurIPS detail title does not match snapshot: {url}")
    return page, url


def _fetch_neurips_abstract(row: dict[str, Any]) -> tuple[str, str]:
    page, url = _fetch_neurips_page(row)
    block = re.search(r'<h2 class="section-label">Abstract</h2>(.*?)</section>', page, re.S)
    return (collector.strip_html_fragment(block[1]) if block else ""), url


def _fetch_neurips_2021_datasets_abstract(row: dict[str, Any]) -> tuple[str, str]:
    url = row["paper_url"]
    path = row["source_record_id"]
    if (str(row["year"]) != "2021" or url != f"https://datasets-benchmarks-proceedings.neurips.cc{path}"
            or not re.fullmatch(r"/paper_files/paper/2021/hash/[0-9a-f]{32}-Abstract-round[12]\.html", path)):
        raise ValueError("Invalid NeurIPS 2021 Datasets and Benchmarks paper URL")
    raw, _ = collector.request_bytes(url, timeout=20, retries=1)
    page = raw.decode("utf-8")
    title = re.search(r"<h4>(.*?)</h4>", page, re.S)
    if not title or normalize_title(collector.strip_html_fragment(title[1])) != normalize_title(row["title"]):
        raise RuntimeError(f"NeurIPS 2021 Datasets and Benchmarks title does not match snapshot: {url}")
    abstract = re.search(r"<h4>Abstract</h4>\s*<p>(.*?)</p>", page, re.S)
    return (collector.strip_html_fragment(abstract[1]) if abstract else ""), url


AAAI_DOI = re.compile(r"10\.1609/aaai\.v\d+i\d+\.(\d+)")
AAAI_OAI = "https://ojs.aaai.org/index.php/AAAI/oai"


def _aaai_title(title: str) -> str:
    return normalize_title(re.sub(r"(?<=\w)\^(?=\d)", "", title))


def _fetch_aaai_metadata(row: dict[str, Any]) -> tuple[str, str, list[str]]:
    doi = _normalize_doi(row["doi"])
    article_id = AAAI_DOI.fullmatch(doi)[1]
    url = _as_text(row.get("publisher_paper_url"))
    if not re.fullmatch(r"https://ojs\.aaai\.org/index\.php/AAAI/article/view/\d+(?:-\d+)?", url):
        url = f"https://ojs.aaai.org/index.php/AAAI/article/view/{article_id}"
    raw, _ = collector.request_bytes(url, timeout=20, retries=1)
    fields = re.findall(r'<meta name="([^"]+)"[^>]*? content="([^"]*)"', raw.decode("utf-8"))
    metadata = dict(fields)
    published_title = _aaai_title(unescape(metadata.get("citation_title", "")))
    snapshot_title = _aaai_title(row["title"])
    title_matches = published_title == snapshot_title
    if not title_matches and _as_text(row.get("source_type")).startswith("dblp"):
        authors = [normalize_title(re.sub(r" \d{4}$", "", name.strip()))
                   for name in _as_text(row.get("authors")).split(";")]
        published_authors = [normalize_title(unescape(value)) for name, value in fields
                             if name == "citation_author"]
        title_matches = (bool(authors) and all(authors) and authors == published_authors
                         and difflib.SequenceMatcher(None, snapshot_title, published_title).ratio() >= 0.9)
    if _normalize_doi(metadata.get("citation_doi")) != doi or not title_matches:
        raise RuntimeError(f"AAAI detail DOI or title does not match snapshot: {url}")
    affiliations = sorted({unescape(value).strip() for name, value in fields
                           if name == "citation_author_institution" and value.strip()})
    return unescape(metadata.get("DC.Description", "")).strip(), url, affiliations


def _fetch_iclr2020_program_abstract(row: dict[str, Any]) -> tuple[str, str]:
    forum = row["source_record_id"]
    if str(row["year"]) != "2020" or not re.fullmatch(r"[A-Za-z0-9_-]+", forum):
        raise ValueError("Invalid ICLR 2020 program record ID")
    url = f"https://iclr.cc/virtual_2020/poster_{forum}.html"
    raw, _ = collector.request_bytes(url, timeout=20, retries=1)
    page = raw.decode("utf-8")
    title = re.search(r'<meta name="citation_title" content="([^"]*)"', page)
    if not title or normalize_title(unescape(title[1])) != normalize_title(row["title"]):
        raise RuntimeError(f"ICLR 2020 program title does not match snapshot: {url}")
    block = re.search(r'<div id="abstractExample">\s*<span[^>]*>Abstract:</span>(.*?)</div>', page, re.S)
    return (collector.strip_html_fragment(block[1]) if block else ""), url


OFFICIAL_ABSTRACT_SOURCES = {
    "official_ijcai": _fetch_ijcai_abstract,
    "official_cvf_openaccess": _fetch_cvf_or_ecva_abstract,
    "official_ecva": _fetch_cvf_or_ecva_abstract,
    "official_eccv_springer": _fetch_eccv_springer_metadata,
    "official_ijcv_springer": _fetch_ijcv_springer_metadata,
    "official_neurips": _fetch_neurips_abstract,
    "official_neurips_2021_datasets": _fetch_neurips_2021_datasets_abstract,
    "official_iclr_program": _fetch_iclr2020_program_abstract,
}


def official_abstract_source(row: dict[str, Any]) -> str:
    if row.get("conference") == "AAAI" and AAAI_DOI.fullmatch(_normalize_doi(row.get("doi"))):
        return "official_aaai"
    if row.get("conference") == "J_IJCV" and IJCV_SPRINGER_DOI.fullmatch(_normalize_doi(row.get("doi"))):
        return "official_ijcv_springer"
    source = row.get("source_type", "")
    if source == "official_iclr_program" and str(row["year"]) != "2020":
        return ""
    if source == "official_cvf_openaccess" and not _as_text(row.get("paper_url")):
        return ""
    return source if source in OFFICIAL_ABSTRACT_SOURCES else ""


def scan_aaai_oai_abstracts(
    rows: list[dict[str, Any]], output_root: Path, *, resumption_token: str = "",
) -> dict[str, Any]:
    pending = {_normalize_doi(row["doi"]): row for row in rows
               if official_abstract_source(row) == "official_aaai" and not _as_text(row.get("abstract"))}
    report = dict(pages=0, matched=0, error="")
    if not pending:
        return report
    start_year = min(int(row["year"]) for row in pending.values())
    params = {"verb": "ListRecords", "metadataPrefix": "oai_dc", "from": f"{start_year}-01-01T00:00:00Z"}
    if resumption_token:
        params = {"verb": "ListRecords", "resumptionToken": resumption_token}
    namespaces = {"oai": "http://www.openarchives.org/OAI/2.0/", "dc": "http://purl.org/dc/elements/1.1/"}
    path = _enrichment_root(output_root) / "abstracts.jsonl"
    cache = _read_jsonl_map(path, strict=True)
    while params and pending:
        url = f"{AAAI_OAI}?{urlencode(params)}"
        try:
            payload, _ = collector.request_bytes(url, timeout=25, retries=2)
            page = ElementTree.fromstring(payload)
        except (RuntimeError, ElementTree.ParseError) as exc:
            report["error"] = f"{url}: {exc}"
            break
        records = page.find("oai:ListRecords", namespaces)
        if records is None:
            error = page.find("oai:error", namespaces)
            if error is None or error.get("code") != "noRecordsMatch":
                report["error"] = f"{url}: {error.text if error is not None else 'missing ListRecords'}"
            break
        report["pages"] += 1
        for metadata in records.findall("oai:record/oai:metadata/*", namespaces):
            dois = {_normalize_doi(field.text) for field in metadata.findall("dc:identifier", namespaces)}
            matched = dois & pending.keys()
            if len(matched) != 1:
                continue
            doi = matched.pop()
            row = pending[doi]
            title = metadata.findtext("dc:title", "", namespaces)
            abstract = metadata.findtext("dc:description", "", namespaces).strip()
            if not abstract or _aaai_title(title) != _aaai_title(row["title"]):
                continue
            del pending[doi]
            key = paper_key(row)
            cache[key] = dict(paper_id=key, status="success", source="official_aaai_oai", source_url=url,
                              abstract=abstract, retrieved_at=utc_now(), matched_title=title,
                              match_confidence=1.0, error="")
            report["matched"] += 1
        token = records.findtext("oai:resumptionToken", "", namespaces).strip()
        params = {"verb": "ListRecords", "resumptionToken": token} if token else {}
    if report["matched"]:
        _write_jsonl_map(path, cache)
    if report["error"] and params.get("resumptionToken"):
        report["resumption_token"] = params["resumptionToken"]
    return report


def enrich_aaai_candidate_affiliations(rows: list[dict[str, Any]], output_root: Path) -> dict[str, str]:
    pending = [row for row in rows if row.get("abstract_source") == "official_aaai_oai"
               and not row.get("publisher_affiliations")]
    if not pending:
        return {}
    path = _enrichment_root(output_root) / "abstracts.jsonl"
    cache = _read_jsonl_map(path, strict=True)
    errors = {}
    for row in pending:
        key = paper_key(row)
        if "publisher_affiliations" in cache[key]:
            continue
        try:
            _, url, affiliations = _fetch_aaai_metadata(row)
        except (RuntimeError, ValueError) as exc:
            errors[key] = str(exc)
            continue
        fields = dict(publisher_affiliations=affiliations, publisher_affiliations_url=url)
        row.update(fields)
        cache[key].update(fields)
    _write_jsonl_map(path, cache)
    return errors


def _author_tokens(value: str) -> set[str]:
    tokens: set[str] = set()
    for author in value.split(";"):
        words = re.findall(r"[a-z0-9]+", author.casefold())
        if words:
            tokens.add(words[-1])
    return tokens


def enrich_semantic_scholar_citations(rows: Iterable[dict[str, Any]]) -> None:
    """Fill publication citation gaps using a DOI or an explicit DBLP record key."""
    for row in rows:
        if any(str(row.get(field, "")).isdigit() for field in (
            "cited_by_count", "crossref_cited_by_count", "semantic_scholar_cited_by_count",
        )):
            continue
        doi = _crossref_publication_doi(row)
        dblp_key = _as_text(row.get("source_record_id")) if row.get("source_type") == "dblp_proceedings" else ""
        if doi.startswith("10.48550/arxiv.") or not (doi or dblp_key):
            continue
        params = urlencode({
            "query": '"' + _as_text(row.get("title")) + '"',
            "fields": "title,year,externalIds,url,citationCount",
        })
        payload, _, _ = collector.request_json(f"{SEMANTIC_SCHOLAR_SEARCH_URL}/bulk?{params}")
        matches = [
            work for work in payload["data"]
            if normalize_title(_as_text(work.get("title"))) == normalize_title(_as_text(row.get("title")))
            and _as_text(work.get("year")) == _as_text(row.get("year"))
            and (
                _as_text((work.get("externalIds") or {}).get("DOI")).lower() == doi
                if doi else (work.get("externalIds") or {}).get("DBLP") == dblp_key
            )
        ]
        if len(matches) != 1:
            continue
        work = matches[0]
        count = work.get("citationCount")
        if type(count) is int and count >= 0 and work.get("url"):
            row.update(semantic_scholar_cited_by_count=count, semantic_scholar_url=work["url"],
                       semantic_scholar_retrieved_at=utc_now())


def _semantic_scholar_abstract(
    row: dict[str, Any],
) -> tuple[str, str, float, str] | None:
    title = _as_text(row.get("title"))
    if not title:
        return None
    params = urlencode(
        {
            "query": title,
            "limit": "5",
            "fields": "title,abstract,authors,year,externalIds,url",
        }
    )
    url = f"{SEMANTIC_SCHOLAR_SEARCH_URL}?{params}"
    payload, _raw, _headers = collector.request_json(url)
    candidates = payload.get("data", []) if isinstance(payload, dict) else []
    if not isinstance(candidates, list):
        return None

    wanted_title = normalize_title(title)
    wanted_year = _as_text(row.get("year"))
    wanted_authors = _author_tokens(_as_text(row.get("authors")))
    ranked: list[tuple[float, dict[str, Any]]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict) or not _as_text(candidate.get("abstract")):
            continue
        candidate_title = _as_text(candidate.get("title"))
        normalized_candidate = normalize_title(candidate_title)
        if not normalized_candidate:
            continue
        title_score = difflib.SequenceMatcher(
            None, wanted_title, normalized_candidate
        ).ratio()
        token_left = set(wanted_title.split())
        token_right = set(normalized_candidate.split())
        union = token_left | token_right
        token_score = len(token_left & token_right) / len(union) if union else 0.0
        score = max(title_score, token_score)
        if normalized_candidate == wanted_title:
            score = 1.0
        candidate_year = _as_text(candidate.get("year"))
        if wanted_year and candidate_year and wanted_year != candidate_year:
            score -= 0.08
        candidate_authors = candidate.get("authors", [])
        candidate_author_text = ";".join(
            _as_text(author.get("name"))
            for author in candidate_authors
            if isinstance(author, dict)
        )
        if wanted_authors and _author_tokens(candidate_author_text) & wanted_authors:
            score += 0.03
        ranked.append((score, candidate))

    if not ranked:
        return None
    score, candidate = max(ranked, key=lambda item: item[0])
    if score < 0.92:
        return None
    return (
        _as_text(candidate.get("abstract")),
        url,
        round(min(score, 1.0), 4),
        _as_text(candidate.get("title")),
    )


def enrich_abstracts(
    rows: Iterable[dict[str, Any]],
    output_root: Path,
    *,
    refresh: bool = False,
    use_external_source: bool = True,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Fill missing abstracts for selected rows and persist a reusable cache."""
    cache_path = _enrichment_root(output_root) / "abstracts.jsonl"
    cache = _read_jsonl_map(cache_path)
    enriched_rows: list[dict[str, Any]] = []
    failures: dict[str, str] = {}

    for source_row in rows:
        row = dict(source_row)
        key = paper_key(row)
        cached = cache.get(key)
        if cached and cached.get("status") == "success" and not refresh:
            result = cached
        else:
            abstract = _as_text(row.get("abstract"))
            result: dict[str, Any] = {
                "paper_id": key,
                "status": "success" if abstract else "not_found",
                "abstract": abstract,
                "source": "local_dataset" if abstract else "",
                "source_url": _as_text(row.get("source_url")),
                "retrieved_at": utc_now(),
                "match_confidence": 1.0 if abstract else 0.0,
                "matched_title": _as_text(row.get("title")) if abstract else "",
                "error": "",
            }
            official_source = official_abstract_source(row)
            if not abstract and _as_text(row.get("openreview_id")) and official_source != "official_iclr_program":
                try:
                    abstract, source_url = _fetch_openreview_abstract(
                        _as_text(row["openreview_id"])
                    )
                    if abstract:
                        result.update(
                            status="success",
                            abstract=abstract,
                            source="openreview",
                            source_url=source_url,
                            match_confidence=1.0,
                            matched_title=_as_text(row.get("title")),
                        )
                except RuntimeError as exc:
                    result["error"] = str(exc)
            official = OFFICIAL_ABSTRACT_SOURCES.get(official_source)
            if not abstract and official_source:
                try:
                    if official_source == "official_aaai":
                        abstract, source_url, affiliations = _fetch_aaai_metadata(row)
                        result.update(publisher_affiliations=affiliations, publisher_affiliations_url=source_url)
                    elif official_source in {"official_eccv_springer", "official_ijcv_springer"}:
                        abstract, source_url, affiliations = official(row)
                        result.update(publisher_affiliations=affiliations, publisher_affiliations_url=source_url)
                    else:
                        abstract, source_url = official(row)
                    if abstract:
                        source = ("official_cvf_eccv_archive" if official_source == "official_ecva"
                                  and urlsplit(source_url).hostname == "openaccess.thecvf.com" else official_source)
                        result.update(status="success", abstract=abstract, source=source,
                                      source_url=source_url, match_confidence=1.0,
                                      matched_title=_as_text(row.get("title")), error="")
                except RuntimeError as exc:
                    result["error"] = str(exc)
            if not abstract and use_external_source:
                try:
                    match = _semantic_scholar_abstract(row)
                    if match:
                        abstract, source_url, confidence, matched_title = match
                        result.update(
                            status="success",
                            abstract=abstract,
                            source="semantic_scholar",
                            source_url=source_url,
                            match_confidence=confidence,
                            matched_title=matched_title,
                            error="",
                        )
                except RuntimeError as exc:
                    result["error"] = str(exc)
            if not result["abstract"]:
                result["status"] = "not_found"
                failures[key] = result.get("error") or "No abstract source matched"
            cache[key] = result

        row["paper_id"] = key
        row["abstract"] = result.get("abstract", "")
        row["abstract_status"] = result.get("status", "not_found")
        row["abstract_source"] = result.get("source", "")
        row["abstract_source_url"] = result.get("source_url", "")
        row["abstract_retrieved_at"] = result.get("retrieved_at", "")
        row["abstract_match_confidence"] = result.get("match_confidence", 0.0)
        row["abstract_matched_title"] = result.get("matched_title", "")
        row["abstract_error"] = result.get("error", "")
        if result.get("publisher_affiliations"):
            row["publisher_affiliations"] = result["publisher_affiliations"]
            row["publisher_affiliations_url"] = result["publisher_affiliations_url"]
        enriched_rows.append(row)

    _write_jsonl_map(cache_path, cache)
    return enriched_rows, failures


def resolve_pdf_url(row: dict[str, Any]) -> str:
    for field in ("oa_pdf_url", "pdf_url", "paper_url"):
        value = _as_text(row.get(field))
        if value.casefold().startswith(("http://", "https://")):
            if field in {"oa_pdf_url", "pdf_url"} or value.casefold().split("?", 1)[0].endswith(".pdf"):
                return value
    openreview_id = _as_text(row.get("openreview_id"))
    if openreview_id:
        return "https://openreview.net/pdf?id=" + openreview_id
    return ""


def _download_one_pdf(url: str, target: Path) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(3):
        temp = target.with_name(target.name + ".part")
        digest = hashlib.sha256()
        total = 0
        try:
            request = Request(
                url,
                headers={"User-Agent": USER_AGENT, "Accept": "application/pdf,*/*;q=0.5"},
            )
            with urlopen(request, timeout=120) as response:
                final_url = response.geturl()
                content_type = response.headers.get("Content-Type", "")
                with temp.open("wb") as handle:
                    while True:
                        chunk = response.read(DOWNLOAD_CHUNK_SIZE)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_PDF_BYTES:
                            raise RuntimeError("PDF exceeds 100 MB safety limit")
                        digest.update(chunk)
                        handle.write(chunk)
            if total < 5:
                raise RuntimeError("Downloaded file is empty")
            with temp.open("rb") as handle:
                signature = handle.read(5)
            if signature != b"%PDF-" and "pdf" not in content_type.casefold():
                raise RuntimeError("Downloaded response is not a PDF")
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(temp, target)
            return {
                "status": "downloaded",
                "requested_url": url,
                "final_url": final_url,
                "content_type": content_type,
                "file_size": total,
                "sha256": digest.hexdigest(),
                "local_path": str(target),
                "downloaded_at": utc_now(),
                "error": "",
            }
        except HTTPError as exc:
            last_error = exc
            if 400 <= exc.code < 500:
                break
        except (URLError, TimeoutError, OSError, RuntimeError) as exc:
            last_error = exc
        finally:
            if temp.exists():
                try:
                    temp.unlink()
                except OSError:
                    pass
        if attempt < 2:
            time.sleep(2**attempt)
    return {
        "status": "failed",
        "requested_url": url,
        "final_url": "",
        "content_type": "",
        "file_size": 0,
        "sha256": "",
        "local_path": "",
        "downloaded_at": utc_now(),
        "error": str(last_error) if last_error else "Unknown download error",
    }


def download_pdfs(
    rows: Iterable[dict[str, Any]],
    output_root: Path,
    *,
    refresh: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Download selected public PDFs and persist a resumable manifest."""
    manifest_path = _enrichment_root(output_root) / "pdf_manifest.jsonl"
    manifest = _read_jsonl_map(manifest_path)
    results: list[dict[str, Any]] = []
    failures: dict[str, str] = {}
    pdf_dir = _enrichment_root(output_root) / "pdf"

    for source_row in rows:
        row = dict(source_row)
        key = paper_key(row)
        cached = manifest.get(key)
        target = pdf_dir / f"{key}.pdf"
        if cached and cached.get("status") == "linked":
            target = Path(cached["local_path"])
        if cached and cached.get("status") in {"downloaded", "linked"} and target.is_file() and not refresh:
            result = cached
        else:
            target = pdf_dir / f"{key}.pdf"
            url = resolve_pdf_url(row)
            if not url:
                result = {
                    "status": "no_pdf_url",
                    "requested_url": "",
                    "final_url": "",
                    "content_type": "",
                    "file_size": 0,
                    "sha256": "",
                    "local_path": "",
                    "downloaded_at": utc_now(),
                    "error": "No public PDF URL was found in the paper metadata",
                }
            else:
                result = _download_one_pdf(url, target)
            result["paper_id"] = key
            result["title"] = _as_text(row.get("title"))
            manifest[key] = result

        row["paper_id"] = key
        row["pdf_status"] = result.get("status", "")
        row["pdf_url_resolved"] = result.get("final_url") or result.get("requested_url", "")
        row["pdf_local_path"] = result.get("local_path", "")
        row["pdf_sha256"] = result.get("sha256", "")
        row["pdf_error"] = result.get("error", "")
        results.append(row)
        if result.get("status") not in {"downloaded", "linked"}:
            failures[key] = result.get("error") or result.get("status", "failed")

    _write_jsonl_map(manifest_path, manifest)
    return results, failures


def export_ai_jsonl(
    rows: Iterable[dict[str, Any]],
    output_path: Path,
    *,
    query: str = "",
) -> Path:
    """Export selected rows as compact, one-paper-per-line AI input records."""
    records: list[dict[str, Any]] = []
    for source_row in rows:
        row = dict(source_row)
        authors = [value.strip() for value in _as_text(row.get("authors")).split(";") if value.strip()]
        keywords = [value.strip() for value in _as_text(row.get("keywords")).split(";") if value.strip()]
        records.append(
            {
                "paper_id": paper_key(row),
                "conference": row.get("conference", ""),
                "conference_display_name": row.get("conference_display_name", ""),
                "ccf_category": row.get("ccf_category", ""),
                "ccf_type": row.get("ccf_type", ""),
                "doi": row.get("doi", ""),
                "oa_status": row.get("oa_status", ""),
                "oa_version": row.get("oa_version", ""),
                "year": row.get("year", ""),
                "title": row.get("title", ""),
                "authors": authors,
                "abstract": row.get("abstract", ""),
                "abstract_status": row.get("abstract_status", "available" if row.get("abstract") else "not_found"),
                "abstract_source": row.get("abstract_source", ""),
                "abstract_match_confidence": row.get("abstract_match_confidence", 0.0),
                "keywords": keywords,
                "tldr": row.get("tldr", ""),
                "areas": {
                    "primary": row.get("primary_area", ""),
                    "secondary": row.get("secondary_area", ""),
                    "topic": row.get("topic", ""),
                },
                "links": {
                    "source": row.get("source_url", ""),
                    "paper": row.get("paper_url", ""),
                    "pdf": row.get("pdf_url_resolved") or row.get("pdf_url", ""),
                    "openreview": row.get("openreview_url", ""),
                    "virtual": row.get("virtual_url", ""),
                    "oa_pdf": row.get("oa_pdf_url", ""),
                    "oa_landing": row.get("oa_landing_url", ""),
                },
                "local_files": {
                    "pdf_path": row.get("pdf_local_path", ""),
                    "pdf_sha256": row.get("pdf_sha256", ""),
                },
                "search": {"query": query,
                           "matched_query_groups": row.get("matched_query_groups", []),
                           "matched_terms": row.get("matched_terms", []),
                           "matched_fields": row.get("matched_fields", []),
                           "matched_snippets": row.get("matched_snippets", [])},
                "provenance": {
                    "source_type": row.get("source_type", ""),
                    "source_id": row.get("source_id", ""),
                    "source_record_id": row.get("source_record_id", ""),
                },
            }
        )
    collector.write_jsonl(output_path, records)
    return output_path


def link_local_pdf(row: dict[str, Any], path: Path, output_root: Path) -> dict[str, Any]:
    """Associate a user-selected PDF without copying or altering its contents."""
    path = path.expanduser().resolve()
    with path.open("rb") as handle:
        if not handle.read(1024).lstrip().startswith(b"%PDF-"):
            raise ValueError("所选文件不是 PDF")
    manifest_path = _enrichment_root(output_root) / "pdf_manifest.jsonl"
    manifest = _read_jsonl_map(manifest_path, strict=True)
    key = paper_key(row)
    manifest[key] = dict(paper_id=key, title=row.get("title", ""), status="linked",
                         local_path=str(path), linked_at=utc_now())
    _write_jsonl_map(manifest_path, manifest)
    return dict(row, pdf_status="linked", pdf_local_path=str(path), pdf_error="", pdf_sha256="")


def lookup_open_access(row: dict[str, Any], email: str) -> dict[str, Any]:
    """Locate an OA copy by DOI; absence/error is not evidence of a paywall."""
    if "@" not in email or any(c.isspace() for c in email):
        raise ValueError("Unpaywall requires a contact email")
    result = dict(row, oa_status="no_doi", oa_pdf_url="", oa_landing_url="", oa_version="")
    doi = _as_text(row.get("doi"))
    doi = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", doi, flags=re.I)
    if not doi:
        return result
    url = "https://api.unpaywall.org/v2/" + quote(doi, safe="") + "?" + urlencode({"email": email})
    request = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=30) as response:
            data = json.load(response)
    except HTTPError as exc:
        if exc.code == 404:
            return dict(result, oa_status="not_found")
        raise RuntimeError(f"Unpaywall 查询失败：HTTP {exc.code}") from None
    except (URLError, TimeoutError, ValueError):
        raise RuntimeError("Unpaywall 查询失败：网络或响应格式错误") from None
    if str(data.get("doi", "")).casefold() != doi.casefold():
        raise ValueError("Unpaywall returned a different DOI")
    location = data.get("best_oa_location") or {}
    return dict(result, oa_status="found" if location else "not_found",
                oa_pdf_url=location.get("url_for_pdf") or "",
                oa_landing_url=location.get("url_for_landing_page") or location.get("url") or "",
                oa_version=location.get("version") or "")
