#!/usr/bin/env python3
"""Configuration-driven, auditable multi-field research-topic retrieval."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from . import fetch_openreview_accepted as collector
from . import openalex_metadata
from . import paper_enrichment
from .query_target_papers import token_matches, tokenize


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SNAPSHOT_ROOT = PROJECT_ROOT / "output"

SEARCH_FIELDS = ("title", "abstract", "keywords", "tldr")
CANDIDATE_FIELDS = [
    "conference", "conference_display_name", "ccf_category", "ccf_type", "ccf_professional_field",
    "doi", "volume", "issue", "pages", "pdf_status", "pdf_local_path",
    "oa_status", "oa_pdf_url", "oa_landing_url", "oa_version", "year", "publication_year", "track",
    "title", "authors", "author_institutions",
    "abstract", "keywords", "tldr",
    "primary_area", "secondary_area", "topic", "openreview_id",
    "source_type", "source_record_id", "source_url", "openreview_url", "paper_url", "publisher_paper_url", "pdf_url",
    "matched_query_groups", "matched_terms", "matched_fields", "matched_snippets",
    "abstract_source", "abstract_source_url", "abstract_retrieved_at", "abstract_match_confidence",
    "cited_by_count", "openalex_status", "openalex_url", "openalex_match_method",
    "openalex_retrieved_at", "openalex_affiliations", "publisher_affiliations", "publisher_affiliations_url",
    "institution_tags", "institution_tag_evidence",
    "crossref_cited_by_count", "crossref_citations_retrieved_at",
    "crossref_citation_status", "crossref_citation_doi", "crossref_citation_match_method", "crossref_affiliations",
    "semantic_scholar_cited_by_count", "semantic_scholar_url", "semantic_scholar_retrieved_at",
    "preprint_doi", "preprint_openalex_url", "preprint_openalex_cited_by_count", "preprint_openalex_retrieved_at",
    "merged_openalex_url", "merged_openalex_cited_by_count", "merged_openalex_retrieved_at",
    "review_decision", "review_note",
]
SUMMARY_FIELDS = [
    "conference", "year", "query_group", "matched_field", "raw_match_count",
    "deduplicated_match_count",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_text(value: Any) -> str:
    """Normalize case, accents, punctuation, and hyphen/space variants."""
    if isinstance(value, (list, tuple, set)):
        value = "; ".join(str(item) for item in value)
    normalized = unicodedata.normalize("NFKD", str(value or "").casefold())
    normalized = "".join(c for c in normalized if not unicodedata.combining(c))
    return " ".join(re.findall(r"[a-z0-9]+", normalized))


def phrase_matches(text: Any, term: str) -> bool:
    """Match phrases with simple inflection support on every word."""
    return _phrase_tokens_match(tokenize(str(text or "")), tokenize(term))


def _phrase_tokens_match(text_tokens: list[str], term_tokens: list[str], *, exact: bool = False) -> bool:
    if not term_tokens:
        return False
    if exact:
        width = len(term_tokens)
        return any(text_tokens[index:index + width] == term_tokens
                   for index in range(len(text_tokens) - width + 1))
    first, *rest = term_tokens
    for index in range(len(text_tokens) - len(term_tokens) + 1):
        if token_matches(first, text_tokens[index]) and all(
            token_matches(wanted, text_tokens[index + offset])
            for offset, wanted in enumerate(rest, 1)
        ):
            return True
    return False


def phrase_match_spans(text: str, term: str, *, exact: bool = False) -> list[tuple[int, int]]:
    """Locate actual source spans using the same token rules as topic retrieval."""
    wanted = tokenize(term)
    if not wanted:
        return []
    normalized, positions = [], []
    for index, character in enumerate(text):
        for part in unicodedata.normalize("NFKD", character.casefold()):
            if not unicodedata.combining(part):
                normalized.append(part)
                positions.append(index)
    tokens = [(match.group(), positions[match.start()], positions[match.end() - 1] + 1)
              for match in re.finditer(r"[a-z0-9]+", "".join(normalized))]
    return [(tokens[index][1], tokens[index + len(wanted) - 1][2])
            for index in range(len(tokens) - len(wanted) + 1)
            if all((term_token == tokens[index + offset][0] if exact
                    else token_matches(term_token, tokens[index + offset][0]))
                   for offset, term_token in enumerate(wanted))]


def matched_snippet(text: Any, term: str, *, limit: int = 260, exact: bool = False) -> str:
    """Return a short source excerpt near a matched term without inventing text."""
    source = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(source) <= limit:
        return source
    spans = phrase_match_spans(source, term, exact=exact)
    center = spans[0][0] if spans else 0
    start = max(0, center - limit // 3)
    end = min(len(source), start + limit)
    prefix = "..." if start else ""
    suffix = "..." if end < len(source) else ""
    return prefix + source[start:end].strip() + suffix


def paper_identity(row: dict[str, Any]) -> str:
    """Apply the documented stable deduplication priority."""
    for field in ("openreview_id", "source_record_id", "doi"):
        value = str(row.get(field, "")).strip()
        if value:
            if field == "source_record_id":
                return f"{field}:{row.get('conference', '')}:{row.get('year', '')}:{value}"
            return f"{field}:{value}"
    return f"title:{normalize_text(row.get('title'))}:{row.get('year', '')}"


def find_matches(
    row: dict[str, Any], config: dict[str, Any]
) -> list[dict[str, str]]:
    """Return term/field evidence that passes each group's context rule."""
    fields = tuple(config.get("search_fields") or SEARCH_FIELDS)
    field_tokens = {field: tokenize(str(row.get(field) or "")) for field in fields}
    combined = [token for field in fields for token in field_tokens[field]]
    has_context = any(_phrase_tokens_match(combined, tokenize(term))
                      for term in config.get("context_anchors", []))
    evidence: list[dict[str, str]] = []
    for group_name, group in config["query_groups"].items():
        exact_terms = set(group.get("exact_terms", []))
        terms = [(term, tokenize(term), term in exact_terms) for term in group.get("terms", [])]
        standalone = set(group.get("standalone_terms", []))
        direct = bool(group.get("direct", False))
        group_hits: list[dict[str, str]] = []
        for field in fields:
            value = row.get(field, "")
            for term, term_tokens, exact in terms:
                if _phrase_tokens_match(field_tokens[field], term_tokens, exact=exact):
                    group_hits.append({
                        "group": group_name,
                        "term": term,
                        "field": field,
                        "snippet": matched_snippet(value, term, exact=exact),
                        **({"match_mode": "exact"} if exact else {}),
                    })
        if group_hits and (direct or has_context or any(hit["term"] in standalone for hit in group_hits)):
            evidence.extend(group_hits)
    unique: dict[tuple[str, str, str, str], dict[str, str]] = {}
    for item in evidence:
        unique[(item["group"], item["term"], item["field"], item["snippet"])] = item
    return list(unique.values())


