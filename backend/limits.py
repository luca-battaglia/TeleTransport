"""Per-client rate limiting and the shared SerpApi demo budget.

Counters live in diskcache (SQLite), so updates are atomic across worker
processes and survive restarts.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import diskcache
from starlette.requests import Request

_HOUR_S = 3600
_COUNTER_TTL_S = 2 * 24 * _HOUR_S


@dataclass(frozen=True)
class DemoReservation:
    day: str
    client: str
    calls: int


class UsageLimits:
    def __init__(
        self,
        cache: diskcache.Cache,
        *,
        searches_per_hour: int,
        demo_daily_calls: int,
        demo_client_daily_searches: int,
        proxy_secret: str = "",
    ) -> None:
        self.cache = cache
        self.searches_per_hour = searches_per_hour
        self.demo_daily_calls = demo_daily_calls
        self.demo_client_daily_searches = demo_client_daily_searches
        self._proxy_secret = proxy_secret.encode()
        # A stable per-install salt, so client ids survive restarts but cannot be
        # reversed into IP addresses by anyone who reads the cache.
        self.cache.add("limits:salt", secrets.token_hex(16))
        self._salt = self.cache.get("limits:salt")

    def client_ip(self, request: Request) -> str:
        """The caller's IP address, taken only from sources a caller cannot forge.

        The web app's server-side proxy sends every visitor from its host's own
        addresses, so it passes the visitor's address in X-Client-IP and proves it
        with the shared X-Proxy-Secret. Other callers are identified by the TCP
        peer, or, when that peer is a reverse proxy on a private network, by the
        X-Forwarded-For hop that proxy appended.
        """
        supplied = request.headers.get("x-proxy-secret", "").encode()
        if self._proxy_secret and hmac.compare_digest(supplied, self._proxy_secret):
            forwarded = request.headers.get("x-client-ip", "").strip()
            if forwarded:
                return forwarded

        peer = request.client.host if request.client else ""
        try:
            behind_proxy = ipaddress.ip_address(peer).is_private
        except ValueError:
            behind_proxy = False
        if behind_proxy:
            hops = [hop.strip() for hop in request.headers.get("x-forwarded-for", "").split(",") if hop.strip()]
            if hops:
                return hops[-1]
        return peer or "unknown"

    def client_id(self, request: Request) -> str:
        """A salted hash of the caller's IP address; the raw address is never stored."""
        return hashlib.sha256(f"{self._salt}:{self.client_ip(request)}".encode()).hexdigest()[:24]

    def allow_search(self, client: str) -> bool:
        window = int(time.time() // _HOUR_S)
        key = f"limits:rate:{client}:{window}"
        with self.cache.transact():
            count = self.cache.get(key, 0) + 1
            self.cache.set(key, count, expire=2 * _HOUR_S)
        return count <= self.searches_per_hour

    @staticmethod
    def _today() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def _keys(self, day: str, client: str) -> tuple[str, str]:
        return f"limits:demo:calls:{day}", f"limits:demo:searches:{day}:{client}"

    def demo_searches_left(self, client: str) -> int:
        calls_key, client_key = self._keys(self._today(), client)
        if self.cache.get(calls_key, 0) >= self.demo_daily_calls:
            return 0
        return max(0, self.demo_client_daily_searches - self.cache.get(client_key, 0))

    def reserve_demo(self, client: str, calls: int) -> Optional[DemoReservation]:
        """Book one search and its worst-case upstream calls, or None if either cap would be exceeded."""
        day = self._today()
        calls_key, client_key = self._keys(day, client)
        with self.cache.transact():
            used_calls = self.cache.get(calls_key, 0)
            used_searches = self.cache.get(client_key, 0)
            if used_calls + calls > self.demo_daily_calls or used_searches + 1 > self.demo_client_daily_searches:
                return None
            self.cache.set(calls_key, used_calls + calls, expire=_COUNTER_TTL_S)
            self.cache.set(client_key, used_searches + 1, expire=_COUNTER_TTL_S)
        return DemoReservation(day, client, calls)

    def settle_demo(self, reservation: DemoReservation, used_calls: int, succeeded: bool) -> None:
        """Replace the worst-case booking with what the search actually cost.

        Cache hits cost nothing upstream, and SerpApi does not bill failed
        searches, so both are refunded.
        """
        calls_key, client_key = self._keys(reservation.day, reservation.client)
        with self.cache.transact():
            used = self.cache.get(calls_key, 0) - reservation.calls + (used_calls if succeeded else 0)
            self.cache.set(calls_key, max(0, used), expire=_COUNTER_TTL_S)
            if not succeeded:
                searches = self.cache.get(client_key, 0) - 1
                self.cache.set(client_key, max(0, searches), expire=_COUNTER_TTL_S)
