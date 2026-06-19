import React from 'react';
import { GitBranch, Zap, Shield, Eye } from 'lucide-react';
import './AboutUs.css';

const AboutUs = () => {
  const teamMembers = [
    {
      name: 'Saqib Ali Butt',
      role: 'Software Engineer'
    },
    {
      name: 'Abdullah Naveed',
      role: 'Software Engineer'
    },
    {
      name: 'Anwar Karim',
      role: 'Software Engineer'
    },
  ];

  return (
    <div className="about-container">
      <div className="mission-section">
        <h2>Our Mission</h2>
        <p>
          EcoScout is an advanced AI-powered platform designed to detect and document environmental violations
          in urban and hilly terrains. Using state-of-the-art computer vision and machine learning, we help
          enforce environmental regulations by identifying violator vehicles and generating evidence-backed
          investigation records.
        </p>
      </div>

      <div className="team-section">
        <h2>Team</h2>
        <div className="team-grid compact">
          {teamMembers.map((member, idx) => {
            const initials = member.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)
              .toUpperCase();
            return (
              <div key={idx} className="team-card compact">
                <div className="team-avatar">{initials}</div>
                <div>
                  <h3>{member.name}</h3>
                  <p className="team-role">{member.role}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="about-footer">
        <p>© 2026 EcoScout. All rights reserved.</p>
        <p>Built for cleaner, safer urban environments.</p>
      </footer>
    </div>
  );
};

export default AboutUs;
