import hashlib
import json
import os
from pathlib import Path

import diskcache

# Outside backend/ on purpose: the deploy syncs that folder with --delete.
CACHE_DIR = Path(
    os.getenv("TELETRANSPORT_CACHE_DIR")
    or Path(__file__).resolve().parent.parent / ".cache"
)
app_cache = diskcache.Cache(str(CACHE_DIR))


def generate_cache_key(prefix: str, data: dict) -> str:
    payload = json.dumps(data, sort_keys=True)
    return f"{prefix}_{hashlib.sha256(payload.encode('utf-8')).hexdigest()}"
