"""Pytest config + shared fixtures for processing-side unit tests."""
import json
import sys
from pathlib import Path

# Add processing/ to sys.path so tests can import lib/* modules
PROCESSING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROCESSING_DIR))

