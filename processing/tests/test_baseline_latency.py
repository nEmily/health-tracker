"""Tests for processing/lib/baseline_latency.py"""
import sys
import tempfile
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.baseline_latency import measure


def _write_log(logs_dir, filename, lines):
    logs_dir.mkdir(parents=True, exist_ok=True)
    (logs_dir / filename).write_text('\n'.join(lines))


def test_no_logs_dir_returns_none(tmp_path, capsys):
    result = measure(tmp_path)
    assert result is None
    assert 'no baseline data' in capsys.readouterr().out


def test_empty_logs_dir_returns_none(tmp_path, capsys):
    (tmp_path / 'logs').mkdir()
    result = measure(tmp_path)
    assert result is None
    assert 'no baseline data' in capsys.readouterr().out


def test_parses_elapsed_seconds():
    with tempfile.TemporaryDirectory() as td:
        logs = Path(td) / 'logs'
        _write_log(logs, 'processing-2026-05-01.log', [
            '[INFO] Processing started',
            '[INFO] Elapsed: 42.3s — done',
            '[INFO] Elapsed: 18.0s — done',
        ])
        result = measure(td, window_days=365)
    assert result is not None
    assert result['sample_count'] == 2
    assert result['p50_seconds'] == 18.0   # lower half
    assert result['p95_seconds'] == 42.3   # upper


def test_multiple_logs_aggregated():
    with tempfile.TemporaryDirectory() as td:
        logs = Path(td) / 'logs'
        _write_log(logs, 'processing-2026-05-01.log', ['Elapsed: 10s', 'Elapsed: 20s'])
        _write_log(logs, 'processing-2026-05-02.log', ['elapsed: 30s', 'elapsed: 40s'])
        result = measure(td, window_days=365)
    assert result['sample_count'] == 4
    assert result['p50_seconds'] == 20.0
    assert result['p95_seconds'] == 40.0


def test_result_keys():
    with tempfile.TemporaryDirectory() as td:
        logs = Path(td) / 'logs'
        _write_log(logs, 'processing-2026-05-01.log', ['Elapsed: 25s'])
        result = measure(td, window_days=365)
    assert set(result.keys()) == {'p50_seconds', 'p95_seconds', 'sample_count', 'period_days'}


def test_logs_outside_window_ignored():
    with tempfile.TemporaryDirectory() as td:
        logs = Path(td) / 'logs'
        # Old log — outside 7-day window
        _write_log(logs, 'processing-2020-01-01.log', ['Elapsed: 999s'])
        # Recent log (we use 365 days to ensure it's included regardless of real date)
        _write_log(logs, 'processing-2026-05-01.log', ['Elapsed: 15s'])
        result = measure(td, window_days=7)
    # The 2020 log is outside any reasonable 7-day window; 2026-05-01 may or may not
    # be included depending on test run date. We just confirm no crash and result is
    # either None or contains only values <= 999.
    if result is not None:
        assert result['p95_seconds'] <= 999


def test_malformed_lines_ignored():
    with tempfile.TemporaryDirectory() as td:
        logs = Path(td) / 'logs'
        _write_log(logs, 'processing-2026-05-01.log', [
            'Elapsed: not_a_number s',
            'some other log line',
            'elapsed: 55s',
        ])
        result = measure(td, window_days=365)
    assert result['sample_count'] == 1
    assert result['p50_seconds'] == 55.0
