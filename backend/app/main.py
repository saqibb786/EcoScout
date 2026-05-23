from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# Load .env before anything reads env vars -----------------------------------
try:
    from dotenv import load_dotenv

    _env_path = Path(__file__).resolve().parent.parent / ".env"
    if _env_path.exists():
        load_dotenv(_env_path, override=True)
except ImportError:
    pass  # python-dotenv is optional; env vars may come from the system
# -----------------------------------------------------------------------------

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.core.pipeline import ViolationPipeline
from services.supabase_client import get_client, ensure_media_bucket
from services.storage import upload_media
from services.groq_vision import analyze_with_groq, has_groq_api_key

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


BASE_DIR = Path(__file__).resolve().parent.parent
EVIDENCE_DIR = BASE_DIR / "evidence"
IMAGES_DIR = EVIDENCE_DIR / "images"
VIDEOS_DIR = EVIDENCE_DIR / "videos"
UPLOAD_DIR = BASE_DIR / "temp" / "uploads"

ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
SESSION_COOKIE = "ecoscout_session"
ACTIVE_SESSIONS: set[str] = set()
PROTECTED_PATHS = {"/analyze/image", "/analyze/video", "/history", "/analyses"}


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


for folder in (IMAGES_DIR, VIDEOS_DIR, UPLOAD_DIR):
    folder.mkdir(parents=True, exist_ok=True)

ensure_media_bucket()


class LoginRequest(BaseModel):
    username: str
    password: str

pipeline = ViolationPipeline(
    litter_model_path=str(BASE_DIR / "models" / "litter_best.pt"),
    smoke_model_path=str(BASE_DIR / "models" / "smoke_best.pt"),
    vehicle_model_path=str(BASE_DIR / "models" / "yolov8s.pt"),
    plate_model_path=str(BASE_DIR / "models" / "plate_best.pt"),
    litter_conf=_env_float("LITTER_CONF", 0.35),
    smoke_conf=_env_float("SMOKE_CONF", 0.40),
    vehicle_conf=_env_float("VEHICLE_CONF", 0.30),
    plate_conf=_env_float("PLATE_CONF", 0.30),
    vehicle_recover_conf=_env_float("VEHICLE_RECOVER_CONF", 0.15),
)

app = FastAPI(
    title="EcoScout Violation API",
    description="Detects vehicle violations, links them to violator vehicles, detects number plates, and runs OCR.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/evidence", StaticFiles(directory=str(EVIDENCE_DIR)), name="evidence")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    is_protected = path in PROTECTED_PATHS or path.startswith("/analyses/")
    if request.method != "OPTIONS" and is_protected:
        token = request.cookies.get(SESSION_COOKIE)
        if not token or token not in ACTIVE_SESSIONS:
            return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    return await call_next(request)


def _save_image_safely(image: np.ndarray, out_path: Path) -> bool:
    """Save image with OpenCV and fall back to imencode when needed."""
    if image is None or not isinstance(image, np.ndarray) or image.size == 0:
        return False

    safe_img = image
    if safe_img.dtype != np.uint8:
        safe_img = np.clip(safe_img, 0, 255).astype(np.uint8)

    if len(safe_img.shape) == 2:
        safe_img = cv2.cvtColor(safe_img, cv2.COLOR_GRAY2BGR)

    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Primary save path.
    ok = cv2.imwrite(str(out_path), safe_img)
    if ok:
        return True

    # Fallback path for environments where imwrite can fail unexpectedly.
    encoded, buffer = cv2.imencode(out_path.suffix or ".jpg", safe_img)
    if not encoded:
        return False

    out_path.write_bytes(buffer.tobytes())
    return out_path.exists() and out_path.stat().st_size > 0


def _dominant_violation_name(records: list[dict[str, Any]]) -> str:
    names = [str(record.get("violation") or record.get("class_name") or "unknown") for record in records]
    if not names:
        return "unknown"
    return Counter(names).most_common(1)[0][0]


def _current_timestamp() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _upload_image_result(image: np.ndarray, dest_name: str) -> str | None:
    """Encode an OpenCV image as JPEG bytes and upload to Supabase Storage."""
    if image is None or not isinstance(image, np.ndarray) or image.size == 0:
        logger.warning("_upload_image_result: invalid image — skipping upload")
        return None

    safe_img = image
    if safe_img.dtype != np.uint8:
        safe_img = np.clip(safe_img, 0, 255).astype(np.uint8)
    if len(safe_img.shape) == 2:
        safe_img = cv2.cvtColor(safe_img, cv2.COLOR_GRAY2BGR)

    encoded, buffer = cv2.imencode(".jpg", safe_img)
    if not encoded:
        logger.error("_upload_image_result: cv2.imencode failed for '%s'", dest_name)
        return None
    return upload_media(buffer.tobytes(), dest_name=dest_name, content_type="image/jpeg")


