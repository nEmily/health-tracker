# Processing Tests

Unit + integration tests for the processing pipeline (Phase A orchestrator + helpers).

Run: `cd processing && python -m pytest tests/ -v`

Layout:
- `lib/` — code under test (importable modules)
- `tests/` — pytest test files
- `tests/fixtures/` — golden inputs/outputs (Emily + Michael)
