import diskcache
from pathlib import Path
import json
import hashlib

CACHE_DIR = Path(__file__).resolve().parent.parent / "backend" / "backend_cache"
app_cache = diskcache.Cache(str(CACHE_DIR))

def generate_cache_key(prefix: str, data: dict) -> str:
    s = json.dumps(data, sort_keys=True)
    h = hashlib.md5(s.encode("utf-8")).hexdigest()
    return f"{prefix}_{h}"