def annotate_institutions(record: dict[str, Any], labels: dict[str, list[str]]) -> None:
    affiliations = set(record.get("openalex_affiliations", []))
    affiliations.update(record.get("crossref_affiliations", []))
    affiliations.update(record.get("publisher_affiliations", []))
    source_affiliations = str(record.get("author_institutions") or "").split(";")
    affiliations.update(name.strip() for name in source_affiliations if name.strip())
    tags = openalex_metadata.institution_evidence(affiliations, labels, normalize_text)
    record.update(institution_tags=list(tags), institution_tag_evidence=tags)


def search_papers(
    papers: Iterable[dict[str, Any]], config: dict[str, Any], *,
    screening: dict[tuple[str, str, str], tuple[str, str]] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Search, deduplicate, and merge every evidence item for each paper."""
    merged: dict[str, dict[str, Any]] = {}
    raw_evidence: list[dict[str, str]] = []
    for source in papers:
        row = dict(source)
        if screening is not None:
            decision, note = screening[screening_key(row)]
            if decision != "include":
                continue
            row.update(review_decision=decision, review_note=note)
        evidence = find_matches(row, config)
        if not evidence and screening is None:
            continue
        identity = paper_identity(row)
        record = merged.setdefault(identity, {**row, "_evidence": []})
        known = {
            (item["group"], item["term"], item["field"], item["snippet"])
            for item in record["_evidence"]
        }
        for item in evidence:
            keyed = {"conference": str(row.get("conference", "")), "year": str(row.get("year", "")), "paper_key": identity, **item}
            raw_evidence.append(keyed)
            key = (item["group"], item["term"], item["field"], item["snippet"])
            if key not in known:
                record["_evidence"].append(item)
                known.add(key)

    labels = config.get("institution_labels", {})
    candidates: list[dict[str, Any]] = []
    for record in merged.values():
        evidence = record.pop("_evidence")
        record["matched_query_groups"] = sorted({item["group"] for item in evidence})
        record["matched_terms"] = sorted({item["term"] for item in evidence})
        record["matched_fields"] = sorted({item["field"] for item in evidence})
        record["matched_snippets"] = [
            {"query_group": item["group"], "term": item["term"],
             "field": item["field"], "text": item["snippet"],
             **({"match_mode": item["match_mode"]} if "match_mode" in item else {})}
            for item in evidence
        ]
        if labels:
            annotate_institutions(record, labels)
        candidates.append(record)
    candidates.sort(key=lambda row: (
        str(row.get("conference", "")), normalize_text(row.get("title", "")),
        paper_identity(row),
    ))
    return candidates, raw_evidence


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _accepted_count(manifest: dict[str, Any]) -> int:
    counts = manifest.get("counts", {})
    return int(counts.get("accepted_paper_count", counts.get("openreview_current_accepted", 0)))


def _neurips_publication_key(row: dict[str, Any]) -> tuple[str, str]:
    return normalize_text(row["title"]), normalize_text(row["authors"].split(";", 1)[0])


def _link_neurips_publications(rows: list[dict], track: str, publications: dict) -> int:
    keys = Counter(_neurips_publication_key(row) for row in rows)
    titles = Counter(normalize_text(row["title"]) for row in rows)
    linked = 0
    for row in rows:
        key = _neurips_publication_key(row)
        possible = publications.get((track, key[0]), [])
        matches = [paper for paper in possible if _neurips_publication_key(paper) == key]
        if all(key) and len(matches) == keys[key] == 1:
            row["publisher_paper_url"] = matches[0]["paper_url"]
            linked += 1
        elif key[0] and not matches and len(possible) == titles[key[0]] == 1:
            published = possible[0]
            authors = {n for name in row["authors"].split(";") if (n := normalize_text(name))}
            published_authors = {n for name in published["authors"].split(";") if (n := normalize_text(name))}
            overlap = len(authors & published_authors)
            if len(authors) == len(published_authors) and overlap >= 2 and overlap * 2 > len(authors):
                row["publisher_paper_url"] = published["paper_url"]
                linked += 1
    return linked


def collect_snapshots(
    config: dict[str, Any], snapshot_root: Path
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, str], list[str]]:
    """Reuse valid accepted-paper snapshots and independently audit their rows."""
    papers: list[dict[str, Any]] = []
    snapshots: list[dict[str, Any]] = []
    errors: dict[str, str] = {}
    warnings: list[str] = []
    for target in config["targets"]:
        conference = collector.normalize_conference_argument(str(target["conference"]))
        year = collector.valid_year(str(target["year"]))
        key = f"{conference}-{year}"
        spec = collector.CONFERENCE_SPECS[conference]
        try:
            manifest, rows, rich_rows = collector.build_conference_outputs(
                snapshot_root.resolve(), spec=spec, year=year, page_size=1000,
                use_iclr_virtual=True, refresh=False, include_rows=True,
            )
            if not rows:
                raise RuntimeError("No public paper records available for this target")
            expected = _accepted_count(manifest)
            identities = [paper_identity(row) for row in rows]
            exact_venue = spec.venue_id(year)
            integrity = {
                "count_matches_manifest": len(rows) == expected,
                "paper_ids_present": all(
                    str(row.get("openreview_id") or row.get("source_record_id") or "").strip()
                    for row in rows
                ),
                "paper_ids_unique": len(identities) == len(set(identities)),
                "exact_venue_id_matches": (manifest.get("source_kind", spec.source_kind) != "openreview"
                                           or all(str(row.get("venueid", "")) == exact_venue for row in rows)),
            }
            if not all(integrity.values()):
                raise RuntimeError(f"Snapshot integrity check failed: {integrity}")
            if manifest.get("source_kind") in {"crossref_journal", "crossref_journal_print", "official_eccv_springer"}:
                # The original JSONL record retains Crossref citation and affiliation metadata.
                records_by_doi = {}
                for record in rich_rows:
                    source = record.get("source_record", {})
                    if source.get("DOI"):
                        records_by_doi[source["DOI"].casefold()] = source
                for row in rows:
                    source = records_by_doi.get(str(row.get("doi") or "").casefold(), {})
                    count = source.get("is-referenced-by-count")
                    if type(count) is int and count >= 0:
                        row["crossref_cited_by_count"] = count
                    affiliations = paper_enrichment.crossref_affiliations(source)
                    if affiliations:
                        row["crossref_affiliations"] = affiliations
                    if str(row.get("crossref_cited_by_count", "")).isdigit():
                        row["crossref_citations_retrieved_at"] = manifest.get("fetched_at_utc", "")
            manifest_path = Path(manifest["outputs"].get("manifest") or snapshot_root / str(year) / conference / "source_manifest.json")
            csv_path = Path(manifest["outputs"]["csv"])
            jsonl_path = Path(manifest["outputs"]["jsonl"])
            snapshots.append({
                "conference": conference, "year": year,
                "venue_id": manifest.get("venue_id", ""), "source_kind": manifest.get("source_kind", ""),
                "collection_scope": manifest.get("collection_scope", ""),
                "collection_status": manifest.get("collection_status", ""),
                "accepted_paper_count": len(rows), "fetched_at_utc": manifest.get("fetched_at_utc", ""),
                "source_manifest_path": str(manifest_path),
                "source_manifest_sha256": _sha256_file(manifest_path),
                "snapshot_csv_path": str(csv_path), "snapshot_csv_sha256": _sha256_file(csv_path),
                "snapshot_jsonl_path": str(jsonl_path), "snapshot_jsonl_sha256": _sha256_file(jsonl_path),
                "integrity": integrity,
            })
            if (config.get("include_neurips_tracks") and conference == "NIPS"
                    and year in {2023, 2024, 2025} and manifest.get("source_kind") == "openreview"):
                datasets = "Datasets and Benchmarks Track"
                suffix = "Track/Datasets_and_Benchmarks" if year == 2023 else "Datasets_and_Benchmarks_Track"
                track_specs = [(datasets, suffix)]
                if year == 2025:
                    track_specs.extend([("Position Paper Track", "Position_Paper_Track"),
                                        ("Creative AI Track", "Creative_AI_Track")])
                published_spec = replace(spec, source_kind="official_neurips")
                published_dir = "neurips-published-main" if year == 2025 else "neurips-published"
                published, published_rows, _ = collector.build_conference_outputs(
                    snapshot_root / published_dir, spec=published_spec, year=year, page_size=1000,
                    use_iclr_virtual=False, refresh=False, include_rows=True,
                )
                if (published.get("source_kind") != "official_neurips"
                        or len(published_rows) != _accepted_count(published)):
                    raise RuntimeError("NeurIPS proceedings snapshot failed its count or source check")
                published_by_track_title = defaultdict(list)
                for row in published_rows:
                    published_by_track_title[row["track"], normalize_text(row["title"])].append(row)
                published_manifest = Path(published["outputs"]["manifest"])
                snapshots[-1]["published_tracks"] = {
                    "counts": dict(Counter(row["track"] for row in published_rows)),
                    "source_manifest_path": str(published_manifest),
                    "source_manifest_sha256": _sha256_file(published_manifest),
                }
                track_snapshots = {}
                combined = list(rows)
                if year == 2025:
                    snapshots[-1]["primary_publisher_link_count"] = _link_neurips_publications(
                        combined, "Main Conference Track", published_by_track_title,
                    )
                for label, suffix in track_specs:
                    track_spec = replace(spec, venue_suffix=suffix)
                    track_manifest, track_rows, _ = collector.build_conference_outputs(
                        snapshot_root / "neurips-tracks" / suffix.replace("/", "-"), spec=track_spec,
                        year=year, page_size=1000, use_iclr_virtual=False, refresh=False, include_rows=True,
                    )
                    if (not track_rows or len(track_rows) != _accepted_count(track_manifest)
                            or any(row.get("venueid") != track_spec.venue_id(year) for row in track_rows)):
                        raise RuntimeError(f"NeurIPS {label} snapshot failed its count or venue check")
                    track_manifest_path = Path(track_manifest["outputs"]["manifest"])
                    track_rows = [{**row, "track": label} for row in track_rows]
                    linked = _link_neurips_publications(track_rows, label, published_by_track_title)
                    combined.extend(track_rows)
                    track_snapshots[label] = {
                        "accepted_paper_count": len(track_rows),
                        "publisher_link_count": linked,
                        "venue_id": track_spec.venue_id(year),
                        "source_manifest_path": str(track_manifest_path),
                        "source_manifest_sha256": _sha256_file(track_manifest_path),
                    }
                if len({paper_identity(row) for row in combined}) != len(combined):
                    raise RuntimeError("Duplicate paper identity across NeurIPS track snapshots")
                snapshots[-1].update(primary_paper_count=len(rows), accepted_paper_count=len(combined),
                                     openreview_tracks=track_snapshots)
                rows = combined
            if (config.get("include_neurips_tracks") and conference == "NIPS" and year == 2021
                    and manifest.get("source_kind") == "official_neurips"):
                track_spec = replace(spec, source_kind="official_neurips_2021_datasets")
                track, track_rows, _ = collector.build_conference_outputs(
                    snapshot_root / "neurips-tracks" / "2021-datasets", spec=track_spec,
                    year=year, page_size=1000, use_iclr_virtual=False, refresh=False, include_rows=True,
                )
                if track.get("source_kind") != track_spec.source_kind or len(track_rows) != 174:
                    raise RuntimeError("NeurIPS 2021 Datasets and Benchmarks snapshot failed its source or count check")
                track_path = Path(track["outputs"]["manifest"])
                snapshots[-1].update(
                    primary_paper_count=len(rows), accepted_paper_count=len(rows) + len(track_rows),
                    published_tracks={"counts": {"Datasets and Benchmarks Track": len(track_rows)},
                                      "source_manifest_path": str(track_path),
                                      "source_manifest_sha256": _sha256_file(track_path)},
                )
                rows = [*rows, *track_rows]
            papers.extend(rows)
            warnings.extend(f"{key}: {warning}" for warning in manifest.get("warnings", []))
        except (RuntimeError, OSError, KeyError, ValueError) as exc:
            raise RuntimeError(f"{key}: collection failed: {exc}") from exc
    return papers, snapshots, errors, warnings


def enrich_missing_candidate_abstracts(
    candidates: list[dict[str, Any]], snapshot_root: Path
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Use existing enrichment only for already-recalled candidates lacking abstracts."""
    missing = [row for row in candidates if not str(row.get("abstract", "")).strip()]
    if not missing:
        return candidates, {}
    enriched, failures = paper_enrichment.enrich_abstracts(missing, snapshot_root, refresh=False)
    by_key = {paper_identity(row): row for row in enriched}
    return [by_key.get(paper_identity(row), row) for row in candidates], failures


def load_cvf_program_abstracts(papers: Iterable[dict[str, Any]]) -> dict[str, str]:
    """Join bulk conference abstracts to proceedings by an unambiguous title."""
    by_venue = defaultdict(list)
    errors = {}
    for row in papers:
        conference, year = row["conference"], int(row["year"])
        if ((conference == "CVPR" and year >= 2023) or (conference == "ICCV" and year >= 2025)):
            by_venue[(conference, year)].append(row)
    for (conference, year), rows in by_venue.items():
        missing = [row for row in rows if not str(row.get("abstract") or "").strip()]
        if not missing:
            continue
        event = conference.lower()
        url = f"https://{event}.thecvf.com/static/virtual/data/{event}-{year}-orals-posters.json"
        try:
            raw, _ = collector.request_bytes(url, timeout=30, retries=1)
        except RuntimeError as exc:
            errors[f"{conference}-{year}"] = str(exc)
            continue
        data = json.loads(raw)
        entries = data["results"]
        if entries and all("abstract" not in entry for entry in entries):
            errors[f"{conference}-{year}"] = f"Official CVF program does not provide abstract fields: {url}"
            continue
        if data.get("next") or data["count"] != len(entries):
            raise RuntimeError(f"Incomplete official CVF program: {url}")
        abstracts = defaultdict(set)
        for entry in entries:
            title = normalize_text(entry["name"])
            abstract = entry["abstract"].strip()
            if title and abstract:
                abstracts[title].add(abstract)
        title_counts = defaultdict(int)
        for row in rows:
            title_counts[normalize_text(paper_enrichment.cvf_title_text(row["title"]))] += 1
        retrieved = utc_now()
        for row in missing:
            key = normalize_text(paper_enrichment.cvf_title_text(row["title"]))
            choices = abstracts[key]
            if title_counts[key] == 1 and len(choices) == 1:
                row.update(abstract=next(iter(choices)), abstract_source="CVF program",
                           abstract_source_url=url, abstract_retrieved_at=retrieved)
    return errors


def load_iclr2020_program_abstracts(papers: Iterable[dict[str, Any]]) -> dict[str, str]:
    rows = [row for row in papers if row.get("source_type") == "official_iclr_program"
            and str(row["year"]) == "2020"]
    missing = [row for row in rows if not str(row.get("abstract") or "").strip()]
    if not missing:
        return {}
    url = "https://iclr.cc/static/virtual/data/iclr-2020-orals-posters.json"
    try:
        raw, _ = collector.request_bytes(url, timeout=30, retries=1)
    except RuntimeError as exc:
        return {"ICLR-2020": str(exc)}
    data = json.loads(raw)
    entries = data["results"]
    if data.get("next") or len(entries) != data["count"] or len(entries) != 687:
        raise RuntimeError(f"Incomplete official ICLR 2020 program: {url}")
    by_title = defaultdict(list)
    for entry in entries:
        by_title[normalize_text(entry["name"])].append(entry)
    title_counts = Counter(normalize_text(row["title"]) for row in rows)
    retrieved = utc_now()
    for row in missing:
        key = normalize_text(row["title"])
        matches = by_title[key]
        if not key or len(matches) != 1 or title_counts[key] != 1:
            continue
        entry = matches[0]
        names = {normalize_text(name) for name in row["authors"].split(";")} - {""}
        program_names = {normalize_text(author["fullname"]) for author in entry["authors"]} - {""}
        common = len(names & program_names)
        if common >= min(2, len(names)) and common * 2 > max(len(names), len(program_names)):
            abstract = (entry.get("abstract") or "").strip()
            if abstract:
                row.update(abstract=abstract, abstract_source="ICLR 2020 program",
                           abstract_source_url=url, abstract_retrieved_at=retrieved)
    return {}


def load_neurips_program_abstracts(papers: Iterable[dict[str, Any]]) -> dict[str, str]:
    """Join virtual program abstracts to the corresponding published papers."""
    by_year = defaultdict(list)
    for row in papers:
        if row.get("source_type") == "official_neurips" and int(row["year"]) in {2020, 2021, 2022}:
            by_year[int(row["year"])].append(row)
    errors = {}
    for year, rows in by_year.items():
        missing = [row for row in rows if not str(row.get("abstract") or "").strip()]
        if not missing:
            continue
        url = f"https://neurips.cc/static/virtual/data/neurips-{year}-orals-posters.json"
        try:
            raw, _ = collector.request_bytes(url, timeout=30, retries=1)
        except RuntimeError as exc:
            errors[f"NIPS-{year}"] = str(exc)
            continue
        data = json.loads(raw)
        entries = data["results"]
        if data.get("next") or data["count"] != len(entries):
            raise RuntimeError(f"Incomplete official NeurIPS program: {url}")
        abstracts = defaultdict(set)
        for entry in entries:
            abstract = (entry.get("abstract") or "").strip()
            if not abstract:
                continue
            title = normalize_text(entry["name"])
            if year == 2022:
                author = normalize_text(entry["authors"][0]["fullname"]) if entry.get("authors") else ""
                if title and author:
                    abstracts[title, author].add(abstract)
            else:
                abstracts[entry["uid"], title].add(abstract)
        publication_keys = Counter(_neurips_publication_key(row) for row in rows) if year == 2022 else {}
        retrieved = utc_now()
        for row in missing:
            if year == 2022:
                key = _neurips_publication_key(row)
                if publication_keys[key] != 1:
                    continue
            else:
                identifier = re.search(r"/hash/([0-9a-f]{32})-", row["source_record_id"])
                if not identifier:
                    raise ValueError(f"Invalid NeurIPS proceedings ID: {row['source_record_id']}")
                key = identifier[1], normalize_text(row["title"])
            choices = abstracts[key]
            if len(choices) == 1:
                row.update(abstract=next(iter(choices)), abstract_source="NeurIPS program",
                           abstract_source_url=url, abstract_retrieved_at=retrieved)
    return errors


def load_crossref_print_metadata(papers: Iterable[dict[str, Any]], snapshot_root: Path) -> dict[str, str]:
    from .fetch_venue_metadata import crossref_rows

    issns = {"J_IJCV": ("0920-5691", "1573-1405"), "J_TPAMI": ("0162-8828", "1939-3539")}
    by_edition = defaultdict(list)
    for row in papers:
        if row.get("conference") in issns and str(row.get("source_type", "")).startswith("dblp"):
            by_edition[row["conference"], int(row["year"])].append(row)
    errors = {}
    for (conference, year), rows in by_edition.items():
        spec = replace(collector.CONFERENCE_SPECS[conference], issns=issns[conference])
        raw_dir = snapshot_root / "enrichment" / "crossref-print" / conference / str(year)
        try:
            fetched, rich, sources, _ = crossref_rows(spec, year, raw_dir, print_publication=True)
        except RuntimeError as exc:
            errors[f"{conference}-{year}"] = str(exc)
            continue
        by_doi = {row["doi"]: (row, data["source_record"]) for row, data in zip(fetched, rich, strict=True)}
        retrieved = utc_now()
        for row in rows:
            doi = openalex_metadata.paper_doi(row)
            if doi not in by_doi:
                continue
            registration, record = by_doi[doi]
            if registration.get("abstract") and not str(row.get("abstract") or "").strip():
                row.update(abstract=registration["abstract"], abstract_source="Crossref print metadata",
                           abstract_source_url=sources[0], abstract_retrieved_at=retrieved)
            count = registration.get("crossref_cited_by_count")
            if type(count) is int and count >= 0 and not str(row.get("crossref_cited_by_count", "")).isdigit():
                row.update(crossref_cited_by_count=count, crossref_citations_retrieved_at=retrieved,
                           crossref_citation_doi=doi, crossref_citation_match_method="doi",
                           crossref_citation_status="snapshot",
                           crossref_affiliations=paper_enrichment.crossref_affiliations(record))
    return errors


def build_query_summary(raw_evidence: list[dict[str, str]], config: dict | None = None) -> list[dict[str, Any]]:
    raw_counts: dict[tuple[str, str, str, str], int] = defaultdict(int)
    papers: dict[tuple[str, str, str, str], set[str]] = defaultdict(set)
    if config:
        for target in config["targets"]:
            for group in config["query_groups"]:
                for field in config.get("search_fields", SEARCH_FIELDS):
                    key = (collector.normalize_conference_argument(target["conference"]), str(target["year"]), group, field)
                    raw_counts[key] = 0
    for item in raw_evidence:
        key = (item["conference"], item["year"], item["group"], item["field"])
        raw_counts[key] += 1
        papers[key].add(item["paper_key"])
    return [
        {"conference": key[0], "year": key[1], "query_group": key[2], "matched_field": key[3],
         "raw_match_count": raw_counts[key], "deduplicated_match_count": len(papers[key])}
        for key in sorted(raw_counts)
    ]


def _csv_value(value: Any) -> Any:
    return json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, (list, dict)) else value


