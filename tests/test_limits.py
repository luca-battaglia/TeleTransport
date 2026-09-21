import diskcache
import pytest

from backend.limits import UsageLimits


@pytest.fixture
def limits(tmp_path):
    return UsageLimits(
        diskcache.Cache(str(tmp_path)),
        searches_per_hour=3,
        demo_daily_calls=6,
        demo_client_daily_searches=2,
    )


def test_rate_limit_counts_per_client(limits):
    assert [limits.allow_search("a") for _ in range(4)] == [True, True, True, False]
    assert limits.allow_search("b")


def test_demo_searches_are_capped_per_client(limits):
    assert limits.reserve_demo("a", 1)
    assert limits.reserve_demo("a", 1)
    assert limits.reserve_demo("a", 1) is None
    assert limits.demo_searches_left("a") == 0
    assert limits.demo_searches_left("b") == 2


def test_global_call_budget_holds_across_clients(limits):
    assert limits.reserve_demo("a", 3)
    assert limits.reserve_demo("b", 3)
    assert limits.reserve_demo("c", 1) is None
    assert limits.demo_searches_left("c") == 0


def test_unused_and_failed_calls_are_refunded(limits):
    reservation = limits.reserve_demo("a", 3)
    limits.settle_demo(reservation, used_calls=1, succeeded=True)
    assert limits.reserve_demo("b", 3) and limits.reserve_demo("c", 2)

    failed = limits.reserve_demo("d", 0)
    limits.settle_demo(failed, used_calls=0, succeeded=False)
    assert limits.demo_searches_left("d") == 0  # the global budget is spent, not d's allowance


def test_a_failed_search_gives_the_client_its_search_back(limits):
    reservation = limits.reserve_demo("a", 2)
    limits.settle_demo(reservation, used_calls=2, succeeded=False)
    assert limits.demo_searches_left("a") == 2
