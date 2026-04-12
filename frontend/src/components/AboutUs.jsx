import React from 'react';
import { GitBranch, Zap, Shield, Eye } from 'lucide-react';
import './AboutUs.css';

const AboutUs = () => {
  const features = [
    {
      icon: <Eye size={32} />,
      title: 'Advanced Detection',
      description: 'AI-powered detection of environmental violations including smoke and littering incidents.'
    },
    {
      icon: <Shield size={32} />,
      title: 'Vehicle Matching',
      description: 'Identifies and matches violating vehicles using spatial analysis and confidence scoring.'
    },
    {
      icon: <Zap size={32} />,
      title: 'Plate Recognition',
      description: 'OCR-based license plate extraction with masked display for privacy protection.'
    },
    {
      icon: <GitBranch size={32} />,
      title: 'Evidence Pipeline',
      description: 'Forensic-grade workflow delivering annotated media and detailed investigation records.'
    },
  ];

  const teamMembers = [
    {
      name: 'Saqib',
      image: '/assets/saqib.png',
      role: 'Software Engineer'
    },
    {
      name: 'Abdullah',
      image: '/assets/abdullah.png',
      role: 'Software Engineer'
    },
    {
      name: 'Anwar',
      image: '/assets/anwar.png',
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

      <div className="features-section">
        <h2>Core Features</h2>
        <div className="features-grid">
          {features.map((feature, idx) => (
            <div key={idx} className="feature-card">
              <div className="feature-icon">{feature.icon}</div>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="team-section">
        <h2>Our Team</h2>
        <div className="team-grid">
          {teamMembers.map((member, idx) => (
            <div key={idx} className="team-card">
              <div className="team-image-wrapper">
                <img src={member.image} alt={member.name} className="team-image" />
              </div>
              <h3>{member.name}</h3>
              <p className="team-role">{member.role}</p>
            </div>
          ))}
        </div>
      </div>

      <footer className="about-footer">
        <p>© 2025 EcoScout. All rights reserved.</p>
        <p>Built for cleaner, safer urban environments.</p>
      </footer>
    </div>
  );
};

export default AboutUs;
