import json
import logging
import os
from pathlib import Path
from urllib import error, request

try:
    from supabase import create_client
except Exception:  # optional dependency
    create_client = None

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy initialisation – env vars may not be available when this module is
# first *imported* (e.g. when storage.py imports us before main.py has
# called load_dotenv).  We therefore defer reading them until the first call
# to get_client() / ensure_media_bucket().
# ---------------------------------------------------------------------------
_client = None
_initialised = False  # False = haven't tried yet; True = already attempted


def _read_env():
    """Return (SUPABASE_URL, SUPABASE_SERVICE_KEY) — always reads .env with override."""
    _env_path = Path(__file__).resolve().parent.parent / ".env"
    if _env_path.exists():
        try:
            from dotenv import load_dotenv as _load
            _load(_env_path, override=True)
        except ImportError:
            pass
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    return url, key


def _init_client():
    """One-shot lazy init of the Supabase client."""
    global _client, _initialised
    if _initialised:
        return _client
    _initialised = True

    url, key = _read_env()
    if not create_client:
        logger.warning("supabase package not installed — Supabase features disabled")
        return None
    if not url or not key:
        logger.warning(
            "SUPABASE_URL or SUPABASE_SERVICE_KEY not set — Supabase features disabled "
            "(url=%s, key=%s)",
            "set" if url else "MISSING",
            "set" if key else "MISSING",
        )
        return None
    # Reject obvious placeholder / non-JWT values
    is_placeholder = "your_supabase" in key.lower() or key == "your_supabase_service_role_key_here"
    is_publishable = key.startswith("sb_publishable_")
    if is_placeholder or is_publishable:
        logger.error(
            "SUPABASE_SERVICE_KEY is invalid! Got: %s... — "
            "Edit backend/.env and use the service_role JWT key from "
            "Supabase Dashboard → Settings → API → service_role (starts with eyJ).",
            key[:20],
        )
        _initialised = False  # allow retry
        return None
    try:
        _client = create_client(url, key)
        logger.info("Supabase client initialised successfully (URL: %s)", url)
    except Exception as exc:
        logger.error("Failed to initialise Supabase client: %s", exc)
        _client = None
    return _client


def get_client():
    """Return the Supabase client, lazily creating it on first call."""
    return _init_client()


def get_supabase_url() -> str | None:
    """Return SUPABASE_URL from env (always fresh read)."""
    return os.getenv("SUPABASE_URL")


def ensure_media_bucket() -> bool:
    """Best-effort create the public `media` bucket if it doesn't exist."""
    url, key = _read_env()
    if not url or not key:
        logger.warning("ensure_media_bucket: env vars not set — skipping")
        return False

    endpoint = f"{url.rstrip('/')}/storage/v1/bucket"
    payload = json.dumps({"id": "media", "name": "media", "public": True}).encode("utf-8")
    req = request.Request(
        endpoint,
        data=payload,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )

    try:
        with request.urlopen(req, timeout=15):
            logger.info("Created Supabase Storage bucket 'media'")
            return True
    except error.HTTPError as exc:
        if exc.code in (400, 409):
            logger.info("Supabase Storage bucket 'media' already exists")
            return True
        logger.error("Failed to create media bucket: HTTP %s", exc.code)
        return False
    except Exception as exc:
        logger.error("Failed to create media bucket: %s", exc)
        return False
