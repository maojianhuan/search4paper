"""Editable batch runner and unit tests for ``fetch_openreview_accepted``.

Run this file directly to download every currently accepted paper for the
conference/year pairs in ``DEFAULT_TARGETS``.  Run the unit tests separately:

    python -m unittest test_fetch_openreview_accepted.py
"""

import json
import tempfile
import unittest
from http.client import IncompleteRead
from pathlib import Path
from unittest.mock import patch


# ---------------------------------------------------------------------------
# User-editable batch settings
# ---------------------------------------------------------------------------
# Add, remove, or edit a conference/year pair here.  Supported conference
# values: ICLR, ICML, NIPS (or NEURIPS), AAAI, ACL, CVPR, ICCV, WWW, RTSS,
# SIGKDD (or KDD), ICDE, and VLDB. OpenReview venues use a live accepted set.
# Other venues first try their official public paper source and use DBLP only
# when that source is not yet public or cannot be parsed safely.
DEFAULT_TARGETS = (
    {"conference": "ICML", "year": 2026},
    {"conference": "ICLR", "year": 2026},
    {"conference": "NIPS", "year": 2025},
    {"conference": "ICML", "year": 2025},
    {"conference": "ICLR", "year": 2025},
)

# Output is organized as OUTPUT_ROOT/<year>/<conference>/.  This matches the
# fetcher's own default so direct and batch runs share the same local cache.
OUTPUT_ROOT = Path(__file__).resolve().parent / "output"

# OpenReview currently permits up to 1,000 notes per page.
PAGE_SIZE = 1000

# Set False to skip the optional ICLR Virtual metadata enrichment.
USE_ICLR_VIRTUAL = True

# Keep False to reuse a complete local snapshot for the same conference/year.
# Set True only when you intentionally want to query OpenReview again.
REFRESH_EXISTING = False

from code import fetch_openreview_accepted as crawler


def collection_arguments(target: dict[str, object]) -> list[str]:
    """Build crawler command-line arguments for one editable target."""
    arguments = [
        "--conference",
        str(target["conference"]),
        "--year",
        str(target["year"]),
        "--output-dir",
        str(OUTPUT_ROOT),
        "--page-size",
        str(PAGE_SIZE),
    ]
    if not USE_ICLR_VIRTUAL:
        arguments.append("--no-iclr-virtual")
    if REFRESH_EXISTING:
        arguments.append("--refresh")
    return arguments


