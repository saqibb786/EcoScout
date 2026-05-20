<div align="center">

# 🌿 EcoScout

### AI-Powered Environmental Violation Detection System

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Python 3.12+](https://img.shields.io/badge/Python-3.12+-3776AB.svg?logo=python&logoColor=white)](https://python.org)
[![React 18](https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&logoColor=white)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Supabase](https://img.shields.io/badge/Supabase-3FCF8E.svg?logo=supabase&logoColor=white)](https://supabase.com)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-blue.svg)](https://docs.ultralytics.com)

**EcoScout** is a full-stack computer vision platform that detects environmental violations (littering, illegal smoke emissions) from images and videos, automatically identifies violator vehicles, reads license plates via OCR, and generates professional investigation reports — all through an intuitive web dashboard.

</div>

---

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Running the Application](#-running-the-application)
- [Usage Guide](#-usage-guide)
- [API Reference](#-api-reference)
- [Supabase Setup](#-supabase-setup)
- [Environment Variables](#-environment-variables)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

### 🔍 Detection & Analysis
- **Multi-violation detection** — Identifies littering and illegal smoke emissions using custom-trained YOLOv8 models
- **Vehicle association** — Automatically links violations to nearby vehicles using spatial proximity matching
- **License plate recognition** — Detects plates with a dedicated YOLO model and reads them with EasyOCR
- **Image & video support** — Analyze single images or process video files frame-by-frame with configurable stride

### 📊 Dashboard & Reporting
- **Real-time results** — Annotated images with bounding boxes, confidence scores, and violation classifications
- **Analysis history** — Persistent storage of all investigations with timestamps, thumbnails, and metadata
- **PDF report generation** — Professional multi-page investigation reports with evidence boards, forensic crops, detection metrics, and annotated frame overlays
- **Persistent reports** — Generated PDFs are uploaded to cloud storage and remain downloadable indefinitely

### ☁️ Cloud Infrastructure
- **Supabase Storage** — All media (original uploads, annotated results, PDF reports) stored in cloud buckets
- **Supabase Database** — PostgreSQL-backed persistence for analyses, detections, and report URLs
- **Public URL generation** — Every uploaded artifact gets a permanent, publicly-accessible download link

### 🔒 Security
- **Session-based authentication** — Cookie-based admin login with protected API routes
- **Environment-driven credentials** — All secrets (DB keys, admin credentials) loaded from `.env` files
- **CORS protection** — Strict origin allowlist for frontend-backend communication

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     React + Vite Frontend                   │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌────────────────┐  │
│  │ Upload   │ │ Results  │ │ History │ │ PDF Report Gen │  │
│  │ Media    │ │ Viewer   │ │ Browser │ │ (jsPDF)        │  │
│  └────┬─────┘ └────┬─────┘ └────┬────┘ └───────┬────────┘  │
│       │             │            │               │          │
└───────┼─────────────┼────────────┼───────────────┼──────────┘
        │    REST API  │            │               │
┌───────┼─────────────┼────────────┼───────────────┼──────────┐
│       ▼             ▼            ▼               ▼          │
│                    FastAPI Backend                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              ViolationPipeline (core)                 │   │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐  │   │
│  │  │ Litter   │ │ Smoke    │ │Vehicle │ │  Plate   │  │   │
│  │  │ YOLOv8   │ │ YOLOv8   │ │YOLOv8s │ │  YOLOv8  │  │   │
│  │  └──────────┘ └──────────┘ └────────┘ └──────────┘  │   │
│  │                    │                                  │   │
│  │              EasyOCR Engine                           │   │
│  └──────────────────┬───────────────────────────────────┘   │
│                     │                                        │
│  ┌──────────────────▼───────────────────────────────────┐   │
│  │           Supabase Service Layer                      │   │
│  │  ┌─────────────────┐    ┌────────────────────────┐   │   │
│  │  │  Storage Client  │    │  Database Client        │   │   │
│  │  │  (media bucket)  │    │  (analyses, detections) │   │   │
│  │  └────────┬────────┘    └───────────┬────────────┘   │   │
│  └───────────┼─────────────────────────┼────────────────┘   │
└──────────────┼─────────────────────────┼────────────────────┘
               │                         │
    ┌──────────▼─────────────────────────▼──────────┐
    │              Supabase Cloud                    │
    │  ┌───────────────┐    ┌────────────────────┐  │
    │  │ Storage Bucket │    │   PostgreSQL DB    │  │
    │  │   (media)      │    │ ┌──────────────┐  │  │
    │  │ • originals    │    │ │  analyses    │  │  │
    │  │ • annotated    │    │ │  detections  │  │  │
    │  │ • reports/     │    │ └──────────────┘  │  │
    │  └───────────────┘    └────────────────────┘  │
    └───────────────────────────────────────────────┘
```

---

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18, Vite 5 | Single-page application |
| **Styling** | Vanilla CSS | Dark theme with glassmorphism |
| **Icons** | Lucide React | UI iconography |
| **PDF Generation** | jsPDF + AutoTable | Client-side investigation reports |
| **Backend** | FastAPI (Python) | REST API, auth middleware |
| **Object Detection** | YOLOv8 (Ultralytics) | Violation, vehicle, and plate detection |
| **OCR** | EasyOCR | License plate text recognition |
| **Image Processing** | OpenCV, NumPy | Frame manipulation and annotation |
| **Database** | Supabase (PostgreSQL) | Structured data persistence |
| **File Storage** | Supabase Storage | Cloud media and report hosting |
| **Environment** | python-dotenv | Secure credential management |

---

## 📁 Project Structure

```
EcoScout/
├── backend/
│   ├── app/
│   │   ├── core/
│   │   │   └── pipeline.py          # ViolationPipeline — multi-model detection engine
│   │   └── main.py                  # FastAPI app, routes, auth, analysis endpoints
│   ├── models/
│   │   ├── litter_best.pt           # Custom litter detection model
│   │   ├── smoke_best.pt            # Custom smoke detection model
│   │   ├── plate_best.pt            # License plate detection model
│   │   └── yolov8s.pt               # Pre-trained vehicle detection model
│   ├── services/
│   │   ├── storage.py               # Supabase Storage upload helpers
│   │   └── supabase_client.py       # Lazy-init Supabase client with env validation
│   ├── .env                         # Backend secrets (git-ignored)
│   ├── requirements.txt             # Python dependencies
│   └── supabase_setup.sql           # Database & storage policy setup script
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── UploadMedia.jsx      # Drag-and-drop evidence upload
│   │   │   ├── Results.jsx          # Detection results with annotated preview
│   │   │   ├── History.jsx          # Analysis history browser
│   │   │   ├── Sidebar.jsx          # Navigation sidebar
│   │   │   ├── Header.jsx           # Top header bar
│   │   │   └── AboutUs.jsx          # About page
│   │   ├── utils/
│   │   │   └── reportPdf.js         # PDF report generator (6-section layout)
│   │   ├── App.jsx                  # Main app with auth, routing, state management
│   │   └── index.css                # Global design tokens and theme
│   ├── .env                         # Frontend env vars (VITE_ prefixed)
│   └── package.json                 # Node.js dependencies
│
├── docs/                            # Additional documentation
├── .gitignore                       # Ignores .env, node_modules, evidence/, temp/
├── LICENSE                          # MIT License
└── README.md                        # This file
```

---

## 📦 Prerequisites

| Requirement | Version | Notes |
|------------|---------|-------|
| **Python** | 3.12+ | [Download](https://python.org/downloads/) |
| **Node.js** | 18+ | [Download](https://nodejs.org/) |
| **npm** | 9+ | Bundled with Node.js |
| **Supabase Account** | Free tier | [Sign up](https://supabase.com/dashboard) |

> **Note:** YOLOv8 models (`.pt` files) must be placed in `backend/models/`. These are not included in the repository due to their size. Contact the project maintainer if you need the trained weights.

---

## 🚀 Installation

### 1. Clone the repository

```bash
git clone https://github.com/saqibb786/EcoScout.git
cd EcoScout
```

### 2. Set up the backend

```bash
cd backend

# Create and activate a virtual environment (recommended)
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt
```

### 3. Set up the frontend

```bash
cd frontend
npm install
```

---

## ⚙️ Configuration

### Backend Environment Variables

Create a `.env` file in the `backend/` directory:

```env
# Supabase credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIs...  # service_role key (NOT anon key)

```

> **⚠️ Important:** The `SUPABASE_SERVICE_KEY` must be the **service_role** (secret) key, not the anon/publishable key. Find it in your Supabase Dashboard → **Settings** → **API** → **service_role**.

### Frontend Environment Variables

Create a `.env` file in the `frontend/` directory:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key_here
```

### Optional: Detection Confidence Thresholds

Fine-tune model sensitivity via backend `.env`:

```env
LITTER_CONF=0.35        # Litter detection threshold (default: 0.35)
SMOKE_CONF=0.40         # Smoke detection threshold (default: 0.40)
VEHICLE_CONF=0.30       # Vehicle detection threshold (default: 0.30)
PLATE_CONF=0.30         # Plate detection threshold (default: 0.30)
VEHICLE_RECOVER_CONF=0.15  # Secondary vehicle recovery (default: 0.15)
```

---

## ▶️ Running the Application

Open **two terminals** from the project root:

### Terminal 1 — Backend API

```bash
cd backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Terminal 2 — Frontend Dev Server

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

### Access Points

| Service | URL |
|---------|-----|
| **Frontend Dashboard** | http://127.0.0.1:5173 |
| **Backend API** | http://127.0.0.1:8000 |
| **API Documentation** | http://127.0.0.1:8000/docs |
| **Supabase Diagnostic** | http://127.0.0.1:8000/debug/supabase |

---

## 📖 Usage Guide

### 1. Login
Open the frontend at `http://127.0.0.1:5173` and log in with the credentials configured in your `backend/.env`.

### 2. Upload Evidence
Navigate to **Upload Media** in the sidebar. Drag-and-drop or select an image (JPG, PNG) or video (MP4, MOV).

### 3. Run Investigation
Click **Run Investigation**. The backend will:
- Detect violations (litter/smoke) using YOLOv8
- Associate violations with nearby vehicles
- Detect and read license plates via OCR
- Upload annotated evidence to Supabase Storage
- Persist results to the database

### 4. View Results
The **Detection Results** page shows:
- Annotated image with color-coded bounding boxes
- Per-detection cards with confidence scores, plate reads, and vehicle associations
- Detection statistics summary

### 5. Browse History
The **History** page displays all past analyses with:
- Thumbnail preview of the annotated evidence
- Violation type, detection count, and timestamp
- One-click PDF report download
- Direct navigation to full detection results

### 6. Download Reports
Click the download icon on any history card to generate a professional PDF report containing:
1. **Case Profile** — Case ID, evidence metadata, timestamp
2. **Detection Performance** — Confidence metrics and success rates
3. **Detection Register** — Tabulated record of all detections
4. **Visual Evidence Board** — Annotated frames with bounding boxes
5. **Zoomed Forensic Crops** — Vehicle and plate close-ups
6. **Report Note** — Methodological disclaimer

Reports are automatically uploaded to Supabase Storage for persistent access.

---

## 🔌 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/login` | Authenticate with admin credentials |
| `GET` | `/auth/me` | Check current session status |
| `POST` | `/logout` | End the current session |
| `POST` | `/analyze/image` | Upload and analyze an image |
| `POST` | `/analyze/video` | Upload and analyze a video |
| `GET` | `/history` | Fetch all analysis history |
| `GET` | `/analyses` | Alias for `/history` |
| `POST` | `/analyses/{id}/report` | Upload a PDF report for an analysis |
| `GET` | `/debug/supabase` | Diagnostic: check Supabase connection status |
| `GET` | `/health` | Backend health check |

> Full interactive API documentation is available at `/docs` (Swagger UI) when the backend is running.

---

## 🗄 Supabase Setup

### 1. Create a Supabase Project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a new project
2. Note your **Project URL** and **service_role key** from Settings → API

### 2. Run the Setup Script

Open the **SQL Editor** in your Supabase Dashboard, paste the contents of [`backend/supabase_setup.sql`](backend/supabase_setup.sql), and click **Run**.

This script will:
- Ensure the `media` storage bucket exists and is public
- Create permissive RLS policies for storage uploads
- Create the `analyses` and `detections` tables
- Set up row-level security policies for database access

### 3. Verify Configuration

After starting the backend, visit `http://127.0.0.1:8000/debug/supabase` to confirm:

```json
{
  "supabase_url_set": true,
  "service_key_set": true,
  "service_key_preview": "eyJhbGci...",
  "client_connected": true,
  "bucket_name": "media"
}
```

All fields should show `true` and the key preview should start with `eyJ` (JWT format).

---

## 🔐 Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | ✅ | Service-role key (JWT, starts with `eyJ`) |
| `ADMIN_USERNAME` | ❌ | Admin login username (default: `admin`) |
| `ADMIN_PASSWORD` | ❌ | Admin login password (default: `admin123`) |
| `LITTER_CONF` | ❌ | Litter detection confidence threshold (default: `0.35`) |
| `SMOKE_CONF` | ❌ | Smoke detection confidence threshold (default: `0.40`) |
| `VEHICLE_CONF` | ❌ | Vehicle detection confidence threshold (default: `0.30`) |
| `PLATE_CONF` | ❌ | Plate detection confidence threshold (default: `0.30`) |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | Anon/publishable key (safe for client-side) |

> **Security:** Both `.env` files are git-ignored. Never commit credentials to the repository.

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feature/your-feature`
3. **Commit** your changes: `git commit -m "Add your feature"`
4. **Push** to the branch: `git push origin feature/your-feature`
5. **Open** a Pull Request

### Development Guidelines

- Follow existing code style and project structure
- Keep backend routes in `app/main.py` and service logic in `services/`
- Keep frontend components modular with co-located CSS files
- Test all changes with both image and video uploads
- Never hardcode credentials — always use environment variables

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built by [SAQIB](https://github.com/saqibb786) and [ABDULLAH](https://github.com/abdullahnaveed786)**

*EcoScout — Protecting the environment through intelligent surveillance*

</div>
