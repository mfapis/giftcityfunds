"""The returns and volatility calculation of the fund detail page, tested in node (skipped when node is not installed)."""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_returns_table_calculations():
    result = subprocess.run(["node", "tests/js/returns_table.test.js"], cwd=ROOT, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr or result.stdout
    assert "ALL returns_table tests passed" in result.stdout