def run_default_collection() -> int:
    """Download every paper for each conference/year pair at the top of file."""
    statuses: list[dict[str, object]] = []
    for target in DEFAULT_TARGETS:
        exit_code = crawler.main(collection_arguments(target))
        statuses.append({**target, "exit_code": exit_code})

    print(
        json.dumps(
            {
                "output_root": str(OUTPUT_ROOT.resolve()),
                "targets": statuses,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 1 if any(status["exit_code"] for status in statuses) else 0


class ConferenceConfigurationTests(unittest.TestCase):
    def test_default_targets(self):
        self.assertGreater(len(DEFAULT_TARGETS), 0)
        self.assertIn(
            {"conference": "ICLR", "year": 2026},
            DEFAULT_TARGETS,
        )
        self.assertIn(
            {"conference": "NIPS", "year": 2025},
            DEFAULT_TARGETS,
        )
        for target in DEFAULT_TARGETS:
            self.assertNotEqual(
                crawler.normalize_conference_argument(str(target["conference"])),
                "ALL",
            )
            self.assertIsInstance(crawler.valid_year(str(target["year"])), int)

    def test_collection_arguments(self):
        arguments = collection_arguments({"conference": "ICLR", "year": 2026})
        self.assertIn("ICLR", arguments)
        self.assertIn("2026", arguments)
        self.assertIn(str(OUTPUT_ROOT), arguments)
        self.assertNotIn("--refresh", arguments)

    def test_refresh_argument(self):
        with patch(__name__ + ".REFRESH_EXISTING", True):
            arguments = collection_arguments(
                {"conference": "ICLR", "year": 2026}
            )
        self.assertIn("--refresh", arguments)

    def test_venue_ids(self):
        self.assertEqual(
            crawler.CONFERENCE_SPECS["ICLR"].venue_id(2026),
            "ICLR.cc/2026/Conference",
        )
        self.assertEqual(
            crawler.CONFERENCE_SPECS["ICML"].venue_id(2025),
            "ICML.cc/2025/Conference",
        )
        self.assertEqual(
            crawler.CONFERENCE_SPECS["NIPS"].venue_id(2024),
            "NeurIPS.cc/2024/Conference",
        )

    def test_aliases(self):
        self.assertEqual(crawler.normalize_conference_argument("nips"), "NIPS")
        self.assertEqual(crawler.normalize_conference_argument("NeurIPS"), "NIPS")
        self.assertEqual(crawler.normalize_conference_argument("all"), "ALL")
        self.assertEqual(crawler.normalize_conference_argument("kdd"), "SIGKDD")

    def test_added_proceedings_conferences_are_configured(self):
        for conference in (
            "AAAI", "ACL", "CVPR", "ICCV", "RTSS", "SIGKDD", "ICDE"
        ):
            self.assertEqual(
                crawler.CONFERENCE_SPECS[conference].source_kind,
                "official_then_dblp",
            )
        self.assertEqual(crawler.CONFERENCE_SPECS["WWW"].source_kind, "openreview")
        self.assertEqual(crawler.CONFERENCE_SPECS["VLDB"].source_kind, "dblp")

    def test_presentation_classification(self):
        self.assertEqual(
            crawler.presentation_type_from_venue("NeurIPS 2025 Spotlight"),
            "Spotlight",
        )
        self.assertEqual(
            crawler.presentation_type_from_venue("ICLR 2026 Poster"),
            "Poster",
        )
        self.assertEqual(
            crawler.presentation_type_from_venue("ICML 2026"),
            "Accepted",
        )


class FetchTests(unittest.TestCase):
    def test_interrupted_http_body_fails_as_a_transport_error(self):
        url = "https://api.crossref.org/works"
        with patch.object(crawler, "urlopen", side_effect=IncompleteRead(b"partial")):
            with self.assertRaisesRegex(RuntimeError, "Failed to fetch.*IncompleteRead"):
                crawler.request_bytes(url, timeout=2, retries=1)

    def test_exact_pagination_and_normalization(self):
        venue_id = "ICML.cc/2026/Conference"
        notes = [
            {
                "id": "paper-a",
                "number": 1,
                "content": {
                    "venueid": {"value": venue_id},
                    "venue": {"value": "ICML 2026 Oral"},
                    "title": {"value": "Paper A"},
                    "authors": {"value": ["Alice"]},
                    "abstract": {"value": "Abstract A"},
                    "pdf": {"value": "/pdf?id=paper-a"},
                },
            },
            {
                "id": "paper-b",
                "number": 2,
                "content": {
                    "venueid": {"value": venue_id},
                    "venue": {"value": "ICML 2026 Poster"},
                    "title": {"value": "Paper B"},
                    "authors": {"value": ["Bob"]},
                },
            },
        ]
        responses = [
            (
                {"count": 2, "notes": [notes[0]]},
                json.dumps({"count": 2, "notes": [notes[0]]}).encode(),
                {"status": "200", "url": "page-1"},
            ),
            (
                {"count": 2, "notes": [notes[1]]},
                json.dumps({"count": 2, "notes": [notes[1]]}).encode(),
                {"status": "200", "url": "page-2"},
            ),
        ]
        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.object(crawler, "request_json", side_effect=responses):
                fetched, page_meta = crawler.fetch_openreview_accepted(
                    Path(temporary_directory), venue_id=venue_id, page_size=1
                )

        self.assertEqual([note["id"] for note in fetched], ["paper-a", "paper-b"])
        self.assertEqual(len(page_meta), 2)

        row, _ = crawler.normalize_openreview_note(
            fetched[0],
            spec=crawler.CONFERENCE_SPECS["ICML"],
            year=2026,
        )
        self.assertEqual(row["conference"], "ICML")
        self.assertEqual(row["presentation_type"], "Oral")
        self.assertEqual(row["pdf_url"], "https://openreview.net/pdf?id=paper-a")

    def test_dblp_proceedings_are_normalized_without_openreview(self):
        spec = crawler.CONFERENCE_SPECS["AAAI"]
        index_html = (
            b'<a href="https://dblp.org/db/conf/aaai/aaai2025.html">AAAI 2025</a>'
        )
        volume_xml = b"""<?xml version='1.0' encoding='UTF-8'?>
        <dblp><inproceedings key='conf/aaai/Test2025'>
        <author>Alice Example</author><author>Bob Example</author>
        <title>Time Series Anomaly Detection.</title><pages>1-10</pages>
        <year>2025</year><booktitle>AAAI 2025</booktitle>
        <doi>10.1234/example</doi><ee>https://doi.org/10.1234/example</ee>
        </inproceedings></dblp>"""
        responses = [
            (index_html, {"status": "200", "url": "index"}),
            (volume_xml, {"status": "200", "url": "volume"}),
        ]
        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.object(crawler, "request_bytes", side_effect=responses):
                manifest, rows, rich_rows = crawler.build_dblp_conference_outputs(
                    Path(temporary_directory),
                    spec=spec,
                    year=2025,
                )

        self.assertEqual(manifest["counts"]["accepted_paper_count"], 1)
        self.assertEqual(rows[0]["source_record_id"], "conf/aaai/Test2025")
        self.assertEqual(rows[0]["doi"], "10.1234/example")
        self.assertEqual(rows[0]["openreview_id"], "")
        self.assertEqual(rich_rows[0]["dblp_record"]["pages"], "1-10")

    def test_acl_uses_official_anthology_before_dblp(self):
        spec = crawler.CONFERENCE_SPECS["ACL"]
        long_bib = b"""@inproceedings{long-paper,
          title = {Long Paper Title},
          author = {Example, Alice and Example, Bob},
          booktitle = {ACL 2025},
          year = {2025},
          url = {https://aclanthology.org/2025.acl-long.1/}
        }"""
        short_bib = b"""@inproceedings{short-paper,
          title = {Short Paper Title},
          author = {Example, Carol},
          booktitle = {ACL 2025},
          year = {2025}
        }"""
        responses = [
            (long_bib, {"status": "200", "url": "long"}),
            (short_bib, {"status": "200", "url": "short"}),
        ]
        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.object(crawler, "request_bytes", side_effect=responses):
                manifest, rows, _ = crawler.build_conference_outputs(
                    Path(temporary_directory),
                    spec=spec,
                    year=2025,
                    page_size=1000,
                    use_iclr_virtual=False,
                    refresh=True,
                    include_rows=True,
                )

        self.assertEqual(manifest["source_kind"], "official_acl_anthology")
        self.assertEqual(manifest["counts"]["accepted_paper_count"], 2)
        self.assertTrue(all(row["source_type"] == "official_acl_anthology" for row in rows))

    def test_cvpr_uses_official_cvf_open_access_before_dblp(self):
        spec = crawler.CONFERENCE_SPECS["CVPR"]
        index_html = b'<a href="/CVPR2026?day=2026-06-05">Day 1</a>'
        day_html = b"""<dt class="ptitle"><a href="/content/CVPR2026/html/Example_paper.html">Official CVF Paper</a></dt>
        @InProceedings{Example_2026_CVPR,<br>
          author = {Example, Alice and Example, Bob},<br>
          title = {Official CVF Paper},<br>
          booktitle = {Proceedings of CVPR},<br>
          year = {2026}<br>
        }
        <dt class="ptitle"><a href="/content/CVPR2026/html/Another_paperOriginal.html">Another Official CVF Paper</a></dt>
        @InProceedings{Example_2026_CVPR,
          author = {Example, Carol},
          title = {Another Official CVF Paper},
          booktitle = {Proceedings of CVPR},
          year = {2026}
        }"""
        responses = [
            (index_html, {"status": "200", "url": "index"}),
            (day_html, {"status": "200", "url": "day"}),
        ]
        with tempfile.TemporaryDirectory() as temporary_directory:
            with patch.object(crawler, "request_bytes", side_effect=responses):
                manifest, rows, _ = crawler.build_conference_outputs(
                    Path(temporary_directory),
                    spec=spec,
                    year=2026,
                    page_size=1000,
                    use_iclr_virtual=False,
                    refresh=True,
                    include_rows=True,
                )

        self.assertEqual(manifest["source_kind"], "official_cvf_openaccess")
        self.assertEqual(len(rows), 2)
        self.assertEqual(
            {row["title"] for row in rows},
            {"Official CVF Paper", "Another Official CVF Paper"},
        )
        self.assertTrue(all(row["source_type"] == "official_cvf_openaccess" for row in rows))
        self.assertTrue(all(row["paper_url"].startswith("https://openaccess.thecvf.com/content/CVPR2026/") for row in rows))

    def test_eccv_selects_only_requested_official_main_proceedings(self):
        raw = b"""<button>ECCV 2024 Papers</button><dl>
        <dt class="ptitle"><br><a href=papers/eccv_2024/papers_ECCV/html/1_paper.php>Main paper</a></dt>
        <dd>Alice Example*, Bob Example</dd>
        <dd><a href='papers/eccv_2024/papers_ECCV/papers/1.pdf'>pdf</a>
        <a href="https://link.springer.com/chapter/10.1007/example_1">DOI</a></dd></dl>
        <button>ECCV 2022 Papers</button><dl><dt class="ptitle">Other year</dt></dl>"""
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(crawler, "request_bytes", return_value=(raw, {"url": "https://www.ecva.net/papers.php"})):
                manifest, rows, _ = crawler.build_conference_outputs(
                    Path(directory), spec=crawler.CONFERENCE_SPECS["ECCV"], year=2024,
                    page_size=1000, use_iclr_virtual=False, refresh=False, include_rows=True,
                )
        self.assertEqual(manifest["collection_scope"], "main_proceedings")
        self.assertEqual(manifest["source_kind"], "official_ecva")
        self.assertEqual([(row["title"], row["authors"], row["doi"]) for row in rows],
                         [("Main paper", "Alice Example; Bob Example", "10.1007/example_1")])

    def test_historical_icml_uses_main_pmlr_volume(self):
        index = (b'<li><a href="v184"><b>Volume 184</b></a> Proceedings of ICML 2022 Workshop</li>'
                 b'<li><a href="v162"><b>Volume 162</b></a> Proceedings of ICML 2022</li>')
        paper = b"""@InProceedings{example, title={Spatial Reasoning}, author={Example, Alice},
        year={2022}, volume={162}, abstract={Spatial reasoning in three dimensions.}}"""
        bibliography = b"@Proceedings{ICML2022, title={Proceedings of ICML}}\n" + paper + b"\n" + paper
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(crawler, "request_bytes", side_effect=[(index, {}), (bibliography, {})]) as request:
                manifest, rows, _ = crawler.build_conference_outputs(
                    Path(directory), spec=crawler.CONFERENCE_SPECS["ICML"], year=2022,
                    page_size=1000, use_iclr_virtual=False, refresh=False, include_rows=True,
                )
        self.assertEqual(manifest["source_kind"], "official_pmlr")
        self.assertEqual(len(rows), 1)
        self.assertEqual(request.call_args.args[0], "https://proceedings.mlr.press/v162/assets/bib/bibliography.bib")
        self.assertEqual(rows[0]["abstract"], "Spatial reasoning in three dimensions.")

    def test_historical_neurips_keeps_official_tracks_and_reports_missing_authors(self):
        page = b"""<h1 class="book-title">Advances in Neural Information Processing Systems 35</h1>
        <p class="book-meta">NeurIPS 2022</p><span class="paper-count">1 paper</span>
        <div><a title="paper title" href="/paper_files/paper/2022/hash/0123456789abcdef0123456789abcdef-Abstract-Datasets_and_Benchmarks.html">Benchmark</a>
        <span class="paper-authors"></span></div><span class="paper-track-badge">Datasets and Benchmarks Track</span>"""
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(crawler, "request_bytes", return_value=(page, {})):
                manifest, rows, _ = crawler.build_conference_outputs(
                    Path(directory), spec=crawler.CONFERENCE_SPECS["NIPS"], year=2022,
                    page_size=1000, use_iclr_virtual=False, refresh=False, include_rows=True,
                )
        self.assertEqual(manifest["source_kind"], "official_neurips")
        self.assertEqual(manifest["missing_field_counts"]["authors"], 1)
        self.assertEqual(rows[0]["track"], "Datasets and Benchmarks Track")

    def test_ijcai_official_proceedings_validates_identifiers_and_retains_track(self):
        page = b"""<p class="volume-head__meta">1 paper</p>
        <div class="section_title"><h3>AI and Social Good</h3></div>
        <div class="paper_wrapper paper-row" id="paper7">
        <a class="title" href="/proceedings/2025/7">Spatial Navigation</a>
        <div class="authors"><a href="/authors/example/">Alice Example</a></div>
        <a href="https://doi.org/10.24963/ijcai.2025/7">DOI</a>
        <a href="/proceedings/2025/0007.pdf">PDF</a></div>"""
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(crawler, "request_bytes", return_value=(page, {})):
                manifest, rows, _ = crawler.build_conference_outputs(
                    Path(directory), spec=crawler.CONFERENCE_SPECS["IJCAI"], year=2025,
                    page_size=1000, use_iclr_virtual=False, refresh=False, include_rows=True,
                )
            with patch.object(crawler, "request_bytes", return_value=(page.replace(b"ijcai.2025/7", b"ijcai.2025/8"), {})):
                with self.assertRaisesRegex(RuntimeError, "Conflicting IJCAI"):
                    crawler.fetch_ijcai_proceedings(Path(directory), spec=crawler.CONFERENCE_SPECS["IJCAI"], year=2025)
            without_doi = page.replace(b'<a href="https://doi.org/10.24963/ijcai.2025/7">DOI</a>', b"")
            with patch.object(crawler, "request_bytes", return_value=(without_doi, {})):
                missing_doi_rows, _, _ = crawler.fetch_ijcai_proceedings(
                    Path(directory), spec=crawler.CONFERENCE_SPECS["IJCAI"], year=2025,
                )
        self.assertEqual(manifest["source_kind"], "official_ijcai")
        self.assertEqual(rows[0]["track"], "AI and Social Good")
        self.assertEqual(rows[0]["doi"], "10.24963/ijcai.2025/7")
        self.assertEqual(missing_doi_rows[0]["doi"], "")

    def test_aaai_2021_excludes_legacy_volumes_republished_in_2021(self):
        records = [
            {
                "DOI": f"10.1609/aaai.v{volume}i1.{record_id}",
                "ISSN": ["2374-3468"],
                "type": "journal-article",
                "published": {"date-parts": [[2021]]},
                "volume": str(volume),
                "issue": "1",
                "title": [title],
            }
            for volume, record_id, title in (
                (26, 8391, "Legacy paper"),
                (35, 16187, "AAAI 2021 paper"),
            )
        ]
        payload = json.dumps({"message": {"total-results": 2, "items": records}}).encode()
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(crawler, "request_bytes", return_value=(payload, {})):
                manifest, rows, _ = crawler.build_conference_outputs(
                    Path(directory), spec=crawler.CONFERENCE_SPECS["AAAI"], year=2021,
                    page_size=1000, use_iclr_virtual=False, refresh=False, include_rows=True,
                )
        self.assertEqual(manifest["source_kind"], "crossref_journal")
        self.assertEqual(manifest["counts"]["excluded_record_count"], 1)
        self.assertEqual([row["doi"] for row in rows], ["10.1609/aaai.v35i1.16187"])

        with tempfile.TemporaryDirectory() as directory:
            with patch.object(crawler, "request_bytes", return_value=(payload, {})) as request:
                manifest, rows, _ = crawler.build_conference_outputs(
                    Path(directory), spec=crawler.CONFERENCE_SPECS["AAAI"], year=2012,
                    page_size=1000, use_iclr_virtual=False, refresh=False, include_rows=True,
                )
        self.assertIn("from-pub-date%3A2021-01-01", request.call_args.args[0])
        self.assertEqual(manifest["year"], 2012)
        self.assertEqual([(row["year"], row["doi"]) for row in rows], [(2012, "10.1609/aaai.v26i1.8391")])

    def test_icra_official_program_reads_three_technical_days(self):
        fixtures = Path(__file__).parent / "fixtures" / "zotero-robotics"
        days = [3, 4, 5]
        responses = [
            ((fixtures / f"icra-2026-day{day}.html").read_bytes(), {}) for day in days
        ]
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(crawler, "request_bytes", side_effect=responses) as request:
                manifest, rows, _ = crawler.build_conference_outputs(
                    Path(directory), spec=crawler.CONFERENCE_SPECS["ICRA"], year=2026,
                    page_size=1000, use_iclr_virtual=False, refresh=False, include_rows=True,
                )
        self.assertEqual([call.args[0].rsplit("/", 1)[-1] for call in request.call_args_list],
                         [f"ICRA26_ContentListWeb_{day}.html" for day in days])
        self.assertEqual(manifest["collection_scope"], "technical_program")
        self.assertEqual(len(rows), 8)
        self.assertEqual(sum(bool(row["abstract"]) for row in rows), 7)


class BatchRunnerTests(unittest.TestCase):
    def test_default_runner_invokes_each_configured_target(self):
        with patch.object(crawler, "main", return_value=0) as mocked_main:
            exit_code = run_default_collection()

        self.assertEqual(exit_code, 0)
        self.assertEqual(mocked_main.call_count, len(DEFAULT_TARGETS))
        for index, target in enumerate(DEFAULT_TARGETS):
            self.assertEqual(
                mocked_main.call_args_list[index].args[0],
                collection_arguments(target),
            )


class LocalSnapshotTests(unittest.TestCase):
    def test_complete_local_snapshot_is_reused_without_fetching(self):
        spec = crawler.CONFERENCE_SPECS["ICLR"]
        year = 2026
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_root = Path(temporary_directory)
            conference_dir = output_root / str(year) / spec.key
            csv_path = conference_dir / "ICLR_2026_accepted_papers.csv"
            jsonl_path = conference_dir / "ICLR_2026_accepted_papers.jsonl"
            crawler.write_csv(
                csv_path,
                [{"openreview_id": "cached-paper", "title": "Cached paper"}],
                crawler.CSV_FIELDS,
            )
            crawler.write_jsonl(
                jsonl_path,
                [{"normalized": {"openreview_id": "cached-paper"}}],
            )
            crawler.write_json(
                conference_dir / "source_manifest.json",
                {
                    "conference": spec.key,
                    "year": year,
                    "venue_id": spec.venue_id(year),
                    "counts": {"openreview_current_accepted": 1},
                    "outputs": {"csv": str(csv_path), "jsonl": str(jsonl_path)},
                    "warnings": [],
                },
            )
            with patch.object(crawler, "fetch_openreview_accepted") as fetch:
                manifest, csv_rows, jsonl_rows = crawler.build_conference_outputs(
                    output_root,
                    spec=spec,
                    year=year,
                    page_size=1000,
                    use_iclr_virtual=True,
                    refresh=False,
                    include_rows=True,
                )

        fetch.assert_not_called()
        self.assertEqual(manifest["collection_status"], "reused_local_snapshot")
        self.assertEqual(csv_rows[0]["openreview_id"], "cached-paper")
        self.assertEqual(jsonl_rows[0]["normalized"]["openreview_id"], "cached-paper")

    def test_official_source_upgrades_a_cached_dblp_fallback(self):
        spec = crawler.CONFERENCE_SPECS["ACL"]
        year = 2025
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_root = Path(temporary_directory)
            conference_dir = output_root / str(year) / spec.key
            csv_path = conference_dir / "ACL_2025_accepted_papers.csv"
            jsonl_path = conference_dir / "ACL_2025_accepted_papers.jsonl"
            fallback_row = {
                "source_record_id": "dblp:old-paper",
                "title": "Cached DBLP paper",
            }
            crawler.write_csv(csv_path, [fallback_row], crawler.CSV_FIELDS)
            crawler.write_jsonl(jsonl_path, [{"normalized": fallback_row}])
            crawler.write_json(
                conference_dir / "source_manifest.json",
                {
                    "conference": spec.key,
                    "year": year,
                    "collection_id": spec.collection_id(year),
                    "source_kind": "dblp_fallback",
                    "source_id": spec.source_id(year),
                    "counts": {"accepted_paper_count": 1},
                    "outputs": {"csv": str(csv_path), "jsonl": str(jsonl_path)},
                    "warnings": [],
                },
            )
            official_manifest = {
                "source_kind": "official_acl_anthology",
                "counts": {"accepted_paper_count": 1},
            }
            official_rows = [{"source_record_id": "acl:new-paper", "title": "Official paper"}]
            with patch.object(
                crawler,
                "build_official_conference_outputs",
                return_value=(official_manifest, official_rows, []),
            ) as official_builder:
                manifest, rows, _ = crawler.build_conference_outputs(
                    output_root,
                    spec=spec,
                    year=year,
                    page_size=1000,
                    use_iclr_virtual=False,
                    refresh=False,
                    include_rows=True,
                )

        official_builder.assert_called_once()
        self.assertEqual(manifest["source_kind"], "official_acl_anthology")
        self.assertEqual(rows[0]["source_record_id"], "acl:new-paper")


if __name__ == "__main__":
    raise SystemExit(run_default_collection())
