import csv
import io
import json
import shlex
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from code import fetch_openreview_accepted as collector
from code import query_research_topic as topic


CONFIG = {
    "search_fields": ["title", "abstract", "keywords", "tldr"],
    "context_anchors": ["agent", "agentic", "llm", "language model"],
    "query_groups": {
        "memory": {"terms": ["episodic memory", "memory retrieval"]},
        "evolving": {"direct": True, "terms": ["self-evolving agent"]},
        "tools": {"terms": ["tool creation"]},
    },
}


class ArgumentTests(unittest.TestCase):
    def test_config_and_output_directory_are_required(self):
        for argv, missing in (([], "--config"),
                              (["--output-dir", "results"], "--config"),
                              (["--config", "query.json"], "--output-dir")):
            with self.subTest(argv=argv):
                stderr = io.StringIO()
                with redirect_stderr(stderr), self.assertRaises(SystemExit) as raised:
                    topic.main(argv)
                self.assertEqual(raised.exception.code, 2)
                self.assertIn(missing, stderr.getvalue())


class MatchingTests(unittest.TestCase):
    def test_spatial_preset_recalls_visual_navigation_and_language_assistance(self):
        config_path = Path(__file__).resolve().parents[1] / "configs" / "spatial_intelligence_vln.json"
        config = json.loads(config_path.read_text(encoding="utf-8"))
        cases = {
            "Self-Adaptive Visual Navigation Using Meta-Learning": "spatial_navigation",
            "Sim-Real Joint Reinforcement Transfer for 3D Indoor Navigation": "spatial_navigation",
            "Scene Memory Transformer for Embodied Agents in Long-Horizon Tasks": "spatial_navigation_methods",
            "Vision-Based Navigation With Language-Based Assistance": "vision_language_navigation",
        }
        for title, group in cases.items():
            with self.subTest(title=title):
                hits = topic.find_matches({"title": title}, config)
                self.assertIn(group, {hit["group"] for hit in hits})

    def test_exact_topic_term_rejects_shared_prefixes_and_preserves_evidence(self):
        config = {"query_groups": {"spatial": {
            "direct": True, "terms": ["spatial relation", "spatial relations", "EmbodiedQA"],
            "exact_terms": ["spatial relation", "spatial relations", "EmbodiedQA"],
        }}}
        miss = {"title": "Spatially related instances in embodied recognition"}
        self.assertEqual(topic.find_matches(miss, config), [])
        row = {"title": "Spatial relations for EmbodiedQA"}
        candidates, _ = topic.search_papers([row], config)
        self.assertEqual(candidates[0]["matched_terms"], ["EmbodiedQA", "spatial relations"])
        self.assertTrue(all(item["match_mode"] == "exact" for item in candidates[0]["matched_snippets"]))

    def test_title_match(self):
        hits = topic.find_matches({"title": "Episodic Memory for LLM Agents"}, CONFIG)
        self.assertEqual(hits[0]["field"], "title")

    def test_abstract_match_when_title_does_not(self):
        row = {"title": "Persistent Assistants", "abstract": "Our language model agent performs memory retrieval."}
        self.assertEqual(topic.find_matches(row, CONFIG)[0]["field"], "abstract")

    def test_hyphen_space_and_case_variants(self):
        self.assertTrue(topic.phrase_matches("A SELF EVOLVING AGENT", "self-evolving agent"))
        self.assertTrue(topic.phrase_matches("Self-Evolving Agents", "self evolving agent"))

    def test_evidence_is_merged_across_groups(self):
        row = {"openreview_id": "one", "conference": "ICLR", "year": 2026,
               "title": "Self-Evolving Agent with Episodic Memory", "abstract": "An LLM agent."}
        candidates, _ = topic.search_papers([row], CONFIG)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["matched_query_groups"], ["evolving", "memory"])

    def test_duplicate_records_are_merged(self):
        base = {"openreview_id": "same", "conference": "ICML", "year": 2026,
                "title": "Episodic Memory for Agents", "abstract": "LLM agent"}
        candidates, _ = topic.search_papers([base, dict(base)], CONFIG)
        self.assertEqual(len(candidates), 1)

    def test_case_distinct_source_ids_remain_separate(self):
        for field in ("openreview_id", "source_record_id"):
            with self.subTest(field=field):
                rows = [{field: identifier, "title": "Self-Evolving Agent"}
                        for identifier in ("PaperA", "papera")]
                candidates, _ = topic.search_papers(rows, CONFIG)
                self.assertEqual(len(candidates), 2)

    def test_memory_without_agent_context_is_not_enough(self):
        self.assertEqual(topic.find_matches({"title": "Episodic Memory in Humans"}, CONFIG), [])

    def test_evolutionary_algorithm_is_not_matched(self):
        row = {"title": "A Classical Evolutionary Algorithm", "abstract": "Population optimization"}
        self.assertEqual(topic.find_matches(row, CONFIG), [])


