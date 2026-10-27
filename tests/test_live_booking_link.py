"""Opens a real booking link on LeFrecce, which the rest of the suite never contacts.

LeFrecce changes its pages without notice, and a link it no longer accepts does
not fail: it opens a page that keeps loading forever. This is the quick way to
tell, opt-in because it needs the network and a browser:

    TELETRANSPORT_LIVE_TESTS=1 pytest tests/test_live_booking_link.py
"""

import asyncio
import os
from datetime import date, datetime, time, timedelta
from typing import List

import pytest

from core import trains

pytestmark = pytest.mark.skipif(
    os.getenv("TELETRANSPORT_LIVE_TESTS") != "1", reason="live check, set TELETRANSPORT_LIVE_TESTS=1 to run it"
)

LANDING_TIMEOUT_MS = 60_000


async def open_link(url: str, page_errors: List[str]) -> str:
    """The address the link settles on, once LeFrecce shows its results or gives up."""
    from playwright.async_api import TimeoutError as PlaywrightTimeout
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await trains.launch_browser(pw)
        try:
            page = await browser.new_page(locale="it-IT", timezone_id="Europe/Rome")
            page.on("pageerror", lambda exc: page_errors.append(str(exc)))
            # LeFrecce's router catches what breaks a navigation and only logs it.
            # Failed resource loads are left out: its analytics beacons are refused
            # on almost every visit.
            page.on("console", lambda msg: msg.type == "error" and not msg.text.startswith("Failed to load resource")
                    and page_errors.append(msg.text))
            await page.goto(url, wait_until="domcontentloaded", timeout=LANDING_TIMEOUT_MS)
            # LeFrecce sets this flag only on the way to results its own search found;
            # a failed search lands on the results page without it.
            try:
                await page.wait_for_function(
                    "location.hash.includes('whiteLabelDirectSearch=true')", timeout=LANDING_TIMEOUT_MS
                )
            except PlaywrightTimeout:
                pass
            return page.url
        finally:
            await browser.close()


def test_a_booking_link_lands_on_its_results() -> None:
    dep = datetime.combine(date.today() + timedelta(days=14), time(9), trains.TZ)
    url = trains.build_booking_url("Milano Centrale", "Roma Termini", dep)
    page_errors: List[str] = []

    landed = asyncio.run(open_link(url, page_errors))

    assert "whiteLabelDirectSearch=true" in landed, f"{url} stayed on {landed}, page errors: {page_errors}"

