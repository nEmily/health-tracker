"""baseline_latency.py — Measure cron processing latency from existing log files.

Parses processing-*.log files in {data_dir}/logs/ for lines containing
"elapsed:" or "Elapsed:" followed by a number of seconds.  Returns p50/p95
over the rolling window.

Usage (CLI):
    python processing/lib/baseline_latency.py /path/to/coach/data
"""
import math
import re
import sys
from pathlib import Path
from datetime import datetime, timedelta

_ELAPSED_RE = re.compile(r'[Ee]lapsed[:\s]+([0-9]+(?:\.[0-9]+)?)\s*s', re.IGNORECASE)
_DATE_IN_NAME_RE = re.compile(r'processing-(\d{4}-\d{2}-\d{2})')


def measure(data_dir, window_days=7):
    """Parse processing logs and return latency percentiles.

    Returns a dict with keys p50_seconds, p95_seconds, sample_count,
    period_days, or None if no log files exist.
    """
    logs_dir = Path(data_dir) / 'logs'
    if not logs_dir.exists():
        print('no baseline data')
        return None

    cutoff = datetime.now() - timedelta(days=window_days)
    samples = []

    for log_file in sorted(logs_dir.glob('processing-*.log')):
        m = _DATE_IN_NAME_RE.search(log_file.name)
        if m:
            try:
                log_date = datetime.strptime(m.group(1), '%Y-%m-%d')
                if log_date < cutoff:
                    continue
            except ValueError:
                pass

        try:
            text = log_file.read_text(encoding='utf-8', errors='ignore')
        except OSError:
            continue

        for match in _ELAPSED_RE.finditer(text):
            try:
                samples.append(float(match.group(1)))
            except ValueError:
                pass

    if not samples:
        print('no baseline data')
        return None

    samples_sorted = sorted(samples)
    n = len(samples_sorted)

    def percentile(data, pct):
        # Nearest-rank method: ceiling(pct/100 * n), 1-indexed → 0-indexed.
        idx = min(len(data) - 1, max(0, math.ceil(pct / 100 * len(data)) - 1))
        return data[idx]

    return {
        'p50_seconds': round(percentile(samples_sorted, 50), 1),
        'p95_seconds': round(percentile(samples_sorted, 95), 1),
        'sample_count': n,
        'period_days': window_days,
    }


if __name__ == '__main__':
    data_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    result = measure(data_dir)
    if result:
        print(f'\n| Metric        | Value   |')
        print( '|---------------|---------|')
        print(f'| p50 (seconds) | {result["p50_seconds"]:<7} |')
        print(f'| p95 (seconds) | {result["p95_seconds"]:<7} |')
        print(f'| Samples       | {result["sample_count"]:<7} |')
        print(f'| Window (days) | {result["period_days"]:<7} |')
