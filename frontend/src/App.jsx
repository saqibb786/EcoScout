import { useEffect, useMemo, useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import UploadMedia from './components/UploadMedia';
import Results from './components/Results';
import History from './components/History';
import AboutUs from './components/AboutUs';
import './App.css';

const HISTORY_KEY = 'ecoscout_cases_v2';

function normalizeCase(result) {
  const records = result?.records || [];
  const createdAt = records[0]?.timestamp || new Date().toISOString();

  return {
    id: result?.id || `case-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt,
    source_type: result?.source_type || 'image',
    source_name: result?.source_name || 'unknown',
    violations_found: result?.violations_found || 0,
    total_frames: result?.total_frames,
    frame_stride: result?.frame_stride,
    records,
    annotated_image_url: result?.annotated_image_url || result?.annotated_image || null,
    annotated_video_url: result?.annotated_video_url || result?.annotated_video || null,
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

  // Load history from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (error) {
      console.warn('Could not restore EcoScout history', error);
    }
  }, []);

  // Persist history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
      console.warn('Could not persist EcoScout history', error);
    }
  }, [history]);

  // Force dark mode globally.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  const handleUploadSuccess = (data) => {
    const normalizedCase = normalizeCase(data);
    setLatestResults(normalizedCase);
    setHistory((prev) => {
      const updated = [normalizedCase, ...prev.filter((item) => item.id !== normalizedCase.id)];
      return updated.slice(0, 50); // Keep max 50 cases
    });
    setActiveTab('results');
  };

  const handleViewResult = (result) => {
    setLatestResults(normalizeCase(result));
    setActiveTab('results');
  };

  const handleDeleteHistory = (ids) => {
    setHistory((prev) => prev.filter((item) => !ids.includes(item.id)));
    if (latestResults && ids.includes(latestResults.id)) {
      setLatestResults(null);
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
              onDelete={handleDeleteHistory}
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
