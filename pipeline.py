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
except ImportError:  # pragma: no cover - handled at runtime if OCR package is missing
    easyocr = None


BBox = list[int]


class ViolationPipeline:
    def __init__(
        self,
        violation_model_path: str,
        plate_model_path: str,
        violation_conf: float = 0.5,
        plate_conf: float = 0.4,
        vehicle_recover_conf: float = 0.2,
    ) -> None:
        self.violation_model = YOLO(violation_model_path)
        self.plate_model = YOLO(plate_model_path)
        self.violation_conf = violation_conf
        self.plate_conf = plate_conf
        self.vehicle_recover_conf = vehicle_recover_conf
        self.violation_labels = {"smoke", "littering"}
        self._ocr_reader = None

    def analyze_frame(
        self,
        frame: np.ndarray,
        source_name: str,
        frame_index: int | None = None,
    ) -> tuple[np.ndarray, list[dict[str, Any]]]:
        result_list = self.violation_model(frame, conf=self.violation_conf)
        result = result_list[0] if result_list else None

        vehicles: list[dict[str, Any]] = []
        violations: list[dict[str, Any]] = []

        if result is not None:
            for det in result.boxes:
                cls_id = int(det.cls)
                conf = float(det.conf)
                cls_name = str(self.violation_model.names[cls_id]).lower()
                bbox = [int(v) for v in det.xyxy[0].tolist()]

                item = {
                    "class": cls_name,
                    "confidence": conf,
                    "bbox": bbox,
                }
                if cls_name == "vehicle":
                    vehicles.append(item)
                elif cls_name in self.violation_labels:
                    violations.append(item)

        # Recovery pass: if violations exist but no vehicles were detected,
        # retry vehicle detection at a lower confidence.
        if violations and not vehicles and self.vehicle_recover_conf < self.violation_conf:
            recover_results = self.violation_model(
                frame, conf=self.vehicle_recover_conf)
            recover_result = recover_results[0] if recover_results else None
            if recover_result is not None:
                for det in recover_result.boxes:
                    cls_id = int(det.cls)
                    cls_name = str(self.violation_model.names[cls_id]).lower()
                    if cls_name != "vehicle":
                        continue
                    vehicles.append(
                        {
                            "class": "vehicle",
                            "confidence": float(det.conf),
                            "bbox": [int(v) for v in det.xyxy[0].tolist()],
                        }
                    )

        records: list[dict[str, Any]] = []
        for violation in violations:
            matched_vehicle = self._match_vehicle(violation["bbox"], vehicles)
            plate_data = None
            match_strategy = "vehicle_spatial"

            # Fallback: if no vehicle match was possible, use an expanded
            # violation ROI to still attempt plate localization/OCR.
            if matched_vehicle is None:
                fallback_bbox = self._expand_bbox(
                    violation["bbox"],
                    frame.shape[1],
                    frame.shape[0],
                    scale=1.45,
                )
                matched_vehicle = {
                    "class": "vehicle_fallback",
                    "confidence": 0.0,
                    "bbox": fallback_bbox,
                }
                match_strategy = "violation_roi_fallback"

            if matched_vehicle is not None:
                plate_data = self._detect_plate_and_text(
                    frame, matched_vehicle["bbox"])

            record = {
                "source": source_name,
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "frame_index": frame_index,
                "violation": violation["class"],
                "violation_confidence": round(violation["confidence"], 4),
                "violation_bbox": violation["bbox"],
                "vehicle_bbox": matched_vehicle["bbox"] if matched_vehicle else None,
                "vehicle_confidence": round(matched_vehicle["confidence"], 4)
                if matched_vehicle
                else None,
                "match_strategy": match_strategy if matched_vehicle else "none",
                "plate_bbox": plate_data["plate_bbox"] if plate_data else None,
                "plate_confidence": plate_data["plate_confidence"] if plate_data else None,
                "plate_text": plate_data["plate_text_masked"] if plate_data else None,
                "plate_text_raw": plate_data["plate_text_raw"] if plate_data else None,
                "ocr_confidence": plate_data["ocr_confidence"] if plate_data else None,
            }
            records.append(record)

        annotated = self._annotate_frame(
            frame.copy(), vehicles, violations, records)
        return annotated, records

    def _match_vehicle(
        self,
        violation_bbox: BBox,
        vehicles: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        if not vehicles:
            return None

        best_vehicle = None
        best_score = -1.0

        for vehicle in vehicles:
            vb = vehicle["bbox"]
            overlap = self._iou(violation_bbox, vb)
            dist = self._center_distance(violation_bbox, vb)
            # Higher overlap is better, smaller distance is better.
            score = overlap + (1.0 / (1.0 + dist / 150.0))
            if score > best_score:
                best_score = score
                best_vehicle = vehicle

        return best_vehicle

    def _detect_plate_and_text(self, frame: np.ndarray, vehicle_bbox: BBox) -> dict[str, Any] | None:
        vx1, vy1, vx2, vy2 = self._clip_bbox(
            vehicle_bbox, frame.shape[1], frame.shape[0])
        vehicle_crop = frame[vy1:vy2, vx1:vx2]
        if vehicle_crop.size == 0:
            return None

        plate_results = self.plate_model(vehicle_crop, conf=self.plate_conf)
        plate_result = plate_results[0] if plate_results else None
        abs_plate_bbox = None
        plate_conf = None

        if plate_result is not None and len(plate_result.boxes) > 0:
            best_det = max(plate_result.boxes, key=lambda d: float(d.conf))
            px1, py1, px2, py2 = [int(v) for v in best_det.xyxy[0].tolist()]
            abs_plate_bbox = [vx1 + px1, vy1 + py1, vx1 + px2, vy1 + py2]
            plate_conf = float(best_det.conf)
        else:
            # Fallback: detect plate on full frame and pick closest candidate
            # to the selected vehicle region.
            full_frame_plate = self._detect_plate_global(
                frame, [vx1, vy1, vx2, vy2])
            if full_frame_plate is not None:
                abs_plate_bbox = full_frame_plate["bbox"]
                plate_conf = full_frame_plate["confidence"]

        if abs_plate_bbox is None:
            # Rewritten fallback: when detector misses the plate, attempt OCR on
            # likely plate regions inside the vehicle box (lower/center bands).
            fallback_ocr = self._ocr_when_plate_missing(
                frame,
                [vx1, vy1, vx2, vy2],
            )
            if fallback_ocr is None:
                return None

            return {
                "plate_bbox": fallback_ocr["plate_bbox"],
                "plate_confidence": None,
                "plate_text_raw": fallback_ocr["plate_text_raw"],
                "plate_text_masked": self._mask_plate_text(
                    fallback_ocr["plate_text_raw"]
                ),
                "ocr_confidence": round(fallback_ocr["ocr_confidence"], 4)
                if fallback_ocr["ocr_confidence"] is not None
                else None,
            }

        ax1, ay1, ax2, ay2 = self._clip_bbox(
            abs_plate_bbox, frame.shape[1], frame.shape[0])

        plate_crop = frame[ay1:ay2, ax1:ax2]
        if plate_crop.size == 0:
            return None

        plate_text_raw, ocr_conf = self._ocr_plate(plate_crop)
        return {
            "plate_bbox": [ax1, ay1, ax2, ay2],
            "plate_confidence": round(float(plate_conf), 4) if plate_conf is not None else None,
            "plate_text_raw": plate_text_raw,
            "plate_text_masked": self._mask_plate_text(plate_text_raw),
            "ocr_confidence": round(ocr_conf, 4) if ocr_conf is not None else None,
        }

    def _ocr_when_plate_missing(self, frame: np.ndarray, vehicle_bbox: BBox) -> dict[str, Any] | None:
        vx1, vy1, vx2, vy2 = self._clip_bbox(
            vehicle_bbox, frame.shape[1], frame.shape[0])
        vw = max(1, vx2 - vx1)
        vh = max(1, vy2 - vy1)

        # Candidate ROIs are plate-likely areas in a vehicle when detector fails.
        candidate_boxes: list[BBox] = [
            # Lower center strip (most common plate location)
            [
                vx1 + int(vw * 0.18),
                vy1 + int(vh * 0.55),
                vx1 + int(vw * 0.82),
                vy1 + int(vh * 0.90),
            ],
            # Slightly tighter center-lower box
            [
                vx1 + int(vw * 0.24),
                vy1 + int(vh * 0.60),
                vx1 + int(vw * 0.76),
                vy1 + int(vh * 0.88),
            ],
        ]

        best: dict[str, Any] | None = None
        best_score = -1.0
        for cand in candidate_boxes:
            cx1, cy1, cx2, cy2 = self._clip_bbox(
                cand, frame.shape[1], frame.shape[0])
            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                continue

            text_raw, ocr_conf = self._ocr_plate(crop)
            if not text_raw or ocr_conf is None:
                continue

            # Prefer confident, plate-like numeric outputs.
            length_bonus = 0.15 if 3 <= len(text_raw) <= 5 else 0.0
            digit_bonus = 0.08 if len(text_raw) >= 3 else 0.0
            score = float(ocr_conf) + length_bonus + digit_bonus

            if score > best_score:
                best_score = score
                best = {
                    "plate_bbox": [cx1, cy1, cx2, cy2],
                    "plate_text_raw": text_raw,
                    "ocr_confidence": float(ocr_conf),
                }
                if float(ocr_conf) >= 0.88 and 3 <= len(text_raw) <= 5:
                    break

        # Require a minimum OCR confidence for detector-missed fallback.
        if best is None or best["ocr_confidence"] < 0.45:
            return None
        return best

    def _detect_plate_global(self, frame: np.ndarray, vehicle_bbox: BBox) -> dict[str, Any] | None:
        plate_results = self.plate_model(frame, conf=self.plate_conf)
        plate_result = plate_results[0] if plate_results else None
        if plate_result is None or len(plate_result.boxes) == 0:
            return None

        vx1, vy1, vx2, vy2 = vehicle_bbox
        v_cx = (vx1 + vx2) / 2.0
        v_cy = (vy1 + vy2) / 2.0

        best_item = None
        best_score = -1.0
        for det in plate_result.boxes:
            bbox = [int(v) for v in det.xyxy[0].tolist()]
            p_cx = (bbox[0] + bbox[2]) / 2.0
            p_cy = (bbox[1] + bbox[3]) / 2.0
            dist = math.dist((v_cx, v_cy), (p_cx, p_cy))
            score = float(det.conf) + (1.0 / (1.0 + dist / 120.0))
            if score > best_score:
                best_score = score
                best_item = {
                    "bbox": bbox,
                    "confidence": float(det.conf),
                }

        return best_item

    def _ocr_plate(self, plate_crop: np.ndarray) -> tuple[str | None, float | None]:
        """Pakistani plate OCR engine (number-first).

        This engine intentionally outputs only numeric plate content to avoid
        false letter predictions. It combines multiple ROIs and preprocess
        variants, then selects a stable numeric candidate by confidence/support.
        """
        if easyocr is None:
            return None, None

        if self._ocr_reader is None:
            self._ocr_reader = easyocr.Reader(["en"], gpu=False)

        # Pakistani plates often include province text strips; numbers are
        # usually in middle/lower portions. Evaluate multiple sub-ROIs.
        h, w = plate_crop.shape[:2]
        rois: list[np.ndarray] = [plate_crop]
        if h >= 18 and w >= 24:
            # Keep only one lower-band ROI to reduce OCR latency.
            rois.append(plate_crop[int(h * 0.28): int(h * 0.98), :])

        candidates: list[tuple[str, float]] = []
        for roi in rois:
            for variant in self._ocr_variants_for_digits(roi):
                try:
                    ocr_result = self._ocr_reader.readtext(
                        variant,
                        detail=1,
                        paragraph=False,
                        allowlist="0123456789٠١٢٣٤٥٦٧٨٩",
                    )
                except Exception:
                    continue

                for row in ocr_result:
                    conf = float(row[2])
                    digits = self._normalize_to_ascii_digits(str(row[1]))
                    if not digits:
                        continue
                    # Pakistani plate number blocks are usually short.
                    if len(digits) < 2 or len(digits) > 6:
                        continue
                    candidates.append((digits, conf))
                    # Early accept high-confidence stable numeric read.
                    if conf >= 0.88 and 3 <= len(digits) <= 5:
                        return digits, conf

        if not candidates:
            return None, None

        # Aggregate by digit string to reward repeatability across variants.
        agg: dict[str, dict[str, float]] = {}
        for digits, conf in candidates:
            if digits not in agg:
                agg[digits] = {"count": 0.0, "best_conf": 0.0, "sum_conf": 0.0}
            agg[digits]["count"] += 1.0
            agg[digits]["sum_conf"] += conf
            agg[digits]["best_conf"] = max(agg[digits]["best_conf"], conf)

        best_digits = None
        best_score = -1.0
        best_conf = 0.0
        for digits, s in agg.items():
            count = s["count"]
            avg_conf = s["sum_conf"] / max(1.0, count)
            peak_conf = s["best_conf"]
            length_bonus = 0.10 if 3 <= len(digits) <= 5 else 0.0
            # score emphasizes agreement across ROIs/variants + confidence.
            score = (avg_conf * 0.55) + (peak_conf * 0.30) + \
                (min(count, 5.0) * 0.03) + length_bonus
            if score > best_score:
                best_score = score
                best_digits = digits
                best_conf = peak_conf

        if not best_digits:
            return None, None

        # Strict reliability gate: suppress weak reads.
        if best_conf < 0.50:
            return None, best_conf

        return best_digits, best_conf

    @staticmethod
    def _normalize_to_ascii_digits(text: str) -> str:
        # Convert Arabic/Urdu digits to ASCII digits and remove everything else.
        digit_map = {
            "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
            "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
        }
        mapped = "".join(digit_map.get(ch, ch) for ch in text)
        return re.sub(r"[^0-9]", "", mapped)

    @staticmethod
    def _ocr_variants_for_digits(img: np.ndarray) -> list[np.ndarray]:
        h, w = img.shape[:2]
        scale = 2.3 if min(h, w) < 60 else 1.7
        up = cv2.resize(img, None, fx=scale, fy=scale,
                        interpolation=cv2.INTER_CUBIC)
        gray = cv2.cvtColor(up, cv2.COLOR_BGR2GRAY)
        denoise = cv2.bilateralFilter(gray, 7, 40, 40)
        clahe = cv2.createCLAHE(
            clipLimit=2.5, tileGridSize=(8, 8)).apply(denoise)
        th_otsu = cv2.threshold(
            clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        # Three strong variants for speed/quality balance.
        return [gray, clahe, th_otsu]

    @staticmethod
    def _mask_plate_text(raw_text: str | None) -> str | None:
        if not raw_text:
            return None

        compact = raw_text.replace(" ", "")
        if len(compact) <= 4:
            return "*" * len(compact)

        masked = f"{compact[:2]}{'*' * (len(compact) - 4)}{compact[-2:]}"
        return masked

    def _annotate_frame(
        self,
        frame: np.ndarray,
        vehicles: list[dict[str, Any]],
        violations: list[dict[str, Any]],
        records: list[dict[str, Any]],
    ) -> np.ndarray:
        for vehicle in vehicles:
            x1, y1, x2, y2 = vehicle["bbox"]
            cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 180, 0), 2)
            label = f"vehicle {vehicle['confidence']:.2f}"
            cv2.putText(frame, label, (x1, max(20, y1 - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 180, 0), 2)

        for violation in violations:
            x1, y1, x2, y2 = violation["bbox"]
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 2)
            label = f"{violation['class']} {violation['confidence']:.2f}"
            cv2.putText(frame, label, (x1, max(20, y1 - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 255), 2)

        for record in records:
            vehicle_bbox = record.get("vehicle_bbox")
            if vehicle_bbox:
                x1, y1, x2, y2 = vehicle_bbox
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 220, 0), 3)

                plate_text = record.get("plate_text") or "plate unreadable"
                text = f"{record['violation']} | plate: {plate_text}"
                cv2.putText(frame, text, (x1, min(
                    frame.shape[0] - 10, y2 + 20)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 220, 0), 2)

            plate_bbox = record.get("plate_bbox")
            if plate_bbox:
                px1, py1, px2, py2 = plate_bbox
                cv2.rectangle(frame, (px1, py1), (px2, py2), (180, 0, 255), 2)

        return frame

    @staticmethod
    def _iou(a: BBox, b: BBox) -> float:
        ax1, ay1, ax2, ay2 = a
        bx1, by1, bx2, by2 = b

        inter_x1 = max(ax1, bx1)
        inter_y1 = max(ay1, by1)
        inter_x2 = min(ax2, bx2)
        inter_y2 = min(ay2, by2)

        inter_w = max(0, inter_x2 - inter_x1)
        inter_h = max(0, inter_y2 - inter_y1)
        inter_area = inter_w * inter_h

        area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
        area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
        denom = area_a + area_b - inter_area
        if denom == 0:
            return 0.0
        return inter_area / denom

    @staticmethod
    def _center_distance(a: BBox, b: BBox) -> float:
        acx = (a[0] + a[2]) / 2
        acy = (a[1] + a[3]) / 2
        bcx = (b[0] + b[2]) / 2
        bcy = (b[1] + b[3]) / 2
        return math.dist((acx, acy), (bcx, bcy))

    @staticmethod
    def _clip_bbox(bbox: BBox, width: int, height: int) -> tuple[int, int, int, int]:
        x1, y1, x2, y2 = bbox
        x1 = max(0, min(width - 1, x1))
        y1 = max(0, min(height - 1, y1))
        x2 = max(1, min(width, x2))
        y2 = max(1, min(height, y2))
        if x2 <= x1:
            x2 = min(width, x1 + 1)
        if y2 <= y1:
            y2 = min(height, y1 + 1)
        return x1, y1, x2, y2

    @staticmethod
    def _expand_bbox(
        bbox: BBox,
        width: int,
        height: int,
        scale: float = 1.4,
    ) -> BBox:
        x1, y1, x2, y2 = bbox
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        bw = max(1.0, (x2 - x1) * scale)
        bh = max(1.0, (y2 - y1) * scale)

        nx1 = int(max(0, cx - bw / 2.0))
        ny1 = int(max(0, cy - bh / 2.0))
        nx2 = int(min(width, cx + bw / 2.0))
        ny2 = int(min(height, cy + bh / 2.0))

        if nx2 <= nx1:
            nx2 = min(width, nx1 + 1)
        if ny2 <= ny1:
            ny2 = min(height, ny1 + 1)
        return [nx1, ny1, nx2, ny2]