def _upload_video_result(video_path: Path, dest_name: str) -> str | None:
    """Upload a video file to Supabase Storage."""
    return upload_media(video_path, dest_name=dest_name, content_type="video/mp4")


def _encode_image_bytes(image: np.ndarray) -> bytes | None:
    """Encode an OpenCV image as JPEG bytes for downstream analysis."""
    if image is None or not isinstance(image, np.ndarray) or image.size == 0:
        return None

    safe_img = image
    if safe_img.dtype != np.uint8:
        safe_img = np.clip(safe_img, 0, 255).astype(np.uint8)
    if len(safe_img.shape) == 2:
        safe_img = cv2.cvtColor(safe_img, cv2.COLOR_GRAY2BGR)

    encoded, buffer = cv2.imencode(".jpg", safe_img)
    if not encoded:
        return None
    return buffer.tobytes()


def _guess_upload_content_type(filename: str) -> str:
    """Guess content-type from the original upload filename."""
    ext = Path(filename).suffix.lower()
    mapping = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".avi": "video/x-msvideo",
    }
    return mapping.get(ext, "application/octet-stream")


def _basename_from_url(url: str | None) -> str:
    if not url:
        return "unknown"
    parsed = urlparse(url)
    candidate = Path(parsed.path).name
    return candidate or "unknown"


def _normalize_detection_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "frame_index": row.get("frame_index"),
        "violation": row.get("class_name"),
        "violation_confidence": row.get("confidence"),
        "violation_bbox": row.get("bbox"),
        "plate_text": row.get("ocr_text"),
        "plate_text_raw": row.get("ocr_text"),
        "ocr_confidence": row.get("ocr_confidence"),
        "vehicle_bbox": row.get("vehicle_bbox"),
        "vehicle_confidence": row.get("vehicle_confidence"),
        "match_strategy": row.get("match_strategy"),
        "timestamp": row.get("timestamp"),
        "video_time_sec": row.get("video_time_sec"),
    }


def _analysis_to_history_item(analysis: dict[str, Any], detections: list[dict[str, Any]]) -> dict[str, Any]:
    media_url = analysis.get("media_url")
    created_at = analysis.get("created_at")
    total_detections = analysis.get("total_detections") or len(detections)
    detection_summary = analysis.get("detection_summary") or {}
    detection_image_url = analysis.get("detection_image_url") or media_url
    return {
        "id": analysis.get("id"),
        "created_at": created_at,
        "createdAt": created_at,
        "timestamp_real": analysis.get("timestamp_real") or created_at,
        "source_type": analysis.get("media_type", "image"),
        "source_name": detection_summary.get("source_name") or _basename_from_url(media_url),
        "violations_found": total_detections,
        "total_detections": total_detections,
        "frame_stride": detection_summary.get("frame_stride"),
        "total_frames": detection_summary.get("total_frames"),
        "media_url": media_url,
        "detection_image_url": detection_image_url,
        "annotated_image_url": detection_image_url if analysis.get("media_type") == "image" else None,
        "annotated_video_url": detection_image_url if analysis.get("media_type") == "video" else None,
        "violation_name": analysis.get("violation_name") or detection_summary.get("violation_name") or _dominant_violation_name(detections),
        "detection_summary": detection_summary,
        "report_url": analysis.get("report_url"),
        "groq_analysis": detection_summary.get("groq_analysis"),
        "detections": [_normalize_detection_row(row) for row in detections],
        "records": [_normalize_detection_row(row) for row in detections],
        "raw": analysis,
    }


@app.get("/")
def root() -> dict[str, str]:
    return {
        "message": "EcoScout FastAPI is running.",
        "docs": "/docs",
    }


@app.post("/login")
async def login(payload: LoginRequest):
    if payload.username != ADMIN_USERNAME or payload.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    session_token = uuid.uuid4().hex
    ACTIVE_SESSIONS.add(session_token)
    response = JSONResponse({"authenticated": True, "username": ADMIN_USERNAME})
    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_token,
        httponly=True,
        samesite="lax",
        secure=False,
        path="/",
    )
    return response


