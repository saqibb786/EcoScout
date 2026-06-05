from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any

import cv2
import numpy as np
from ultralytics import YOLO

try:
    import easyocr
except ImportError:
    easyocr = None

BBox = list[int]
COCO_VEHICLE_IDS: set[int] = {2, 3, 5, 7}  # car, motorcycle, bus, truck


class DetectorBase:
    """Wrapper for YOLO inference."""
    def __init__(self, model_path: str, conf: float):
        self.model = YOLO(model_path)
        self.conf = conf

    def detect(self, frame: np.ndarray, class_filter: set[int] | None = None) -> list[dict]:
        results = self.model(frame, conf=self.conf, verbose=False)
        detections = []
        if results and results[0] is not None:
            for det in results[0].boxes:
                cls_id = int(det.cls)
                if class_filter and cls_id not in class_filter:
                    continue
                detections.append({
                    "class": str(self.model.names[cls_id]).lower(),
                    "cls_id": cls_id,
                    "confidence": float(det.conf),
                    "bbox": [int(v) for v in det.xyxy[0].tolist()]
                })
        return detections


class Tracker:
    """Lightweight Centroid Tracker for maintaining vehicle identities in video."""
    def __init__(self, max_disappeared=15, max_distance=150):
        self.next_id = 1
        self.objects = {}       # id -> (cX, cY)
        self.disappeared = {}   # id -> count
        self.vehicle_data = {}  # id -> { "plate_text": None, "plate_conf": 0.0, "violation": None }
        self.max_disappeared = max_disappeared
        self.max_distance = max_distance

    def reset(self):
        self.next_id = 1
        self.objects.clear()
        self.disappeared.clear()
        self.vehicle_data.clear()

    def update(self, bboxes: list[BBox]) -> list[int]:
        if len(bboxes) == 0:
            for obj_id in list(self.disappeared.keys()):
                self.disappeared[obj_id] += 1
                if self.disappeared[obj_id] > self.max_disappeared:
                    self.deregister(obj_id)
            return []

        input_centroids = np.array([((x1+x2)/2.0, (y1+y2)/2.0) for x1, y1, x2, y2 in bboxes])

        if len(self.objects) == 0:
            return [self.register(c) for c in input_centroids]

        object_ids = list(self.objects.keys())
        object_centroids = np.array(list(self.objects.values()))

        diff = object_centroids[:, np.newaxis, :] - input_centroids[np.newaxis, :, :]
        D = np.linalg.norm(diff, axis=2)

        rows = D.min(axis=1).argsort()
        cols = D.argmin(axis=1)[rows]

        used_rows, used_cols = set(), set()
        assigned_ids = [None] * len(bboxes)

        for row, col in zip(rows, cols):
            if row in used_rows or col in used_cols: continue
            if D[row, col] > self.max_distance: continue

            obj_id = object_ids[row]
            self.objects[obj_id] = input_centroids[col]
            self.disappeared[obj_id] = 0
            assigned_ids[col] = obj_id

            used_rows.add(row)
            used_cols.add(col)

        for row in set(range(D.shape[0])) - used_rows:
            obj_id = object_ids[row]
            self.disappeared[obj_id] += 1
            if self.disappeared[obj_id] > self.max_disappeared:
                self.deregister(obj_id)

        for col in set(range(D.shape[1])) - used_cols:
            assigned_ids[col] = self.register(input_centroids[col])

        return assigned_ids

    def register(self, centroid):
        obj_id = self.next_id
        self.objects[obj_id] = centroid
        self.disappeared[obj_id] = 0
        self.vehicle_data[obj_id] = {"plate_text": None, "plate_conf": 0.0, "violation": None}
        self.next_id += 1
        return obj_id

    def deregister(self, obj_id):
        self.objects.pop(obj_id, None)
        self.disappeared.pop(obj_id, None)
        self.vehicle_data.pop(obj_id, None)

    def cache_plate(self, obj_id: int, text: str, conf: float):
        if obj_id in self.vehicle_data:
            if conf > self.vehicle_data[obj_id]["plate_conf"]:
                self.vehicle_data[obj_id]["plate_text"] = text
                self.vehicle_data[obj_id]["plate_conf"] = conf

    def get_plate(self, obj_id: int) -> tuple[str | None, float]:
        if obj_id in self.vehicle_data:
            return self.vehicle_data[obj_id]["plate_text"], self.vehicle_data[obj_id]["plate_conf"]
        return None, 0.0