def write_candidate_files(output_dir: Path, candidates: list[dict[str, Any]]) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "candidate_papers.csv"
    jsonl_path = output_dir / "candidate_papers.jsonl"
    csv_rows = [{field: _csv_value(row.get(field, "")) for field in CANDIDATE_FIELDS} for row in candidates]
    collector.write_csv(csv_path, csv_rows, CANDIDATE_FIELDS)
    collector.write_jsonl(jsonl_path, [{field: row.get(field, "") for field in CANDIDATE_FIELDS} for row in candidates])
    return csv_path, jsonl_path


def screening_key(row: dict[str, Any]) -> tuple[str, str, str]:
    return row["conference"], str(row["year"]), paper_identity(row)


def reuse_crossref_citations(candidates: list[dict], path: Path) -> int:
    """Reuse completed lookups from a previous candidate JSONL export."""
    previous = {}
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            if str(row.get("crossref_cited_by_count", "")).isdigit():
                key = screening_key(row)
                if key in previous:
                    raise ValueError(f"Duplicate Crossref snapshot record: {key}")
                previous[key] = row
    reused = 0
    for candidate in candidates:
        row = previous.get(screening_key(candidate))
        if row is None or str(candidate.get("crossref_cited_by_count", "")).isdigit():
            continue
        if any(candidate.get(field, "") != row.get(field, "")
               for field in ("title", "authors", "doi", "publisher_paper_url")):
            continue
        candidate.update({field: value for field, value in row.items() if field.startswith("crossref_")})
        reused += 1
    return reused


