import logging
import uuid
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

from services.supabase_client import get_client, get_supabase_url

logger = logging.getLogger(__name__)

# Map common extensions to MIME types for Supabase Storage uploads.
_EXT_CONTENT_TYPE = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
}


def _guess_content_type(filename: str) -> str:
    """Return a MIME type for *filename* based on its extension."""
    ext = Path(filename).suffix.lower()
    return _EXT_CONTENT_TYPE.get(ext, "application/octet-stream")


def upload_media(
    file,
    dest_name: Optional[str] = None,
    content_type: Optional[str] = None,
) -> Optional[str]:
    """Upload bytes / file-like / filesystem path to Supabase Storage ``media`` bucket.

    Returns the public URL on success, or ``None`` on failure.

    Parameters
    ----------
    file : bytes | bytearray | BinaryIO | str | Path
        The payload.  Bytes / bytearray are uploaded directly.
        A file-like with ``.read()`` is consumed.  A string/Path is treated
        as a local filesystem path whose bytes are read.
    dest_name : str, optional
        Storage key (object path).  Defaults to a random UUID hex.
    content_type : str, optional
        MIME type for the upload.  Guessed from *dest_name* extension when
        omitted.
    """
    supabase = get_client()
    if supabase is None:
        logger.warning("upload_media: Supabase client is None — skipping upload")
        return None

    # ── Normalise data to raw bytes ──────────────────────────────────────
    data: bytes | None = None

    if isinstance(file, (bytes, bytearray)):
        data = bytes(file)
    elif hasattr(file, "read"):
        try:
            data = file.read()
        except Exception as exc:
            logger.error("upload_media: failed to read file-like: %s", exc)
            data = None
    else:
        # Treat as a filesystem path
        p = Path(file)
        if p.exists():
            data = p.read_bytes()
            logger.info("upload_media: read %d bytes from filesystem path %s", len(data), p)
        else:
            logger.warning("upload_media: filesystem path does not exist: %s", p)

    if not data:
        logger.warning("upload_media: no data to upload (file=%s)", type(file).__name__)
        return None

    logger.info("upload_media: data size = %d bytes", len(data))

    # ── Build the storage key ────────────────────────────────────────────
    if dest_name is None:
        dest_name = f"{uuid.uuid4().hex}"

    # Ensure path does not start with slash
    key = dest_name.lstrip("/")

    # ── Determine content type ───────────────────────────────────────────
    if content_type is None:
        content_type = _guess_content_type(key)

    # ── Upload ───────────────────────────────────────────────────────────
    try:
        bucket = supabase.storage.from_("media")

        # content-type is *required* for the Supabase Python SDK when
        # uploading raw bytes.  upsert prevents 409 on filename collisions.
        bucket.upload(
            key,
            data,
            file_options={
                "content-type": content_type,
                "upsert": "true",
            },
        )

        # ── Build the public URL ─────────────────────────────────────────
        public = bucket.get_public_url(key)

        if isinstance(public, str) and public:
            logger.info("upload_media: uploaded '%s' → %s", key, public)
            return public
        if isinstance(public, dict):
            url = (
                public.get("publicUrl")
                or public.get("public_url")
                or public.get("url")
            )
            if url:
                logger.info("upload_media: uploaded '%s' → %s", key, url)
                return url

        # Fallback – construct the URL ourselves
        supa_url = get_supabase_url()
        if supa_url:
            fallback = urljoin(
                supa_url.rstrip("/") + "/",
                f"storage/v1/object/public/media/{key}",
            )
            logger.info("upload_media: uploaded '%s' → %s (fallback URL)", key, fallback)
            return fallback

        logger.error("upload_media: could not determine public URL for '%s'", key)
        return None

    except Exception as exc:
        logger.error("upload_media: failed to upload '%s': %s", key, exc, exc_info=True)
        return None
