from __future__ import annotations

import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.pipeline import ViolationPipeline


BASE_DIR = Path(__file__).resolve().parent.parent
EVIDENCE_DIR = BASE_DIR / "evidence"
IMAGES_DIR = EVIDENCE_DIR / "images"
VIDEOS_DIR = EVIDENCE_DIR / "videos"
UPLOAD_DIR = BASE_DIR / "temp" / "uploads"


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
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/evidence", StaticFiles(directory=str(EVIDENCE_DIR)), name="evidence")


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


@app.get("/")
def root() -> dict[str, str]:
    return {
        "message": "EcoScout FastAPI is running.",
        "docs": "/docs",
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "time": datetime.now().isoformat(timespec="seconds")}


@app.post("/analyze/image")
async def analyze_image(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read()
    arr = np.frombuffer(data, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid image file")

    annotated, records = pipeline.analyze_frame(
        frame, source_name=file.filename, source_type="image")
    out_name = f"image_{uuid.uuid4().hex[:12]}.jpg"
    out_path = IMAGES_DIR / out_name

    ok = _save_image_safely(annotated, out_path)

    annotated_rel = None
    annotated_abs = None
    warning = None
    if ok:
        annotated_rel = f"/evidence/images/{out_name}"
        annotated_abs = f"http://127.0.0.1:8000/evidence/images/{out_name}"
    else:
        warning = (
            "Annotated image could not be persisted to disk. "
            "Analysis results are returned without annotated media."
        )
    # Persist per-record crops and attach URLs so reports can include them.
    if ok:
        base = out_name.rsplit(".", 1)[0]
        for i, rec in enumerate(records):
            rec["frame_image_url"] = annotated_rel
            rec["frame_image_url_abs"] = annotated_abs

            # vehicle crop
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

            # plate crop
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

    return {
        "source_type": "image",
        "source_name": file.filename,
        "violations_found": len(records),
        "records": records,
        "annotated_image": annotated_rel,
        "annotated_image_url": annotated_abs,
        "warning": warning,
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
        if upload_path.exists():
            os.remove(upload_path)

    return {
        "source_type": "video",
        "source_name": file.filename,
        "total_frames": frame_index,
        "frame_stride": frame_stride,
        "violations_found": len(all_records),
        "records": all_records,
        "annotated_video": f"/evidence/videos/{out_name}",
        "annotated_video_url": f"http://127.0.0.1:8000/evidence/videos/{out_name}",
    }