def read_screening(path: Path, papers: list[dict[str, Any]]) -> dict[tuple[str, str, str], tuple[str, str]]:
    source = {screening_key(row): row for row in papers}
    if len(source) != len(papers):
        raise ValueError("Duplicate source identifiers in screening scope")
    decisions = {}
    required = {"conference", "year", "paper_key", "title", "doi", "review_decision", "review_note"}
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("Screening CSV is missing required columns")
        for row in reader:
            key = row["conference"], row["year"], row["paper_key"]
            paper = source.get(key)
            if paper is None or key in decisions:
                raise ValueError(f"Unknown or duplicate screening record at line {reader.line_num}: {key}")
            if any(row[field] != str(paper.get(field) or "") for field in ("title", "doi")):
                raise ValueError(f"Screening title or DOI differs from snapshot at line {reader.line_num}: {key}")
            decision = (row["review_decision"] or "").strip().casefold()
            if decision not in {"", "include", "exclude"}:
                raise ValueError(f"Invalid screening decision at line {reader.line_num}: {decision}")
            decisions[key] = (decision, row["review_note"] or "")
    return {key: decisions.get(key, ("", "")) for key in source}


def write_screening_csv(
    path: Path, papers: list[dict[str, Any]], candidates: list[dict[str, Any]],
    *, screening: dict[tuple[str, str, str], tuple[str, str]] | None = None,
    config: dict[str, Any] | None = None,
) -> Path:
    """Export the complete source set for relevance review."""
    if screening is not None and config is None:
        raise ValueError("Screening export with decisions requires the query configuration")
    fields = ["conference", "year", "track", "paper_key", "doi", "title", "authors", "abstract",
              "abstract_source", "openalex_status", "paper_url", "keyword_hit", "matched_query_groups", "matched_terms",
              "review_decision", "review_note"]
    matches = {screening_key(row): row for row in candidates}
    rows = []
    for paper in papers:
        key = screening_key(paper)
        match = matches.get(key)
        row = {**paper, **(match or {}), "paper_key": key[2]}
        if screening is not None and match is None:
            evidence = find_matches(paper, config)
            row["matched_query_groups"] = sorted({item["group"] for item in evidence})
            row["matched_terms"] = sorted({item["term"] for item in evidence})
        decision, note = screening[key] if screening is not None else ("", "")
        row.update(keyword_hit="yes" if row.get("matched_terms") else "no",
                   review_decision=decision, review_note=note)
        rows.append({field: _csv_value(row.get(field, "")) for field in fields})
    collector.write_csv(path, rows, fields)
    return path


