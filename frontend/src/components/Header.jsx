import React from 'react';
import './Header.css';

const Header = ({ title, subtitle, meta }) => (
    <header className="header">
        <div className="header-copy">
            <p className="header-kicker">EcoScout Command Center</p>
            <h1>{title}</h1>
            {subtitle && <p className="header-subtitle">{subtitle}</p>}
        </div>
        <div className="header-actions">
            {meta && <span className="meta-pill">{meta}</span>}
        </div>
    </header>
);

export default Header;