@app.get("/auth/me")
async def auth_me(request: Request) -> dict[str, Any]:
    token = request.cookies.get(SESSION_COOKIE)
    return {"authenticated": bool(token and token in ACTIVE_SESSIONS), "username": ADMIN_USERNAME if token and token in ACTIVE_SESSIONS else None}


@app.post("/logout")
async def logout(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        ACTIVE_SESSIONS.discard(token)
    response = JSONResponse({"authenticated": False})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "time": datetime.now().isoformat(timespec="seconds")}


@app.get("/debug/supabase")
def debug_supabase() -> dict[str, Any]:
    """Diagnostic endpoint — reports Supabase config/connection status."""
    from services.supabase_client import get_supabase_url
    url = get_supabase_url()
    key = os.getenv("SUPABASE_SERVICE_KEY")
    client = get_client()
    return {
        "supabase_url_set": bool(url),
        "supabase_url": url[:40] + "..." if url and len(url) > 40 else url,
        "service_key_set": bool(key) and key != "your_supabase_service_role_key_here",
        "service_key_preview": (key[:8] + "...") if key and len(key) > 8 else "NOT SET",
        "client_connected": client is not None,
        "bucket_name": "media",
    }


@app.post("/analyze/image")
async def analyze_image(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read()
    arr = np.frombuffer(data, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image file")

    annotated, records = pipeline.analyze_frame(
        frame, source_name=file.filename, source_type="image")
    analysis_id = str(uuid.uuid4())
    timestamp_real = _current_timestamp()

    # Upload original media with correct content-type
    original_ct = _guess_upload_content_type(file.filename or "image.jpg")
    media_url = upload_media(data, dest_name=f"{analysis_id}_original_{file.filename}", content_type=original_ct)

    # Upload annotated detection image (always JPEG)
    detection_image_url = _upload_image_result(annotated, f"{analysis_id}_annotated.jpg")

    violation_name = _dominant_violation_name(records)
    detection_summary = {
        "source_name": file.filename,
        "violations_found": len(records),
        "frame_stride": None,
        "total_frames": None,
        "violation_name": violation_name,
    }

    # --- GROQ Vision enrichment (additive — does not affect existing pipeline) ---
    try:
        groq_input = _encode_image_bytes(annotated) or data
        groq_analysis = await analyze_with_groq(groq_input, content_type="image/jpeg")
        if not groq_analysis or not groq_analysis.get("violations"):
            fallback_analysis = await analyze_with_groq(data, content_type=original_ct)
            if fallback_analysis and fallback_analysis.get("violations"):
                groq_analysis = fallback_analysis
        detection_summary["groq_status"] = "available_with_results" if groq_analysis and groq_analysis.get("violations") else "available_no_violations"
        if groq_analysis:
            detection_summary["groq_analysis"] = groq_analysis
            logger.info("analyze_image: GROQ enrichment returned %d violations", len(groq_analysis.get("violations", [])))
    except Exception as groq_exc:
        logger.warning("analyze_image: GROQ enrichment failed (non-fatal): %s", groq_exc)
    if not has_groq_api_key():
        detection_summary["groq_status"] = "missing_api_key"
    # --- End GROQ enrichment ---

    supabase = get_client()
    if not supabase:
        logger.error("analyze_image: Supabase client not configured — check SUPABASE_URL and SUPABASE_SERVICE_KEY env vars")
        raise HTTPException(
            status_code=500,
            detail="Supabase client not configured. Check backend .env file has valid SUPABASE_URL and SUPABASE_SERVICE_KEY. Hit /debug/supabase to diagnose.",
        )
    if not media_url:
        logger.error("analyze_image: original media upload failed (data size=%d bytes, dest=%s)", len(data), f"{analysis_id}_original_{file.filename}")
        raise HTTPException(
            status_code=500,
            detail="Supabase upload failed for original image. Check backend console logs for details and ensure 'media' bucket exists and is public.",
        )
    if not detection_image_url:
        logger.error("analyze_image: annotated image upload failed")
        raise HTTPException(
            status_code=500,
            detail="Supabase upload failed for annotated image. Check backend console logs for details.",
        )

    try:
        analyses_row = {
            "id": analysis_id,
            "created_at": timestamp_real,
            "timestamp_real": timestamp_real,
            "media_url": media_url,
            "media_type": "image",
            "detection_image_url": detection_image_url,
            "violation_name": violation_name,
            "detection_summary": detection_summary,
            "total_detections": len(records),
        }
        supabase.table("analyses").insert(analyses_row).execute()
        logger.info("analyze_image: inserted analysis %s into DB", analysis_id)

        detections_rows = []
        for rec in records:
            det = {
                "id": str(uuid.uuid4()),
                "analysis_id": analysis_id,
                "frame_index": rec.get("frame_index"),
                "class_name": rec.get("violation"),
                "confidence": rec.get("violation_confidence") or rec.get("confidence"),
                "bbox": rec.get("violation_bbox") or rec.get("bbox"),
                "ocr_text": rec.get("plate_text") or rec.get("plate_text_raw"),
                "ocr_confidence": rec.get("ocr_conf") or rec.get("ocr_confidence") or rec.get("plate_confidence"),
            }
            detections_rows.append(det)

        if detections_rows:
            supabase.table("detections").insert(detections_rows).execute()
            logger.info("analyze_image: inserted %d detections for analysis %s", len(detections_rows), analysis_id)
    except Exception as exc:
        logger.error("analyze_image: DB insert failed for analysis %s: %s", analysis_id, exc)
        raise HTTPException(status_code=500, detail=f"Could not persist image analysis to Supabase: {exc}")

    return {
        "analysis_id": analysis_id,
        "media_url": media_url,
        "detection_image_url": detection_image_url,
        "total_detections": len(records),
        "detections": records,
        "violation_name": violation_name,
        "timestamp_real": timestamp_real,
        "detection_summary": detection_summary,
        "source_type": "image",
        "source_name": file.filename,
        "violations_found": len(records),
        "groq_analysis": detection_summary.get("groq_analysis"),
    }


@app.post("/analyze/video")
async def analyze_video(
    file: UploadFile = File(...),
    frame_stride: int = Form(5),
) -> dict[str, Any]:
    if frame_stride < 1:
        raise HTTPException(
            status_code=400, detail="frame_stride must be >= 1")

    upload_name = f"upload_{uuid.uuid4().hex[:12]}_{file.filename}"
    upload_path = UPLOAD_DIR / upload_name

    with upload_path.open("wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)

    original_upload_bytes = upload_path.read_bytes()

    cap = cv2.VideoCapture(str(upload_path))
    if not cap.isOpened():
        raise HTTPException(
            status_code=400, detail="Could not open uploaded video")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)

    out_name = f"video_{uuid.uuid4().hex[:12]}.mp4"
    out_path = VIDEOS_DIR / out_name
    writer = cv2.VideoWriter(
        str(out_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height),
    )

    all_records: list[dict[str, Any]] = []
    frame_index = 0
    analysis_id = str(uuid.uuid4())
    timestamp_real = _current_timestamp()
    media_url = None
    detection_image_url = None
    groq_candidate_frame: np.ndarray | None = None

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            if frame_index % frame_stride == 0:
                annotated, records = pipeline.analyze_frame(
                    frame,
                    source_name=file.filename,
                    frame_index=frame_index,
                    source_type="video",
                )
                for rec in records:
                    rec["video_time_sec"] = round(frame_index / fps, 3)
                all_records.extend(records)
                if groq_candidate_frame is None and records:
                    groq_candidate_frame = annotated.copy()
                # Save annotated frame and per-record crops for reporting.
                writer.write(annotated)
                try:
                    base = f"video_{uuid.uuid4().hex[:10]}_f{frame_index}"
                    ann_name = f"{base}_annot.jpg"
                    ann_path = IMAGES_DIR / ann_name
                    _save_image_safely(annotated, ann_path)
                    ann_rel = f"/evidence/images/{ann_name}"
                    ann_abs = f"http://127.0.0.1:8000/evidence/images/{ann_name}"

                    for i, rec in enumerate(records):
                        rec["frame_image_url"] = ann_rel
                        rec["frame_image_url_abs"] = ann_abs

                        vb = rec.get("vehicle_bbox")
                        if vb:
                            vx1, vy1, vx2, vy2 = pipeline._clip_bbox(
                                vb, frame.shape[1], frame.shape[0]
                            )
                            vehicle_crop = frame[vy1:vy2, vx1:vx2]
                            vname = f"{base}_rec{i}_vehicle.jpg"
                            vpath = IMAGES_DIR / vname
                            if _save_image_safely(vehicle_crop, vpath):
                                rec["vehicle_crop_url"] = f"/evidence/images/{vname}"
                                rec["vehicle_crop_url_abs"] = f"http://127.0.0.1:8000/evidence/images/{vname}"

                        pb = rec.get("plate_bbox")
                        if pb:
                            px1, py1, px2, py2 = pipeline._clip_bbox(
                                pb, frame.shape[1], frame.shape[0]
                            )
                            plate_crop = frame[py1:py2, px1:px2]
                            pname = f"{base}_rec{i}_plate.jpg"
                            ppath = IMAGES_DIR / pname
                            if _save_image_safely(plate_crop, ppath):
                                rec["plate_crop_url"] = f"/evidence/images/{pname}"
                                rec["plate_crop_url_abs"] = f"http://127.0.0.1:8000/evidence/images/{pname}"
                except Exception:
                    pass
            else:
                writer.write(frame)

            frame_index += 1
    finally:
        cap.release()
        writer.release()

    # Upload original video with correct content-type
    original_ct = _guess_upload_content_type(file.filename or "video.mp4")
    media_url = upload_media(original_upload_bytes, dest_name=f"{analysis_id}_original_{file.filename}", content_type=original_ct)

    # Upload annotated video
    detection_image_url = _upload_video_result(out_path, f"{analysis_id}_annotated.mp4")

    violation_name = _dominant_violation_name(all_records)
    detection_summary = {
        "source_name": file.filename,
        "violations_found": len(all_records),
        "frame_stride": frame_stride,
        "total_frames": frame_index,
        "violation_name": violation_name,
    }

    # --- GROQ Vision enrichment for video (analyze first frame) ---
    try:
        _groq_frame_bytes = _encode_image_bytes(groq_candidate_frame)
        if _groq_frame_bytes is None:
            _gcap = cv2.VideoCapture(str(upload_path))
            _gok, _gframe = _gcap.read()
            _gcap.release()
            if _gok and _gframe is not None:
                _groq_frame_bytes = _encode_image_bytes(_gframe)
        groq_analysis = await analyze_with_groq(_groq_frame_bytes) if _groq_frame_bytes else None
        if not groq_analysis or not groq_analysis.get("violations"):
            _gcap = cv2.VideoCapture(str(upload_path))
            _gok, _gframe = _gcap.read()
            _gcap.release()
            if _gok and _gframe is not None:
                fallback_analysis = await analyze_with_groq(_encode_image_bytes(_gframe))
                if fallback_analysis and fallback_analysis.get("violations"):
                    groq_analysis = fallback_analysis
        detection_summary["groq_status"] = "available_with_results" if groq_analysis and groq_analysis.get("violations") else "available_no_violations"
        if groq_analysis:
            detection_summary["groq_analysis"] = groq_analysis
            logger.info("analyze_video: GROQ enrichment returned %d violations", len(groq_analysis.get("violations", [])))
    except Exception as groq_exc:
        logger.warning("analyze_video: GROQ enrichment failed (non-fatal): %s", groq_exc)
    if not has_groq_api_key():
        detection_summary["groq_status"] = "missing_api_key"
    # --- End GROQ enrichment ---

    supabase = get_client()
    if not supabase:
        logger.error("analyze_video: Supabase client not configured — check env vars")
        raise HTTPException(
            status_code=500,
            detail="Supabase client not configured. Check backend .env file. Hit /debug/supabase to diagnose.",
        )
    if not media_url:
        logger.error("analyze_video: original video upload failed")
        raise HTTPException(
            status_code=500,
            detail="Supabase upload failed for original video. Check backend console logs and ensure 'media' bucket exists and is public.",
        )
    if not detection_image_url:
        logger.error("analyze_video: annotated video upload failed")
        raise HTTPException(
            status_code=500,
            detail="Supabase upload failed for annotated video. Check backend console logs.",
        )

    try:
        analyses_row = {
            "id": analysis_id,
            "created_at": timestamp_real,
            "timestamp_real": timestamp_real,
            "media_url": media_url,
            "media_type": "video",
            "detection_image_url": detection_image_url,
            "violation_name": violation_name,
            "detection_summary": detection_summary,
            "total_detections": len(all_records),
        }
        supabase.table("analyses").insert(analyses_row).execute()
        logger.info("analyze_video: inserted analysis %s into DB", analysis_id)

        detections_rows = []
        for rec in all_records:
            det = {
                "id": str(uuid.uuid4()),
                "analysis_id": analysis_id,
                "frame_index": rec.get("frame_index"),
                "class_name": rec.get("violation"),
                "confidence": rec.get("violation_confidence") or rec.get("confidence"),
                "bbox": rec.get("violation_bbox") or rec.get("bbox"),
                "ocr_text": rec.get("plate_text") or rec.get("plate_text_raw"),
                "ocr_confidence": rec.get("ocr_conf") or rec.get("ocr_confidence") or rec.get("plate_confidence"),
            }
            detections_rows.append(det)

        if detections_rows:
            supabase.table("detections").insert(detections_rows).execute()
            logger.info("analyze_video: inserted %d detections for analysis %s", len(detections_rows), analysis_id)
    except Exception as exc:
        logger.error("analyze_video: DB insert failed for analysis %s: %s", analysis_id, exc)
        raise HTTPException(status_code=500, detail=f"Could not persist video analysis to Supabase: {exc}")
    finally:
        if upload_path.exists():
            os.remove(upload_path)
        if out_path.exists():
            os.remove(out_path)

    return {
        "analysis_id": analysis_id,
        "media_url": media_url,
        "detection_image_url": detection_image_url,
        "total_detections": len(all_records),
        "detections": all_records,
        "violation_name": violation_name,
        "timestamp_real": timestamp_real,
        "detection_summary": detection_summary,
        "source_type": "video",
        "source_name": file.filename,
        "total_frames": frame_index,
        "frame_stride": frame_stride,
        "violations_found": len(all_records),
        "groq_analysis": detection_summary.get("groq_analysis"),
    }


@app.get("/analyses")
@app.get("/history")
async def get_history() -> dict[str, Any]:
    """Fetch all analyses from Supabase with their detections."""
    supabase = get_client()
    if not supabase:
        return {"history": [], "analyses": [], "error": "Supabase not configured"}

    try:
        analyses_response = supabase.table("analyses").select("*").order("created_at", desc=True).execute()
        analyses = analyses_response.data or []

        result = []
        for analysis in analyses:
            detections_response = supabase.table("detections").select("*").eq("analysis_id", analysis["id"]).execute()
            detections = detections_response.data or []

            result.append(_analysis_to_history_item(analysis, detections))

        return {"history": result, "analyses": result}
    except Exception as e:
        logger.error("get_history: failed to fetch analyses: %s", e)
        return {"history": [], "analyses": [], "error": str(e)}


@app.post("/analyses/{analysis_id}/report")
async def upload_report(
    analysis_id: str,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Upload a generated PDF report and link it to an existing analysis."""
    supabase = get_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    dest_name = f"reports/{analysis_id}_report.pdf"
    report_url = upload_media(data, dest_name=dest_name, content_type="application/pdf")
    if not report_url:
        raise HTTPException(status_code=500, detail="Failed to upload report to storage")

    try:
        supabase.table("analyses").update({"report_url": report_url}).eq("id", analysis_id).execute()
        logger.info("upload_report: stored report_url for analysis %s", analysis_id)
    except Exception as exc:
        logger.error("upload_report: DB update failed for %s: %s", analysis_id, exc)
        raise HTTPException(status_code=500, detail=f"Failed to update analysis record: {exc}")

    return {"report_url": report_url, "analysis_id": analysis_id}


@app.delete("/analyses/{analysis_id}")
async def delete_analysis(analysis_id: str) -> dict[str, Any]:
    """Delete a single analysis and its associated detections from Supabase."""
    supabase = get_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    try:
        # 1. Delete associated detections first (foreign-key safe)
        supabase.table("detections").delete().eq("analysis_id", analysis_id).execute()
        logger.info("delete_analysis: deleted detections for %s", analysis_id)

        # 2. Delete the analysis record
        result = supabase.table("analyses").delete().eq("id", analysis_id).execute()
        deleted = result.data if result and result.data else []

        if not deleted:
            raise HTTPException(status_code=404, detail=f"Analysis {analysis_id} not found")

        # 3. Best-effort cleanup of storage files (non-fatal)
        try:
            bucket = supabase.storage.from_("media")
            files_to_remove = [
                f"{analysis_id}_original",
                f"{analysis_id}_annotated.jpg",
                f"reports/{analysis_id}_report.pdf",
            ]
            # List files that might match and remove them
            for prefix in files_to_remove:
                try:
                    bucket.remove([prefix])
                except Exception:
                    pass  # storage cleanup is best-effort
        except Exception as storage_exc:
            logger.warning("delete_analysis: storage cleanup failed (non-fatal): %s", storage_exc)

        logger.info("delete_analysis: successfully deleted analysis %s", analysis_id)
        return {"deleted": True, "analysis_id": analysis_id}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("delete_analysis: failed for %s: %s", analysis_id, exc)
        raise HTTPException(status_code=500, detail=f"Failed to delete analysis: {exc}")
