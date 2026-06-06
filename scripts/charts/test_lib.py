# scripts/charts/test_lib.py
import json
from pathlib import Path
import lib

def test_parse_report_filename_basic():
    r = lib.parse_report_filename("[260603] [Jefferies] Adani - Day 1.pdf")
    assert r == {"yymmdd":"260603","date":"2026-06-03","house":"Jefferies","title":"Adani - Day 1"}

def test_parse_report_filename_brackets_in_house():
    r = lib.parse_report_filename("[260518] [MorganStanley] X - Y.pdf")
    assert r["house"] == "MorganStanley" and r["date"] == "2026-05-18"
    assert r["title"] == "X - Y"  # title captured, not swallowed into house

def test_parse_report_filename_rejects_junk():
    assert lib.parse_report_filename("notes.pdf") is None

def test_fs_slug_strips_illegal_chars():
    s = lib.fs_slug("Jefferies", "260603", "What's changed: a|b#c")
    assert "|" not in s and "#" not in s and "'" not in s and " " not in s
    assert s.startswith("Jefferies_260603_")

def test_fs_slug_edges():
    assert lib.fs_slug() == ""
    assert lib.fs_slug("", "valid") == "valid"          # empty parts skipped
    long = lib.fs_slug("a" * 119 + "__b")               # truncates at 120
    assert len(long) <= 120 and not long.endswith("_")  # no trailing '_' after cut

def test_pad_bbox_clamps():
    assert lib.pad_bbox([0.0, 0.0, 1.0, 1.0], 0.02) == [0.0, 0.0, 1.0, 1.0]
    out = lib.pad_bbox([0.5, 0.5, 0.6, 0.6], 0.1)
    assert out == [0.4, 0.4, 0.7, 0.7]

def test_norm_to_points():
    assert lib.norm_to_points([0.0,0.0,0.5,0.5], 600, 800) == [0.0,0.0,300.0,400.0]

def test_source_type():
    assert lib.source_type("India Macro") == "theme"
    assert lib.source_type("Indian Financials") == "sector"
    assert lib.source_type("Bajaj Finance") == "company"

def test_company_sector(tmp_path):
    p = tmp_path / "companies.json"
    p.write_text(json.dumps({"Bajaj Finance":{"ticker":"X","sector":"NBFC","desc":"d"}}), encoding="utf-8")
    assert lib.company_sector("Bajaj Finance", str(p)) == "NBFC"
    assert lib.company_sector("Nonexistent", str(p)) is None
    assert lib.company_sector(None, str(p)) is None
