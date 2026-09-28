import json
from datetime import datetime
from pathlib import Path

import pytest

from core import flights, trains

# The share page rebuilds these links in TypeScript (frontend/src/lib/share.ts),
# and its tests read the same file, so a change on either side fails a test
# until the other follows.
CASES = json.loads((Path(__file__).parent / "booking_urls.json").read_text(encoding="utf-8"))
BUILDERS = {"trains": trains.build_booking_url, "flights": flights.build_booking_url}


@pytest.mark.parametrize("case", CASES, ids=lambda case: f"{case['origin']}-{case['destination']}")
def test_booking_url_matches_the_share_page(case):
    dep = datetime.fromisoformat(case["dep"])
    assert BUILDERS[case["mode"]](case["origin"], case["destination"], dep, lang=case["lang"]) == case["url"]
