import React, { useEffect, useState } from 'react';
import { LayoutDashboard, Upload, FileText, Calendar, Users, Menu, X, LogOut } from 'lucide-react';
import './Sidebar.css';

const Sidebar = ({ activeTab, setActiveTab, onLogout }) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (window.innerWidth > 1080) {
      setMobileOpen(false);
    }

    const handleResize = () => {
      if (window.innerWidth > 1080) {
        setMobileOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { id: 'upload', label: 'Upload Media', icon: <Upload size={20} /> },
    { id: 'results', label: 'Detection Results', icon: <FileText size={20} /> },
    { id: 'history', label: 'History', icon: <Calendar size={20} /> },
    { id: 'about', label: 'About Us', icon: <Users size={20} /> },
  ];

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <img src="/assets/logo_dark.png" alt="EcoScout" className="logo-image" />
        </div>
        <button
          className="mobile-nav-toggle"
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      <nav className={`sidebar-nav ${mobileOpen ? 'open' : ''}`}>
        {menuItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => {
              setActiveTab(item.id);
              setMobileOpen(false);
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
        <button
          className="nav-item logout-btn"
          onClick={() => {
            if (window.confirm('Are you sure you want to log out?')) {
              onLogout();
              setMobileOpen(false);
            }
          }}
        >
          <LogOut size={20} />
          <span>Log Out</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <p>© 2025 EcoScout System</p>
      </div>
    </div>
  );
};

export default Sidebar;
