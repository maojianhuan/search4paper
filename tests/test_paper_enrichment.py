import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

from code import paper_enrichment as enrichment


class PaperEnrichmentTests(unittest.TestCase):
    def test_cvf_preprint_citations_preserve_version_and_verify_first_author(self):
        paper = {"source_type": "official_cvf_openaccess", "conference": "CVPR", "title": "Spatial Navigation",
                 "authors": "Guo, Wenxuan; Xiuwei Xu", "doi": "",
                 "paper_url": "https://openaccess.thecvf.com/content/CVPR2026/html/example.html"}
        doi = "10.48550/arxiv.2605.22816"
        html = b'<a href="https://arxiv.org/abs/2605.22816v2">arXiv</a>'
        work = {"type": "preprint", "doi": f"https://doi.org/{doi}", "display_name": paper["title"],
                "id": "https://openalex.org/W123", "cited_by_count": 0,
                "authorships": [{"author": {"display_name": "Wenxuan Guo"}}]}
        for first_author in ("Wenxuan Guo", "Another Author"):
            with self.subTest(first_author=first_author):
                row = dict(paper)
                response = {**work, "authorships": [{"author": {"display_name": first_author}}]}
                with patch.object(enrichment.collector, "request_bytes",
                                  side_effect=[(html, {}), (json.dumps(response).encode(), {})]):
                    enrichment.enrich_cvf_preprint_citation(row)
                self.assertEqual(row["doi"], "")
                self.assertNotIn("cited_by_count", row)
                if first_author == "Wenxuan Guo":
                    self.assertEqual(row["preprint_doi"], doi)
                    self.assertEqual(row["preprint_openalex_cited_by_count"], 0)
                else:
                    self.assertNotIn("preprint_openalex_cited_by_count", row)

    def test_crossref_batches_known_dois_and_matches_by_returned_identifier(self):
        first = {"conference": "AAAI", "year": 2025, "title": "First", "doi": "10.1609/first"}
        second = {"conference": "AAAI", "year": 2025, "title": "Second", "doi": "10.1609/second"}
        items = [{"DOI": second["doi"], "is-referenced-by-count": 12},
                 {"DOI": first["doi"], "is-referenced-by-count": 0}]
        data = {"message": {"total-results": 2, "items": items}}
        with patch.object(enrichment.collector, "request_bytes",
                          return_value=(json.dumps(data).encode(), {})) as request:
            self.assertEqual(enrichment.enrich_crossref_citations([first, second]), {})
        request.assert_called_once()
        self.assertEqual([first["crossref_cited_by_count"], second["crossref_cited_by_count"]], [0, 12])

    def test_eccv_crossref_requires_main_proceedings_container(self):
        row = {"source_type": "official_ecva", "conference": "ECCV", "year": 2018,
               "title": "Vision and Language Navigation", "authors": "Xin Wang"}
        main = {"DOI": "10.1007/978-3-030-01270-0_3", "title": [row["title"]],
                "author": [{"given": "Xin", "family": "Wang"}], "is-referenced-by-count": 12,
                "container-title": ["Lecture Notes in Computer Science", "Computer Vision – ECCV 2018"]}
        workshop = {**main, "DOI": "10.1007/978-3-030-01270-0_4",
                    "container-title": ["Computer Vision – ECCV 2018 Workshops"]}
        payload = json.dumps({"message": {"items": [workshop, main]}}).encode()
        with patch.object(enrichment.collector, "request_bytes", return_value=(payload, {})):
            self.assertEqual(enrichment.enrich_crossref_citations([row]), {})
        self.assertEqual(row["crossref_citation_doi"], main["DOI"])
        self.assertEqual(row["crossref_cited_by_count"], 12)

    def test_neurips_crossref_uses_doi_from_verified_proceedings_page(self):
        paper_id = "/paper_files/paper/2024/hash/" + "a" * 32 + "-Abstract-Datasets_and_Benchmarks_Track.html"
        row = {"source_type": "official_neurips", "conference": "NIPS", "year": 2024,
               "source_record_id": paper_id, "paper_url": f"https://proceedings.neurips.cc{paper_id}",
               "title": "Navigation Benchmark"}
        page = b'<meta name="citation_doi" content="10.52202/079017-0970"><h1 class="paper-title">Navigation Benchmark</h1>'
        crossref = json.dumps({"message": {"DOI": "10.52202/079017-0970", "is-referenced-by-count": 8}}).encode()
        with patch.object(enrichment.collector, "request_bytes", side_effect=[(page, {}), (crossref, {})]) as request:
            self.assertEqual(enrichment.enrich_crossref_citations([row]), {})
        self.assertEqual(request.call_args_list[1].args[0], "https://api.crossref.org/works/10.52202/079017-0970")
        self.assertEqual(row["crossref_citation_match_method"], "neurips_publisher_doi")
        self.assertEqual(row["crossref_cited_by_count"], 8)
        linked = {"source_type": "openreview", "conference": "NIPS", "year": 2024,
                  "openreview_id": "forum", "paper_url": "https://openreview.net/pdf?id=forum",
                  "publisher_paper_url": row["paper_url"], "title": row["title"]}
        with patch.object(enrichment.collector, "request_bytes", side_effect=[(page, {}), (crossref, {})]) as request:
            self.assertEqual(enrichment.enrich_crossref_citations([linked]), {})
        self.assertEqual(request.call_args_list[0].args[0], row["paper_url"])
        self.assertEqual(linked["crossref_cited_by_count"], 8)
        self.assertEqual(linked["paper_url"], "https://openreview.net/pdf?id=forum")

    def test_crossref_cvf_citations_require_main_venue_and_exact_identity(self):
        row = {"conference": "CVPR", "year": 2019, "source_type": "official_cvf_openaccess",
               "title": "The Regretful Agent", "authors": "Ma, Chih-Yao", "cited_by_count": 100}
        main = {"DOI": "10.1109/CVPR.2019.00689", "title": [row["title"]], "is-referenced-by-count": 0,
                "author": [{"given": "Chih-Yao", "family": "Ma",
                            "affiliation": [{"name": "ETH Z&#x00FC;rich"}]}]}
        workshop = {**main, "DOI": "10.1109/CVPRW.2019.00689", "is-referenced-by-count": 50}
        other_author = {**main, "DOI": "10.1109/CVPR.2019.00690", "author": [{"given": "Different", "family": "Ma"}]}
        payload = json.dumps({"message": {"items": [workshop, other_author, main]}}).encode()
        with patch.object(enrichment.collector, "request_bytes", return_value=(payload, {})) as request:
            self.assertEqual(enrichment.enrich_crossref_citations([row]), {})
        request.assert_called_once()
        self.assertEqual(row["crossref_citation_doi"], "10.1109/cvpr.2019.00689")
        self.assertEqual(row["crossref_cited_by_count"], 0)
        self.assertEqual(row["crossref_affiliations"], ["ETH Zürich"])
        self.assertEqual(row["cited_by_count"], 100)
        self.assertNotIn("doi", row)

    def test_crossref_papercept_does_not_assign_journal_presentations_venue_citations(self):
        title = "Vision-Language Navigation with Continual Learning"
        row = {"conference": "IROS", "year": 2025, "source_type": "official_papercept",
               "title": title, "authors": "Example, Alice"}
        journal = {"DOI": "10.1109/lra.2025.001", "title": [title], "is-referenced-by-count": 22,
                   "author": [{"given": "Alice", "family": "Example"}]}
        conference = {**journal, "DOI": "10.1109/iros60139.2025.11246709", "is-referenced-by-count": 1}
        pages = [{"message": {"items": [journal]}}, {"message": {"items": [journal, conference]}}]
        with patch.object(enrichment.collector, "request_bytes", side_effect=[
                (json.dumps(page).encode(), {}) for page in pages]):
            enrichment.enrich_crossref_citations([row])
            self.assertEqual(row["crossref_citation_status"], "unmatched")
            self.assertNotIn("crossref_cited_by_count", row)
            enrichment.enrich_crossref_citations([row])
        self.assertEqual(row["crossref_citation_doi"], conference["DOI"])
        self.assertEqual(row["crossref_cited_by_count"], 1)

    def test_doi_bibtex_enrichment_checks_identity_and_preserves_source_and_provenance(self):
        row = dict(conference="TODS", year=2025, source_record_id="paper-one", title="A paper",
                   doi="HTTPS://doi.org/10.1234/EXAMPLE%23v1", bibtex="")
        bibtex = '@article{Example, title={{A} paper}, DOI={10.1234/Example#v1}, year={2025}}'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(enrichment, "urlopen") as request, \
                 patch.object(enrichment, "utc_now", return_value="2026-09-20T12:00:00+00:00"):
                response = request.return_value.__enter__.return_value
                response.read.return_value = bibtex.encode("utf-8")
                response.geturl.return_value = "https://api.crossref.org/example/transform"
                rows, failures = enrichment.enrich_bibtex([row], root)
            request.assert_called_once()
            sent = request.call_args.args[0]
            self.assertEqual(sent.full_url, "https://doi.org/10.1234/example%23v1")
            self.assertEqual(sent.get_header("Accept"), "application/x-bibtex")
            self.assertEqual(failures, {})
            self.assertEqual(row["bibtex"], "")
            self.assertEqual(rows[0]["doi"], row["doi"])
            self.assertEqual(rows[0]["bibtex"], bibtex)
            self.assertEqual(rows[0]["bibtex_source"], "doi_content_negotiation")
            self.assertEqual(rows[0]["bibtex_source_url"], "https://api.crossref.org/example/transform")
            self.assertEqual(rows[0]["bibtex_retrieved_at"], "2026-09-20T12:00:00+00:00")
            path = root / "enrichment" / "bibtex.jsonl"
            before = path.read_bytes()
            record = json.loads(before)
            self.assertEqual(record["doi"], "10.1234/example#v1")
            self.assertEqual(record["status"], "success")
            with patch.object(enrichment, "urlopen", side_effect=AssertionError("network forbidden")):
                self.assertEqual(enrichment.load_cached_bibtex([row], root), rows)
                reused, errors = enrichment.enrich_bibtex([row], root)
                self.assertEqual((reused, errors), (rows, {}))
                authoritative = dict(row, bibtex="@article{source, title={Original citation}}")
                self.assertEqual(enrichment.load_cached_bibtex([authoritative], root), [authoritative])
                self.assertEqual(enrichment.enrich_bibtex([authoritative], root), ([authoritative], {}))
            self.assertEqual(path.read_bytes(), before)

    def test_doi_bibtex_enrichment_reports_each_failure_and_keeps_successes(self):
        rows = [dict(conference="TODS", year=2025, source_record_id=name, title=name, doi=doi)
                for name, doi in (("Existing", ""), ("Missing DOI", ""), ("Invalid DOI", "not-a-doi"),
                                  ("Wrong identity", "10.1234/wrong"), ("Network failure", "10.1234/network"),
                                  ("Matched paper", "10.1234/matched"))]
        rows[0]["bibtex"] = "@article{original, title={Original}}"
        wrong, matched = MagicMock(), MagicMock()
        wrong.__enter__.return_value.read.return_value = b"@article{wrong, title={Wrong paper}, doi={10.1234/other}}"
        matched.__enter__.return_value.read.return_value = b"@article{matched, title={Matched paper}, doi={10.1234/matched}}"
        matched.__enter__.return_value.geturl.return_value = "https://api.crossref.org/matched/transform"
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(enrichment, "urlopen", side_effect=[wrong, URLError("offline"), matched]) as request:
            result, failures = enrichment.enrich_bibtex(rows, Path(directory))
            self.assertEqual(request.call_count, 3)
            self.assertEqual(len(failures), 4)
            self.assertEqual(result[0], rows[0])
            self.assertEqual([row["bibtex_status"] for row in result[1:]],
                             ["no_doi", "invalid_doi", "failed", "failed", "success"])
            for row, message in zip(result[1:5], ("缺少 DOI", "DOI 格式无效", "DOI 不匹配", "offline")):
                self.assertIn(message, row["bibtex_error"])
                self.assertEqual(row["bibtex"], "")
                self.assertIn(enrichment.paper_key(row), failures)
            restored = enrichment.load_cached_bibtex(rows, Path(directory))
            self.assertEqual(restored, result)

    def test_doi_bibtex_rejects_unverified_responses_without_retry(self):
        bodies = [b"<html>Access denied</html>",
                  b"@article{key, title={Missing DOI}}",
                  b"@article{key, title={Wrong DOI}, doi={10.1234/other}}",
                  b"@article{a, title={A}, doi={10.1234/test}} @article{b, title={B}, doi={10.1234/test}}",
                  b"\xff"]
        for body in bodies:
            with self.subTest(body=body), patch.object(enrichment, "urlopen") as request:
                request.return_value.__enter__.return_value.read.return_value = body
                with self.assertRaises(ValueError):
                    enrichment._fetch_doi_bibtex("10.1234/test")
                request.assert_called_once()
        error = HTTPError("https://doi.org/10.1234/test", 404, "Not Found", {}, None)
        with patch.object(enrichment, "urlopen", side_effect=error) as request:
            with self.assertRaisesRegex(RuntimeError, "HTTP 404"):
                enrichment._fetch_doi_bibtex("10.1234/test")
            request.assert_called_once()

    def test_doi_bibtex_existing_citation_needs_no_doi_request_or_cache_write(self):
        row = dict(title="Original", bibtex="@article{source, title={Original}}")
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(enrichment, "urlopen", side_effect=AssertionError("network forbidden")):
            self.assertEqual(enrichment.enrich_bibtex([row], Path(directory)), ([row], {}))
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_doi_bibtex_failed_lookup_is_retried_only_by_explicit_enrichment(self):
        row = dict(source_record_id="one", doi="doi:10.1234/test", title="A paper")
        bibtex = "@article{key, title={A paper}, doi={10.1234/test}}"
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(enrichment, "_fetch_doi_bibtex", side_effect=[RuntimeError("offline"),
                                                                      (bibtex, "https://doi.org/10.1234/test")]) as fetch:
            root = Path(directory)
            failed, failures = enrichment.enrich_bibtex([row], root)
            self.assertEqual(len(failures), 1)
            restored = enrichment.load_cached_bibtex([row], root)
            self.assertEqual(restored, failed)
            fetch.assert_called_once_with("10.1234/test")
            retried, failures = enrichment.enrich_bibtex(restored, root)
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(failures, {})
            self.assertEqual(retried[0]["bibtex"], bibtex)
            self.assertEqual(retried[0]["bibtex_error"], "")
            self.assertEqual(enrichment.load_cached_bibtex([row], root), retried)

    def test_doi_bibtex_corrupt_or_mismatched_saved_record_fails_explicitly(self):
        row = dict(source_record_id="one", title="A paper", doi="10.1234/current")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "enrichment" / "bibtex.jsonl"
            path.parent.mkdir()
            path.write_text("{broken", encoding="utf-8")
            for action in (enrichment.load_cached_bibtex, enrichment.enrich_bibtex):
                with self.subTest(action=action.__name__), self.assertRaisesRegex(ValueError, "Cannot read enrichment cache"):
                    action([row], root)
            for record, message in ((dict(doi="10.1234/old", bibtex="@article{key, title={Old}}"), "DOI 不匹配"),
                                    (dict(doi="10.1234/current", bibtex=""), "缺少引用内容")):
                enrichment.collector.write_jsonl(path, [dict(record, paper_id=enrichment.paper_key(row), status="success")])
                for action in (enrichment.load_cached_bibtex, enrichment.enrich_bibtex):
                    with self.subTest(record=record, action=action.__name__), self.assertRaisesRegex(ValueError, message):
                        action([row], root)

    def test_bibtex_preserves_source_text_and_selection_order(self):
        first = '@inproceedings{z2025,\n  title = {{LLM} 与记忆},\n  author = {M{\\\"u}ller and 王明},\n  year = {2025}\n}'
        second = '@article{a2024, title={Second paper}, journal={Research \\& Science}, year={2024}}'
        rows = [{"title": "LLM 与记忆", "bibtex": first}, {"title": "Second paper", "bibtex": second}]
        with tempfile.TemporaryDirectory() as directory:
            output = enrichment.export_bibtex(iter(rows), Path(directory) / "papers.bib")
            self.assertEqual(output.read_text(encoding="utf-8"), first + "\n\n" + second + "\n")

    def test_bibtex_missing_records_are_listed_without_creating_or_overwriting_file(self):
        rows = [{"title": "Available", "bibtex": "@article{one, title={Available}}"},
                {"title": "Missing one"}, {"title": "Missing two", "bibtex": "  \n"}]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "papers.bib"
            for existing in (False, True):
                with self.subTest(existing=existing):
                    if existing:
                        output.write_text("Keep existing bibliography", encoding="utf-8")
                    with self.assertRaises(ValueError) as error:
                        enrichment.export_bibtex(iter(rows), output)
                    self.assertIn("2 篇论文缺少来源 BibTeX", str(error.exception))
                    self.assertIn("Missing one", str(error.exception))
                    self.assertIn("Missing two", str(error.exception))
                    if existing:
                        self.assertEqual(output.read_text(), "Keep existing bibliography")
                    else:
                        self.assertFalse(output.exists())

    def test_bibtex_duplicate_citation_keys_report_both_papers_before_writing(self):
        rows = [{"title": title, "bibtex": f"@inproceedings{{Wang_2026_CVPR, title={{{title}}}}}"}
                for title in ("First paper", "Second paper")]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "papers.bib"
            output.write_text("Keep existing bibliography", encoding="utf-8")
            with self.assertRaises(ValueError) as error:
                enrichment.export_bibtex(rows, output)
            for text in ("引用键重复", "Wang_2026_CVPR", "First paper", "Second paper"):
                self.assertIn(text, str(error.exception))
            self.assertEqual(output.read_text(), "Keep existing bibliography")

    def test_bibtex_empty_selection_or_unrecognized_record_leaves_file_unchanged(self):
        selections = [[], [{"title": "Broken", "bibtex": "not BibTeX"}],
                      [{"title": "Truncated", "bibtex": "@article{key, title={Paper}"}],
                      [{"title": "No key", "bibtex": "@article{, title={Paper}}"}],
                      [{"title": "Two entries", "bibtex": "@article{a, title={A}}\n@article{b, title={B}}"}]]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "papers.bib"
            output.write_text("Keep existing bibliography", encoding="utf-8")
            for rows in selections:
                with self.subTest(rows=rows), self.assertRaises(ValueError):
                    enrichment.export_bibtex(rows, output)
                self.assertEqual(output.read_text(), "Keep existing bibliography")

    def test_reading_list_preserves_selection_order_and_escapes_markdown(self):
        rows = [{"title": "A [test] *paper*", "abstract": "Use <memory> and [tools].",
                 "source_url": "https://example.test/a paper(x)", "conference": "ICLR", "year": 2025},
                {"title": "Second paper"}]
        with tempfile.TemporaryDirectory() as directory:
            output = enrichment.export_reading_list(rows, Path(directory) / "reading.md")
            text = output.read_text(encoding="utf-8")
        self.assertIn(r"A \[test\] \*paper\*", text)
        self.assertIn(r"Use \<memory\> and \[tools\].", text)
        self.assertIn("https://example.test/a%20paper%28x%29", text)
        self.assertLess(text.index("## 1."), text.index("## 2."))
        self.assertIn("未提供摘要", text)

    def test_reading_list_keeps_publisher_and_open_access_links(self):
        row = dict(title='Journal paper', source_url='https://doi.org/10.1/example',
                   oa_landing_url='https://repository.example/article',
                   oa_pdf_url='https://repository.example/paper.pdf', oa_version='acceptedVersion')
        with tempfile.TemporaryDirectory() as directory:
            output = enrichment.export_reading_list([row], Path(directory) / 'reading.md').read_text()
        for field in ('source_url', 'oa_landing_url', 'oa_pdf_url', 'oa_version'):
            self.assertIn(row[field], output)
        self.assertNotIn('None', output)

    def test_cached_pdf_requires_existing_file_and_does_not_write(self):
        row = {"conference": "ICLR", "year": 2025, "openreview_id": "one"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            key = enrichment.paper_key(row)
            manifest = root / "enrichment" / "pdf_manifest.jsonl"
            enrichment.collector.write_jsonl(manifest, [{"paper_id": key, "status": "downloaded"}])
            self.assertNotIn("pdf_local_path", enrichment.load_cached_pdfs([row], root)[0])
            pdf = root / "enrichment" / "pdf" / f"{key}.pdf"
            pdf.parent.mkdir()
            pdf.write_bytes(b"%PDF-1.4 test")
            before = manifest.read_bytes()
            restored = enrichment.load_cached_pdfs([row], root)[0]
            self.assertEqual(restored["pdf_local_path"], str(pdf.resolve()))
            self.assertEqual(restored["pdf_status"], "downloaded")
            self.assertEqual(manifest.read_bytes(), before)

    def test_local_abstract_is_normalized_and_cached(self):
        row = {
            "conference": "ICLR",
            "year": 2026,
            "source_record_id": "forum-1",
            "title": "A Paper",
            "authors": "Alice Example",
            "abstract": "An existing abstract.",
        }
        with tempfile.TemporaryDirectory() as directory:
            enriched, failures = enrichment.enrich_abstracts((row,), Path(directory))
            self.assertEqual(failures, {})
            self.assertEqual(enriched[0]["abstract_status"], "success")
            self.assertEqual(enriched[0]["abstract_source"], "local_dataset")
            cache = Path(directory) / "enrichment" / "abstracts.jsonl"
            self.assertTrue(cache.is_file())

    def test_ecva_and_neurips_use_official_abstracts_and_validate_year(self):
        examples = (
            ("ECCV", "official_ecva", "https://www.ecva.net/",
             "papers/eccv_2020/papers_ECCV/html/1_paper.php",
             b'<div id="papertitle">Navigation</div><div id="abstract">An &amp; example.</div>',
             "An & example."),
            ("NIPS", "official_neurips", "https://proceedings.neurips.cc",
             "/paper_files/paper/2020/hash/0123456789abcdef0123456789abcdef-Abstract.html",
             b'<h1 class="paper-title">Navigation</h1><h2 class="section-label">Abstract</h2>'
             b'<p class="paper-abstract"><p>First paragraph.</p><p>Second paragraph.</p></p></section>',
             "First paragraph. Second paragraph."),
        )
        with tempfile.TemporaryDirectory() as directory:
            for conference, source, domain, path, page, expected in examples:
                with self.subTest(conference=conference):
                    row = {"conference": conference, "year": 2020, "source_type": source,
                           "source_record_id": path, "paper_url": domain + path, "title": "Navigation"}
                    with patch.object(enrichment.collector, "request_bytes", return_value=(page, {})) as request:
                        enriched, failures = enrichment.enrich_abstracts(
                            [row], Path(directory), use_external_source=False,
                        )
                        with self.assertRaisesRegex(ValueError, "Invalid official"):
                            enrichment.enrich_abstracts(
                                [{**row, "year": 2018}], Path(directory), use_external_source=False,
                            )
                    request.assert_called_once()
                    self.assertFalse(failures)
                    self.assertEqual(enriched[0]["abstract"], expected)
                    self.assertEqual(enriched[0]["abstract_source"], source)

    def test_eccv2018_recovers_abstract_from_official_cvf_archive(self):
        path = "papers/eccv_2018/papers_ECCV/html/Example_paper.php"
        row = {"conference": "ECCV", "year": 2018, "source_type": "official_ecva",
               "source_record_id": path, "paper_url": f"https://www.ecva.net/{path}", "title": "Navigation"}
        page = b'<div id="papertitle">Navigation</div><div id="abstract">Published summary.</div>'
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(enrichment.collector, "request_bytes",
                          side_effect=[RuntimeError("Timeout"), (page, {})]) as request:
            enriched, failures = enrichment.enrich_abstracts([row], Path(directory), use_external_source=False)
        self.assertFalse(failures)
        self.assertEqual(request.call_args.args[0],
                         "https://openaccess.thecvf.com/content_ECCV_2018/html/Example_paper.html")
        self.assertEqual(enriched[0]["abstract_source"], "official_cvf_eccv_archive")

    def test_iclr2020_fetches_the_verified_official_poster(self):
        row = {"conference": "ICLR", "year": 2020, "source_type": "official_iclr_program",
               "source_record_id": "forum123", "openreview_id": "forum123", "title": "Spatial Navigation"}
        page = (b'<meta name="citation_title" content="Spatial Navigation">'
                b'<div id="abstractExample"><span class="font-weight-bold">Abstract:</span>Published summary.</div>')
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(enrichment.collector, "request_bytes", return_value=(page, {})) as request:
            enriched, failures = enrichment.enrich_abstracts([row], Path(directory), use_external_source=False)
        self.assertFalse(failures)
        self.assertEqual(enriched[0]["abstract"], "Published summary.")
        self.assertEqual(request.call_args.args[0], "https://iclr.cc/virtual_2020/poster_forum123.html")

    def test_neurips_2021_datasets_reads_legacy_detail_page(self):
        path = "/paper_files/paper/2021/hash/" + "a" * 32 + "-Abstract-round2.html"
        url = "https://datasets-benchmarks-proceedings.neurips.cc" + path
        row = {"conference": "NIPS", "year": 2021, "source_record_id": path, "paper_url": url,
               "title": "Dataset for Navigation"}
        page = b"<h4>Dataset for Navigation</h4><h4>Abstract</h4><p><p>A dataset &amp; benchmark.</p></p>"
        with patch.object(enrichment.collector, "request_bytes", return_value=(page, {})):
            self.assertEqual(enrichment._fetch_neurips_2021_datasets_abstract(row),
                             ("A dataset & benchmark.", url))

    def test_cvf_detail_accepts_bibtex_math_escapes(self):
        url = "https://openaccess.thecvf.com/content/CVPR2025/html/Example_paper.html"
        row = {"conference": "CVPR", "year": 2025, "source_type": "official_cvf_openaccess",
               "title": r"Navigation\textasciicircum2: 5\%\ensuremath>1\%", "paper_url": url}
        page = b'<div id="papertitle">Navigation^2: 5%&gt;1%</div><div id="abstract">Official summary.</div>'
        with patch.object(enrichment.collector, "request_bytes", return_value=(page, {})):
            self.assertEqual(enrichment._fetch_cvf_or_ecva_abstract(row), ("Official summary.", url))
            with self.assertRaisesRegex(RuntimeError, "detail title does not match"):
                enrichment._fetch_cvf_or_ecva_abstract({**row, "title": "Different title"})

    def test_aaai_publisher_abstract_requires_matching_doi_and_title(self):
        row = {"conference": "AAAI", "year": 2025, "source_type": "dblp_proceedings",
               "source_record_id": "conf/aaai/example", "title": "Vision & Language.",
               "doi": "10.1609/aaai.v39i22.34526"}
        page = (b'<meta name="citation_title" content="Vision &amp; Language"/>'
                b'<meta name="citation_doi" content="10.1609/aaai.v39i22.34526"/>'
                b'<meta name="citation_author_institution" content="First Institute"/>'
                b'<meta name="citation_author_institution" content="Second Institute"/>'
                b'<meta name="DC.Description" xml:lang="en" content="An &amp; example."/>')
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(enrichment.collector, "request_bytes", return_value=(page, {})) as request:
            enriched, failures = enrichment.enrich_abstracts([row], Path(directory), use_external_source=False)
            request.assert_called_once_with("https://ojs.aaai.org/index.php/AAAI/article/view/34526",
                                            timeout=20, retries=1)
            self.assertFalse(failures)
            self.assertEqual(enriched[0]["abstract"], "An & example.")
            self.assertEqual(enriched[0]["abstract_source"], "official_aaai")
            cached = enrichment.load_cached_abstracts([row], Path(directory))[0]
            self.assertEqual(cached["publisher_affiliations"], ["First Institute", "Second Institute"])
            self.assertEqual(cached["publisher_affiliations_url"], enriched[0]["abstract_source_url"])
            self.assertEqual(enrichment.official_abstract_source({**row, "doi": "10.1000/example"}), "")
            with self.assertRaisesRegex(RuntimeError, "DOI or title does not match"):
                enrichment._fetch_aaai_metadata({**row, "title": "Different Paper"})
            with tempfile.TemporaryDirectory() as other_directory:
                _, failures = enrichment.enrich_abstracts(
                    [{**row, "title": "Different Paper"}, row], Path(other_directory),
                    use_external_source=False,
                )
                self.assertEqual(len(failures), 1)
                self.assertIn("DOI or title does not match", next(iter(failures.values())))

    def test_aaai_title_variants_require_doi_and_the_same_ordered_authors(self):
        row = {"source_type": "dblp_proceedings", "doi": "10.1609/aaai.v39i15.33703",
               "title": "A (1+?)-Approximation for Ultrametric Embedding in Subquadratic Time.",
               "authors": "Gabriel Bathie; Guillaume Lagarde 0001"}
        page = (b'<meta name="citation_doi" content="10.1609/aaai.v39i15.33703">'
                b'<meta name="citation_title" content="A (1+&#949;)-Approximation for Ultrametric Embedding in Subquadratic Time">'
                b'<meta name="citation_author" content="Gabriel Bathie">'
                b'<meta name="citation_author" content="Guillaume Lagarde">'
                b'<meta name="DC.Description" content="Publisher abstract.">')
        with patch.object(enrichment.collector, "request_bytes", return_value=(page, {})):
            self.assertEqual(enrichment._fetch_aaai_metadata(row)[0], "Publisher abstract.")
            with self.assertRaisesRegex(RuntimeError, "DOI or title does not match"):
                enrichment._fetch_aaai_metadata({**row, "authors": "Guillaume Lagarde; Gabriel Bathie"})

    def test_aaai_2019_uses_publisher_url_when_doi_suffix_is_not_article_id(self):
        doi = "10.1609/aaai.v33i01.33014189"
        url = "https://ojs.aaai.org/index.php/AAAI/article/view/4324"
        row = {"doi": doi, "title": "Example paper", "publisher_paper_url": url}
        page = (f'<meta name="citation_doi" content="{doi}">'
                '<meta name="citation_title" content="Example paper">'
                '<meta name="citation_author_institution" content="Example University">').encode()
        with patch.object(enrichment.collector, "request_bytes", return_value=(page, {})) as request:
            self.assertEqual(enrichment._fetch_aaai_metadata(row), ("", url, ["Example University"]))
        request.assert_called_once_with(url, timeout=20, retries=1)

    def test_aaai_oai_paginates_and_requires_both_doi_and_title(self):
        doi = "10.1609/aaai.v39i9.33063"
        row = {"conference": "AAAI", "year": 2025, "title": "D2-DPM.", "doi": doi}
        def page(title, token=""):
            return (f'<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/" '
                    f'xmlns:dc="http://purl.org/dc/elements/1.1/"><ListRecords><record><metadata><dc>'
                    f'<dc:title>{title}</dc:title><dc:identifier>{doi}</dc:identifier>'
                    f'<dc:description>Publisher abstract.</dc:description></dc></metadata></record>'
                    f'<resumptionToken>{token}</resumptionToken></ListRecords></OAI-PMH>').encode()
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(enrichment.collector, "request_bytes",
                          side_effect=[(page("Wrong paper", "next+page"), {}), (page("D^2-DPM"), {})]) as request:
            root = Path(directory)
            result = enrichment.scan_aaai_oai_abstracts([row], root)
            self.assertEqual(result, {"pages": 2, "matched": 1, "error": ""})
            self.assertIn("from=2025-01-01", request.call_args_list[0].args[0])
            self.assertTrue(request.call_args_list[1].args[0].endswith("resumptionToken=next%2Bpage"))
            cached = enrichment.load_cached_abstracts([row], root)[0]
            self.assertEqual(cached["abstract"], "Publisher abstract.")
            self.assertEqual(cached["abstract_source"], "official_aaai_oai")
            publisher_page = "https://ojs.aaai.org/index.php/AAAI/article/view/33063"
            with patch.object(enrichment, "_fetch_aaai_metadata",
                              return_value=("HTML abstract.", publisher_page, ["Example Lab"])):
                self.assertEqual(enrichment.enrich_aaai_candidate_affiliations([cached], root), {})
            reloaded = enrichment.load_cached_abstracts([row], root)[0]
            self.assertEqual(reloaded["abstract"], "Publisher abstract.")
            self.assertEqual(reloaded["publisher_affiliations"], ["Example Lab"])
            self.assertEqual(reloaded["publisher_affiliations_url"], publisher_page)
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(enrichment.collector, "request_bytes",
                          side_effect=[(page("Wrong paper", "next+page"), {}), RuntimeError("timed out")]):
            interrupted = enrichment.scan_aaai_oai_abstracts([row], Path(directory))
        self.assertEqual(interrupted["pages"], 1)
        self.assertEqual(interrupted["resumption_token"], "next+page")
        self.assertIn("timed out", interrupted["error"])

    def test_semantic_scholar_requires_a_strong_title_match(self):
        row = {
            "conference": "AAAI",
            "year": 2026,
            "source_record_id": "paper-1",
            "title": "Reliable Graph Learning",
            "authors": "Alice Example",
        }
        payload = {
            "data": [
                {
                    "title": "Reliable Graph Learning",
                    "abstract": "A matched abstract.",
                    "authors": [{"name": "Alice Example"}],
                    "year": 2026,
                }
            ]
        }
        with patch.object(enrichment.collector, "request_json", return_value=(payload, b"", {})):
            match = enrichment._semantic_scholar_abstract(row)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(match[0], "A matched abstract.")
        self.assertEqual(match[2], 1.0)

    def test_export_contains_ai_friendly_structured_record(self):
        row = {
            "conference": "ICML",
            "year": 2026,
            "source_record_id": "paper-1",
            "title": "A Paper",
            "authors": "Alice Example; Bob Example",
            "abstract": "An abstract.",
            "abstract_status": "success",
            "abstract_source": "openreview",
            "keywords": "graph; learning",
            "source_url": "https://example.test/source",
            "pdf_local_path": "C:/papers/paper.pdf",
        }
        with tempfile.TemporaryDirectory() as directory:
            output = enrichment.export_ai_jsonl((row,), Path(directory) / "papers.jsonl")
            records = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["authors"], ["Alice Example", "Bob Example"])
        self.assertEqual(records[0]["abstract"], "An abstract.")
        self.assertEqual(records[0]["local_files"]["pdf_path"], "C:/papers/paper.pdf")

    def test_pdf_without_public_url_is_reported_without_network_access(self):
        row = {
            "conference": "AAAI",
            "year": 2026,
            "source_record_id": "paper-1",
            "title": "A Paper",
        }
        with tempfile.TemporaryDirectory() as directory:
            rows, failures = enrichment.download_pdfs((row,), Path(directory))
        self.assertEqual(rows[0]["pdf_status"], "no_pdf_url")
        self.assertIn(rows[0]["paper_id"], failures)


if __name__ == "__main__":
    unittest.main()