def _git_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT, check=True,
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def write_readme(output_dir: Path, config: dict[str, Any], command: str, *,
                 review_counts: dict[str, int] | None = None) -> Path:
    groups = "\n".join(f"- `{name}`" for name in config["query_groups"])
    targets = ", ".join(f"{target['conference']} {target['year']}" for target in config["targets"])
    fields = ", ".join(f"`{field}`" for field in (config.get("search_fields") or SEARCH_FIELDS))
    path = output_dir / "README.md"
    description = (
        "# Papers selected by screening decisions\n\n"
        f"Source records: {review_counts.get('include', 0)} included, "
        f"{review_counts.get('exclude', 0)} excluded, {review_counts.get('pending', 0)} pending. "
        "The output contains the included papers. Keyword evidence is retained where available."
        if review_counts is not None else
        "# Research-topic keyword candidates\n\n"
        "This dataset is an automatically retrieved keyword candidate set. "
        "It has **not** undergone semantic relevance review, method classification, or RCA analysis."
    )
    path.write_text(
        f"{description}\n\n"
        f"## Data source\n\n{targets}, "
        "using the repository's validated local snapshot/cache logic.\n\n"
        f"## Search fields\n\n{fields}.\n\n"
        f"## Query groups\n\n{groups}\n\n"
        f"## Run command\n\n```text\n{command}\n```\n\n"
        "## Outputs\n\n- `candidate_papers.csv`\n- `candidate_papers.jsonl`\n"
        "- `query_summary.csv`\n- `run_manifest.json`\n",
        encoding="utf-8",
    )
    return path