class OCREngine:
    """Dedicated OCR Engine for License Plates."""
    def __init__(self):
        self._reader = None

    def read_plate(self, plate_crop: np.ndarray) -> tuple[str | None, float | None]:
        if easyocr is None:
            return None, None

        if self._reader is None:
            self._reader = easyocr.Reader(["en"], gpu=False)

        h, w = plate_crop.shape[:2]
        rois = [plate_crop]
        if h >= 18 and w >= 24:
            rois.append(plate_crop[int(h * 0.28): int(h * 0.98), :])

        candidates = []
        for roi in rois:
            for variant in self._get_variants(roi):
                try:
                    res = self._reader.readtext(
                        variant,
                        detail=1,
                        paragraph=False,
                        allowlist="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
                    )
                except Exception:
                    continue

                for row in res:
                    conf = float(row[2])
                    text = self._normalize_text(str(row[1]))
                    if text and 3 <= len(text) <= 9:
                        candidates.append((text, conf))
                        if conf >= 0.88 and 4 <= len(text) <= 8:
                            return text, conf

        if not candidates:
            return None, None

        agg = {}
        for text, conf in candidates:
            if text not in agg:
                agg[text] = {"count": 0, "best_conf": 0.0, "sum_conf": 0.0}
            agg[text]["count"] += 1
            agg[text]["sum_conf"] += conf
            agg[text]["best_conf"] = max(agg[text]["best_conf"], conf)

        best_text, best_score, best_conf = None, -1.0, 0.0
        for text, s in agg.items():
            score = (s["sum_conf"] / s["count"] * 0.55) + (s["best_conf"] * 0.30) + (min(s["count"], 5) * 0.03)
            score += 0.10 if 4 <= len(text) <= 8 else 0.0
            if score > best_score:
                best_score, best_text, best_conf = score, text, s["best_conf"]

        if best_conf < 0.50:
            return None, best_conf
        return best_text, best_conf

    @staticmethod
    def _normalize_text(text: str) -> str:
        return re.sub(r"[^A-Z0-9]", "", text.upper())

    @staticmethod
    def _get_variants(img: np.ndarray) -> list[np.ndarray]:
        h, w = img.shape[:2]
        scale = 2.3 if min(h, w) < 60 else 1.7
        up = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        gray = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)
        denoise = cv2.bilateralFilter(gray, 7, 40, 40)
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(denoise)
        otsu = cv2.threshold(clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        return [gray, clahe, otsu]


class ViolationEngine:
    """Core logic engine coordinating Detectors, Tracking, and Matching."""
    def __init__(self, litter_path, smoke_path, vehicle_path, plate_path, confs):
        self.detectors = {
            "litter": DetectorBase(litter_path, confs["litter"]),
            "smoke": DetectorBase(smoke_path, confs["smoke"]),
            "vehicle": DetectorBase(vehicle_path, confs["vehicle"]),
            "plate": DetectorBase(plate_path, confs["plate"])
        }
        self.ocr_engine = OCREngine()
        self.tracker = Tracker()

    def process_frame(self, frame: np.ndarray, source_name: str, frame_index: int | None, source_type: str):
        # Create a completely clean copy of the frame to isolate OCR/Detection from any mutations
        clean_frame = frame.copy()

        # Reset tracker for new videos
        if source_type == "video" and (frame_index == 0 or frame_index is None):
            self.tracker.reset()

        # Pass 1: Parallel inference for Litter and Smoke using copies
        import concurrent.futures
        
        smoke_model = self.detectors["smoke"].model
        smoke_cls_ids = {cid for cid, name in smoke_model.names.items() if "smoke" in name.lower()}
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            future_litter = executor.submit(self.detectors["litter"].detect, clean_frame.copy())
            future_smoke = executor.submit(self.detectors["smoke"].detect, clean_frame.copy(), smoke_cls_ids)
            
            litter_detections = future_litter.result()
            smoke_detections = future_smoke.result()

        violations = litter_detections + smoke_detections
        
        # If no violations are detected, return early and bypass vehicle and plate detection
        if not violations:
            return clean_frame, []

        vehicles = self.detectors["vehicle"].detect(clean_frame.copy(), class_filter=COCO_VEHICLE_IDS)
        plates = self.detectors["plate"].detect(clean_frame.copy())

        # Pass 2: Plate-based Vehicle Inference
        vehicles = self._infer_vehicles(vehicles, plates, clean_frame.shape)

        # Apply Tracking
        if source_type == "video":
            vehicle_bboxes = [v["bbox"] for v in vehicles]
            assigned_ids = self.tracker.update(vehicle_bboxes)
            for i, v in enumerate(vehicles):
                v["id"] = assigned_ids[i]
        else:
            for v in vehicles:
                v["id"] = None

        # Pass 3: Match Violations to Vehicles
        records = []
        has_smoke = False
        has_litter = False
        for viol in violations:
            viol_class = viol["class"]
            
            # Map class name to user's display format
            if "smoke" in viol_class.lower():
                mapped_violation = "Smoke Detection"
            elif "litter" in viol_class.lower() or "trash" in viol_class.lower():
                mapped_violation = "Litter Detection"
            else:
                mapped_violation = viol_class
            
            if mapped_violation == "Smoke Detection" and has_smoke:
                continue
            if mapped_violation == "Litter Detection" and has_litter:
                continue
            
            vehicle = self._match_vehicle(viol["bbox"], vehicles, viol_class)
            plate_data = None
            match_strategy = "spatial"
            
            if vehicle:
                plate = self._match_plate(vehicle["bbox"], plates)
                if plate:
                    plate_data = self._read_plate(clean_frame, plate["bbox"], plate["confidence"], vehicle.get("id"))
                else:
                    plate_data = self._fallback_local_plate(clean_frame, vehicle["bbox"], vehicle.get("id"))
            else:
                # False positive: violation doesn't match any vehicle spatially
                continue

            record = {
                "source": source_name,
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "frame_index": frame_index,
                "violation": mapped_violation,
                "violation_confidence": round(viol["confidence"], 4),
                "violation_bbox": viol["bbox"],
                "vehicle_id": vehicle.get("id"),
                "vehicle_bbox": vehicle["bbox"],
                "vehicle_confidence": round(vehicle["confidence"], 4) if vehicle["confidence"] else None,
                "vehicle_class": vehicle["class"],
                "match_strategy": match_strategy,
                "plate_bbox": plate_data["bbox"] if plate_data else None,
                "plate_confidence": round(plate_data["conf"], 4) if plate_data and plate_data["conf"] else None,
                "plate_text": self._mask(plate_data["text"]) if plate_data else None,
                "plate_text_raw": plate_data["text"] if plate_data else None,
                "ocr_confidence": round(plate_data["ocr_conf"], 4) if plate_data and plate_data["ocr_conf"] else None,
            }
            records.append(record)
            
            if mapped_violation == "Smoke Detection":
                has_smoke = True
            elif mapped_violation == "Litter Detection":
                has_litter = True

        annotated = self._annotate(clean_frame.copy(), vehicles, violations, records)
        return annotated, records

    # --- Engine Helpers ---

    def _infer_vehicles(self, vehicles, plates, shape):
        for p in plates:
            cx, cy = (p["bbox"][0] + p["bbox"][2]) / 2, (p["bbox"][1] + p["bbox"][3]) / 2
            if any(v["bbox"][0] <= cx <= v["bbox"][2] and v["bbox"][1] <= cy <= v["bbox"][3] for v in vehicles):
                continue
            px1, py1, px2, py2 = p["bbox"]
            pw, ph = px2 - px1, py2 - py1
            vehicles.append({
                "class": "vehicle (inferred)", "confidence": p["confidence"], "id": None,
                "bbox": [max(0, int(px1 - pw * 3.5)), max(0, int(py1 - ph * 10)), min(shape[1], int(px2 + pw * 3.5)), min(shape[0], int(py2 + ph * 2))]
            })
        return vehicles

    def _match_vehicle(self, v_bbox, vehicles, viol_class):
        best_v, best_score = None, 0.0
        for v in vehicles:
            overlap = self._iou(v_bbox, v["bbox"])
            dist = self._dist(v_bbox, v["bbox"])
            
            # Strict Validation Logic
            if "smoke" in viol_class.lower() and overlap == 0:
                continue  # Smoke must overlap with the vehicle
            if ("litter" in viol_class.lower() or "trash" in viol_class.lower()) and overlap == 0 and dist > 250:
                continue  # Litter must be within a reasonable distance
                
            score = overlap + (1.0 / (1.0 + dist / 150.0))
            if score > best_score: best_score, best_v = score, v
        return best_v

    def _match_plate(self, v_bbox, plates):
        best_p, best_score = None, -1.0
        for p in plates:
            cx, cy = (p["bbox"][0] + p["bbox"][2]) / 2, (p["bbox"][1] + p["bbox"][3]) / 2
            overlap = self._iou(v_bbox, p["bbox"])
            if overlap > 0 or (v_bbox[0] <= cx <= v_bbox[2] and v_bbox[1] <= cy <= v_bbox[3]):
                score = overlap + p["confidence"]
                if score > best_score: best_score, best_p = score, p
        return best_p

    def _fallback_local_plate(self, frame, v_bbox, v_id):
        x1, y1, x2, y2 = self._clip(v_bbox, frame.shape)
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0: return None
        res = self.detectors["plate"].detect(crop)
        if not res: return None
        p = max(res, key=lambda x: x["confidence"])
        p_bbox = [x1 + p["bbox"][0], y1 + p["bbox"][1], x1 + p["bbox"][2], y1 + p["bbox"][3]]
        return self._read_plate(frame, p_bbox, p["confidence"], v_id)

    def _read_plate(self, frame, p_bbox, conf, v_id):
        # 1. OCR execution
        x1, y1, x2, y2 = self._clip(p_bbox, frame.shape)
        crop = frame[y1:y2, x1:x2]
        text, ocr_conf = None, 0.0
        if crop.size > 0:
            text, ocr_conf = self.ocr_engine.read_plate(crop)

        # 2. Tracking smoothing
        if v_id is not None:
            if text and ocr_conf is not None:
                self.tracker.cache_plate(v_id, text, ocr_conf)
            cached_text, cached_conf = self.tracker.get_plate(v_id)
            if cached_text:
                text, ocr_conf = cached_text, cached_conf

        if not text: return None
        return {"bbox": p_bbox, "conf": conf, "text": text, "ocr_conf": ocr_conf}

    def _mask(self, text):
        t = text.replace(" ", "")
        return t if len(t) <= 4 else f"{t[:2]}{'*' * (len(t) - 4)}{t[-2:]}"

    def _annotate(self, frame, vehicles, violations, records):
        for v in vehicles:
            x1, y1, x2, y2 = v["bbox"]
            color = (255, 180, 0)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            label = f"ID:{v['id']} " if v.get("id") else ""
            label += f"{v['class']} {v['confidence']:.2f}"
            cv2.putText(frame, label, (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)
        
        for v in violations:
            x1, y1, x2, y2 = v["bbox"]
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 2)
            cv2.putText(frame, f"{v['class']} {v['confidence']:.2f}", (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 2)
        
        for r in records:
            if r["vehicle_bbox"]:
                x1, y1, x2, y2 = r["vehicle_bbox"]
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 220, 0), 3)
                pt = r.get("plate_text") or "unreadable"
                cv2.putText(frame, f"{r['violation']} | plate: {pt}", (x1, min(frame.shape[0] - 10, y2 + 20)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 220, 0), 2)
            if r["plate_bbox"]:
                px1, py1, px2, py2 = r["plate_bbox"]
                cv2.rectangle(frame, (px1, py1), (px2, py2), (180, 0, 255), 2)
        return frame

    def _iou(self, a, b):
        ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
        iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
        inter = ix * iy
        area_a, area_b = max(0, a[2] - a[0]) * max(0, a[3] - a[1]), max(0, b[2] - b[0]) * max(0, b[3] - b[1])
        denom = area_a + area_b - inter
        return inter / denom if denom > 0 else 0.0

    def _dist(self, a, b):
        x_dist = max(0, max(a[0] - b[2], b[0] - a[2]))
        y_dist = max(0, max(a[1] - b[3], b[1] - a[3]))
        return math.sqrt(x_dist**2 + y_dist**2)

    def _clip(self, b, s):
        return max(0, min(s[1]-1, b[0])), max(0, min(s[0]-1, b[1])), max(1, min(s[1], b[2])), max(1, min(s[0], b[3]))

    def _expand_bbox(self, b, s, scale=1.4):
        cx, cy, bw, bh = (b[0]+b[2])/2, (b[1]+b[3])/2, (b[2]-b[0])*scale, (b[3]-b[1])*scale
        return [max(0, int(cx - bw/2)), max(0, int(cy - bh/2)), min(s[1], int(cx + bw/2)), min(s[0], int(cy + bh/2))]


class ViolationPipeline:
    """Wrapper class to maintain API backward compatibility."""
    def __init__(self, litter_model_path, smoke_model_path, vehicle_model_path, plate_model_path,
                 litter_conf=0.35, smoke_conf=0.40, vehicle_conf=0.30, plate_conf=0.30, vehicle_recover_conf=0.15):
        self.engine = ViolationEngine(
            litter_model_path, smoke_model_path, vehicle_model_path, plate_model_path,
            {"litter": litter_conf, "smoke": smoke_conf, "vehicle": vehicle_conf, "plate": plate_conf}
        )
        self.engine.vehicle_recover_conf = vehicle_recover_conf

    def analyze_frame(self, frame, source_name, frame_index=None, source_type="image"):
        # Delegate to the new modular engine
        return self.engine.process_frame(frame, source_name, frame_index, source_type)

    def _clip_bbox(self, bbox, w, h):
        return max(0, min(w-1, bbox[0])), max(0, min(h-1, bbox[1])), max(1, min(w, bbox[2])), max(1, min(h, bbox[3]))
