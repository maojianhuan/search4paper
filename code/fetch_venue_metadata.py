"""Published bibliographies for catalogue venues; never an acceptance feed."""
from __future__ import annotations

import html
import json
import re
from pathlib import Path
from urllib.parse import urlencode

from . import fetch_openreview_accepted as collector


def fetch_json(url: str, raw_dir: Path, page: int) -> dict:
    raw, _headers = collector.request_bytes(url)
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise RuntimeError("元数据源未返回 JSON（可能是访问验证页）；此次采集未完成。") from exc
    collector.write_bytes(raw_dir / f"page_{page}.json", raw)
    return payload


def text(value) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", str(value or ""))).strip()


def base_row(spec, year, title, authors, record_id, doi, url):
    if not title or not record_id:
        raise RuntimeError("Source record lacks title or stable ID")
    row = dict.fromkeys(collector.CSV_FIELDS, "")
    row.update(conference=spec.key, conference_display_name=spec.display_name,
               ccf_abbreviation=spec.ccf_abbreviation, ccf_category=spec.ccf_category,
               ccf_type=spec.ccf_type, ccf_professional_field=spec.ccf_professional_field,
               year=year, title=text(title), authors="; ".join(authors),
               source_type=spec.source_kind, source_id=spec.collection_id(year),
               source_record_id=record_id, source_url=url, paper_url=url, doi=doi)
    return row


def dblp_rows(spec, year: int, raw_dir: Path):
    query = f"year:{year}:"
    if spec.dblp_collection:
        query += f" stream:streams/{spec.dblp_collection}:"
    if spec.venue_filter:
        query += f" venue:{spec.venue_filter}:"
    offset, total, rows, rich, sources, seen = 0, None, [], [], [], set()
    while total is None or offset < total:
        url = "https://dblp.org/search/publ/api?" + urlencode(dict(q=query, format="json", h=1000, f=offset))
        payload = fetch_json(url, raw_dir, len(sources))
        sources.append(url)
        # DBLP stream membership is defined by the query, not the record key:
        # a conference stream can contain papers published in journal issues.
        response_query = payload["result"].get("query", "")
        if spec.dblp_collection and re.findall(r':facetid:stream:"([^"]+)"', response_query) != [f"streams/{spec.dblp_collection}"]:
            raise RuntimeError("DBLP response does not confirm the requested venue stream")
        hits = payload["result"]["hits"]
        count = int(hits["@total"])
        if total is not None and total != count:
            raise RuntimeError("DBLP result count changed during pagination; refresh required")
        total = count
        batch = hits.get("hit", [])
        if isinstance(batch, dict):
            batch = [batch]
        if not batch and offset < total:
            raise RuntimeError("DBLP pagination ended before all records were retrieved")
        for hit in batch:
            info = hit["info"]
            key = info["key"]
            if key in seen:
                raise RuntimeError("DBLP returned duplicate records across pages")
            seen.add(key)
            if int(info["year"]) != year:
                raise RuntimeError("DBLP returned a different publication year")
            venue = info.get("venue", "")
            venues = venue if isinstance(venue, list) else [venue]
            if spec.venue_filter and spec.venue_filter.casefold() not in {v.casefold() for v in venues}:
                raise RuntimeError("DBLP returned a different venue name")
            accepted_types = {"Journal Articles"} if spec.ccf_type == "期刊" else {"Journal Articles", "Conference and Workshop Papers"}
            if info.get("type") not in accepted_types:
                continue
            authors = info.get("authors", {}).get("author", [])
            if not isinstance(authors, list):
                authors = [authors]
            authors = [a.get("text", "") if isinstance(a, dict) else a for a in authors]
            ee = info.get("ee", "")
            if isinstance(ee, list):
                ee = ee[0] if ee else ""
            row = base_row(spec, year, info["title"], authors, key, info.get("doi", ""), ee or info.get("url", ""))
            row.update(booktitle="; ".join(venues), volume=info.get("volume", ""), issue=info.get("number", ""),
                       pages=info.get("pages", ""))
            rows.append(row)
            rich.append({"normalized": row, "source_record": info})
        offset += len(batch)
    return rows, rich, sources, total


