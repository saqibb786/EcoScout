import { useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import UploadMedia from './components/UploadMedia';
import Results from './components/Results';
import History from './components/History';
import AboutUs from './components/AboutUs';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const HISTORY_KEY = 'ecoscout_cases_v2';

function normalizeCase(result) {
  const records = (result?.detections || result?.records || []).map((record) => ({
    ...record,
    violation_bbox: record.violation_bbox || record.bbox || null,
    violation_confidence: record.violation_confidence ?? record.confidence ?? null,
    violation: record.violation || record.class_name || 'unknown',
    plate_text_raw: record.plate_text_raw || record.ocr_text || null,
    plate_text: record.plate_text || record.ocr_text || null,
    ocr_confidence: record.ocr_confidence ?? null,
  }));
  const createdAt = result?.timestamp_real || result?.createdAt || result?.created_at || records[0]?.timestamp || new Date().toISOString();

  return {
    id: result?.id || result?.analysis_id || `case-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt,
    source_type: result?.media_type || result?.source_type || 'image',
    source_name: result?.source_name || result?.detection_summary?.source_name || 'unknown',
    violations_found: result?.violations_found ?? result?.total_detections ?? 0,
    total_frames: result?.total_frames,
    frame_stride: result?.frame_stride,
    records,
    media_url: result?.media_url || null,
    detection_image_url: result?.detection_image_url || result?.annotated_image_url || result?.annotated_video_url || null,
    annotated_image_url: result?.detection_image_url || result?.annotated_image_url || result?.annotated_image || null,
    annotated_video_url: result?.detection_image_url || result?.annotated_video_url || result?.annotated_video || null,
    violation_name: result?.violation_name || result?.detection_summary?.violation_name || 'unknown',
    timestamp_real: result?.timestamp_real || null,
    detection_summary: result?.detection_summary || null,
    report_url: result?.report_url || null,
    groq_analysis: result?.groq_analysis || result?.detection_summary?.groq_analysis || null,
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
            {new Date(dashboardInsights.latestCase.createdAt).toLocaleString()}
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
    const response = await fetch(`${API_BASE}/history`, { credentials: 'include' });
    if (response.status === 401) {
      throw new Error('Not authenticated');
    }
    const data = await response.json();
    const items = data.history || data.analyses || [];
    setHistory(items.map((item) => normalizeCase(item)));
  };

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/me`, { credentials: 'include' });
        const data = await response.json();
        if (data.authenticated) {
          setIsAuthenticated(true);
          await fetchHistory();
        } else {
          setIsAuthenticated(false);
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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Login failed');
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
    setLatestResults(normalizedCase);
    setHistory((prev) => {
      const updated = [normalizedCase, ...prev.filter((item) => item.id !== normalizedCase.id)];
      return updated.slice(0, 50); // Keep max 50 cases
    });
    setActiveTab('results');
    // Re-fetch from Supabase to ensure history is fully in sync
    try {
      await fetchHistory();
    } catch (err) {
      console.warn('Could not refresh history after upload', err);
    }
  };

  const handleViewResult = (result) => {
    setLatestResults(normalizeCase(result));
    setActiveTab('results');
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
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
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
            <Results result={latestResults} />
          )}

          {activeTab === 'history' && (
            <History
              history={history}
              onView={handleViewResult}
              onDelete={(id) => setHistory((prev) => prev.filter((item) => item.id !== id))}
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
