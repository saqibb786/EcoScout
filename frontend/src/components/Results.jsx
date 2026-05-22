import React, { useEffect, useState } from 'react';
import { CheckCircle, FileText, TrendingUp } from 'lucide-react';
import './Results.css';
import { exportCaseReportPdf } from '../utils/reportPdf';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

function asSourceUrl(pathOrUrl) {
    if (!pathOrUrl) return null;
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('blob:')) {
        return pathOrUrl;
    }
    return `${API_BASE}${pathOrUrl}`;
}

function fmtPercent(value) {
    if (value === null || value === undefined) return '-';
    return `${Math.round(Number(value) * 100)}%`;
}

async function cropViolationPreview(imageUrl, bbox) {
    if (!imageUrl || !Array.isArray(bbox) || bbox.length < 4) return null;

    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const [x1, y1, x2, y2] = bbox.map((n) => Number(n));
            const width = Math.max(1, x2 - x1);
            const height = Math.max(1, y2 - y1);

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(null);
                return;
            }

            ctx.drawImage(img, x1, y1, width, height, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.92));
        };
        img.onerror = () => resolve(null);
        img.src = imageUrl;
    });
}

/* ── Violation type label mapping (clean, user-facing) ─────────────── */
function mapViolationLabel(type) {
    if (!type) return 'Unknown Violation';
    const t = type.toLowerCase();
    if (t === 'smoke_emission' || t.includes('smoke')) return 'Smoke Detection';
    if (t === 'littering' || t.includes('litter')) return 'Vehicle Littering Detection';
    // Capitalize first letter for any other type
    return type.charAt(0).toUpperCase() + type.slice(1);
}

/* ── Card CSS class based on violation type ─────────────────────────── */
function violationCardClass(type) {
    if (!type) return '';
    const t = type.toLowerCase();
    if (t.includes('smoke')) return 'smoke';
    if (t.includes('litter')) return 'littering';
    return '';
}

/* ────────────────────────────────────────────────────────────────────
   DetectionCard — renders a YOLO pipeline detection record
   Used as fallback when vision analysis is unavailable
   ──────────────────────────────────────────────────────────────────── */
function DetectionCard({ detection, index, sourceImageUrl }) {
    const maskedPlate = detection.plate_text || 'Not detected';
    const rawPlate = detection.plate_text_raw || '';
    const hasOnlyMasked = Boolean(maskedPlate) && /^\*+$/.test(String(maskedPlate).replace(/\s+/g, ''));
    const visiblePlate = rawPlate || (hasOnlyMasked ? 'Not readable' : maskedPlate);
    const [violationPreview, setViolationPreview] = useState(null);

    useEffect(() => {
        let active = true;
        cropViolationPreview(sourceImageUrl, detection.violation_bbox).then((preview) => {
            if (active) setViolationPreview(preview);
        });
        return () => { active = false; };
    }, [sourceImageUrl, detection.violation_bbox]);

    const label = mapViolationLabel(detection.violation);
    const cardClass = violationCardClass(detection.violation);

    return (
        <article className={`analysis-record-card ${cardClass}`}>
            <div className="analysis-record-header">
                <div>
                    <span className="record-kicker">Record #{index + 1}</span>
                    <h5>{label}</h5>
                </div>
                <span className="record-confidence">{fmtPercent(detection.violation_confidence)} confidence</span>
            </div>

            <div className="analysis-record-layout">
                <div className="analysis-record-image">
                    {violationPreview ? (
                        <img src={violationPreview} alt={`Detection evidence ${index + 1}`} className="frame-image" />
                    ) : (
                        <div className="violation-image-placeholder">Evidence crop unavailable</div>
                    )}
                </div>

                <div className="analysis-record-body">
                    <div className="plate-identity-block">
                        <span className="info-label">Number Plate</span>
                        <div className="plate-display">
                            <span className="plate-text-display">{visiblePlate}</span>
                            {!rawPlate && hasOnlyMasked && <span className="plate-raw">OCR could not reliably read full characters.</span>}
                        </div>
                    </div>

                    <dl className="analysis-detail-list">
                        <div className="detail-row"><dt>Vehicle Confidence</dt><dd>{fmtPercent(detection.vehicle_confidence)}</dd></div>
                        <div className="detail-row"><dt>Plate Confidence</dt><dd>{fmtPercent(detection.plate_confidence)}</dd></div>
                        <div className="detail-row"><dt>OCR Confidence</dt><dd>{fmtPercent(detection.ocr_confidence)}</dd></div>
                    </dl>

                    <div className="analysis-meta-row">
                        {typeof detection.video_time_sec === 'number' ? `Video Time: ${detection.video_time_sec.toFixed(2)}s` : 'Image Evidence'}
                        {detection.timestamp ? ` · ${new Date(detection.timestamp).toLocaleString()}` : ''}
                    </div>
                </div>
            </div>
        </article>
    );
}

/* ────────────────────────────────────────────────────────────────────
   ViolationCard — renders a single vision analysis violation record
   Primary display when vision analysis succeeds
   ──────────────────────────────────────────────────────────────────── */
