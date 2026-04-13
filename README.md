# EcoScout

EcoScout is a computer vision app for detecting vehicle-related violations, matching vehicles and plates, and generating annotated investigation results.

## Project Structure

- `fastapi_app.py` - FastAPI backend API
- `pipeline.py` - detection and OCR pipeline
- `frontend/` - React + Vite frontend
- `plate_best.pt` - plate detection model
- `violation_best.pt` - violation detection model

## Prerequisites

- Python 3.12 or compatible
- Node.js 18+ and npm

## Run the App Manually

Open two terminals from the project root.

### 1. Start the backend

```powershell
python -m uvicorn fastapi_app:app --app-dir . --host 127.0.0.1 --port 8000
```

### 2. Start the frontend

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

### 3. Open the app

- Frontend: http://127.0.0.1:5173/
- Backend health: http://127.0.0.1:8000/health

## Build the Frontend

```powershell
cd frontend
npm run build
```

## Push to GitHub

```powershell
git init
git add .
git commit -m "Initial EcoScout project"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

## Notes

- Generated folders such as `evidence/`, `temp/`, and `frontend/dist/` are ignored by Git.
- If you change the backend or frontend dependencies, rerun the relevant install command.
