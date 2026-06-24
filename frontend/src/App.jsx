import { useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import UploadMedia from './components/UploadMedia';
import Results from './components/Results';
import History from './components/History';
import AboutUs from './components/AboutUs';
import { getSessionToken, setSessionToken } from './utils/auth';
import { formatPKT } from './utils/date';
import './App.css';

let rawApiBase = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'https://saqibb786-ecoscout-api.hf.space';
// Clean up any copied parenthetical comments, spaces, or trailing slashes
if (rawApiBase) {
  rawApiBase = rawApiBase.split(/[ \t(]+/)[0].trim().replace(/\/+$/, '');
}
const API_BASE = rawApiBase;
const HISTORY_KEY = 'ecoscout_cases_v2';

function normalizeCase(result) {
  let records = (result?.detections || result?.records || []).map((record) => {
    let violationName = record.violation || record.class_name || 'unknown';
    if (violationName.toLowerCase().includes('smoke')) {
      violationName = 'Smoke Detection';
    } else if (violationName.toLowerCase().includes('litter') || violationName.toLowerCase().includes('trash')) {
      violationName = 'Litter Detection';
    }

    return {
      ...record,
      violation_bbox: record.violation_bbox || record.bbox || null,
      violation_confidence: record.violation_confidence ?? record.confidence ?? null,
      violation: violationName,
      plate_text_raw: record.plate_text_raw || record.ocr_text || null,
      plate_text: record.plate_text || record.ocr_text || null,
      ocr_confidence: record.ocr_confidence ?? null,
      plate_confidence: record.plate_confidence ?? null,
      vehicle_confidence: record.vehicle_confidence ?? null,
    };
  });

  // Deduplicate: Keep only one Smoke Detection and one Litter Detection (highest confidence)
  let bestSmoke = null;
  let bestLitter = null;
  const others = [];

  for (const rec of records) {
    if (rec.violation === 'Smoke Detection') {
      if (!bestSmoke || (rec.violation_confidence || 0) > (bestSmoke.violation_confidence || 0)) {
        bestSmoke = rec;
      }
    } else if (rec.violation === 'Litter Detection') {
      if (!bestLitter || (rec.violation_confidence || 0) > (bestLitter.violation_confidence || 0)) {
        bestLitter = rec;
      }
    } else {
      others.push(rec);
    }
  }

  records = [];
  if (bestSmoke) records.push(bestSmoke);
  if (bestLitter) records.push(bestLitter);
  records.push(...others);

  const createdAt = result?.timestamp_real || result?.createdAt || result?.created_at || records[0]?.timestamp || new Date().toISOString();

  return {
    id: result?.id || result?.analysis_id || `case-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt,
    source_type: result?.media_type || result?.source_type || 'image',
    source_name: result?.source_name || result?.detection_summary?.source_name || 'unknown',
    violations_found: records.length,
    total_frames: result?.total_frames,
    frame_stride: result?.frame_stride,
    records,
    media_url: result?.media_url || null,
    detection_image_url: result?.detection_image_url || result?.annotated_image_url || result?.annotated_video_url || null,
    annotated_image_url: result?.detection_image_url || result?.annotated_image_url || result?.annotated_image || null,
    annotated_video_url: result?.detection_image_url || result?.annotated_video_url || result?.annotated_video || null,
    violation_name: records.length > 0 ? records[0].violation : 'unknown',
    timestamp_real: result?.timestamp_real || null,
    detection_summary: result?.detection_summary ? { ...result.detection_summary, violations_found: records.length } : null,
    report_url: result?.report_url || null,
    isSaved: result?.isSaved ?? false,
    raw: result,
  };
}

function Dashboard({ history, latestResults, setActiveTab }) {
  const dashboardInsights = useMemo(() => {
    const totalCases = history.length;
    const totalViolations = history.reduce((sum, item) => sum + (item.violations_found || 0), 0);
    const latestCase = history[0] || latestResults;
    const plateReady = history.reduce(
      (sum, item) => sum + (item.records ? item.records.filter((record) => Boolean(record.plate_bbox)).length : 0),
      0,
    );

    return { totalCases, totalViolations, latestCase, plateReady };
  }, [history, latestResults]);

  return (
    <div className="dashboard-view">
      <section className="mission-panel">
        <p className="mission-kicker">Eco Enforcement Intelligence</p>
        <h2>Track, verify, and document road violations in one forensic workflow.</h2>
        <p className="mission-copy">
          Run detection on media, review confidence-linked evidence, and maintain a searchable case timeline.
        </p>
        <div className="mission-actions">
          <button className="mission-btn primary" onClick={() => setActiveTab('upload')}>Start New Analysis</button>
          <button className="mission-btn ghost" onClick={() => setActiveTab('history')}>Open Case History</button>
        </div>
      </section>

      <div className="dashboard-stats">
        <div className="stat-card dashboard">
          <span className="stat-label">Total Cases</span>
          <span className="stat-number">{dashboardInsights.totalCases}</span>
        </div>
        <div className="stat-card dashboard">
          <span className="stat-label">Total Violations</span>
          <span className="stat-number">{dashboardInsights.totalViolations}</span>
        </div>
        <div className="stat-card dashboard">
          <span className="stat-label">Plates Detected</span>
          <span className="stat-number">{dashboardInsights.plateReady}</span>
        </div>
      </div>

      {dashboardInsights.latestCase && (
        <div className="latest-case-card">
          <h3>Latest Analysis</h3>
          <p className="case-name">{dashboardInsights.latestCase.source_name}</p>
          <p className="case-meta">
            {dashboardInsights.latestCase.source_type === 'video' ? '🎬 Video' : '🖼️ Image'} •{' '}
            {formatPKT(dashboardInsights.latestCase.createdAt)}
          </p>
          <p className="case-violations">
            {dashboardInsights.latestCase.violations_found} violation(s) detected
          </p>
        </div>
      )}
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [latestResults, setLatestResults] = useState(null);
  const [history, setHistory] = useState([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [credentials, setCredentials] = useState({ username: '', password: '' });

  const fetchHistory = async () => {
    const headers = {};
    const token = getSessionToken();
    if (token) {
      headers['X-Session-Token'] = token;
    }
    const response = await fetch(`${API_BASE}/history`, {
      headers
    });
    if (response.status === 401) {
      setIsAuthenticated(false);
      setSessionToken('');
      throw new Error('Session expired. Please log in again.');
    }
    const data = await response.json();
    const items = data.history || data.analyses || [];
    setHistory(items.map((item) => {
      const norm = normalizeCase(item);
      norm.isSaved = true;
      return norm;
    }));
  };

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const headers = {};
        const token = getSessionToken();
        if (token) {
          headers['X-Session-Token'] = token;
        }
        const response = await fetch(`${API_BASE}/auth/me`, {
          headers
        });
        const data = await response.json();
        if (data.authenticated) {
          setIsAuthenticated(true);
          await fetchHistory();
        } else {
          setIsAuthenticated(false);
          setSessionToken('');
        }
      } catch (error) {
        console.warn('Could not verify authentication', error);
        setIsAuthenticated(false);
      } finally {
        setAuthLoading(false);
      }
    };
    checkAuth();
  }, []);

  // Force dark mode globally.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    setAuthError('');
    try {
      const response = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Login failed');
      }

      const data = await response.json();
      if (data.token) {
        setSessionToken(data.token);
      }

      setIsAuthenticated(true);
      await fetchHistory();
      setActiveTab('dashboard');
    } catch (error) {
      setAuthError(error.message || 'Login failed');
    }
  };

  const handleUploadSuccess = async (data) => {
    const normalizedCase = normalizeCase(data);
    normalizedCase.isSaved = false;
    setLatestResults(normalizedCase);
    setActiveTab('results');
  };

  const handleAutoSaveCase = async (caseData) => {
    if (!caseData.records || caseData.records.length === 0) {
      console.log('No violations detected; bypassing database persistence.');
      return;
    }
    try {
      const headers = { 'Content-Type': 'application/json' };
      const token = getSessionToken();
      if (token) {
        headers['X-Session-Token'] = token;
      }
      const response = await fetch(`${API_BASE}/analyses/save`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          analysis_id: caseData.id,
          media_url: caseData.media_url,
          media_type: caseData.source_type,
          detection_image_url: caseData.detection_image_url,
          violation_name: caseData.violation_name,
          detection_summary: caseData.detection_summary || {},
          total_detections: caseData.violations_found,
          detections: caseData.records,
          timestamp_real: caseData.timestamp_real,
        }),
      });

      if (response.status === 401) {
        setIsAuthenticated(false);
        setSessionToken('');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to auto-save case to database');
      }

      const resData = await response.json();

      setLatestResults((prev) => {
        if (!prev || prev.id !== caseData.id) return prev;
        return {
          ...prev,
          isSaved: true,
          media_url: resData.media_url || prev.media_url,
          detection_image_url: resData.detection_image_url || prev.detection_image_url,
          annotated_image_url: resData.detection_image_url || prev.annotated_image_url,
          annotated_video_url: resData.detection_image_url || prev.annotated_video_url,
        };
      });

      await fetchHistory();
    } catch (error) {
      console.error('Error auto-saving case:', error);
    }
  };

  const handleDeleteCase = async (id) => {
    try {
      const headers = {};
      const token = getSessionToken();
      if (token) {
        headers['X-Session-Token'] = token;
      }
      const response = await fetch(`${API_BASE}/analyses/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (response.status === 401) {
        setIsAuthenticated(false);
        setSessionToken('');
        throw new Error('Session expired. Please log in again.');
      }
      if (!response.ok) {
        throw new Error('Failed to delete case');
      }
      setLatestResults((prev) => (prev && prev.id === id ? null : prev));
      await fetchHistory();
    } catch (error) {
      console.error('Error deleting case:', error);
      alert('Failed to delete case: ' + error.message);
    }
  };

  const handleDeleteBulk = async (ids) => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      const token = getSessionToken();
      if (token) {
        headers['X-Session-Token'] = token;
      }
      const response = await fetch(`${API_BASE}/analyses/delete-bulk`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids }),
      });
      if (response.status === 401) {
        setIsAuthenticated(false);
        setSessionToken('');
        throw new Error('Session expired. Please log in again.');
      }
      if (!response.ok) {
        throw new Error('Failed to delete selected cases');
      }
      setLatestResults((prev) => {
        if (!prev) return null;
        if (!ids || ids.includes(prev.id)) return null;
        return prev;
      });
      await fetchHistory();
    } catch (error) {
      console.error('Error bulk deleting cases:', error);
      alert('Failed to delete cases: ' + error.message);
    }
  };

  const handleViewResult = (result) => {
    const normalized = normalizeCase(result);
    normalized.isSaved = true;
    setLatestResults(normalized);
    setActiveTab('results');
  };

  const handleLogout = async () => {
    try {
      const headers = {};
      const token = getSessionToken();
      if (token) {
        headers['X-Session-Token'] = token;
      }
      await fetch(`${API_BASE}/logout`, {
        method: 'POST',
        headers
      });
    } catch (error) {
      console.warn('Error during logout:', error);
    } finally {
      setIsAuthenticated(false);
      setSessionToken('');
      setActiveTab('dashboard');
    }
  };

  // Page titles and headers
  const pageHeaders = {
    dashboard: {
      title: 'Dashboard',
      subtitle: 'Monitor your environmental enforcement operations',
    },
    upload: {
      title: 'Upload Media',
      subtitle: 'Analyze images or videos for violations',
    },
    results: {
      title: 'Detection Results',
      subtitle: 'View detailed analysis and evidence',
    },
    history: {
      title: 'Analysis History',
      subtitle: 'Review past investigations',
    },
    about: {
      title: 'About EcoScout',
      subtitle: 'Learn about our platform',
    },
  };

  const currentHeader = pageHeaders[activeTab] || pageHeaders.dashboard;

  if (authLoading) {
    return (
      <div className="auth-shell" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="auth-card" style={{ width: 'min(100%, 420px)', padding: 28, borderRadius: 24, border: '1px solid rgba(178, 202, 194, 0.18)', background: 'rgba(10, 16, 15, 0.96)', color: 'var(--text-primary)' }}>
          <p style={{ letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginTop: 0 }}>EcoScout</p>
          <h2 style={{ margin: '8px 0 0' }}>Checking session...</h2>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="auth-shell" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <form onSubmit={handleLogin} className="auth-card" style={{ width: 'min(100%, 420px)', padding: 28, borderRadius: 24, border: '1px solid rgba(178, 202, 194, 0.18)', background: 'linear-gradient(180deg, rgba(15, 23, 22, 0.98), rgba(9, 14, 13, 0.98))', color: 'var(--text-primary)', boxShadow: 'var(--shadow-lg)' }}>
          <p style={{ letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--accent-primary)', marginTop: 0 }}>EcoScout Command Center</p>
          <h1 style={{ margin: '8px 0 6px', fontSize: '2rem' }}>Admin Login</h1>
          <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>Enter your admin credentials to access analysis history and uploads.</p>
          <label style={{ display: 'block', marginTop: 18 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--text-secondary)' }}>Username</span>
            <input
              value={credentials.username}
              onChange={(e) => setCredentials((prev) => ({ ...prev, username: e.target.value }))}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(178, 202, 194, 0.18)', background: 'rgba(8, 14, 13, 0.92)', color: 'var(--text-primary)' }}
            />
          </label>
          <label style={{ display: 'block', marginTop: 16 }}>
            <span style={{ display: 'block', marginBottom: 6, color: 'var(--text-secondary)' }}>Password</span>
            <input
              type="password"
              value={credentials.password}
              onChange={(e) => setCredentials((prev) => ({ ...prev, password: e.target.value }))}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(178, 202, 194, 0.18)', background: 'rgba(8, 14, 13, 0.92)', color: 'var(--text-primary)' }}
            />
          </label>
          {authError && <p style={{ color: '#ff8a8a', marginTop: 14 }}>{authError}</p>}
          <button type="submit" className="upload-btn" style={{ width: '100%', marginTop: 18 }}>
            Log In
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-container">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />
      
      <main className="main-content">
        <Header
          title={currentHeader.title}
          subtitle={currentHeader.subtitle}
        />

        <div className="view-container">
          {activeTab === 'dashboard' && (
            <Dashboard history={history} latestResults={latestResults} setActiveTab={setActiveTab} />
          )}

          {activeTab === 'upload' && (
            <UploadMedia onUploadSuccess={handleUploadSuccess} />
          )}

          {activeTab === 'results' && (
            <Results result={latestResults} onAutoSave={handleAutoSaveCase} />
          )}

          {activeTab === 'history' && (
            <History
              history={history}
              onView={handleViewResult}
              onDelete={handleDeleteCase}
              onDeleteBulk={handleDeleteBulk}
            />
          )}

          {activeTab === 'about' && (
            <AboutUs />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