function ViolationCard({ violation, index }) {
    const label = mapViolationLabel(violation.violation_type);
    const plateText = violation.number_plate || 'Not detected';
    const cardClass = violationCardClass(violation.violation_type);

    return (
        <article className={`analysis-record-card ${cardClass}`}>
            <div className="analysis-record-header">
                <div>
                    <span className="record-kicker">Record #{index + 1}</span>
                    <h5>{label}</h5>
                </div>
                <span className="record-confidence">{Math.round((violation.confidence || 0) * 100)}% confidence</span>
            </div>

            <div className="analysis-record-layout">
                <div className="analysis-record-body">
                    <div className="plate-identity-block">
                        <span className="info-label">Number Plate</span>
                        <div className="plate-display">
                            <span className="plate-text-display">{plateText}</span>
                        </div>
                    </div>

                    <dl className="analysis-detail-list">
                        <div className="detail-row"><dt>Vehicle Confidence</dt><dd>{fmtPercent(violation.confidence)}</dd></div>
                        <div className="detail-row"><dt>Plate Confidence</dt><dd>{violation.number_plate ? fmtPercent(violation.confidence) : '-'}</dd></div>
                        <div className="detail-row"><dt>OCR Confidence</dt><dd>{violation.number_plate ? fmtPercent(violation.confidence) : '-'}</dd></div>
                    </dl>
                </div>
            </div>
        </article>
    );
}

/* ────────────────────────────────────────────────────────────────────
   resolveDisplayData — decides which data source to show
   Priority: vision analysis → pipeline detections → nothing
   ──────────────────────────────────────────────────────────────────── */
function resolveDisplayData(result) {
    // 1. Try vision analysis (primary)
    const visionData = result.groq_analysis
        || result.detection_summary?.groq_analysis
        || null;

    if (
        visionData
        && Array.isArray(visionData.violations)
        && visionData.violations.length > 0
    ) {
        // Filter low-confidence results (below 30%) as unreliable
        const reliable = visionData.violations.filter(
            (v) => (v.confidence || 0) >= 0.3,
        );
        if (reliable.length > 0) {
            return { source: 'vision', violations: reliable, records: [] };
        }
    }

    // 2. Fallback to pipeline detection records
    const records = result.records || [];
    if (records.length > 0) {
        return { source: 'pipeline', violations: [], records };
    }

    // 3. No results from either source
    return { source: 'none', violations: [], records: [] };
}

/* ────────────────────────────────────────────────────────────────────
   Results — main component
   ──────────────────────────────────────────────────────────────────── */
const Results = ({ result }) => {
    if (!result) {
        return (
            <div className="results-empty">
                <div className="results-empty-state">
                    <FileText size={48} />
                    <h3>No Results Yet</h3>
                    <p>Upload an image or video to see detection results here.</p>
                </div>
            </div>
        );
    }

    const { annotated_image_url } = result;
    const annotatedUrl = asSourceUrl(result.annotated_video_url || result.annotated_image_url || annotated_image_url);
    const hasAnnotatedMedia = Boolean(annotatedUrl);

    const displayData = resolveDisplayData(result);
    const hasResults = displayData.violations.length > 0 || displayData.records.length > 0;

    return (
        <div className="results-container">
            <div className="results-header">
                <h3>Detection Analysis</h3>
                <div className="results-actions">
                    <button className="download-btn" onClick={() => exportCaseReportPdf(result)}>
                        <FileText size={16} />
                        Download Detailed Report
                    </button>
                    <span className="results-timestamp">{new Date(result.createdAt).toLocaleString()}</span>
                </div>
            </div>

            <div className="results-grid">
                <div className="image-section">
                    <h4>Annotated Output</h4>
                    <div className="annotated-image-wrapper">
                        {!hasAnnotatedMedia ? (
                            <div className="violation-image-placeholder">Annotated media unavailable for this run.</div>
                        ) : result.source_type === 'video' ? (
                            <video controls src={annotatedUrl} className="result-video" width="100%" />
                        ) : (
                            <img src={annotatedUrl} alt="Annotated Detection" />
                        )}
                    </div>
                    <p className="file-ref">Source: {result.source_name || 'unknown'}</p>
                    {result.total_frames && (
                        <p className="file-ref">Total Frames: {result.total_frames} | Stride: {result.frame_stride || 'N/A'}</p>
                    )}
                </div>

                <div className="data-section">
                    <h4>Detected Violations</h4>

                    {/* Primary: vision analysis violations */}
                    {displayData.violations.length > 0 && (
                        <div className="detections-list-expanded">
                            {displayData.violations.map((v, i) => (
                                <ViolationCard key={i} violation={v} index={i} />
                            ))}
                        </div>
                    )}

                    {/* Fallback: pipeline detection records with annotated crops */}
                    {displayData.records.length > 0 && (
                        <div className="detections-list-expanded">
                            {displayData.records.map((det, i) => (
                                <DetectionCard
                                    key={i}
                                    detection={det}
                                    index={i}
                                    sourceImageUrl={asSourceUrl(det.frame_image_url || result.annotated_image_url || result.annotated_image)}
                                />
                            ))}
                        </div>
                    )}

                    {/* No violations from any source */}
                    {!hasResults && (
                        <div className="no-detections">
                            <CheckCircle size={24} color="#22c55e" />
                            <p>No violations or objects detected.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Results;
