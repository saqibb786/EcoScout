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

from pipeline import ViolationPipeline


BASE_DIR = Path(__file__).resolve().parent
EVIDENCE_DIR = BASE_DIR / "evidence"
IMAGES_DIR = EVIDENCE_DIR / "images"
VIDEOS_DIR = EVIDENCE_DIR / "videos"
UPLOAD_DIR = BASE_DIR / "temp" / "uploads"

for folder in (IMAGES_DIR, VIDEOS_DIR, UPLOAD_DIR):
    folder.mkdir(parents=True, exist_ok=True)

pipeline = ViolationPipeline(
    violation_model_path=str(BASE_DIR / "violation_best.pt"),
    plate_model_path=str(BASE_DIR / "plate_best.pt"),
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
        frame, source_name=file.filename)
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
                )
                for rec in records:
                    rec["video_time_sec"] = round(frame_index / fps, 3)
                all_records.extend(records)
                writer.write(annotated)
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
