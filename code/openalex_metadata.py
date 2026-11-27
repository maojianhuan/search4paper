"""Citation and publication-affiliation enrichment for topic results."""

from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict
from contextlib import closing
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .paper_enrichment import _normalize_doi

API = "https://api.openalex.org/works"
FIELDS = "id,doi,title,publication_year,cited_by_count,authorships,abstract_inverted_index"


class OpenAlexRateLimitError(RuntimeError):
    pass


class OpenAlexCheckpoint:
    """Retain successful requests across quota-limited runs."""

    def __init__(self, path, utc_now):
        self.path = path
        self.utc_now = utc_now
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS responses "
                       "(request TEXT PRIMARY KEY, retrieved_at TEXT NOT NULL, page TEXT NOT NULL)")

    def get(self, params, api_key):
        key = json.dumps([API, FIELDS, params], sort_keys=True)
        with closing(sqlite3.connect(self.path)) as db:
            saved = db.execute("SELECT retrieved_at, page FROM responses WHERE request = ?", (key,)).fetchone()
            if saved is None:
                page = _get(params, api_key)
                retrieved_at = self.utc_now()
                with db:
                    db.execute("INSERT OR IGNORE INTO responses VALUES (?, ?, ?)",
                               (key, retrieved_at, json.dumps(page, ensure_ascii=False)))
            else:
                retrieved_at, payload = saved
                page = json.loads(payload)
        for work in page["results"]:
            work["_retrieved_at"] = retrieved_at
        return page


