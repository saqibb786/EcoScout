import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Upload, X, FileVideo, Image as ImageIcon, CheckCircle, AlertCircle, Wand2, Gauge, ShieldCheck } from 'lucide-react';
import './UploadMedia.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

const UploadMedia = ({ onUploadSuccess }) => {
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);
    const [frameStride, setFrameStride] = useState(5);
    const fileInputRef = useRef(null);

    const isVideo = useMemo(() => file?.type?.startsWith('video/'), [file]);

    useEffect(() => {
        return () => {
            if (preview && preview.startsWith('blob:')) {
                URL.revokeObjectURL(preview);
            }
        };
    }, [preview]);

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            if (preview && preview.startsWith('blob:')) {
                URL.revokeObjectURL(preview);
            }
            setFile(selectedFile);
            setError(null);
            setPreview(URL.createObjectURL(selectedFile));

            if (selectedFile.type.startsWith('video/')) {
                setFrameStride(5);
            }
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        const selectedFile = e.dataTransfer.files[0];
        if (selectedFile) {
            if (preview && preview.startsWith('blob:')) {
                URL.revokeObjectURL(preview);
            }
            setFile(selectedFile);
            setError(null);
            setPreview(URL.createObjectURL(selectedFile));
        }
    };

    const handleUpload = async () => {
        if (!file) {
            setError("Please select a file first.");
            return;
        }

        setUploading(true);
        setError(null);

        const formData = new FormData();
        formData.append("file", file);

        const endpoint = isVideo ? '/analyze/video' : '/analyze/image';
        if (isVideo) {
            formData.append('frame_stride', String(frameStride));
        }

        try {
            const response = await axios.post(`${API_BASE}${endpoint}`, formData, {
                timeout: 180000,
            });

            if (response.data) {
                onUploadSuccess(response.data);
                setFile(null);
                setPreview(null);
                setFrameStride(5);
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        } catch (err) {
            console.error("Upload failed:", err);

            if (err.code === 'ECONNABORTED') {
                setError('Analysis timed out. Please try a smaller file or increase frame stride for video.');
                return;
            }

            if (!err.response) {
                setError(`Cannot reach backend at ${API_BASE}. Start the FastAPI server and try again.`);
                return;
            }

            const detail = err.response?.data?.detail;
            setError(Array.isArray(detail) ? detail.map((item) => item.msg).join(' ') : detail || `Upload failed (${err.response.status}). Please try again.`);
        } finally {
            setUploading(false);
        }
    };

    const clearFile = () => {
        setFile(null);
        setPreview(null);
        setError(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    return (
        <section className="upload-shell glass-panel">
            <div className="upload-copy">
                <p className="eyebrow">Evidence Intake</p>
                <h2>Upload an image or video for forensic analysis</h2>
                <p>
                    The backend runs violation detection first, then vehicle matching, then number plate OCR.
                    This keeps the result accurate and easy to present in a professional demo.
                </p>
                <div className="upload-highlights">
                    <span><Wand2 size={16} /> Smart detection pipeline</span>
                    <span><Gauge size={16} /> Confidence-driven reporting</span>
                    <span><ShieldCheck size={16} /> Privacy-safe masked plates</span>
                </div>
            </div>

            <div
                className={`drop-zone ${file ? 'has-file' : ''}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                {!file ? (
                    <div className="upload-prompt">
                        <Upload size={52} className="upload-icon" />
                        <h3>Drag and drop, or click to browse</h3>
                        <p>JPG, PNG, MP4, MOV</p>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept="image/*,video/*"
                            className="file-input"
                            style={{ display: 'none' }}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </div>
                ) : (
                    <div className="file-preview" onClick={(e) => e.stopPropagation()}>
                        <div className="preview-content">
                            {isVideo ? (
                                <video src={preview || ''} controls className="media-preview" />
                            ) : (
                                <img src={preview || ''} alt="Preview" className="image-preview" />
                            )}
                        </div>
                        <div className="file-info">
                            <div>
                                <span className="file-name">{file.name}</span>
                                <small>{isVideo ? 'Video input' : 'Image input'} · {(file.size / (1024 * 1024)).toFixed(2)} MB</small>
                            </div>
                            <button onClick={clearFile} className="remove-btn" type="button">
                                <X size={20} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="upload-side-panel">
                <div className="side-card">
                    <h4>Analysis Controls</h4>
                    <label>
                        <span>Frame stride</span>
                        <input
                            type="number"
                            min={1}
                            value={frameStride}
                            onChange={(e) => setFrameStride(Number(e.target.value) || 1)}
                            disabled={!isVideo}
                        />
                    </label>
                    <p className="side-note">
                        For videos, the engine analyzes every <strong>{frameStride}</strong> frame to balance speed and accuracy.
                    </p>
                </div>

                <div className="side-card calm">
                    <h4>Output Format</h4>
                    <ul>
                        <li>Annotated evidence image/video</li>
                        <li>Violation confidence and match strategy</li>
                        <li>Vehicle and plate bounding boxes</li>
                        <li>Masked plate output and OCR confidence</li>
                    </ul>
                </div>
            </div>

            {error && (
                <div className="error-message">
                    <AlertCircle size={20} />
                    <span>{error}</span>
                </div>
            )}

            {uploading && (
                <div className="analysis-progress" role="status" aria-live="polite">
                    <div className="analysis-loader" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                    </div>
                    <div className="analysis-copy">
                        <strong>Analyzing evidence</strong>
                        <p>Running detection, matching vehicles, and reading plates...</p>
                    </div>
                </div>
            )}

            <div className="upload-actions">
                <button
                    className="upload-btn"
                    onClick={handleUpload}
                    disabled={!file || uploading}
                >
                    {uploading ? "Analyzing Evidence..." : "Run Investigation"}
                </button>
            </div>
        </section>
    );
};

export default UploadMedia;
