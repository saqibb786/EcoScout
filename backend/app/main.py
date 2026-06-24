from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
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
    smoke_model_path=str(BASE_DIR / "models" / "smoke_detection.pt"),
    vehicle_model_path=str(BASE_DIR / "models" / "yolov8s.pt"),
    plate_model_path=str(BASE_DIR / "models" / "plate_best.pt"),
    litter_conf=_env_float("LITTER_CONF", 0.35),
    smoke_conf=_env_float("SMOKE_CONF", 0.003),
    vehicle_conf=_env_float("VEHICLE_CONF", 0.30),
    plate_conf=_env_float("PLATE_CONF", 0.30),
    vehicle_recover_conf=_env_float("VEHICLE_RECOVER_CONF", 0.15),
)

app = FastAPI(
    title="EcoScout Violation API",
    description="Detects vehicle violations, links them to violator vehicles, detects number plates, and runs OCR.",
    version="1.0.0",
)

allowed_origins = ["http://127.0.0.1:5173", "http://localhost:5173"]
cors_origins_env = os.getenv("CORS_ORIGINS")
if cors_origins_env:
    # Clean any JSON array brackets or quotes if present in the secret
    cleaned = cors_origins_env.replace("[", "").replace("]", "").replace('"', '').replace("'", "")
    allowed_origins.extend([o.strip() for o in cleaned.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/evidence", StaticFiles(directory=str(EVIDENCE_DIR)), name="evidence")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.method != "OPTIONS":
        path = request.url.path
        is_protected = False
        for p in PROTECTED_PATHS:
            if path == p or path.startswith(p + "/"):
                is_protected = True
                break
        if is_protected:
            token = request.cookies.get(SESSION_COOKIE)
            if not token:
                token = request.headers.get("X-Session-Token")
            if not token:
                auth_header = request.headers.get("Authorization", "")
                if auth_header.startswith("Bearer "):
                    token = auth_header[7:].strip()
                elif auth_header:
                    token = auth_header.strip()
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
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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


def deduplicate_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best_smoke = None
    best_litter = None
    other_records = []
    
    for rec in records:
        viol = str(rec.get("violation") or rec.get("class_name") or "unknown")
        conf = rec.get("violation_confidence") or rec.get("confidence") or 0.0
        try:
            conf = float(conf)
        except (ValueError, TypeError):
            conf = 0.0
            
        if "smoke" in viol.lower():
            rec["violation"] = "Smoke Detection"
            if "class_name" in rec:
                rec["class_name"] = "Smoke Detection"
            
            best_conf = (best_smoke.get("violation_confidence") or best_smoke.get("confidence") or 0.0) if best_smoke else -1.0
            try:
                best_conf = float(best_conf)
            except (ValueError, TypeError):
                best_conf = -1.0
                
            if conf > best_conf:
                best_smoke = rec
        elif "litter" in viol.lower() or "trash" in viol.lower():
            rec["violation"] = "Litter Detection"
            if "class_name" in rec:
                rec["class_name"] = "Litter Detection"
            
            best_conf = (best_litter.get("violation_confidence") or best_litter.get("confidence") or 0.0) if best_litter else -1.0
            try:
                best_conf = float(best_conf)
            except (ValueError, TypeError):
                best_conf = -1.0
                
            if conf > best_conf:
                best_litter = rec
        else:
            other_records.append(rec)
            
    deduped = []
    if best_smoke:
        deduped.append(best_smoke)
    if best_litter:
        deduped.append(best_litter)
    deduped.extend(other_records)
    return deduped


def _normalize_detection_row(row: dict[str, Any]) -> dict[str, Any]:
    raw_violation = row.get("class_name") or row.get("violation") or "unknown"
    if "smoke" in raw_violation.lower():
        violation = "Smoke Detection"
    elif "litter" in raw_violation.lower() or "trash" in raw_violation.lower():
        violation = "Litter Detection"
    else:
        violation = raw_violation

    return {
        "frame_index": row.get("frame_index"),
        "violation": violation,
        "violation_confidence": row.get("confidence") or row.get("violation_confidence"),
        "violation_bbox": row.get("bbox") or row.get("violation_bbox"),
        "plate_text": row.get("ocr_text") or row.get("plate_text"),
        "plate_text_raw": row.get("ocr_text") or row.get("plate_text_raw"),
        "ocr_confidence": row.get("ocr_confidence"),
        "plate_confidence": row.get("plate_confidence"),
        "vehicle_bbox": row.get("vehicle_bbox"),
        "vehicle_confidence": row.get("vehicle_confidence"),
        "match_strategy": row.get("match_strategy"),
        "timestamp": row.get("timestamp"),
        "video_time_sec": row.get("video_time_sec"),
    }


def _analysis_to_history_item(analysis: dict[str, Any], detections: list[dict[str, Any]]) -> dict[str, Any]:
    media_url = analysis.get("media_url")
    created_at = analysis.get("created_at")
    detection_summary = analysis.get("detection_summary") or {}
    detection_image_url = analysis.get("detection_image_url") or media_url

    full_detections = detection_summary.get("full_detections")
    restored_detections = []
    
    if full_detections:
        for matched in full_detections:
            viol = str(matched.get("violation") or matched.get("class_name") or "unknown")
            if "smoke" in viol.lower():
                matched["violation"] = "Smoke Detection"
            elif "litter" in viol.lower() or "trash" in viol.lower():
                matched["violation"] = "Litter Detection"
            
            for k in ("violation_confidence", "vehicle_confidence", "plate_confidence", "ocr_confidence"):
                if matched.get(k) is not None:
                    try:
                        matched[k] = float(matched[k])
                    except (ValueError, TypeError):
                        pass
            restored_detections.append(matched)
    else:
        restored_detections = [_normalize_detection_row(row) for row in detections]

    restored_detections = deduplicate_records(restored_detections)
    total_detections = len(restored_detections)

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
        "violation_name": analysis.get("violation_name") or detection_summary.get("violation_name") or _dominant_violation_name(restored_detections),
        "detection_summary": {**detection_summary, "violations_found": total_detections},
        "report_url": analysis.get("report_url"),
        "detections": restored_detections,
        "records": restored_detections,
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
    response = JSONResponse({
        "authenticated": True,
        "username": ADMIN_USERNAME,
        "token": session_token
    })
    response.set_cookie(
        key=SESSION_COOKIE,
        value=session_token,
        httponly=True,
        samesite="none",
        secure=True,
        path="/",
    )
    return response


@app.get("/auth/me")
async def auth_me(request: Request) -> dict[str, Any]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        token = request.headers.get("X-Session-Token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        elif auth_header:
            token = auth_header.strip()
    is_auth = bool(token and token in ACTIVE_SESSIONS)
    return {"authenticated": is_auth, "username": ADMIN_USERNAME if is_auth else None}


@app.post("/logout")
async def logout(request: Request):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        token = request.headers.get("X-Session-Token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        elif auth_header:
            token = auth_header.strip()
    if token:
        ACTIVE_SESSIONS.discard(token)
    response = JSONResponse({"authenticated": False})
    response.delete_cookie(SESSION_COOKIE, path="/", samesite="none", secure=True)
    return response


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat(timespec="seconds")}


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


class SaveDetectionRow(BaseModel):
    frame_index: int | None = None
    violation: str | None = None
    violation_confidence: float | None = None
    violation_bbox: list[float] | None = None
    plate_text: str | None = None
    plate_text_raw: str | None = None
    ocr_confidence: float | None = None
    vehicle_bbox: list[float] | None = None
    vehicle_confidence: float | None = None
    match_strategy: str | None = None
    timestamp: str | None = None
    video_time_sec: float | None = None

    # Extra fields returned by the pipeline or normalizer
    source: str | None = None
    vehicle_id: int | None = None
    vehicle_class: str | None = None
    plate_bbox: list[float] | None = None
    plate_confidence: float | None = None
    frame_image_url: str | None = None
    frame_image_url_abs: str | None = None
    vehicle_crop_url: str | None = None
    vehicle_crop_url_abs: str | None = None
    plate_crop_url: str | None = None
    plate_crop_url_abs: str | None = None


class SaveAnalysisPayload(BaseModel):
    analysis_id: str
    media_url: str
    media_type: str
    detection_image_url: str
    violation_name: str
    detection_summary: dict[str, Any]
    total_detections: int
    detections: list[SaveDetectionRow]
    timestamp_real: str | None = None


class DeleteBulkPayload(BaseModel):
    ids: list[str] | None = None


@app.post("/analyze/image")
async def analyze_image(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read()
    arr = np.frombuffer(data, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image file")

    annotated, records = pipeline.analyze_frame(
        frame.copy(), source_name=file.filename, source_type="image")
    records = deduplicate_records(records)
    analysis_id = str(uuid.uuid4())
    timestamp_real = _current_timestamp()

    # Save original image locally
    original_ext = Path(file.filename or "image.jpg").suffix or ".jpg"
    original_name = f"{analysis_id}_original{original_ext}"
    original_path = IMAGES_DIR / original_name
    original_path.write_bytes(data)

    # Save annotated image locally
    annotated_name = f"{analysis_id}_annotated.jpg"
    annotated_path = IMAGES_DIR / annotated_name
    _save_image_safely(annotated, annotated_path)

    media_url = f"/evidence/images/{original_name}"
    detection_image_url = f"/evidence/images/{annotated_name}"

    # Generate clean crops (vehicle and license plate)
    clean_rel = media_url
    clean_abs = f"http://127.0.0.1:8000{media_url}"

    for i, rec in enumerate(records):
        rec["frame_image_url"] = clean_rel
        rec["frame_image_url_abs"] = clean_abs

        vb = rec.get("vehicle_bbox")
        if vb:
            vx1, vy1, vx2, vy2 = pipeline._clip_bbox(
                vb, frame.shape[1], frame.shape[0]
            )
            vehicle_crop = frame[vy1:vy2, vx1:vx2]
            vname = f"{analysis_id}_rec{i}_vehicle.jpg"
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
            pname = f"{analysis_id}_rec{i}_plate.jpg"
            ppath = IMAGES_DIR / pname
            if _save_image_safely(plate_crop, ppath):
                rec["plate_crop_url"] = f"/evidence/images/{pname}"
                rec["plate_crop_url_abs"] = f"http://127.0.0.1:8000/evidence/images/{pname}"

    violation_name = _dominant_violation_name(records)
    detection_summary = {
        "source_name": file.filename,
        "violations_found": len(records),
        "frame_stride": None,
        "total_frames": None,
        "violation_name": violation_name,
    }

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
        if upload_path.exists():
            os.remove(upload_path)
        raise HTTPException(
            status_code=400, detail="Could not open uploaded video")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)

    analysis_id = str(uuid.uuid4())
    timestamp_real = _current_timestamp()
    best_vehicle_plates = {}

    # Save original video locally with analysis_id
    original_ext = Path(file.filename or "video.mp4").suffix or ".mp4"
    original_name = f"{analysis_id}_original{original_ext}"
    original_video_path = VIDEOS_DIR / original_name
    original_video_path.write_bytes(original_upload_bytes)

    out_name = f"{analysis_id}_annotated.mp4"
    out_path = VIDEOS_DIR / out_name
    writer = cv2.VideoWriter(
        str(out_path),
        cv2.VideoWriter_fourcc(*"avc1"),
        fps,
        (width, height),
    )

    all_records: list[dict[str, Any]] = []
    frame_index = 0

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break

            if frame_index % frame_stride == 0:
                annotated, records = pipeline.analyze_frame(
                    frame.copy(),
                    source_name=file.filename,
                    frame_index=frame_index,
                    source_type="video",
                )
                for rec in records:
                    rec["video_time_sec"] = round(frame_index / fps, 3)
                all_records.extend(records)
                # Save annotated frame and per-record crops for reporting.
                writer.write(annotated)
                try:
                    base = f"video_{uuid.uuid4().hex[:10]}_f{frame_index}"
                    ann_name = f"{base}_annot.jpg"
                    ann_path = IMAGES_DIR / ann_name
                    _save_image_safely(annotated, ann_path)

                    clean_name = f"{base}_clean.jpg"
                    clean_path = IMAGES_DIR / clean_name
                    _save_image_safely(frame, clean_path)

                    clean_rel = f"/evidence/images/{clean_name}"
                    clean_abs = f"http://127.0.0.1:8000/evidence/images/{clean_name}"

                    for i, rec in enumerate(records):
                        rec["frame_image_url"] = clean_rel
                        rec["frame_image_url_abs"] = clean_abs

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

                        # Cache best plate read and crop details per tracked vehicle ID
                        v_id = rec.get("vehicle_id")
                        if v_id is not None and rec.get("plate_text_raw"):
                            ocr_conf = rec.get("ocr_confidence") or 0.0
                            if v_id not in best_vehicle_plates or ocr_conf > best_vehicle_plates[v_id]["ocr_confidence"]:
                                best_vehicle_plates[v_id] = {
                                    "plate_text": rec.get("plate_text"),
                                    "plate_text_raw": rec.get("plate_text_raw"),
                                    "ocr_confidence": ocr_conf,
                                    "plate_bbox": rec.get("plate_bbox"),
                                    "plate_confidence": rec.get("plate_confidence"),
                                    "plate_crop_url": rec.get("plate_crop_url"),
                                    "plate_crop_url_abs": rec.get("plate_crop_url_abs")
                                }
                except Exception as e:
                    logger.error("Error saving frame or crops: %s", e)
            else:
                writer.write(frame)

            frame_index += 1
    finally:
        cap.release()
        writer.release()
        if upload_path.exists():
            os.remove(upload_path)

    media_url = f"/evidence/videos/{original_name}"
    detection_image_url = f"/evidence/videos/{out_name}"

    # Backfill plate texts and crops from the best detection of that vehicle in the video history
    for rec in all_records:
        v_id = rec.get("vehicle_id")
        if v_id is not None and v_id in best_vehicle_plates:
            best = best_vehicle_plates[v_id]
            rec["plate_text"] = best["plate_text"]
            rec["plate_text_raw"] = best["plate_text_raw"]
            rec["ocr_confidence"] = best["ocr_confidence"]
            rec["plate_bbox"] = best["plate_bbox"]
            rec["plate_confidence"] = best["plate_confidence"]
            rec["plate_crop_url"] = best["plate_crop_url"]
            rec["plate_crop_url_abs"] = best["plate_crop_url_abs"]

    all_records = deduplicate_records(all_records)
    violation_name = _dominant_violation_name(all_records)
    detection_summary = {
        "source_name": file.filename,
        "violations_found": len(all_records),
        "frame_stride": frame_stride,
        "total_frames": frame_index,
        "violation_name": violation_name,
    }

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
    }


def _local_path_from_url(url: str) -> Path | None:
    if not url:
        return None
    parsed = urlparse(url)
    path_str = parsed.path
    if "/evidence/images/" in path_str:
        filename = path_str.split("/evidence/images/")[-1]
        return IMAGES_DIR / filename
    if "/evidence/videos/" in path_str:
        filename = path_str.split("/evidence/videos/")[-1]
        return VIDEOS_DIR / filename
    return None


@app.post("/analyses/save")
async def save_analysis(payload: SaveAnalysisPayload):
    # Rule 3: Skip saving to DB if no violations/detections were found (clean scan)
    if not payload.detections or len(payload.detections) == 0:
        logger.info("save_analysis: clean scan (no detections) — skipping database insert")
        return {"status": "skipped_clean_scan", "analysis_id": payload.analysis_id}

    supabase = get_client()
    if not supabase:
        raise HTTPException(
            status_code=500,
            detail="Supabase client not configured. Check backend .env file.",
        )

    # Prevent duplicates
    try:
        existing = supabase.table("analyses").select("id").eq("id", payload.analysis_id).execute()
        if existing.data:
            return {"status": "already_saved", "analysis_id": payload.analysis_id}
    except Exception as exc:
        logger.warning("save_analysis: duplicate check failed: %s", exc)

    local_media = _local_path_from_url(payload.media_url)
    local_annotated = _local_path_from_url(payload.detection_image_url)

    media_supabase_url = None
    annotated_supabase_url = None

    if local_media and local_media.exists():
        ct = _guess_upload_content_type(local_media.name)
        media_supabase_url = upload_media(local_media, dest_name=local_media.name, content_type=ct)
    
    if not media_supabase_url:
        media_supabase_url = payload.media_url

    if local_annotated and local_annotated.exists():
        ct = _guess_upload_content_type(local_annotated.name)
        annotated_supabase_url = upload_media(local_annotated, dest_name=local_annotated.name, content_type=ct)
    
    if not annotated_supabase_url:
        annotated_supabase_url = payload.detection_image_url

    timestamp = payload.timestamp_real or _current_timestamp()

    rec_dicts = [rec.dict() for rec in payload.detections]
    deduped_dicts = deduplicate_records(rec_dicts)

    # Automatically upload local crop images (vehicle crop, plate crop, clean frame) to Supabase Storage
    for item in deduped_dicts:
        for crop_field in ("frame_image_url", "vehicle_crop_url", "plate_crop_url"):
            val = item.get(crop_field)
            if val:
                local_p = _local_path_from_url(val)
                if local_p and local_p.exists():
                    try:
                        ct = _guess_upload_content_type(local_p.name)
                        uploaded_url = upload_media(local_p, dest_name=local_p.name, content_type=ct)
                        if uploaded_url:
                            item[crop_field] = uploaded_url
                            item[f"{crop_field}_abs"] = uploaded_url
                    except Exception as e:
                        logger.error("Failed to upload crop %s to Supabase: %s", val, e)

    summary_to_save = {**payload.detection_summary}
    summary_to_save["full_detections"] = deduped_dicts
    summary_to_save["violations_found"] = len(deduped_dicts)

    try:
        analyses_row = {
            "id": payload.analysis_id,
            "created_at": timestamp,
            "timestamp_real": timestamp,
            "media_url": media_supabase_url,
            "media_type": payload.media_type,
            "detection_image_url": annotated_supabase_url,
            "violation_name": payload.violation_name,
            "detection_summary": summary_to_save,
            "total_detections": len(deduped_dicts),
        }
        supabase.table("analyses").insert(analyses_row).execute()

        detections_rows = []
        for item in deduped_dicts:
            det = {
                "id": str(uuid.uuid4()),
                "analysis_id": payload.analysis_id,
                "frame_index": item.get("frame_index"),
                "class_name": item.get("violation"),
                "confidence": item.get("violation_confidence"),
                "bbox": item.get("violation_bbox"),
                "ocr_text": item.get("plate_text"),
                "ocr_confidence": item.get("ocr_confidence"),
            }
            detections_rows.append(det)

        if detections_rows:
            supabase.table("detections").insert(detections_rows).execute()

        return {
            "status": "success",
            "analysis_id": payload.analysis_id,
            "media_url": media_supabase_url,
            "detection_image_url": annotated_supabase_url,
        }
    except Exception as exc:
        logger.error("save_analysis: database insertion failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Database insertion failed: {exc}",
        )


@app.delete("/analyses/{analysis_id}")
async def delete_analysis(analysis_id: str):
    supabase = get_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    try:
        # Delete dependent detections first
        supabase.table("detections").delete().eq("analysis_id", analysis_id).execute()
        # Delete analysis
        supabase.table("analyses").delete().eq("id", analysis_id).execute()
        logger.info("delete_analysis: deleted analysis %s from DB", analysis_id)
        return {"status": "success", "deleted_id": analysis_id}
    except Exception as exc:
        logger.error("delete_analysis failed for %s: %s", analysis_id, exc)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")


@app.post("/analyses/delete-bulk")
async def delete_analyses_bulk(payload: DeleteBulkPayload):
    supabase = get_client()
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    try:
        if payload.ids:
            # Delete selected detections first
            supabase.table("detections").delete().in_("analysis_id", payload.ids).execute()
            # Delete selected analyses
            supabase.table("analyses").delete().in_("id", payload.ids).execute()
            logger.info("delete_analyses_bulk: deleted %d analyses", len(payload.ids))
        else:
            # Clear all
            analyses_res = supabase.table("analyses").select("id").execute()
            all_ids = [row["id"] for row in (analyses_res.data or [])]
            if all_ids:
                supabase.table("detections").delete().in_("analysis_id", all_ids).execute()
                supabase.table("analyses").delete().in_("id", all_ids).execute()
            logger.info("delete_analyses_bulk: cleared all analyses (count=%d)", len(all_ids))
        return {"status": "success"}
    except Exception as exc:
        logger.error("delete_analyses_bulk failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")



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
