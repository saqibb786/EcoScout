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

function formatVideoTime(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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

function DetectionCard({ detection, index, sourceImageUrl, isPlaceholder, placeholderTitle, sourceType }) {
    if (isPlaceholder) {
        return (
            <article className="analysis-record-card placeholder" style={{ opacity: 0.85 }}>
                <div className="analysis-record-header">
                    <div>
                        <span className="record-kicker">Record #{index + 1}</span>
                        <h5>{placeholderTitle}</h5>
                    </div>
                    <span className="record-confidence" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' }}>Not detected</span>
                </div>

                <div className="analysis-record-layout">
                    <div className="analysis-record-image">
                        <div className="violation-image-placeholder">No crop available</div>
                    </div>

                    <div className="analysis-record-body">
                        <div className="plate-identity-block">
                            <span className="info-label">Number Plate</span>
                            <div className="plate-display">
                                <span className="plate-text-display">Not detected</span>
                            </div>
                        </div>

                        <dl className="analysis-detail-list">
                            <div className="detail-row"><dt>Vehicle Confidence</dt><dd>-</dd></div>
                            <div className="detail-row"><dt>Plate Confidence</dt><dd>-</dd></div>
                            <div className="detail-row"><dt>OCR Confidence</dt><dd>-</dd></div>
                        </dl>

                        <div className="analysis-meta-row">
                            {sourceType === 'video' ? 'No evidence for this violation type.' : 'Image Evidence'}
                        </div>
                    </div>
                </div>
            </article>
        );
    }

    const maskedPlate = detection.plate_text || 'Not detected';
    const rawPlate = detection.plate_text_raw || '';
    const hasOnlyMasked = Boolean(maskedPlate) && /^\*+$/.test(String(maskedPlate).replace(/\s+/g, ''));
    const visiblePlate = rawPlate || (hasOnlyMasked ? 'Not readable' : maskedPlate);
    const hasPlate = Boolean(detection.plate_bbox);
    const [violationPreview, setViolationPreview] = useState(null);
    const isZeroConf = Math.round(Number(detection.violation_confidence || 0) * 100) === 0;

    useEffect(() => {
        let active = true;

        if (!isZeroConf) {
            cropViolationPreview(sourceImageUrl, detection.violation_bbox).then((preview) => {
                if (active) setViolationPreview(preview);
            });
        }

        return () => {
            active = false;
        };
    }, [sourceImageUrl, detection.violation_bbox, isZeroConf]);

    return (
        <article className={`analysis-record-card ${(detection.violation || '').toLowerCase()}`}>
            <div className="analysis-record-header">
                <div>
                    <span className="record-kicker">Record #{index + 1}</span>
                    <h5>{detection.violation || 'Unknown Violation'}</h5>
                </div>
                <span className="record-confidence" style={isZeroConf ? { background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)' } : undefined}>
                    {isZeroConf ? 'Not detected' : `${fmtPercent(detection.violation_confidence)} confidence`}
                </span>
            </div>

            <div className="analysis-record-layout">
                <div className="analysis-record-image">
                    {isZeroConf ? (
                        <div className="violation-image-placeholder">No crop available</div>
                    ) : violationPreview ? (
                        <img src={violationPreview} alt={`Violation crop for record ${index + 1}`} className="frame-image" />
                    ) : (
                        <div className="violation-image-placeholder">Violation crop unavailable</div>
                    )}
                </div>

                <div className="analysis-record-body">
                    <div className="plate-identity-block">
                        <span className="info-label">Number Plate</span>
                        <div className="plate-display">
                            <span className="plate-text-display">
                                {isZeroConf ? 'Not detected' : visiblePlate}
                            </span>
                            {!isZeroConf && !rawPlate && hasOnlyMasked && <span className="plate-raw">OCR could not reliably read full characters.</span>}
                        </div>
                    </div>

                    <dl className="analysis-detail-list">
                        <div className="detail-row"><dt>Vehicle Confidence</dt><dd>{isZeroConf ? '-' : fmtPercent(detection.vehicle_confidence)}</dd></div>
                        <div className="detail-row"><dt>Plate Confidence</dt><dd>{isZeroConf ? '-' : fmtPercent(detection.plate_confidence)}</dd></div>
                        <div className="detail-row"><dt>OCR Confidence</dt><dd>{isZeroConf ? '-' : fmtPercent(detection.ocr_confidence)}</dd></div>
                    </dl>

                    <div className="analysis-meta-row">
                        {isZeroConf ? (
                            sourceType === 'video' ? 'No evidence for this violation type.' : 'Image Evidence'
                        ) : (
                            sourceType === 'video' && typeof detection.video_time_sec === 'number' ? (
                                `Violation Time: ${formatVideoTime(detection.video_time_sec)}`
                            ) : (
                                'Image Evidence'
                            )
                        )}
                        {!isZeroConf && sourceType === 'video' && detection.timestamp ? ` · ${new Date(detection.timestamp).toLocaleString()}` : ''}
                    </div>
                </div>
            </div>
            {!isZeroConf && !hasPlate && <div className="record-warning">Plate could not be detected in this record.</div>}
        </article>
    );
}

const Results = ({ result, onAutoSave }) => {
    useEffect(() => {
        if (result && !result.isSaved && onAutoSave) {
            onAutoSave(result);
        }
    }, [result?.id, result?.isSaved, onAutoSave]);

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

    const { annotated_image_url, records = [] } = result;
    const smokeRecord = records.find(r => r.violation === 'Smoke Detection');
    const litterRecord = records.find(r => r.violation === 'Litter Detection');
    const annotatedUrl = asSourceUrl(result.annotated_video_url || result.annotated_image_url || annotated_image_url);
    const hasAnnotatedMedia = Boolean(annotatedUrl);

    return (
        <div className="results-container">
            <div className="results-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <h3>Detection Analysis</h3>
                    {records.length === 0 ? (
                        <span style={{
                            fontSize: '0.8rem',
                            padding: '4px 10px',
                            borderRadius: '12px',
                            fontWeight: '600',
                            background: 'rgba(16, 185, 129, 0.1)',
                            color: '#10b981',
                            border: '1px solid rgba(16, 185, 129, 0.2)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}>
                            <CheckCircle size={12} />
                            Clean Scan
                        </span>
                    ) : (
                        <span style={{
                            fontSize: '0.8rem',
                            padding: '4px 10px',
                            borderRadius: '12px',
                            fontWeight: '600',
                            background: result.isSaved ? 'rgba(34, 197, 94, 0.1)' : 'rgba(234, 179, 8, 0.1)',
                            color: result.isSaved ? '#22c55e' : '#eab308',
                            border: `1px solid ${result.isSaved ? 'rgba(34, 197, 94, 0.2)' : 'rgba(234, 179, 8, 0.2)'}`,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}>
                            {result.isSaved ? (
                                <>
                                    <CheckCircle size={12} />
                                    Synced with DB
                                </>
                            ) : (
                                <>
                                    <span style={{
                                        display: 'inline-block',
                                        width: '6px',
                                        height: '6px',
                                        borderRadius: '50%',
                                        background: '#eab308',
                                        boxShadow: '0 0 8px #eab308'
                                    }} />
                                    Saving to DB...
                                </>
                            )}
                        </span>
                    )}
                </div>
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
                    <h4>Detected Violations & Objects</h4>

                    {records.length === 0 ? (
                        <div className="no-detections">
                            <CheckCircle size={24} color="#22c55e" />
                            <p>No violations or objects detected.</p>
                        </div>
                    ) : (
                        <div className="detections-list-expanded">
                            <DetectionCard
                                key="smoke"
                                detection={smokeRecord}
                                index={0}
                                isPlaceholder={!smokeRecord}
                                placeholderTitle="Smoke Detection"
                                sourceType={result.source_type}
                                sourceImageUrl={smokeRecord ? asSourceUrl(smokeRecord.frame_image_url || result.media_url || result.annotated_image_url || result.annotated_image) : null}
                            />
                            <DetectionCard
                                key="litter"
                                detection={litterRecord}
                                index={1}
                                isPlaceholder={!litterRecord}
                                placeholderTitle="Litter Detection"
                                sourceType={result.source_type}
                                sourceImageUrl={litterRecord ? asSourceUrl(litterRecord.frame_image_url || result.media_url || result.annotated_image_url || result.annotated_image) : null}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Results;
