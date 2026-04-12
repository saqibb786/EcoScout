import React, { useMemo, useState } from 'react';
import { Trash2, View, ChevronRight, FileDown, CheckSquare, Square, FileText } from 'lucide-react';
import './History.css';
import { exportCaseReportPdf } from '../utils/reportPdf';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

function asSourceUrl(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('blob:')) {
    return pathOrUrl;
  }
  return `${API_BASE}${pathOrUrl}`;
}

const History = ({ history, onView, onDelete }) => {
  const [selectedIds, setSelectedIds] = useState([]);

  const selectedItems = useMemo(
    () => history.filter((item) => selectedIds.includes(item.id)),
    [history, selectedIds],
  );

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;
    if (window.confirm(`Delete ${selectedIds.length} selected item(s)? This cannot be undone.`)) {
      onDelete(selectedIds);
      setSelectedIds([]);
    }
  };

  const handleDeleteAll = () => {
    if (window.confirm('Delete all history? This cannot be undone.')) {
      onDelete(history.map(item => item.id));
      setSelectedIds([]);
    }
  };

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
          <div className="history-actions-right">
            <button className="btn-report" onClick={handleBulkReport} disabled={selectedItems.length === 0}>
              <FileText size={16} />
              Import as Report
            </button>
            <button className="btn-delete-selected" onClick={handleBulkDelete} disabled={selectedIds.length === 0}>
              <Trash2 size={16} />
              Delete Selected
            </button>
            <button className="btn-delete-all" onClick={handleDeleteAll}>
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
                {asSourceUrl(item.annotated_image_url || item.annotated_image) ? (
                  <img
                    src={asSourceUrl(item.annotated_image_url || item.annotated_image)}
                    alt={item.source_name || 'History thumbnail'}
                  />
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
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
                <h4>{item.source_name || 'Untitled'}</h4>
                <div className="card-stats">
                  <span>{item.violations_found} violations</span>
                  {item.records && <span>{item.records.length} records</span>}
                </div>
              </div>
              <div className="card-actions">
                <button
                  className="btn-export"
                  onClick={() => exportCaseReportPdf(item)}
                  title="Export PDF report"
                >
                  <FileDown size={18} />
                </button>
                <button 
                  className="btn-view"
                  onClick={() => onView(item)}
                  title="View results"
                >
                  <ChevronRight size={20} />
                </button>
                <button 
                  className="btn-delete"
                  onClick={() => onDelete([item.id])}
                  title="Delete"
                >
                  <Trash2 size={20} />
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
