"""
GROQ Vision API enrichment service.

This module provides an ADDITIVE analysis layer using the GROQ Vision API.
It runs alongside the existing YOLO pipeline without replacing or modifying
any existing detection logic.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from pathlib import Path
from urllib import error, request as urllib_request

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

_SYSTEM_PROMPT = """\
You are an AI traffic violation analysis system integrated into a motorway surveillance backend.

PRIMARY TASK:
Analyze the provided highway or motorway image.

Detect and extract the following violations:
1. Vehicle smoke emission (visible exhaust smoke or abnormal smoke plume)
2. Litter throwing or disposal from a vehicle

Also perform:
3. Identify and extract vehicle number plate text if visible
4. Associate each detected violation with its corresponding vehicle plate if possible

VISUAL DETECTION RULES:
- Smoke emission refers only to clearly visible abnormal exhaust smoke (e.g., dark plume, heavy emission).
- Littering refers only to visible object disposal or throwing from a vehicle.
- Do NOT infer violations without visual evidence.
- If uncertainty is high, do not include the violation.

NUMBER PLATE RULES:
- Extract only clearly readable plates.
- If plate is partially visible or unclear, return null.

OUTPUT RULES:
- Return STRICT JSON ONLY.
- Do NOT include explanations outside JSON.
- Do NOT include markdown, comments, or additional text.
- If no violations exist, return an empty violations array.

REQUIRED OUTPUT FORMAT:
{
  "violations": [
    {
      "violation_type": "smoke_emission",
      "violation_detected": true,
      "confidence": 0.92,
      "description": "Heavy black smoke emitted from rear exhaust of truck.",
      "number_plate": "LEA-1234"
    }
  ]
}

IF NO VIOLATION IS DETECTED:
{
  "violations": []
}
"""


def _get_api_key() -> str | None:
    """Read GROQ_API_KEY from environment (loaded via .env with override)."""
    _env_path = Path(__file__).resolve().parent.parent / ".env"
    if _env_path.exists():
        try:
            from dotenv import load_dotenv
            load_dotenv(_env_path, override=True)
        except ImportError:
            pass
    key = os.getenv("GROQ_API_KEY")
    if key:
        key = key.strip()
    return key if key else None


def has_groq_api_key() -> bool:
    """Return True when a GROQ API key is configured."""
    return _get_api_key() is not None


def _call_groq_sync(image_bytes: bytes, content_type: str = "image/jpeg") -> dict | None:
    """Synchronous GROQ Vision API call. Meant to be run in a thread pool."""
    api_key = _get_api_key()
    if not api_key:
        logger.warning("groq_vision: GROQ_API_KEY not set — skipping enrichment")
        return None

    if not image_bytes:
        return None

    # Base64-encode the image
    b64_image = base64.b64encode(image_bytes).decode("utf-8")
    data_uri = f"data:{content_type};base64,{b64_image}"

    payload = json.dumps({
        "model": GROQ_VISION_MODEL,
        "messages": [
            {
                "role": "system",
                "content": _SYSTEM_PROMPT,
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": data_uri},
                    },
                    {
                        "type": "text",
                        "text": "Analyze this highway/motorway image for Litter and Smoke violations.",
                    },
                ],
            },
        ],
        "temperature": 0.1,
        "max_tokens": 1024,
        "response_format": {"type": "json_object"},
    }).encode("utf-8")

    req = urllib_request.Request(
        GROQ_API_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "EcoScout/1.0",
        },
    )

    try:
        with urllib_request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))

        # Extract the assistant message content
        choices = body.get("choices", [])
        if not choices:
            logger.warning("groq_vision: empty choices in API response")
            return None

        content = choices[0].get("message", {}).get("content", "")
        if not content:
            logger.warning("groq_vision: empty content in API response")
            return None

        # Parse JSON from content (strip markdown fences if present)
        text = content.strip()
        if text.startswith("```"):
            # Remove ```json ... ``` wrapper
            lines = text.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            text = "\n".join(lines).strip()

        result = json.loads(text)

        # Validate structure
        if not isinstance(result, dict) or "violations" not in result:
            logger.warning("groq_vision: unexpected response structure: %s", text[:200])
            return {"violations": []}

        # Validate each violation entry
        valid_violations = []
        for v in result.get("violations", []):
            if isinstance(v, dict) and v.get("violation_type"):
                valid_violations.append({
                    "violation_type": str(v.get("violation_type", "")),
                    "violation_detected": bool(v.get("violation_detected", False)),
                    "confidence": float(v.get("confidence", 0)),
                    "description": str(v.get("description", "")),
                    "number_plate": v.get("number_plate"),  # can be null
                })

        result["violations"] = valid_violations
        logger.info("groq_vision: detected %d violations via GROQ", len(valid_violations))
        return result

    except error.HTTPError as exc:
        body_text = ""
        try:
            body_text = exc.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            pass
        logger.error("groq_vision: API HTTP error %s: %s", exc.code, body_text)
        return None
    except json.JSONDecodeError as exc:
        logger.error("groq_vision: failed to parse JSON response: %s", exc)
        return None
    except Exception as exc:
        logger.error("groq_vision: unexpected error: %s", exc)
        return None


async def analyze_with_groq(image_bytes: bytes | None, content_type: str = "image/jpeg") -> dict | None:
    """
    Async wrapper for GROQ Vision analysis.

    Runs the synchronous API call in a thread pool so it never blocks
    the FastAPI event loop. Returns None on any failure — the caller
    can safely ignore the result without affecting the main pipeline.
    """
    if not image_bytes:
        return None

    try:
        return await asyncio.to_thread(_call_groq_sync, image_bytes, content_type)
    except Exception as exc:
        logger.error("groq_vision: async wrapper error: %s", exc)
        return None
