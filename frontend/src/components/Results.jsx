import React, { useEffect, useState } from 'react';
import { CheckCircle, Car, FileText, TrendingUp } from 'lucide-react';
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

function AnalysisSummary({ records }) {
    const stats = {
        totalViolations: records.length,
        highConfidence: records.filter(r => (r.violation_confidence || 0) >= 0.8).length,
        vehiclesMatched: records.filter(r => Boolean(r.vehicle_bbox)).length,
        platesDetected: records.filter(r => Boolean(r.plate_bbox)).length,
        ocrSuccess: records.filter(r => Boolean(r.plate_text)).length,
    };

    return (
        <div className="analysis-summary">
            <h4>
                <TrendingUp size={18} />
                Case Overview
            </h4>
            <div className="summary-inline-metrics">
                <div className="summary-metric-pill"><span>Violations</span><strong>{stats.totalViolations}</strong></div>
                <div className="summary-metric-pill"><span>High Confidence</span><strong>{stats.highConfidence}</strong></div>
                <div className="summary-metric-pill"><span>Vehicles Linked</span><strong>{stats.vehiclesMatched}</strong></div>
                <div className="summary-metric-pill"><span>Plates Found</span><strong>{stats.platesDetected}</strong></div>
                <div className="summary-metric-pill"><span>OCR Reads</span><strong>{stats.ocrSuccess}</strong></div>
            </div>
        </div>
    );
}

function DetectionCard({ detection, index, sourceImageUrl }) {
    const maskedPlate = detection.plate_text || 'Not detected';
    const rawPlate = detection.plate_text_raw || '';
    const hasOnlyMasked = Boolean(maskedPlate) && /^\*+$/.test(String(maskedPlate).replace(/\s+/g, ''));
    const visiblePlate = rawPlate || (hasOnlyMasked ? 'Not readable' : maskedPlate);
    const hasPlate = Boolean(detection.plate_bbox);
    const [violationPreview, setViolationPreview] = useState(null);

    useEffect(() => {
        let active = true;

        cropViolationPreview(sourceImageUrl, detection.violation_bbox).then((preview) => {
            if (active) setViolationPreview(preview);
        });

        return () => {
            active = false;
        };
    }, [sourceImageUrl, detection.violation_bbox]);

    return (
        <article className={`analysis-record-card ${(detection.violation || '').toLowerCase()}`}>
            <div className="analysis-record-header">
                <div>
                    <span className="record-kicker">Record #{index + 1}</span>
                    <h5>{detection.violation || 'Unknown Violation'}</h5>
                </div>
                <span className="record-confidence">{fmtPercent(detection.violation_confidence)} confidence</span>
            </div>

            <div className="analysis-record-layout">
                <div className="analysis-record-image">
                    {violationPreview ? (
                        <img src={violationPreview} alt={`Violation crop for record ${index + 1}`} className="frame-image" />
                    ) : (
                        <div className="violation-image-placeholder">Violation crop unavailable</div>
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
                        <div className="detail-row"><dt>Match Strategy</dt><dd>{detection.match_strategy || '-'}</dd></div>
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

function ViolationResults({ analysisData }) {
    if (!analysisData || !Array.isArray(analysisData.violations) || analysisData.violations.length === 0) {
        return null;
    }

    const mapViolationType = (type) => {
        if (!type) return 'Unknown Violation';
        if (type === 'smoke_emission' || type.toLowerCase().includes('smoke')) return 'Smoke Detection';
        if (type === 'littering' || type.toLowerCase().includes('litter')) return 'Vehicle Littering Detection';
        return type;
    };

    return (
        <div className="detections-list-expanded">
            {analysisData.violations.map((v, i) => {
                const violationLabel = mapViolationType(v.violation_type);
                const plateText = v.number_plate || 'Not detected';
                const cardClass = (v.violation_type || '').toLowerCase().includes('smoke') ? 'smoke'
                    : (v.violation_type || '').toLowerCase().includes('litter') ? 'littering'
                    : '';

                return (
                    <article key={i} className={`analysis-record-card ${cardClass}`}>
                        <div className="analysis-record-header">
                            <div>
                                <span className="record-kicker">Record #{i + 1}</span>
                                <h5>{violationLabel}</h5>
                            </div>
                            <span className="record-confidence">{Math.round((v.confidence || 0) * 100)}% confidence</span>
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
                                    <div className="detail-row"><dt>Vehicle Confidence</dt><dd>{fmtPercent(v.confidence)}</dd></div>
                                    <div className="detail-row"><dt>Plate Confidence</dt><dd>{v.number_plate ? fmtPercent(v.confidence) : '-'}</dd></div>
                                    <div className="detail-row"><dt>OCR Confidence</dt><dd>{v.number_plate ? fmtPercent(v.confidence) : '-'}</dd></div>
                                </dl>
                            </div>
                        </div>
                    </article>
                );
            })}
        </div>
    );
}

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
    const analysisData = result.groq_analysis || result.detection_summary?.groq_analysis || null;
    const hasViolations = analysisData && Array.isArray(analysisData.violations) && analysisData.violations.length > 0;

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

                    <ViolationResults analysisData={analysisData} />

                    {!hasViolations && (
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

