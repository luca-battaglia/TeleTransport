import os
import tempfile

# core.cache opens its store at import time, so the redirect has to happen first.
os.environ["TELETRANSPORT_CACHE_DIR"] = tempfile.mkdtemp(prefix="teletransport-test-cache-")