def _get(params, api_key):
    query_params = {**params, "select": FIELDS}
    if api_key:
        query_params["api_key"] = api_key
    query = urlencode(query_params)
    request = Request(f"{API}?{query}", headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as exc:
        if exc.code == 429:
            delay = exc.headers.get("Retry-After") or exc.headers.get("X-RateLimit-Reset")
            hint = f" (retry after {delay} seconds)" if delay and delay.isdecimal() else ""
            raise OpenAlexRateLimitError(f"OpenAlex request failed with HTTP 429{hint}") from None
        raise RuntimeError(f"OpenAlex request failed with HTTP {exc.code}") from None
    except (URLError, TimeoutError) as exc:
        raise RuntimeError(f"OpenAlex request failed: {getattr(exc, 'reason', exc)}") from None


def work_affiliations(authorships):
    affiliations = set()
    for author in authorships:
        affiliations.update(author.get("raw_affiliation_strings") or [])
        affiliations.update(institution["display_name"] for institution in author.get("institutions", [])
                            if institution.get("display_name"))
    return sorted(affiliations)


def institution_evidence(affiliations, labels, normalize):
    evidence = {}
    for label, aliases in labels.items():
        patterns = [rf"\b{re.escape(normalize(alias))}\b" for alias in [label, *aliases]]
        matches = sorted(name for name in affiliations
                         if any(re.search(pattern, normalize(name)) for pattern in patterns))
        if matches:
            evidence[label] = matches
    return evidence


def paper_doi(row):
    doi = _normalize_doi(row.get("doi"))
    if not doi:
        for field in ("paper_url", "source_url"):
            url = str(row.get(field) or "")
            if re.match(r"https?://(?:dx\.)?doi\.org/", url, re.I):
                doi = _normalize_doi(url)
                break
    return doi


def _lookup_dois(dois, api_key, request):
    works = {}
    unrequested_dois = set()
    for start in range(0, len(dois), 100):
        batch = dois[start:start + 100]
        doi_filter = "|".join(f"https://doi.org/{doi}" for doi in batch)
        try:
            page = request({"filter": f"doi:{doi_filter}", "per_page": 100}, api_key)
        except OpenAlexRateLimitError as exc:
            return works, unrequested_dois, str(exc)
        if page["meta"]["count"] != len(page["results"]):
            raise RuntimeError("OpenAlex DOI batch returned an incomplete page")
        works.update({doi: [] for doi in batch})
        for work in page["results"]:
            doi = _normalize_doi(work.get("doi"))
            if doi not in batch:
                unrequested_dois.add(str(work.get("doi") or work["id"]))
            else:
                works[doi].append(work)
    return works, unrequested_dois, ""


def _author_name(value, normalize):
    surname, comma, given = str(value or "").partition(",")
    return normalize(f"{given} {surname}" if comma else surname)


def _title_key(row, normalize):
    years = tuple(sorted({int(row["year"]), int(row.get("publication_year") or row["year"])}))
    return years, normalize(row.get("title"))


def _lookup_title_batch(years, titles, api_key, normalize, request):
    years_filter = "|".join(str(year) for year in years)
    title_filter = "|".join(f'"{title}"' for title in titles)
    page = request({"filter": f"publication_year:{years_filter},title.search:{title_filter}",
                    "per_page": 100}, api_key)
    if page["meta"]["count"] > len(page["results"]):
        if len(titles) == 1:
            return {(years, titles[0]): None}
        middle = len(titles) // 2
        return {**_lookup_title_batch(years, titles[:middle], api_key, normalize, request),
                **_lookup_title_batch(years, titles[middle:], api_key, normalize, request)}
    works = {(years, title): [] for title in titles}
    for work in page["results"]:
        key = (years, normalize(work.get("title")))
        if key in works and work.get("publication_year") in years:
            works[key].append(work)
    return works


def _enrich(row, doi_works, title_works, normalize, retrieved_at):
    doi = paper_doi(row)
    method = "doi" if doi else "title_year_first_author"
    if doi:
        if doi not in doi_works:
            return {"openalex_status": "rate_limited"}
        matches = doi_works[doi]
    else:
        key = _title_key(row, normalize)
        author = str(row.get("authors") or "").split(";", 1)[0]
        if str(row.get("source_type") or "").startswith("dblp"):
            author = re.sub(r" \d{4}$", "", author)
        first_author = _author_name(author, normalize)
        if not key[1] or not first_author:
            return {"openalex_status": "missing_match_identifiers"}
        if key not in title_works:
            return {"openalex_status": "rate_limited"}
        works = title_works[key]
        if works is None:
            return {"openalex_status": "search_incomplete"}
        matches = [work for work in works
                   if (authors := work.get("authorships"))
                   and first_author in {
                       _author_name((authors[0].get("author") or {}).get("display_name"), normalize),
                       _author_name(authors[0].get("raw_author_name"), normalize),
                   }]
        if len(matches) > 1 and row.get("source_type") == "official_cvf_openaccess":
            conference = str(row.get("conference") or "").casefold()
            if conference in {"cvpr", "iccv"}:
                doi_pattern = rf"10\.1109/{conference}\d*\.{int(row['year'])}\."
                main = [work for work in matches if re.match(doi_pattern, _normalize_doi(work.get("doi")))]
                if len(main) == 1:
                    matches = main
                    method = "title_year_first_author_venue_doi"
        if len(matches) > 1 and row.get("source_type") == "official_ecva":
            publications = [work for work in matches if _normalize_doi(work.get("doi")).startswith("10.1007/")]
            if len(publications) == 1 and all(
                work is publications[0] or _normalize_doi(work.get("doi")).startswith("10.48550/arxiv.")
                for work in matches
            ):
                matches = publications
                method = "title_year_first_author_publisher"

    if len(matches) != 1:
        return {"openalex_status": "ambiguous" if matches else "unmatched"}
    work = matches[0]
    retrieved_at = work.get("_retrieved_at", retrieved_at)
    metadata = {
        "openalex_status": "matched", "openalex_url": work["id"], "openalex_match_method": method,
        "openalex_retrieved_at": retrieved_at, "cited_by_count": work.get("cited_by_count"),
        "openalex_affiliations": work_affiliations(work.get("authorships") or []),
    }
    index = work.get("abstract_inverted_index") or {}
    if not str(row.get("abstract") or "").strip() and index:
        tokens = sorted((position, word) for word, positions in index.items() for position in positions)
        metadata.update(abstract=" ".join(word for _, word in tokens), abstract_source="OpenAlex",
                        abstract_source_url=work["id"], abstract_retrieved_at=retrieved_at)
    return metadata


def enrich_rows(rows, api_key, normalize, utc_now, *, checkpoint=None):
    request = checkpoint.get if checkpoint else _get
    dois = sorted({doi for row in rows if (doi := paper_doi(row))})
    doi_works, unrequested_dois, rate_limit_error = _lookup_dois(dois, api_key, request)
    titles_by_year = defaultdict(set)
    for row in rows:
        if not paper_doi(row) and str(row.get("authors") or "").strip():
            years, title = _title_key(row, normalize)
            if title:
                titles_by_year[years].add(title)
    title_works = {}
    if not rate_limit_error:
        try:
            for years, titles in titles_by_year.items():
                ordered_titles = sorted(titles)
                for start in range(0, len(ordered_titles), 20):
                    title_works.update(_lookup_title_batch(
                        years, ordered_titles[start:start + 20], api_key, normalize, request,
                    ))
        except OpenAlexRateLimitError as exc:
            rate_limit_error = str(exc)
    for row in rows:
        row.update(_enrich(row, doi_works, title_works, normalize, utc_now()))
    return unrequested_dois, rate_limit_error
