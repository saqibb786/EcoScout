import React, { useMemo, useState } from 'react';
import { View, ChevronRight, FileDown, CheckSquare, Square, FileText, Trash2 } from 'lucide-react';
import './History.css';
import { exportCaseReportPdf } from '../utils/reportPdf';

let rawApiBase = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'https://saqibb786-ecoscout-api.hf.space';
// Clean up any copied parenthetical comments, spaces, or trailing slashes
if (rawApiBase) {
  rawApiBase = rawApiBase.split(/[ \t(]+/)[0].trim().replace(/\/+$/, '');
}
const API_BASE = rawApiBase;

function asSourceUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('blob:')) {
    return pathOrUrl;
  }
  return `${API_BASE}${pathOrUrl}`;
}

const History = ({ history, onView, onDelete, onDeleteBulk }) => {
  const [selectedIds, setSelectedIds] = useState([]);

  const selectedItems = useMemo(
    () => history.filter((item) => selectedIds.includes(item.id)),
    [history, selectedIds],
  );

  const toggleSelected = (id) => {
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]
    ));
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === history.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(history.map((item) => item.id));
    }
  };

  const handleBulkReport = async () => {
    if (selectedItems.length === 0) return;
    for (const item of selectedItems) {
      await exportCaseReportPdf(item);
    }
  };

  return (
    <div className="history-container">
      {history.length > 0 && (
        <div className="history-actions">
          <div className="history-actions-left">
            <button className="btn-ghost" onClick={toggleSelectAll}>
              {selectedIds.length === history.length && history.length > 0 ? <CheckSquare size={16} /> : <Square size={16} />}
              {selectedIds.length === history.length && history.length > 0 ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div className="history-actions-right" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {selectedIds.length > 0 && (
              <button
                className="btn-delete-selected"
                onClick={() => {
                  if (window.confirm(`Are you sure you want to delete the ${selectedIds.length} selected cases from the database?`)) {
                    onDeleteBulk(selectedIds);
                    setSelectedIds([]);
                  }
                }}
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: 'var(--accent-primary, #10b981)',
                  padding: '8px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  borderRadius: 'var(--radius-md, 12px)',
                  fontSize: '0.88rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(16, 185, 129, 0.25)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(16, 185, 129, 0.15)';
                }}
              >
                <Trash2 size={16} />
                Delete Selected ({selectedIds.length})
              </button>
            )}
            <button className="btn-report" onClick={handleBulkReport} disabled={selectedItems.length === 0}>
              <FileText size={16} />
              Import as Report
            </button>
            <button
              className="btn-clear-all"
              onClick={() => {
                if (window.confirm("WARNING: Are you sure you want to delete ALL cases in history from the database? This cannot be undone.")) {
                  onDeleteBulk(null);
                  setSelectedIds([]);
                }
              }}
              style={{
                background: 'transparent',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                color: 'rgba(16, 185, 129, 0.8)',
                padding: '8px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderRadius: 'var(--radius-md, 12px)',
                fontSize: '0.88rem',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(16, 185, 129, 0.08)';
                e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                e.currentTarget.style.color = 'var(--accent-primary, #10b981)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.2)';
                e.currentTarget.style.color = 'rgba(16, 185, 129, 0.8)';
              }}
            >
              <Trash2 size={16} />
              Clear All
            </button>
          </div>
        </div>
      )}

      {history.length === 0 ? (
        <div className="history-empty">
          <div className="empty-state">
            <View size={48} />
            <h3>No History</h3>
            <p>Analyses will appear here as you process images and videos.</p>
          </div>
        </div>
      ) : (
        <div className="history-list">
          {history.map((item) => (
            <div key={item.id} className={`history-card ${selectedIds.includes(item.id) ? 'selected' : ''}`}>
              <div className="history-select-wrap">
                <button
                  className="history-select-btn"
                  type="button"
                  onClick={() => toggleSelected(item.id)}
                  aria-label={selectedIds.includes(item.id) ? 'Deselect item' : 'Select item'}
                >
                  {selectedIds.includes(item.id) ? <CheckSquare size={18} /> : <Square size={18} />}
                </button>
              </div>

              <div className="history-thumbnail">
                {asSourceUrl(item.detection_image_url || item.annotated_image_url || item.annotated_image) ? (
                  item.source_type === 'video' ? (
                    <video
                      src={asSourceUrl(item.detection_image_url || item.annotated_image_url || item.annotated_image)}
                      controls={false}
                      muted
                      playsInline
                    />
                  ) : (
                    <img
                      src={asSourceUrl(item.detection_image_url || item.annotated_image_url || item.annotated_image)}
                      alt={item.source_name || 'History thumbnail'}
                    />
                  )
                ) : (
                  <div className="history-thumb-fallback">
                    <span>{(item.source_type || 'item').toUpperCase()}</span>
                  </div>
                )}
              </div>

              <div className="card-content">
                <div className="card-meta">
                  <span className="badge-source">
                    {item.source_type.toUpperCase()}
                  </span>
                  <span className="timestamp">
                    {new Date(item.timestamp_real || item.createdAt).toLocaleString()}
                  </span>
                </div>
                <h4>{item.violation_name || item.source_name || 'Untitled'}</h4>
                <div className="card-stats">
                  <span>{item.violations_found} detections</span>
                  {item.records && <span>{item.records.length} records</span>}
                </div>
                <div className="card-summary">
                  <span>{item.source_name || 'Unknown source'}</span>
                  {item.violation_name && item.violation_name !== 'unknown' && (
                    <span className="violation-tag">{item.violation_name}</span>
                  )}
                </div>
              </div>
              <div className="card-actions">
                <button
                  className="btn-export"
                  onClick={() => {
                    if (item.report_url) {
                      window.open(item.report_url, '_blank');
                    } else {
                      exportCaseReportPdf(item);
                    }
                  }}
                  title={item.report_url ? 'Download saved report' : 'Generate & download report'}
                >
                  <FileDown size={18} />
                </button>
                <button
                  className="btn-delete-item"
                  onClick={() => {
                    if (window.confirm("Are you sure you want to delete this selective instance from the history and database?")) {
                      onDelete(item.id);
                    }
                  }}
                  title="Delete case from database"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent-primary, #10b981)',
                    padding: '6px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <Trash2 size={18} />
                </button>
                <button 
                  className="btn-view"
                  onClick={() => onView(item)}
                  title="View results"
                >
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default History;
