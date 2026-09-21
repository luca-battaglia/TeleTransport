"""Loading travel_ranker.toml and turning its sections into typed settings."""

from __future__ import annotations

import os
import tomllib
from dataclasses import MISSING, fields
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Type, TypeVar

CONFIG_ENV_VAR = "TRAVEL_RANKER_CONFIG"
CONFIG_FILENAME = "travel_ranker.toml"

T = TypeVar("T")


def default_config_paths() -> List[Path]:
    """Where the config is looked for, first match wins."""
    paths: List[Path] = []
    env = os.getenv(CONFIG_ENV_VAR, "").strip()
    if env:
        paths.append(Path(env).expanduser())
    paths.append(Path(CONFIG_FILENAME))
    paths.append(Path.home() / ".config" / CONFIG_FILENAME)
    return paths


def load_config_dict(config_path: Optional[str] = None) -> Dict[str, Any]:
    """Parse the config file, or return {} when there is none.

    A file that exists but does not parse raises: running silently on defaults
    would hide the mistake.
    """
    if config_path:
        path = Path(config_path).expanduser()
        if not path.exists():
            raise FileNotFoundError(f"Config not found: {path}")
        candidates = [path]
    else:
        candidates = [p for p in default_config_paths() if p.exists()]

    if not candidates:
        return {}
    data = tomllib.loads(candidates[0].read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def deep_get(data: Mapping[str, Any], keys: Sequence[str]) -> Any:
    cur: Any = data
    for key in keys:
        if not isinstance(cur, Mapping) or key not in cur:
            return None
        cur = cur[key]
    return cur


def section(data: Mapping[str, Any], *keys: str) -> Dict[str, Any]:
    value = deep_get(data, keys)
    return dict(value) if isinstance(value, Mapping) else {}


def _coerce(value: Any, like: Any, name: str) -> Any:
    """Convert value to the type of the field default, rejecting anything lossy."""
    # bool is a subclass of int, so it has to be ruled out explicitly both ways.
    if isinstance(like, bool):
        if isinstance(value, bool):
            return value
    elif isinstance(like, int):
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        if isinstance(value, float) and value.is_integer():
            return int(value)
    elif isinstance(like, float):
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return float(value)
    elif isinstance(like, str):
        if isinstance(value, str):
            return value
    else:
        return value
    raise ValueError(f"Invalid value for {name}: {value!r}")


def build_settings(cls: Type[T], values: Mapping[str, Any], prefix: str) -> T:
    """Instantiate a settings dataclass from a config section.

    Keys missing from the section keep the dataclass default, so an explicit 0
    stays 0 instead of falling back the way `value or default` would.
    """
    kwargs: Dict[str, Any] = {}
    for f in fields(cls):  # type: ignore[arg-type]
        if f.name not in values:
            continue
        if f.default is not MISSING:
            like = f.default
        elif f.default_factory is not MISSING:
            like = f.default_factory()
        else:
            like = None
        kwargs[f.name] = _coerce(values[f.name], like, f"{prefix}.{f.name}")
    return cls(**kwargs)


def merge_overrides(base: Mapping[str, Any], overrides: Mapping[str, Any]) -> Dict[str, Any]:
    """Recursively overlay overrides on base, returning a new dict."""
    out: Dict[str, Any] = dict(base)
    for key, value in overrides.items():
        if isinstance(value, Mapping) and isinstance(out.get(key), Mapping):
            out[key] = merge_overrides(out[key], value)
        else:
            out[key] = value
    return out
