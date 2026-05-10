"""Clean conversations.md: remove duplicate user msgs + duplicate coach lines.

Bug: append_conversations was re-appending the entire day's chat each cron
tick (no dedup), and using today's date instead of the date being processed.
Result: 5/4 had 58 user messages (8 unique) and 0 coach replies.

This script reads conversations.md, parses each date section, deduplicates
lines (by role + post-timestamp text), and rewrites the file with one entry
per unique line, keeping the original first-seen order.

Idempotent. Safe to re-run.
"""
from __future__ import annotations
import re
from pathlib import Path
import sys


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "coach/conversations.md")
    if not path.exists():
        print(f"{path} not found")
        return 1
    content = path.read_text(encoding="utf-8")

    # Split into header + body sections.
    # Headers can be either "## YYYY-MM-DD" or "## Friday, May 4, 2026"
    header_re = re.compile(r"^## .+$", re.MULTILINE)
    matches = list(header_re.finditer(content))
    if not matches:
        print("No date headers found.")
        return 0

    # Lead (everything before first header) preserved as-is
    lead = content[: matches[0].start()]
    out_parts = [lead]

    line_text_re = re.compile(
        r"^\*\*(User|Coach)\*\*\s+\([^)]+\):\s*(.+)$",
        re.MULTILINE,
    )

    total_removed = 0
    for i, m in enumerate(matches):
        header = m.group(0)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        section = content[start:end]

        # Walk lines; keep first occurrence of each (role, normalized text)
        lines = section.split("\n")
        seen: set[tuple[str, str]] = set()
        kept_lines: list[str] = []
        for line in lines:
            mm = re.match(r"^\*\*(User|Coach)\*\*\s+\([^)]+\):\s*(.+)$", line)
            if mm:
                key = (mm.group(1), mm.group(2).strip())
                if key in seen:
                    total_removed += 1
                    continue
                seen.add(key)
            kept_lines.append(line)
        # Collapse multiple consecutive blank lines
        compressed: list[str] = []
        prev_blank = False
        for ln in kept_lines:
            is_blank = not ln.strip()
            if is_blank and prev_blank:
                continue
            compressed.append(ln)
            prev_blank = is_blank

        out_parts.append(header + "\n" + "\n".join(compressed))

    final = "".join(out_parts).rstrip() + "\n"
    if final == content:
        print("No duplicates found.")
        return 0

    path.write_text(final, encoding="utf-8")
    print(f"Removed {total_removed} duplicate lines. New size: {len(final)} bytes (was {len(content)}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