class OutputAndSnapshotTests(unittest.TestCase):
    def test_collection_failure_stops_before_writing_partial_results(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.json"
            source.write_text("{}", encoding="utf-8")
            config_path = root / "config.json"
            config_path.write_text(json.dumps({**CONFIG, "targets": [
                {"conference": "ICLR", "year": 2026},
                {"conference": "ICML", "year": 2026},
                {"conference": "ICLR", "year": 2025},
            ]}), encoding="utf-8")
            row = {"openreview_id": "PaperA", "title": "Self-Evolving Agent",
                   "venueid": collector.CONFERENCE_SPECS["ICLR"].venue_id(2026)}
            manifest = {"counts": {"accepted_paper_count": 1},
                        "outputs": {key: str(source) for key in ("manifest", "csv", "jsonl")}}
            output = root / "results"
            stdout = io.StringIO()
            with patch.object(topic.collector, "build_conference_outputs", side_effect=[
                (manifest, [row], []), RuntimeError("source unavailable"),
            ]) as build, patch.object(topic, "enrich_missing_candidate_abstracts") as enrich:
                with redirect_stdout(stdout):
                    status = topic.main(["--config", str(config_path), "--output-dir", str(output),
                                         "--snapshot-output-root", str(root / "snapshots")])
            self.assertEqual(status, 1)
            self.assertEqual(build.call_count, 2)
            enrich.assert_not_called()
            self.assertFalse(output.exists())
            failure = json.loads(stdout.getvalue())
            self.assertEqual(failure["status"], "failed")
            self.assertIn("ICML-2026", failure["error"])
            self.assertIn("source unavailable", failure["error"])

    def test_custom_configuration_is_reflected_in_outputs_and_command(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "custom config.json"
            config = {"targets": [{"conference": "ICLR", "year": 2025}],
                      "search_fields": ["title"], "query_groups": {
                          "forecasting": {"direct": True, "terms": ["forecasting"]}}}
            config_path.write_text(json.dumps(config), encoding="utf-8")
            output = root / "custom results"
            snapshots = root / "custom snapshots"
            row = {"openreview_id": "PaperA", "conference": "ICLR", "year": 2025,
                   "title": "Forecasting", "abstract": "An existing abstract."}
            with patch.object(topic, "collect_snapshots", return_value=([row], [], {}, [])):
                manifest = topic.run_pipeline(config_path, output, snapshots)
            readme = (output / "README.md").read_text(encoding="utf-8")
            self.assertIn("ICLR 2025", readme)
            self.assertIn("## Search fields\n\n`title`.", readme)
            self.assertIn("`forecasting`", readme)
            self.assertNotIn("ICML 2026", readme)
            self.assertNotIn("Agent Memory", readme)
            command = shlex.split(manifest["command"])
            args = topic.parse_args(command[3:])
            self.assertEqual(args.config, config_path)
            self.assertEqual(args.output_dir, output)
            self.assertEqual(args.snapshot_output_root, snapshots)
            self.assertIn(manifest["command"], readme)
            saved = json.loads((output / "run_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["command"], manifest["command"])
            self.assertEqual(saved["deduplicated_candidate_count"], 1)

    def test_openalex_abstract_scan_recalls_abstract_only_match_with_annotations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "config.json"
            config_path.write_text(json.dumps({
                "targets": [{"conference": "ICLR", "year": 2025}],
                "query_groups": {"navigation": {"direct": True, "terms": ["language navigation"]}},
                "institution_labels": {"Example Research Lab": ["Example Lab"]},
            }), encoding="utf-8")
            row = {"doi": "10.1234/example", "conference": "ICLR", "year": 2025,
                   "title": "Learning from Experience"}
            work = {"doi": "https://doi.org/10.1234/example", "id": "https://openalex.org/W1",
                    "cited_by_count": 0, "abstract_inverted_index": {"navigation": [1], "language": [0]},
                    "authorships": [{"raw_affiliation_strings": ["Example Lab, University"]}]}
            output = root / "results"
            with patch.dict("os.environ", {"OPENALEX_API_KEY": "test-key"}), \
                 patch.object(topic, "collect_snapshots",
                              return_value=([row], [{"conference": "ICLR", "year": 2025,
                                                     "accepted_paper_count": 1}], {}, [])), \
                 patch.object(topic.openalex_metadata, "_get",
                              return_value={"meta": {"count": 1}, "results": [work]}) as request:
                manifest = topic.run_pipeline(config_path, output, root / "snapshots",
                                              enrich_openalex=True, scan_openalex_abstracts=True)
            request.assert_called_once()
            paper = json.loads((output / "candidate_papers.jsonl").read_text(encoding="utf-8"))
            self.assertEqual(paper["matched_fields"], ["abstract"])
            self.assertEqual(paper["cited_by_count"], 0)
            self.assertEqual(paper["abstract_source"], "OpenAlex")
            self.assertEqual(paper["institution_tag_evidence"], {"Example Research Lab": ["Example Lab, University"]})
            self.assertEqual(manifest["snapshots"][0]["missing_abstracts_before_search"], 0)

    def test_crossref_resume_preserves_zero_and_checks_publisher_identity(self):
        base = {"conference": "NIPS", "year": 2025, "title": "Vision Navigation",
                "authors": "Alice Example", "publisher_paper_url": "https://example.org/canonical"}
        good = {**base, "openreview_id": "forum1"}
        changed = {**base, "openreview_id": "forum2", "publisher_paper_url": "https://example.org/changed"}
        provenance = {"crossref_cited_by_count": 0, "crossref_citation_doi": "10.1234/example",
                      "crossref_citations_retrieved_at": "2026-01-01T00:00:00Z"}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "candidate_papers.jsonl"
            path.write_text(json.dumps({**good, **provenance}) + "\n"
                            + json.dumps({**base, "openreview_id": "forum2", **provenance}) + "\n",
                            encoding="utf-8")
            self.assertEqual(topic.reuse_crossref_citations([good, changed], path), 1)
        self.assertEqual(good["crossref_cited_by_count"], 0)
        self.assertEqual(good["crossref_citation_doi"], "10.1234/example")
        self.assertNotIn("crossref_cited_by_count", changed)

    def test_neurips_publisher_links_require_unique_identity_within_track(self):
        first = {"title": "Spatial Reasoning", "authors": "Alice Example; Bob Example"}
        duplicate = {"title": "Navigation", "authors": "Carol Example"}
        alias = {"title": "Robot Navigation", "authors": "Ada B. Example; Eve Writer; Dave Author"}
        rows = [first, duplicate, dict(duplicate), alias]
        publications = {
            ("Dataset Track", "spatial reasoning"): [{**first, "paper_url": "dataset"}],
            ("Main Track", "spatial reasoning"): [{**first, "paper_url": "main"}],
            ("Main Track", "navigation"): [{**duplicate, "paper_url": "ambiguous"}],
            ("Main Track", "robot navigation"): [
                {**alias, "authors": "Ada Example; Eve Writer; Dave Author", "paper_url": "unique"}
            ],
        }
        self.assertEqual(topic._link_neurips_publications(rows, "Main Track", publications), 2)
        self.assertEqual(first["publisher_paper_url"], "main")
        self.assertEqual(alias["publisher_paper_url"], "unique")
        self.assertFalse(any("publisher_paper_url" in r for r in rows[1:3]))

    def test_neurips_program_requires_published_hash_and_matching_title(self):
        uid = "1" * 32
        row = {"year": 2020, "title": "Vision Navigation", "source_type": "official_neurips",
               "source_record_id": f"/paper_files/paper/2020/hash/{uid}-Abstract.html"}
        other = {**row, "source_record_id": f"/paper_files/paper/2020/hash/{'2' * 32}-Abstract.html"}
        data = {"count": 2, "next": None, "results": [
            {"uid": uid, "name": "Vision Navigation", "abstract": "Matching abstract."},
            {"uid": "2" * 32, "name": "Other Paper", "abstract": "Unrelated abstract."},
        ]}
        with patch.object(topic.collector, "request_bytes", return_value=(json.dumps(data).encode(), {})):
            self.assertEqual(topic.load_neurips_program_abstracts([row, other]), {})
        self.assertEqual(row["abstract"], "Matching abstract.")
        self.assertFalse(other.get("abstract"))

    def test_unavailable_cvf_program_leaves_paper_for_openalex_scan(self):
        row = {"conference": "CVPR", "year": 2025, "title": "Navigation"}
        with patch.object(topic.collector, "request_bytes", side_effect=RuntimeError("request timed out")) as request:
            errors = topic.load_cvf_program_abstracts([row])
        self.assertEqual(errors, {"CVPR-2025": "request timed out"})
        self.assertFalse(row.get("abstract"))
        self.assertEqual(request.call_args.kwargs, {"timeout": 30, "retries": 1})

    def test_cvf_program_without_abstract_fields_leaves_paper_for_detail_scan(self):
        row = {"conference": "CVPR", "year": 2026, "title": "Navigation"}
        page = {"count": 2, "next": "/api/events?offset=1", "results": [{"name": "Navigation"}]}
        with patch.object(topic.collector, "request_bytes", return_value=(json.dumps(page).encode(), {})):
            errors = topic.load_cvf_program_abstracts([row])
        self.assertIn("does not provide abstract fields", errors["CVPR-2026"])
        self.assertFalse(row.get("abstract"))

    def test_official_abstract_scan_precedes_openalex_missing_abstract_scan(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.json"
            config.write_text(json.dumps({
                "targets": [{"conference": "ECCV", "year": 2018}],
                "query_groups": {"navigation": {"direct": True, "terms": ["navigation"]}},
            }), encoding="utf-8")
            official = {"conference": "ECCV", "year": 2018, "source_type": "official_ecva",
                        "source_record_id": "published", "title": "Depth Estimation"}
            missing = {"conference": "ECCV", "year": 2018, "source_record_id": "other",
                       "title": "Another Approach"}
            with patch.object(topic, "collect_snapshots", return_value=([official, missing], [], {}, [])), \
                 patch.object(topic.paper_enrichment, "enrich_abstracts",
                              return_value=([{**official, "abstract": "We estimate depth."}], {})), \
                 patch.object(topic.openalex_metadata, "enrich_rows", return_value=(set(), "")) as enrich:
                topic.run_pipeline(config, root / "results", root / "snapshots", enrich_openalex=True,
                                   scan_official_abstracts=True, scan_openalex_abstracts=True)
            self.assertEqual([call.args[0] for call in enrich.call_args_list], [[missing], []])

    def test_screening_export_includes_misses_and_review_fields(self):
        rows = [
            {"conference": "CVPR", "year": 2025, "title": "Language Navigation", "source_record_id": "nav"},
            {"conference": "CVPR", "year": 2025, "title": "Exploration", "source_record_id": "other"},
        ]
        candidates = [{**rows[0], "abstract": "Enriched abstract", "matched_terms": ["language navigation"]}]
        with tempfile.TemporaryDirectory() as directory:
            path = topic.write_screening_csv(Path(directory) / "screening.csv", rows, candidates)
            with path.open(encoding="utf-8-sig", newline="") as stream:
                exported = list(csv.DictReader(stream))
        self.assertEqual([row["keyword_hit"] for row in exported], ["yes", "no"])
        self.assertEqual(exported[0]["abstract"], "Enriched abstract")
        self.assertEqual(exported[1]["paper_key"], "source_record_id:CVPR:2025:other")
        self.assertTrue(all(not row["review_decision"] and not row["review_note"] for row in exported))

    def test_review_decisions_export_included_keyword_miss_and_report_pending(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.json"
            config.write_text(json.dumps({
                "targets": [{"conference": "ICLR", "year": 2025}],
                "query_groups": {"navigation": {"direct": True, "terms": ["navigation"]}},
            }), encoding="utf-8")
            papers = [
                {"conference": "ICLR", "year": 2025, "title": title,
                 "source_record_id": str(index), "abstract": "Study."}
                for index, title in enumerate(("Exploration", "Navigation", "Another Navigation"))
            ]
            screening = root / "screening.csv"
            keys = ["conference", "year", "paper_key", "title", "doi", "review_decision", "review_note"]
            collector.write_csv(screening, [
                {**{key: paper[key] for key in ("conference", "year", "title")},
                 "paper_key": topic.paper_identity(paper), "review_decision": decision, "review_note": decision}
                for paper, decision in zip(papers[:2], ("include", "exclude"))
            ], keys)
            output = root / "results"
            snapshot = {"conference": "ICLR", "year": 2025, "accepted_paper_count": 3}
            with patch.object(topic, "collect_snapshots", return_value=(papers, [snapshot], {}, [])), \
                 redirect_stdout(io.StringIO()):
                status = topic.main(["--config", str(config), "--output-dir", str(output),
                                     "--snapshot-output-root", str(root), "--screening-decisions", str(screening),
                                     "--export-screening"])
            self.assertEqual(status, 1)
            paper = json.loads((output / "candidate_papers.jsonl").read_text())
            self.assertEqual((paper["title"], paper["review_decision"], paper["review_note"]),
                             ("Exploration", "include", "include"))
            self.assertEqual(paper["matched_terms"], [])
            with (output / "screening.csv").open(encoding="utf-8-sig", newline="") as stream:
                exported = list(csv.DictReader(stream))
            self.assertEqual(
                [(row["keyword_hit"], row["review_decision"], row["review_note"]) for row in exported],
                [("no", "include", "include"), ("yes", "exclude", "exclude"), ("yes", "", "")],
            )
            report = json.loads((output / "run_manifest.json").read_text())
            self.assertEqual(report["screening_decision_counts"], {"include": 1, "exclude": 1, "pending": 1})

    def test_official_cvf_scan_recalls_keyword_miss_before_matching(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.json"
            config.write_text(json.dumps({
                "targets": [{"conference": "CVPR", "year": 2019}],
                "query_groups": {"navigation": {"direct": True, "terms": ["language navigation"]}},
            }), encoding="utf-8")
            paper = {"conference": "CVPR", "year": 2019, "title": "The Regretful Agent", "source_record_id": "1",
                     "source_type": "official_cvf_openaccess",
                     "paper_url": "https://openaccess.thecvf.com/content_CVPR_2019/html/test_paper.html"}
            page = b'<div id="papertitle">The Regretful Agent</div><div id="abstract" >Language navigation.</div>'
            snapshot = {"conference": "CVPR", "year": 2019, "accepted_paper_count": 1}
            with patch.object(topic, "collect_snapshots", return_value=([paper], [snapshot], {}, [])), \
                 patch.object(topic.collector, "request_bytes", return_value=(page, {})) as request:
                manifest = topic.run_pipeline(config, root / "results", root, scan_official_abstracts=True)
            request.assert_called_once()
            self.assertEqual(manifest["snapshots"][0]["missing_abstracts_before_search"], 0)
            candidate = json.loads((root / "results/candidate_papers.jsonl").read_text())
            self.assertEqual(candidate["matched_fields"], ["abstract"])
            self.assertEqual(candidate["abstract_source"], "official_cvf_openaccess")

    def test_openalex_doi_batch_keeps_exact_matches_when_provider_substitutes_a_doi(self):
        rows = [{"doi": "10.1234/conference-1"}, {"doi": "10.1234/conference-2"}]
        works = [
            {"id": "https://openalex.org/W1", "doi": "https://doi.org/10.1234/journal-1", "cited_by_count": 120},
            {"id": "https://openalex.org/W2", "doi": "https://doi.org/10.1234/conference-2", "cited_by_count": 9},
        ]
        page = {"meta": {"count": 2}, "results": works}
        with patch.object(topic.openalex_metadata, "_get", return_value=page):
            unrequested, rate_limit = topic.openalex_metadata.enrich_rows(rows, "", topic.normalize_text, topic.utc_now)
        self.assertEqual(unrequested, {"https://doi.org/10.1234/journal-1"})
        self.assertFalse(rate_limit)
        self.assertEqual(rows[0]["openalex_status"], "unmatched")
        self.assertNotIn("cited_by_count", rows[0])
        self.assertEqual(rows[1]["cited_by_count"], 9)

    def test_openalex_quota_keeps_successful_batches_and_exports_partial_results(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.json"
            config.write_text(json.dumps({
                "targets": [{"conference": "ICLR", "year": 2025}],
                "query_groups": {"navigation": {"direct": True, "terms": ["navigation"]}},
            }), encoding="utf-8")
            rows = [
                {"conference": "ICLR", "year": 2025, "title": "Learning from Experience", "doi": "10.1234/one"},
                {"conference": "ICLR", "year": 2025, "title": "Open Navigation", "authors": "Lee"},
            ]
            resumed_rows = [dict(row) for row in rows]
            snapshot = {"conference": "ICLR", "year": 2025, "accepted_paper_count": 2}
            work = {"id": "https://openalex.org/W1", "doi": "https://doi.org/10.1234/one",
                    "cited_by_count": 8, "abstract_inverted_index": {"navigation": [0]}}
            error = topic.openalex_metadata.OpenAlexRateLimitError("HTTP 429")
            output = root / "results"
            checkpoint = root / "openalex.sqlite3"
            with patch.object(topic, "collect_snapshots", return_value=(rows, [snapshot], {}, [])), \
                 patch.object(topic, "enrich_missing_candidate_abstracts", side_effect=lambda candidates, _: (candidates, {})), \
                 patch.object(topic.openalex_metadata, "_get", side_effect=[
                     {"meta": {"count": 1}, "results": [work]}, error,
                 ]) as request, redirect_stdout(io.StringIO()):
                status = topic.main(["--config", str(config), "--output-dir", str(output),
                                     "--snapshot-output-root", str(root), "--enrich-openalex",
                                     "--scan-openalex-abstracts", "--export-screening",
                                     "--openalex-checkpoint", str(checkpoint)])
            report = json.loads((output / "run_manifest.json").read_text())
            self.assertEqual(status, 1)
            self.assertEqual(request.call_count, 2)
            self.assertEqual(report["openalex_status_counts"], {"matched": 1, "rate_limited": 1})
            self.assertEqual(report["snapshots"][0]["openalex_abstract_scan_rate_limited"], 1)
            self.assertTrue((output / "screening.csv").is_file())

            first_pass = [json.loads(line) for line in (output / "candidate_papers.jsonl").read_text().splitlines()]
            original_date = next(row["openalex_retrieved_at"] for row in first_pass if row["doi"])
            second = {"id": "https://openalex.org/W2", "title": "Open Navigation", "publication_year": 2025,
                      "authorships": [{"raw_author_name": "Lee"}], "cited_by_count": 4,
                      "abstract_inverted_index": {"navigation": [0]}}
            with patch.object(topic, "collect_snapshots", return_value=(resumed_rows, [snapshot], {}, [])), \
                 patch.object(topic, "utc_now", return_value="2026-12-01T00:00:00+00:00"), \
                 patch.object(topic.openalex_metadata, "_get", return_value={"meta": {"count": 1}, "results": [second]}) as request:
                resumed = topic.run_pipeline(config, root / "resumed", root, enrich_openalex=True,
                                              scan_openalex_abstracts=True, openalex_checkpoint=checkpoint)
            request.assert_called_once()
            self.assertIn("title.search", request.call_args.args[0]["filter"])
            self.assertEqual(resumed["openalex_status_counts"], {"matched": 2})
            rows_after = [json.loads(line) for line in (root / "resumed/candidate_papers.jsonl").read_text().splitlines()]
            self.assertEqual(next(row["openalex_retrieved_at"] for row in rows_after if row["doi"]), original_date)

    def test_csv_and_jsonl_have_complete_identical_fields(self):
        row = {field: "value" for field in topic.CANDIDATE_FIELDS}
        row["matched_query_groups"] = ["memory"]
        row["matched_terms"] = ["episodic memory"]
        row["matched_fields"] = ["title"]
        row["matched_snippets"] = [{"field": "title", "text": "Episodic Memory"}]
        with tempfile.TemporaryDirectory() as directory:
            csv_path, jsonl_path = topic.write_candidate_files(Path(directory), [row])
            with csv_path.open(encoding="utf-8-sig", newline="") as handle:
                csv_fields = set(next(csv.DictReader(handle)).keys())
            json_fields = set(json.loads(jsonl_path.read_text(encoding="utf-8").strip()).keys())
        self.assertEqual(csv_fields, set(topic.CANDIDATE_FIELDS))
        self.assertEqual(json_fields, set(topic.CANDIDATE_FIELDS))

    def test_openalex_title_match_accepts_exact_published_author_name(self):
        other = {"title": "Spatial Reasoning", "year": 2018, "authors": "Ada Smith"}
        row = {"title": "Navigation in a Real Environment", "year": 2018, "authors": "Wang, Xin"}
        work = {"title": row["title"], "publication_year": 2018, "id": "https://openalex.org/W1",
                "cited_by_count": 12, "authorships": [
                    {"author": {"display_name": "Xin Eric Wang"}, "raw_author_name": "Xin Wang"},
                ]}
        unrelated = {**work, "title": other["title"], "id": "https://openalex.org/W2"}
        page = {"meta": {"count": 2}, "results": [work, unrelated]}
        with patch.object(topic.openalex_metadata, "_get", return_value=page) as request:
            topic.openalex_metadata.enrich_rows([row, other], "", topic.normalize_text, topic.utc_now)
        request.assert_called_once()
        self.assertEqual(row["openalex_status"], "matched")
        self.assertEqual(row["cited_by_count"], 12)
        self.assertEqual(other["openalex_status"], "unmatched")

    def test_ecva_title_match_uses_unique_springer_version_over_arxiv(self):
        row = {"title": "Spatial Reasoning", "year": 2018, "authors": "Ada Smith", "source_type": "official_ecva"}
        preprint = {"id": "https://openalex.org/W1", "doi": "https://doi.org/10.48550/arXiv.1808.00001",
                    "title": row["title"], "publication_year": 2018,
                    "authorships": [{"raw_author_name": "Ada Smith"}], "cited_by_count": 4}
        published = {**preprint, "id": "https://openalex.org/W2",
                     "doi": "https://doi.org/10.1007/example_1", "cited_by_count": 12}
        page = {"meta": {"count": 2}, "results": [preprint, published]}
        with patch.object(topic.openalex_metadata, "_get", return_value=page):
            topic.openalex_metadata.enrich_rows([row], "", topic.normalize_text, topic.utc_now)
        self.assertEqual(row["openalex_url"], published["id"])
        self.assertEqual(row["openalex_match_method"], "title_year_first_author_publisher")
        self.assertEqual(row["cited_by_count"], 12)

    def test_cvf_title_match_selects_main_conference_doi_over_workshop(self):
        row = {"title": "Embodied Question Answering", "year": 2018, "conference": "CVPR",
               "authors": "Das, Abhishek", "source_type": "official_cvf_openaccess"}
        main = {"id": "https://openalex.org/W1", "doi": "https://doi.org/10.1109/CVPR.2018.00008",
                "title": row["title"], "publication_year": 2018,
                "authorships": [{"raw_author_name": "Abhishek Das"}], "cited_by_count": 12}
        workshop = {**main, "id": "https://openalex.org/W2",
                    "doi": "https://doi.org/10.1109/CVPRW.2018.00279", "cited_by_count": 4}
        page = {"meta": {"count": 2}, "results": [workshop, main]}
        with patch.object(topic.openalex_metadata, "_get", return_value=page):
            topic.openalex_metadata.enrich_rows([row], "", topic.normalize_text, topic.utc_now)
        self.assertEqual(row["openalex_url"], main["id"])
        self.assertEqual(row["openalex_match_method"], "title_year_first_author_venue_doi")
        self.assertEqual(row["cited_by_count"], 12)

    def test_valid_snapshot_is_requested_with_cache_reuse(self):
        spec = collector.CONFERENCE_SPECS["ICLR"]
        row = {"conference": "ICLR", "year": 2026, "openreview_id": "paper-1",
               "source_record_id": "paper-1", "venueid": spec.venue_id(2026), "title": "Paper"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            conference_dir = root / "2026" / "ICLR"
            csv_path = conference_dir / "papers.csv"
            jsonl_path = conference_dir / "papers.jsonl"
            manifest_path = conference_dir / "source_manifest.json"
            collector.write_csv(csv_path, [row], collector.CSV_FIELDS)
            collector.write_jsonl(jsonl_path, [{"normalized": row}])
            manifest = {"counts": {"accepted_paper_count": 1}, "source_kind": "openreview",
                        "collection_status": "reused_local_snapshot",
                        "outputs": {"csv": str(csv_path), "jsonl": str(jsonl_path), "manifest": str(manifest_path)}}
            collector.write_json(manifest_path, manifest)
            config = {"targets": [{"conference": "ICLR", "year": 2026}]}
            with patch.object(topic.collector, "build_conference_outputs", return_value=(manifest, [row], [])) as build:
                papers, snapshots, errors, _ = topic.collect_snapshots(config, root)
        self.assertFalse(build.call_args.kwargs["refresh"])
        self.assertEqual(len(papers), 1)
        self.assertEqual(snapshots[0]["accepted_paper_count"], 1)
        self.assertEqual(errors, {})


if __name__ == "__main__":
    unittest.main()