def crossref_rows(spec, year: int, raw_dir: Path, *, print_publication: bool = False):
    # Crossref 'published' is its earliest publication date, not necessarily print year.
    cursor, rows, rich, sources, seen, total = "*", [], [], [], set(), None
    date_filter = "print-pub-date" if print_publication else "pub-date"
    date_field = "published-print" if print_publication else "published"
    # Crossref dates the digitized AAAI 2012 proceedings to their 2021 release.
    source_year = 2021 if spec.key == "AAAI" and year == 2012 else year
    while True:
        params = dict(filter=f"from-{date_filter}:{source_year}-01-01,until-{date_filter}:{source_year}-12-31,type:journal-article",
                      rows=200, cursor=cursor)
        if print_publication:
            params["select"] = "DOI,ISSN,title,author,abstract,volume,issue,page,published-print,is-referenced-by-count"
        url = f"https://api.crossref.org/journals/{spec.issns[0]}/works?" + urlencode(params)
        message = fetch_json(url, raw_dir, len(sources))["message"]
        sources.append(url)
        count = int(message["total-results"])
        if total is not None and total != count:
            raise RuntimeError("Crossref result count changed during pagination; refresh required")
        total = count
        batch = message["items"]
        if not batch:
            if len(seen) != total:
                raise RuntimeError("Crossref pagination incomplete")
            break
        for info in batch:
            doi = info["DOI"].lower()
            if doi in seen:
                raise RuntimeError("Crossref returned duplicate DOI across pages")
            seen.add(doi)
            if not set(spec.issns).intersection(info.get("ISSN", [])):
                raise RuntimeError("Crossref returned a different journal ISSN")
            if ((not print_publication and info.get("type") != "journal-article")
                    or int(info[date_field]["date-parts"][0][0]) != source_year):
                raise RuntimeError("Crossref returned a different publication type/year")
            if spec.key == "AAAI" and 2010 <= year <= 2024:
                volume = str(info.get("volume", ""))
                if not volume.isdecimal() or not doi.startswith(f"10.1609/aaai.v{volume}i"):
                    raise RuntimeError("Crossref returned inconsistent AAAI proceedings volume metadata")
                if volume != str(year - 1986):
                    continue
                if 2010 <= year <= 2017 and str(info.get("issue")) != "1":
                    # The AAAI conference proceedings for these years are in issue 1.
                    continue
            authors = [" ".join(filter(None, [a.get("given"), a.get("family")])) or a.get("name", "") for a in info.get("author", [])]
            row = base_row(spec, year, info["title"][0], authors, doi, doi, f"https://doi.org/{doi}")
            row.update(abstract=text(info.get("abstract", "")), volume=info.get("volume", ""),
                       issue=info.get("issue", ""), pages=info.get("page", ""),
                       booktitle="; ".join(info.get("container-title", [])),
                       crossref_cited_by_count=info.get("is-referenced-by-count", ""))
            if spec.key == "AAAI":
                publisher_url = (info.get("resource") or {}).get("primary", {}).get("URL", "")
                if re.fullmatch(r"https://ojs\.aaai\.org/index\.php/AAAI/article/view/\d+(?:-\d+)?", publisher_url):
                    row["publisher_paper_url"] = publisher_url
            rows.append(row)
            rich.append({"normalized": row, "source_record": info})
        if len(seen) == total:
            break
        next_cursor = message.get("next-cursor")
        if not next_cursor or next_cursor == cursor:
            raise RuntimeError("Crossref cursor did not advance")
        cursor = next_cursor
    return rows, rich, sources, total


def build_outputs(output_root: Path, *, spec, year: int):
    directory = output_root / str(year) / spec.key
    if spec.source_kind in {"crossref_journal", "crossref_journal_print"}:
        rows, rich, sources, total = crossref_rows(
            spec, year, directory / "raw", print_publication=spec.source_kind == "crossref_journal_print",
        )
    else:
        rows, rich, sources, total = dblp_rows(spec, year, directory / "raw")
    if not rows:
        raise RuntimeError(f"{spec.key} {year}：未发现已索引论文；不能据此认定该年没有论文。")
    stem = f"{spec.key}_{year}_accepted_papers"  # Existing local-search file contract.
    csv_path, jsonl_path = directory / f"{stem}.csv", directory / f"{stem}.jsonl"
    warnings = ["已出版书目，不是实时录用名单；元数据索引可能延迟或遗漏。",
                "有书目不代表有摘要或可下载全文；检索不需要订阅账号。",
                "书目条目的正式长文资格未经逐篇核验，不可直接作为 CCF 成果认定依据。"]
    year_policy = {
        "crossref_journal": "Crossref published 最早发表日期（含在线发表），不一定是纸刊年份",
        "crossref_journal_print": "Crossref published-print 纸刊出版年份",
    }.get(spec.source_kind, "DBLP 记录的出版年份，不一定是会议举办年份")
    if spec.key == "AAAI" and year == 2012:
        year_policy = "按 AAAI 2012 年第 26 卷第 1 期收录，Crossref 数字版出版日期为 2021 年"
    warnings.append(year_policy)
    if spec.mapping_note:
        warnings.append(spec.mapping_note)
    manifest = dict(conference=spec.key, conference_display_name=spec.display_name,
                    ccf=collector.ccf_metadata(spec), year=year, source_kind=spec.source_kind, venue_id="",
                    collection_id=spec.collection_id(year), source_id=spec.collection_id(year),
                    collection_scope="published_bibliography", publication_year_policy=year_policy,
                    fetched_at_utc=collector.utc_now(), collection_status="fetched_from_sources",
                    counts={"accepted_paper_count": len(rows), "published_paper_count": len(rows),
                            "source_record_count": total, "excluded_record_count": total-len(rows)},
                    warnings=warnings, sources=sources,
                    outputs={"csv": str(csv_path), "jsonl": str(jsonl_path)})
    collector.write_csv(csv_path, rows, collector.CSV_FIELDS)
    collector.write_jsonl(jsonl_path, rich)
    path = directory / "source_manifest.json"
    collector.write_json(path, manifest)
    manifest["outputs"]["manifest"] = str(path)
    return manifest, rows, rich