def run_pipeline(config_path: Path, output_dir: Path, snapshot_root: Path, *,
                 enrich_openalex: bool = False, scan_openalex_abstracts: bool = False,
                 export_screening: bool = False, openalex_checkpoint: Path | None = None,
                 screening_decisions: Path | None = None, scan_official_abstracts: bool = False,
                 enrich_crossref: bool = False, aaai_oai_resumption_token: str = "",
                 crossref_citations_from: Path | None = None,
                 enrich_preprint_citations: bool = False,
                 enrich_semantic_scholar: bool = False) -> dict[str, Any]:
    started = utc_now()
    if export_screening and (output_dir / "screening.csv").exists():
        raise FileExistsError(f"Screening file already exists: {output_dir / 'screening.csv'}")
    config_bytes = config_path.read_bytes()
    config = json.loads(config_bytes)
    from .paper_search import expand_targets, validate_config
    validate_config(config)
    config = {**config, "targets": expand_targets(config)}
    if scan_openalex_abstracts and not enrich_openalex:
        raise ValueError("--scan-openalex-abstracts requires --enrich-openalex")
    if aaai_oai_resumption_token and not scan_official_abstracts:
        raise ValueError("--aaai-oai-resumption-token requires --scan-official-abstracts")
    if crossref_citations_from is not None and not enrich_crossref:
        raise ValueError("--crossref-citations-from requires --enrich-crossref-citations")
    if openalex_checkpoint is not None and not enrich_openalex:
        raise ValueError("--openalex-checkpoint requires --enrich-openalex")
    checkpoint = (openalex_metadata.OpenAlexCheckpoint(openalex_checkpoint, utc_now)
                  if openalex_checkpoint is not None else None)
    api_key = os.environ.get("OPENALEX_API_KEY", "").strip() if enrich_openalex else ""
    papers, snapshots, collection_errors, warnings = collect_snapshots(config, snapshot_root)
    screening = read_screening(screening_decisions, papers) if screening_decisions is not None else None
    review_counts = Counter(decision or "pending" for decision, _ in screening.values()) if screening is not None else {}
    papers = paper_enrichment.load_cached_abstracts(papers, snapshot_root)
    cvf_program_errors = {}
    neurips_program_errors = {}
    iclr_program_errors = {}
    crossref_print_errors = {}
    official_abstract_errors = {}
    aaai_oai_scan = {}
    aaai_affiliation_errors = {}
    openalex_unrequested_dois = set()
    openalex_rate_limit_error = ""
    if scan_openalex_abstracts or scan_official_abstracts:
        cvf_program_errors = load_cvf_program_abstracts(papers)
        neurips_program_errors = load_neurips_program_abstracts(papers)
        iclr_program_errors = load_iclr2020_program_abstracts(papers)
    if scan_official_abstracts:
        crossref_print_errors = load_crossref_print_metadata(papers, snapshot_root)
        aaai_oai_scan = paper_enrichment.scan_aaai_oai_abstracts(
            papers, snapshot_root, resumption_token=aaai_oai_resumption_token,
        )
        if aaai_oai_scan["matched"]:
            papers = paper_enrichment.load_cached_abstracts(papers, snapshot_root)
        missing = [row for row in papers if not str(row.get("abstract") or "").strip()
                   and not (row["conference"] == "AAAI" and aaai_oai_scan.get("resumption_token"))
                   and paper_enrichment.official_abstract_source(row)]
        by_key = {}
        for start in range(0, len(missing), 50):
            enriched, failures = paper_enrichment.enrich_abstracts(
                missing[start:start + 50], snapshot_root, use_external_source=False,
            )
            by_key.update((screening_key(row), row) for row in enriched)
            official_abstract_errors.update(failures)
        papers = [by_key.get(screening_key(row), row) for row in papers]
    if scan_openalex_abstracts:
        missing = [row for row in papers if not str(row.get("abstract") or "").strip()]
        unrequested, openalex_rate_limit_error = openalex_metadata.enrich_rows(
            missing, api_key, normalize_text, utc_now, checkpoint=checkpoint,
        )
        openalex_unrequested_dois.update(unrequested)
    missing_abstracts = defaultdict(int)
    rate_limited_abstracts = defaultdict(int)
    for paper in papers:
        if not str(paper.get("abstract") or "").strip():
            key = (paper["conference"], str(paper["year"]))
            missing_abstracts[key] += 1
            if paper.get("openalex_status") == "rate_limited":
                rate_limited_abstracts[key] += 1
    for snapshot in snapshots:
        key = (snapshot["conference"], str(snapshot["year"]))
        snapshot["missing_abstracts_before_search"] = missing_abstracts[key]
        snapshot["openalex_abstract_scan_rate_limited"] = rate_limited_abstracts[key]
    initial_candidates, initial_evidence = search_papers(papers, config, screening=screening)
    candidates, abstract_errors = enrich_missing_candidate_abstracts(initial_candidates, snapshot_root)
    if scan_official_abstracts:
        aaai_affiliation_errors = paper_enrichment.enrich_aaai_candidate_affiliations(candidates, snapshot_root)
    # Re-run matching so newly enriched abstracts contribute auditable evidence.
    candidates, raw_evidence = search_papers(candidates, config, screening=screening)
    if enrich_openalex:
        pending = [row for row in candidates if not row.get("openalex_status")]
        if openalex_rate_limit_error:
            for row in pending:
                row["openalex_status"] = "rate_limited"
        else:
            unrequested, openalex_rate_limit_error = openalex_metadata.enrich_rows(
                pending, api_key, normalize_text, utc_now, checkpoint=checkpoint,
            )
            openalex_unrequested_dois.update(unrequested)
        candidates, raw_evidence = search_papers(candidates, config, screening=screening)
    crossref_reused = (reuse_crossref_citations(candidates, crossref_citations_from)
                       if crossref_citations_from is not None else 0)
    crossref_errors = paper_enrichment.enrich_crossref_citations(candidates) if enrich_crossref else {}
    if enrich_semantic_scholar:
        paper_enrichment.enrich_semantic_scholar_citations(candidates)
    preprint_errors = {}
    if enrich_preprint_citations:
        for candidate in candidates:
            try:
                paper_enrichment.enrich_cvf_preprint_citation(candidate)
            except RuntimeError as exc:
                preprint_errors[paper_identity(candidate)] = str(exc)
                if str(exc).startswith("HTTP 429 "):
                    break
    if enrich_crossref and config.get("institution_labels"):
        for candidate in candidates:
            annotate_institutions(candidate, config["institution_labels"])
    summary = build_query_summary(raw_evidence, config)
    csv_path, jsonl_path = write_candidate_files(output_dir, candidates)
    summary_path = output_dir / "query_summary.csv"
    collector.write_csv(summary_path, summary, SUMMARY_FIELDS)
    screening_path = (write_screening_csv(output_dir / "screening.csv", papers, candidates,
                                          screening=screening, config=config)
                      if export_screening else None)
    command = shlex.join([sys.executable, "-m", "code.query_research_topic",
                          "--config", str(config_path.resolve()),
                          "--output-dir", str(output_dir.resolve()),
                          "--snapshot-output-root", str(snapshot_root.resolve()),
                          *(["--enrich-openalex"] if enrich_openalex else []),
                          *(["--enrich-crossref-citations"] if enrich_crossref else []),
                          *(["--enrich-semantic-scholar-citations"] if enrich_semantic_scholar else []),
                          *(["--enrich-preprint-citations"] if enrich_preprint_citations else []),
                          *(["--crossref-citations-from", str(crossref_citations_from.resolve())]
                            if crossref_citations_from is not None else []),
                          *(["--scan-openalex-abstracts"] if scan_openalex_abstracts else []),
                          *(["--scan-official-abstracts"] if scan_official_abstracts else []),
                          *(["--aaai-oai-resumption-token", aaai_oai_resumption_token]
                            if aaai_oai_resumption_token else []),
                          *(["--export-screening"] if export_screening else []),
                          *(["--screening-decisions", str(screening_decisions.resolve())]
                            if screening_decisions is not None else []),
                          *(["--openalex-checkpoint", str(openalex_checkpoint.resolve())]
                            if openalex_checkpoint is not None else [])])
    readme_path = write_readme(output_dir, config, command,
                               review_counts=dict(review_counts) if screening is not None else None)
    manifest = {
        "started_at_utc": started, "completed_at_utc": utc_now(), "git_commit": _git_commit(),
        "config_path": str(config_path.resolve()), "config_sha256": hashlib.sha256(config_bytes).hexdigest(),
        "input_conferences": config["targets"], "snapshots": snapshots,
        "accepted_paper_counts": {f"{item['conference']}-{item['year']}": item["accepted_paper_count"] for item in snapshots},
        "initial_raw_match_count": len(initial_evidence),
        "initial_candidate_count": len(initial_candidates),
        "deduplicated_candidate_count": len(candidates),
        "screening_decisions_path": str(screening_decisions.resolve()) if screening_decisions is not None else "",
        "screening_decision_counts": dict(review_counts),
        "missing_abstract_count": sum(not str(row.get("abstract", "")).strip() for row in candidates),
        "collection_errors": collection_errors, "abstract_enrichment_errors": abstract_errors,
        "openalex_enrichment_enabled": enrich_openalex,
        "openalex_abstract_scan_enabled": scan_openalex_abstracts,
        "official_abstract_scan_enabled": scan_official_abstracts,
        "official_abstract_scan_errors": official_abstract_errors,
        "aaai_oai_scan": aaai_oai_scan,
        "aaai_affiliation_errors": aaai_affiliation_errors,
        "cvf_program_abstract_errors": cvf_program_errors,
        "neurips_program_abstract_errors": neurips_program_errors,
        "iclr_program_abstract_errors": iclr_program_errors,
        "crossref_print_metadata_errors": crossref_print_errors,
        "openalex_unrequested_dois": sorted(openalex_unrequested_dois),
        "openalex_rate_limit_error": openalex_rate_limit_error,
        "crossref_citation_errors": crossref_errors,
        "preprint_citation_errors": preprint_errors,
        "preprint_citation_count": sum(str(row.get("preprint_openalex_cited_by_count", "")).isdigit()
                                       for row in candidates),
        "crossref_citation_reuse": {"path": str(crossref_citations_from.resolve()), "count": crossref_reused}
        if crossref_citations_from is not None else {},
        "crossref_citation_status_counts": dict(sorted(Counter(
            row["crossref_citation_status"] for row in candidates
        ).items())) if enrich_crossref else {},
        "openalex_checkpoint": str(openalex_checkpoint.resolve()) if openalex_checkpoint is not None else "",
        "openalex_status_counts": dict(sorted(Counter(row["openalex_status"] for row in candidates).items()))
        if enrich_openalex else {},
        "warnings": warnings, "command": command,
        "outputs": {"csv": str(csv_path), "jsonl": str(jsonl_path),
                    "query_summary": str(summary_path), "readme": str(readme_path),
                    **({"screening": str(screening_path)} if screening_path else {})},
    }
    manifest_path = output_dir / "run_manifest.json"
    collector.write_json(manifest_path, manifest)
    manifest["outputs"]["manifest"] = str(manifest_path)
    return manifest


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="High-recall multi-field research-topic retrieval")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--snapshot-output-root", type=Path, default=DEFAULT_SNAPSHOT_ROOT)
    parser.add_argument("--enrich-openalex", action="store_true",
                        help="Annotate candidates with OpenAlex citations and publication affiliations")
    parser.add_argument("--enrich-crossref-citations", action="store_true",
                        help="Add independently labeled Crossref citation counts to candidates")
    parser.add_argument("--enrich-semantic-scholar-citations", action="store_true",
                        help="Fill citation gaps using DOI- or DBLP-verified Semantic Scholar matches")
    parser.add_argument("--enrich-preprint-citations", action="store_true",
                        help="Add separate OpenAlex citation counts for CVF-linked arXiv preprints")
    parser.add_argument("--crossref-citations-from", type=Path,
                        help="Reuse completed citation lookups from a prior candidate_papers.jsonl")
    parser.add_argument("--scan-openalex-abstracts", action="store_true",
                        help="Look up missing abstracts across snapshots before keyword matching")
    parser.add_argument("--scan-official-abstracts", action="store_true",
                        help="Fetch missing abstracts from supported publication sources before keyword matching")
    parser.add_argument("--aaai-oai-resumption-token", default="",
                        help="Resume interrupted AAAI pagination with the same configuration and snapshot root")
    parser.add_argument("--export-screening", action="store_true",
                        help="Export all source records, including keyword misses, for relevance review")
    parser.add_argument("--screening-decisions", type=Path,
                        help="Export papers marked include in a reviewed screening CSV")
    parser.add_argument("--openalex-checkpoint", type=Path,
                        help="Resume identical OpenAlex requests from a SQLite checkpoint")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        manifest = run_pipeline(args.config.resolve(), args.output_dir.resolve(),
                                args.snapshot_output_root.resolve(), enrich_openalex=args.enrich_openalex,
                                scan_openalex_abstracts=args.scan_openalex_abstracts,
                                export_screening=args.export_screening, openalex_checkpoint=args.openalex_checkpoint,
                                screening_decisions=args.screening_decisions,
                                scan_official_abstracts=args.scan_official_abstracts,
                                enrich_crossref=args.enrich_crossref_citations,
                                enrich_semantic_scholar=args.enrich_semantic_scholar_citations,
                                enrich_preprint_citations=args.enrich_preprint_citations,
                                aaai_oai_resumption_token=args.aaai_oai_resumption_token,
                                crossref_citations_from=args.crossref_citations_from)
    except (OSError, ValueError, RuntimeError, argparse.ArgumentTypeError) as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 1 if (manifest["collection_errors"] or manifest["openalex_rate_limit_error"]
                 or manifest["crossref_citation_errors"]
                 or manifest["preprint_citation_errors"]
                 or manifest["aaai_oai_scan"].get("resumption_token")
                 or manifest["official_abstract_scan_errors"]
                 or manifest["screening_decision_counts"].get("pending")) else 0


if __name__ == "__main__":
    raise SystemExit(main())
