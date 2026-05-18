# EcoScout Old Frontend - Complete Analysis Document

## Executive Summary

The old EcoScout application is a sophisticated AI-powered environmental enforcement platform built with **React + Vite**. It features a dark/light theme system, tab-based navigation, real-time detection results, and comprehensive case history management. The application showcases a professional forensic analysis interface with glass-morphic design patterns and smooth animations.

---

## 1. APPLICATION ARCHITECTURE

### Core Stack

- **Framework**: React 18+ (Hooks-based)
- **Build Tool**: Vite
- **Icons**: Lucide React
- **PDF Generation**: jsPDF + jsPDF-AutoTable
- **HTTP Client**: Axios
- **Styling**: CSS Variables + CSS Modules

### State Management

- **Local Component State**: React `useState` for file uploads, tab selection, theme
- **Local Storage**:
  - `ecoscout_cases_v1`: Persists up to 20 detection cases
  - `theme`: Persists dark/light mode preference
- **Props-based Context**: Theme state passed down via Sidebar

### Key Features

1. **Tab-Based Navigation**: Dashboard, Upload, Results, History, About
2. **Theme Toggle**: Dark/Light mode with localStorage persistence
3. **Case History**: In-memory + localStorage (max 20 cases)
4. **PDF Export**: Generate forensic reports with all detection data
5. **Media Upload**: Both image and video support with frame stride control
6. **Real-time Analysis**: Backend integration for violation detection

---

## 2. DESIGN SYSTEM & VISUAL TOKENS

### Color Palette (CSS Variables)

#### Light Mode (Default)

```
Background:
  --bg-app: #f8fafc (Slate 50 - Main app background)
  --bg-sidebar: #ffffff (White - Sidebar/Glass)
  --bg-panel: #ffffff (White - Cards/Panels)
  --bg-surface: #f1f5f9 (Slate 100 - Inputs/Secondary areas)

Text:
  --text-primary: #0f172a (Slate 900 - Main text)
  --text-secondary: #475569 (Slate 600 - Secondary text)
  --text-tertiary: #94a3b8 (Slate 400 - Tertiary text)

Borders:
  --border-light: #e2e8f0 (Slate 200)
  --border-medium: #cbd5e1 (Slate 300)

Accents:
  --accent-primary: #3b82f6 (Blue 500)
  --accent-hover: #2563eb (Blue 600)
  --accent-surface: #eff6ff (Blue 50)

Status:
  --status-success: #10b981 (Emerald 500)
  --status-success-bg: #ecfdf5
  --status-danger: #ef4444 (Red 500)
  --status-danger-bg: #fef2f2
  --status-warning: #f59e0b (Amber 500)

Shadows (Light):
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05)
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1)
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.05)
  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.05)
```

#### Dark Mode (`[data-theme='dark']`)

```
Background:
  --bg-app: #0f172a (Slate 900 - Main app)
  --bg-sidebar: #1e293b (Slate 800)
  --bg-panel: #1e293b (Slate 800)
  --bg-surface: #334155 (Slate 700)

Text:
  --text-primary: #f8fafc (Slate 50)
  --text-secondary: #cbd5e1 (Slate 300)
  --text-tertiary: #64748b (Slate 500)

Borders:
  --border-light: #334155 (Slate 700)
  --border-medium: #475569 (Slate 600)

Accents (Lighter in dark mode):
  --accent-primary: #60a5fa (Blue 400)
  --accent-hover: #93c5fd (Blue 300)
  --accent-surface: rgba(59, 130, 246, 0.15)

Status:
  --status-success: #34d399 (Emerald 400)
  --status-danger: #f87171 (Red 400)

Shadows (Dark):
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.3)
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.5)

Glows:
  --glow-primary: 0 0 25px rgba(59, 130, 246, 0.25)
```

### Typography

- **Font Family**: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto
- **Base Line Height**: 1.6
- **Font Weight**: 400 (body), 600 (headings)

**Heading Sizes**:

```
h1: 2.5rem, letter-spacing: -0.025em
h2: 2rem, letter-spacing: -0.025em
h3: 1.5rem, letter-spacing: -0.025em
Body: 1rem
```

### Spacing & Sizing

- **Border Radius**: 8px (sm), 12px (md), 16px (lg), 24px (xl), 9999px (full)
- **Gap/Padding Base**: 8px increments
- **Sidebar Width**: 280px (fixed)
- **Main Content Margin**: 40px
- **Max Content Width**: 1200px

### Motion System

```
Easing Functions:
  --ease-elastic-1: cubic-bezier(0.5, 1.25, 0.75, 1.25)
  --ease-elastic-2: cubic-bezier(0.5, 1.5, 0.75, 1.25)
  --ease-squish: cubic-bezier(0.5, -0.1, 0.1, 1.5)
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)

Durations:
  --duration-fast: 200ms
  --duration-normal: 300ms
  --duration-slow: 500ms
```

### Visual Effects

- **Glass Panels**:
  - `backdrop-filter: blur(12px)`
  - Border with `--border-light`
  - `--shadow-lg`
  - Semi-transparent background in dark mode
- **Gradients**:
  - Text gradient for headings: `linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%)`
  - Radial gradient backgrounds on hero sections

---

## 3. PAGE STRUCTURE & COMPONENTS

### Overall Layout

```
.app-container (flex, 100vh)
├── Sidebar (fixed width: 280px, height: 100vh)
└── .main-content (flex: 1, margin-left: 280px)
    ├── Header
    └── .content-area
        └── [Active Tab View]
```

---

## 4. COMPONENT DETAILS

### 4.1 SIDEBAR COMPONENT

**File**: `Sidebar.jsx` / `Sidebar.css`

**Structure**:

```
.sidebar (280px width, fixed positioning, flex column)
├── .sidebar-header (logo area, 32px padding)
│   └── .logo (centered)
│       └── img (logo_light.png or logo_dark.png)
├── .sidebar-nav (flex: 1, nav items)
│   └── .nav-item (5 items) x 5
│       ├── icon (lucide-react)
│       └── span (label text)
├── .theme-toggle-container
│   └── .theme-toggle-btn (Moon/Sun icon toggle)
└── .sidebar-footer (copyright text)
```

**Styling Details**:

- Background: `var(--bg-sidebar)` with `backdrop-filter: blur(20px)`
- Border-right: `1px solid var(--border-light)`
- `.nav-item` on hover/active states animate with `scale` transform
- Active nav item: Blue accent background with elevated shadow
- Icon animation on hover: `transform: scale(1.1)`

**Navigation Items**:

1. **Dashboard** - LayoutDashboard icon
2. **Upload Media** - Upload icon
3. **Detection Results** - FileText icon
4. **History** - Calendar icon
5. **About Us** - Users icon

**Theme Toggle**:

- Shows Moon icon in light mode, Sun in dark mode
- Button styling: transparent bg on default, accent on hover
- Transition: `var(--duration-normal)` with `var(--ease-out-expo)`

---

### 4.2 HEADER COMPONENT

**File**: `Header.jsx` / `Header.css`

**Props**:

```javascript
Header({
  title: string, // Selected tab title
  subtitle: string(opt), // Selected tab subtitle
  status: string, // System status (e.g., "5 saved cases")
  meta: string(opt), // Optional metadata
});
```

**Structure**:

```
.header
├── .header-copy
│   ├── p.header-kicker ("EcoScout Command Center")
│   ├── h1 (title)
│   └── p.header-subtitle (subtitle)
└── .header-actions
    ├── span.meta-pill (optional)
    └── span.status-badge
```

**Styling**:

- Background: transparent
- Padding: 25px 40px
- Flexbox layout with space-between
- Status badge: Green background with success color, rounded pill shape
- H1 font-size: 1.5rem with text-shadow

**Dynamic Content by Tab**:

```javascript
Title + Subtitle + Status combinations:
- Dashboard: "Mission Dashboard" + "Monitor detections..." + "X saved cases"
- Upload: "Media Intake" + "Upload an image..." + "X saved cases"
- Results: "Evidence Review" + "Inspect annotated..." + "X saved cases"
- History: "Case Archive" + "Browse prior cases..." + "X saved cases"
- About: "Team & Project" + "Learn about the team..." + "X saved cases"
```

---

### 4.3 DASHBOARD VIEW

**File**: `App.jsx (dashboard case)`

**Structure**:

```
.dashboard-view (gap: 40px)
├── .hero-panel.glass-panel
│   ├── .hero-copy
│   │   ├── p.eyebrow ("AI for Clean Roads")
│   │   ├── h2 (Main title with gradient)
│   │   ├── p (Description)
│   │   └── .hero-actions
│   │       ├── button.cta-btn ("Run New Analysis")
│   │       └── button.ghost-btn ("View Latest Case")
│   └── .hero-metrics (4-column grid)
│       ├── .metric-card x 4
│       │   ├── span (label)
│       │   └── strong (value)
│
├── .feature-grid (3-column responsive grid)
│   ├── .feature-card.glass-panel x 3
│   │   ├── .feature-icon (number badge: 01, 02, 03)
│   │   ├── h3 (Title)
│   │   └── p (Description)
│
└── .overview-strip.glass-panel (3-column grid)
    ├── div x 3
    │   ├── p (Label)
    │   └── strong (Description)
```

**Key Metrics Displayed**:

1. **Total Cases**: Count of all saved cases
2. **Total Violations**: Sum of violations_found across all cases
3. **Plate Hits**: Count of records with plate_bbox detected
4. **Latest Signal**: Source type (image/video) or "Idle" if no data

**Feature Cards** (Static Content):

1. **Violation Detection** - YOLO analyzes frames for smoke/littering
2. **Vehicle Matching** - Spatial linking with fallback recovery
3. **Plate OCR** - Privacy-masked plate extraction

**Overview Sections**:

1. **Pipeline Quality** - Annotated evidence, confidence, strategy, OCR
2. **Presentation Ready** - Built for final-year demos and workflows
3. **Brand Identity** - Blue-green visual language

**Styling**:

- Hero panel: Large radial gradient overlay, centered text
- H2: 3rem with gradient text effect
- CTA button: Primary blue with glow shadow
- Ghost button: **Not defined in provided CSS** (missing styles - see notes)
- Metric cards: Minimal cards with value emphasis
- Feature cards: Hover lift effect (-5px), border accent on hover
- Feature icons: Scale and rotate on hover

---

### 4.4 UPLOAD MEDIA COMPONENT

**File**: `UploadMedia.jsx` / `UploadMedia.css`

**Structure**:

```
<section className="upload-shell glass-panel">
├── .upload-copy
│   ├── p.eyebrow ("Evidence Intake")
│   ├── h2 (Title)
│   ├── p (Description)
│   └── .upload-highlights
│       ├── span (Wand2 icon + "Smart detection pipeline")
│       ├── span (Gauge icon + "Confidence-driven reporting")
│       └── span (ShieldCheck icon + "Privacy-safe masked plates")
│
├── .drop-zone [has-file variant]
│   ├── [No file state]
│   │   ├── .upload-prompt
│   │   │   ├── Upload icon (52px)
│   │   │   ├── h3 (Drag and drop...)
│   │   │   └── p (JPG, PNG, MP4, MOV)
│   │   └── <input type="file">
│   │
│   └── [Has file state]
│       ├── .preview-content
│       │   └── <video> or <img>
│       └── .file-info
│           ├── div
│           │   ├── span.file-name (monospace)
│           │   └── small (type + size)
│           └── button.remove-btn (X icon)
│
├── .upload-side-panel
│   ├── .side-card
│   │   ├── h4 ("Analysis Controls")
│   │   ├── label
│   │   │   ├── span ("Frame stride")
│   │   │   └── <input type="number"> (disabled if image)
│   │   └── p.side-note (explanation)
│   │
│   └── .side-card.calm
│       ├── h4 ("Output Format")
│       └── ul
│           ├── li (Annotated evidence...)
│           ├── li (Violation confidence...)
│           ├── li (Vehicle and plate boxes...)
│           └── li (Masked plate output...)
│
├── [Error state - conditional]
│   └── .error-message
│       ├── AlertCircle icon
│       └── span (error text)
│
└── .upload-actions
    └── button.upload-btn
        (Text: "Analyzing Evidence..." or "Run Investigation")
```

**Key Features**:

- **Drag & Drop**: File drag support with hover feedback
- **File Preview**: Shows thumbnail (image) or video controls
- **Frame Stride Control**: Configurable for video (1 to N frames)
- **Side Panels**: Context-sensitive info about analysis and output
- **Error Handling**: Displays API validation errors

**Styling Details**:

- `.drop-zone`: Dashed border initially, solid when file selected
- `.drop-zone:hover`: Border color accent, background shift, subtle scale
- `.upload-icon` on hover: Scale 1.1, translate up 8px
- `.file-preview`: Flexbox column, gap 20px
- `.remove-btn`: Transparent, danger colors on hover
- `.upload-btn`: Primary blue, disabled state dims the button

**File Upload Logic**:

```javascript
Endpoint: POST ${API_BASE}/analyze/image or /analyze/video
FormData: "file" + optional "frame_stride"
Success: Calls onUploadSuccess(response.data), clears form
Error: Displays validation error messages
```

---

### 4.5 RESULTS COMPONENT

**File**: `Results.jsx` / `Results.css`

**Structure**:

```
<div className="results-container">
├── .results-header
│   ├── h3 ("Detection Analysis")
│   └── .header-actions
│       ├── button.download-btn
│       │   ├── FileText icon
│       │   └── "Download Report"
│       └── span.timestamp (formatted date)
│
└── .results-grid (1.2fr 0.8fr layout)
    ├── .image-section (left, larger)
    │   ├── h4 ("Annotated Output")
    │   ├── .annotated-image-wrapper
    │   │   └── <video controls> OR <img>
    │   ├── p.file-ref (Source: filename)
    │   │
    │   └── [If description exists]
    │       └── .analysis-summary
    │           ├── h5
    │           └── p (description text)
    │
    └── .data-section (right, narrower)
        ├── h4 ("Detected Violations & Objects")
        │
        └── [Conditional rendering]
            ├── [No detections]
            │   └── .no-detections
            │       ├── CheckCircle icon (green)
            │       └── p (No violations detected)
            │
            └── [Has detections]
                └── .detections-list (flex column gap: 16px)
                    └── .detection-card [littering|smoke]
                        ├── .card-header
                        │   ├── span.violation-type
                        │   └── span.confidence-badge
                        │
                        └── .card-details
                            ├── [If frame_image_url]
                            │   └── .detection-frame
                            │       └── <img>
                            │
                            ├── [If license_plate != "N/A"]
                            │   └── .plate-info
                            │       ├── Car icon
                            │       ├── span.plate-number (monospace, yellow bg)
                            │       └── span.ocr-conf (% format)
                            │
                            └── [If violation_type is Littering/Smoke]
                                └── .violation-alert
                                    ├── AlertTriangle icon
                                    └── span ("Violation Detected")
```

**Empty State**:

```
.results-empty
├── .empty-state
│   ├── FileText icon (48px)
│   ├── h3 ("No Results Yet")
│   └── p (Upload an image or video...)
```

**Data Binding**:

```javascript
Results from latestResults state object:
- original_file: string (filename)
- annotated_image_url: string (image URL)
- annotated_video_url: string (video URL, optional)
- detections: array (detection records)
  - violation_type: "Littering" | "Smoke"
  - confidence: number (0-100%)
  - frame_image_url: string (optional)
  - license_plate: string ("N/A" or plate)
  - ocr_confidence: number (0-100%)
- timestamp: ISO date string
- description: string (optional)
```

**Styling Details**:

- `.detection-card`: Left border accent (red for littering, amber for smoke)
- `.detection-card:hover`: Slides right (4px), background shift
- `.plate-number`: Yellow background (#fbbf24), monospace, letter-spacing 1px
- `.confidence-badge`: Minimal pill style with small font
- `.image-section`: Hover box-shadow elevation
- Grid responsive: Switches to 1 column on screens < 900px

**Download Feature**:

- Button clicks: `window.open(http://localhost:8000/report/{results.id}, '_blank')`
- Backend generates PDF on-demand

---

### 4.6 HISTORY COMPONENT

**File**: `History.jsx` / `History.css`

**Structure**:

```
<div className="history-container">
├── .history-header
│   ├── h3 ("Detection History")
│   └── .history-actions
│       ├── button.download-btn
│       │   ├── FileText icon
│       │   ├── span ("Download Selected (N)")
│       │   └── disabled if none selected
│       │
│       └── button.delete-btn
│           ├── Trash2 icon
│           ├── span ("Delete Selected (N)")
│           └── disabled if none selected
│
└── [Empty state]
    └── .history-empty
        └── p ("No detection history found.")

OR

└── .history-grid
    ├── .grid-header
    │   ├── .col-select (checkbox area)
    │   ├── .col-preview ("Preview")
    │   ├── .col-date ("Date")
    │   ├── .col-violations ("Violations")
    │   └── .col-actions ("Actions")
    │
    └── .grid-body
        └── .grid-row [selected variant] x N
            ├── .col-select
            │   └── CheckSquare or Square icon (toggle)
            │
            ├── .col-preview
            │   └── <img> (80x48, cover)
            │
            ├── .col-date
            │   ├── Calendar icon
            │   └── span (localized date string)
            │
            ├── .col-violations
            │   ├── [Has detections]
            │   │   └── .tags
            │   │       └── .tag [littering|smoke]
            │   │
            │   └── [No detections]
            │       └── span.no-violation ("No Violations")
            │
            └── .col-actions
                ├── button.view-btn
                │   ├── Eye icon
                │   └── span ("View")
                │
                └── button.icon-btn
                    ├── FileText icon
                    └── title="Download PDF"
```

**Grid Layout**:

- Columns: `60px 100px 1fr 1fr 140px` (select, preview, date, violations, actions)
- Responds to < 900px: Switches to card layout (flex column)

**Features**:

- **Select All**: Toggle all items selection at header
- **Bulk Download**: Opens each selected case report in new tab
- **Bulk Delete**: Confirmation dialog, then removes from history
- **Individual Actions**: View (sets as active result) or Download single PDF

**Styling Details**:

- `.grid-row:hover`: Background color shift
- `.grid-row.selected`: Accent surface background
- `.tag.littering`: Red/danger coloring
- `.tag.smoke`: Amber/warning coloring
- `.col-preview img`: Rounded corners, 1px border
- Buttons on hover: Border/text accent, slide up -2px
- Mobile: Becomes card layout with full-width previews

**Data Loading**:

- Fetches from: `GET http://localhost:8000/history`
- Displays loading state during fetch
- On delete: Removes locally and syncs with backend

---

### 4.7 ABOUT US COMPONENT

**File**: `AboutUs.jsx` / `AboutUs.css`

**Structure**:

```
<div className="about-view">
├── h2 (gradient text, center-aligned)
├── p.subtitle ("Meet the team behind EcoScout")
│
└── .team-cards-container (3-column grid)
    └── .about-card x 3
        ├── .avatar-circle
        │   └── <img> (member-image with custom transform)
        │
        ├── h3 (full name)
        └── p (description)
```

**Team Members**:

1. **Abdullah Naveed** - avatar.png, initials: "AN"
2. **Saqib Ali Butt** - saqib.png, initials: "SB"
3. **Anwar Karim** - anwar.png, initials: "AK"

**Description** (All identical):
"Contributed to all aspects of the project, including full-stack development, AI integration, and system design."

**Styling Details**:

- `.about-view h2`: `2.5rem`, gradient text effect
- `.about-card::before`: Top accent bar (0 → 100% scaleX on hover)
- `.avatar-circle`:
  - 120px diameter, circular, 4px border
  - Overflow hidden for image masking
  - Hover: scale 1.1, box-shadow elevation
- `.member-image`:
  - `object-fit: cover`
  - Custom `transform` and `objectPosition` per member
  - Hover: scale 1.1 with smooth animation
- `.about-card:hover`: translateY(-8px), shadow elevation
- Responsive: 1 column on screens < 768px

**Styling for Different Members**:

```javascript
Abdullah: scale(1.3), objectPosition: "bottom center"
Saqib:    scale(1.5), objectPosition: "center 20%"
Anwar:    scale(1.3), objectPosition: "center"
```

---

## 5. ANIMATIONS & TRANSITIONS

**Global Animation Keyframes** (defined in `index.css`):

```css
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes slideUpFade {
  from {
    opacity: 0;
    transform: translateY(15px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
```

**Application**:

- `.animate-enter`: Applied to hero section on dashboard
- View switching: All `.dashboard-view`, `.upload-view`, etc. use `slideUpFade`
- Animation duration: `var(--duration-normal)` (300ms)
- Easing: `var(--ease-out-expo)`

**Component-Level Animations**:

- **Sidebar nav items**: Hover `translateX(4px)`, icon `scale(1.1)`
- **Feature cards**: Hover `translateY(-5px)`, icon `rotate(5deg) scale(1.1)`
- **Avatar circles**: Hover `scale(1.1)`
- **Member images**: Hover `scale(1.1)` (slow 500ms)
- **Buttons**: `:active` scale(0.96), hover lift effects
- **File upload zone**: Hover `scale(1.005)`
- **Card borders**: Accent transition on hover

---

## 6. FEATURE SET & FUNCTIONALITY

### Core Features

1. **Media Upload**
   - Accepts JPG, PNG, MP4, MOV
   - Drag & drop or click to browse
   - Preview before upload
   - Frame stride configuration for videos

2. **Violation Detection**
   - Two main violation types: Littering, Smoke
   - Confidence scoring (0-100%)
   - Bounding box visualization
   - Frame-level detection for videos

3. **Vehicle Matching**
   - Links violations to responsible vehicle
   - Vehicle confidence scoring
   - Bounding box coordinates

4. **Plate OCR**
   - Automatic license plate detection
   - OCR text extraction
   - Masked/unmasked plate display
   - OCR confidence scoring

5. **Case History Management**
   - Stores up to 20 most recent cases
   - Persistent localStorage
   - Select/deselect individual cases
   - Bulk download of reports
   - Bulk deletion with confirmation

6. **PDF Report Generation**
   - Uses jsPDF + jsPDF-AutoTable
   - Includes case summary table
   - Lists all detection records with detailed fields
   - Prints bounding boxes, confidence scores
   - Professional formatting with header/footer

7. **Theme Management**
   - Dark/Light mode toggle
   - localStorage persistence
   - Instant UI transition
   - All components adapt automatically

### Advanced Features

- **Glass Morphism**: Blur effects on panels with semi-transparency
- **Responsive Design**: Mobile-friendly (tested down to 768px width)
- **Accessibility**: Semantic HTML, icon + text labels
- **Error Handling**: User-friendly validation error messages
- **Real-time Statistics**: Dashboard metrics update from case history

---

## 7. PDF EXPORT FUNCTIONALITY

**File**: `reportPdf.js` (in `frontend/src/utils/`)

**Export Function**: `exportCaseReportPdf(inputCase)`

**Report Structure**:

1. **Header Section**
   - Green background (#0a2d26) with white text
   - Title: "EcoScout Investigation Report"
   - Generated timestamp
   - **Font**: Arial, size 19 for title, 10 for date

2. **Case Summary Table**
   - 2-column table (Field | Value)
   - Rows:
     - Case ID
     - Source Name
     - Source Type (image/video)
     - Violations Found
     - High Confidence Violations (≥80%)
     - Vehicle Matched count
     - Plates Detected count
     - OCR Success count
     - Average Violation Confidence
     - Total Frames
     - Frame Stride

3. **Detection Records Table**
   - 8 columns: #, Violation, Violation Conf, Vehicle Conf, Plate Text, OCR Conf, Strategy, Timestamp
   - One row per detection record
   - Formatted with percentages and dates

4. **Detailed Technical Fields**
   - Per-record breakdown:
     - Violation Bounding Box coordinates
     - Vehicle Bounding Box + confidence
     - Plate Bounding Box + confidence
     - Plate Text (masked and raw)
     - OCR Confidence
     - Match Strategy
     - Timestamp & Video Time (seconds)

5. **Footer**
   - "EcoScout - AI for Clean Roads" on each page

**File Naming**: `ecoscout_report_{sanitized_source_name}_{timestamp}.pdf`

---

## 8. STYLING ARCHITECTURE

### CSS Organization

- **Global Styles**: `index.css` (design tokens, animations, base elements)
- **App Layout**: `App.css` (main container, views, hero section)
- **Component Styles**: Each component has matching `.css` file
  - `Sidebar.css`
  - `Header.css`
  - `Results.css`
  - `UploadMedia.css`
  - `History.css`
  - `AboutUs.css`

### Key CSS Classes (Organized by File)

**App.css**:

- `.app-container` - Main flex container
- `.main-content` - Content area with sidebar margin
- `.dashboard-view`, `.upload-view`, `.results-view`, `.history-view`, `.about-view` - Tab views
- `.hero-panel`, `.hero-copy`, `.hero-actions`, `.hero-metrics`, `.metric-card` - Dashboard hero
- `.feature-grid`, `.feature-card`, `.feature-icon` - Feature cards
- `.overview-strip` - Info strip (Pipeline Quality, etc.)
- `.cta-btn`, `.ghost-btn` - Buttons _(Note: `.ghost-btn` styling not found in CSS)_
- `.welcome-card` - Card styling

**Sidebar.css**:

- `.sidebar` - Main sidebar container
- `.sidebar-header`, `.sidebar-logo-img` - Logo area
- `.sidebar-nav`, `.nav-item`, `.nav-item.active` - Navigation
- `.theme-toggle-container`, `.theme-toggle-btn` - Theme toggle
- `.sidebar-footer` - Copyright

**Header.css**:

- `.header` - Main header
- `.header-copy` - Title/subtitle area
- `.header-kicker` - "EcoScout Command Center" text
- `.header-actions` - Right-side actions
- `.meta-pill` - Optional metadata
- `.status-badge` - System status

**UploadMedia.css**:

- `.upload-shell` - Main container
- `.upload-copy` - Copy section with description
- `.upload-highlights` - List of highlights
- `.drop-zone`, `.drop-zone:hover`, `.drop-zone.has-file` - Drop zone states
- `.upload-prompt` - Prompt content
- `.file-preview`, `.preview-content` - File preview
- `.file-info` - File name + size
- `.remove-btn` - Remove button
- `.upload-side-panel`, `.side-card`, `.side-card.calm` - Side panels
- `.side-note` - Explanatory text
- `.upload-actions`, `.upload-btn` - Action buttons
- `.error-message` - Error display
- _(Note: `.upload-shell`, `.upload-copy`, `.upload-highlights`, `.upload-side-panel`, `.side-card` styling not fully found)_

**Results.css**:

- `.results-container` - Main container
- `.results-header`, `.header-actions` - Header
- `.results-grid` - 2-column layout
- `.image-section`, `.data-section` - Column sections
- `.annotated-image-wrapper` - Image/video container
- `.file-ref` - Source file reference
- `.analysis-summary` - Summary box
- `.detections-list` - List of detections
- `.detection-card`, `.detection-card.littering`, `.detection-card.smoke` - Detection items
- `.card-header`, `.card-details` - Card sections
- `.violation-type`, `.confidence-badge` - Card elements
- `.detection-frame` - Frame image box
- `.plate-info`, `.plate-number`, `.ocr-conf` - Plate info
- `.violation-alert` - Alert styling
- `.results-empty`, `.empty-state` - Empty state
- `.download-btn` - Download button

**History.css**:

- `.history-container` - Main container
- `.history-header`, `.history-actions` - Header
- `.download-btn`, `.delete-btn` - Action buttons
- `.history-grid`, `.grid-header`, `.grid-body` - Grid structure
- `.grid-row`, `.grid-row.selected` - Rows
- `.col-select`, `.col-preview`, `.col-date`, `.col-violations`, `.col-actions` - Columns
- `.tag`, `.tag.littering`, `.tag.smoke` - Violation tags
- `.no-violation` - No violation text
- `.view-btn`, `.icon-btn` - Action buttons
- `.history-empty` - Empty state

**AboutUs.css**:

- `.about-view` - Main view
- `.team-cards-container` - 3-column grid
- `.about-card` - Card styling
- `.avatar-circle`, `.avatar-circle.has-image` - Avatar styling
- `.member-image` - Member photo
- Card title (h3), description (p)

**index.css**:

- `.glass-panel` - Glass morphism effect
- `.animate-enter` - Entry animation class
- Global animations: `@keyframes fadeIn`, `@keyframes slideUpFade`
- Scrollbar styling
- Typography utilities
- Reset styles

---

## 9. MISSING/INCOMPLETE STYLES

**Classes Used but Not Fully Defined**:

1. `.ghost-btn` - Referenced in App.jsx ("View Latest Case" button) but CSS not found
2. `.hero-panel`, `.hero-copy`, `.hero-actions`, `.hero-metrics`, `.metric-card` - Referenced but CSS rules not located in provided files
3. `.overview-strip` - Referenced but CSS rules incomplete
4. `.upload-shell`, `.upload-copy`, `.upload-highlights` - Referenced in UploadMedia.jsx but full CSS not found
5. `.upload-side-panel`, `.side-card`, `.side-note` - Referenced but styling unclear

**Assumption**: These styles may be defined in separate CSS or may have been omitted from provided versions. The components function but styling may be minimal or inherited.

---

## 10. RESPONSIVE DESIGN

### Breakpoints Implemented

**Sidebar** (768px):

```css
@media (max-width: 768px) {
  .sidebar {
    position: bottom (mobile nav bar)
    flex-direction: row
    height: auto
  }
  .nav-item {
    flex-direction: column
    font-size: 0.75rem
  }
}
```

**Main Content** (768px):

```css
@media (max-width: 768px) {
  .main-content {
    margin-left: 0
    width: 100%
    padding: 24px 16px 100px
  }
}
```

**Upload Component** (768px):

```css
@media (max-width: 768px) {
  .upload-container {
    padding: 24px
  }
  .drop-zone {
    padding: 40px
    min-height: 240px
  }
}
```

**Results Component** (900px):

```css
@media (max-width: 900px) {
  .results-grid {
    grid-template-columns: 1fr (stacks vertically);
  }
}
```

**History Component** (900px):

```css
@media (max-width: 900px) {
  .history-grid {
    Switches from table grid to card layout
    .grid-row becomes flex column
    .col-preview becomes full-width
  }
}
```

**About Component** (768px):

```css
@media (max-width: 768px) {
  .team-cards-container {
    grid-template-columns: 1fr (single column);
  }
}
```

### Mobile-First Considerations

- Bottom navbar for touch screens (sidebar converted to horizontal nav)
- Reduced padding on mobile (40px → 24px or 16px)
- Stack layouts vertically
- Large touch targets for buttons
- Reduced font sizes for nav items on mobile
- Full-width cards/grids

---

## 11. STATE MANAGEMENT & DATA FLOW

### App.jsx State

```javascript
// Local Storage Keys
const HISTORY_KEY = "ecoscout_cases_v1";

// State
const [activeTab, setActiveTab] = useState("dashboard");
const [latestResults, setLatestResults] = useState(null);
const [history, setHistory] = useState([]); // Max 20 items
const [theme, setTheme] = useState(
  () => localStorage.getItem("theme") || "dark",
);
```

### Data Normalization

```javascript
function normalizeCase(result) {
  return {
    id: result?.id || `case-${Date.now()}`,
    createdAt: records[0]?.timestamp || new Date().toISOString(),
    source_type: result?.source_type || "image",
    source_name: result?.source_name || "unknown",
    violations_found: result?.violations_found || 0,
    total_frames: result?.total_frames,
    frame_stride: result?.frame_stride,
    records: result?.records || [],
    annotated_image_url: result?.annotated_image_url || null,
    annotated_video_url: result?.annotated_video_url || null,
    raw: result,
  };
}
```

### Event Handlers

1. **handleUploadSuccess(data)**
   - Normalizes case data
   - Sets as latestResults
   - Prepends to history (de-dupes by ID, keeps 20 max)
   - Navigates to results tab

2. **handleViewResult(result)**
   - Normalizes result
   - Sets as latestResults
   - Navigates to results tab

3. **handleDeleteHistory(ids)**
   - Filters history by ID
   - Clears latestResults if deleted
   - Returns to dashboard if active result deleted

4. **toggleTheme()**
   - Toggles 'dark' ↔ 'light'
   - Persists to localStorage
   - Updates global data-theme attribute

### Effects

```javascript
// Load history from localStorage on mount
useEffect(() => {
  const saved = localStorage.getItem(HISTORY_KEY);
  if (saved) setHistory(JSON.parse(saved));
}, []);

// Persist history to localStorage on changes
useEffect(() => {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}, [history]);

// Apply theme to document root on theme change
useEffect(() => {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}, [theme]);
```

### Dashboard Insights (Memoized)

```javascript
const dashboardInsights = useMemo(() => {
  const totalCases = history.length;
  const totalViolations = history.reduce(
    (sum, item) => sum + (item.violations_found || 0),
    0,
  );
  const latestCase = history[0] || latestResults;
  const plateReady = history.reduce(
    (sum, item) =>
      sum + item.records.filter((r) => Boolean(r.plate_bbox)).length,
    0,
  );

  return { totalCases, totalViolations, latestCase, plateReady };
}, [history, latestResults]);
```

---

## 12. BACKEND INTEGRATION

### API Endpoints

**Upload & Analysis**:

- `POST /analyze/image` - Upload image for analysis
- `POST /analyze/video` - Upload video with frame stride parameter
- Request: FormData(file, [frame_stride])
- Response: Case object with detection results

**Case Management**:

- `GET /history` - Fetch all saved cases
- `DELETE /history` - Delete cases by ID
- Request body: Array of IDs

**Report Generation**:

- `GET /report/{id}` - Download PDF report for case
- Opened in new window via `window.open()`

### Error Handling

- API errors caught in try/catch
- Displays user-friendly error messages
- Validates file size before upload
- Shows loading state during upload

---

## 13. KEY DESIGN DECISIONS

1. **Glass Morphism**: Creates modern, layered aesthetic while maintaining readability
2. **Color Coding**: Red for violations (danger), Amber for smoke (warning), Green for success
3. **Gradient Text**: Adds visual hierarchy to primary headings
4. **Motion**: Subtle animations enhance perceived responsiveness without being distracting
5. **Two-Column Results Grid**: Balances annotated image visibility with detection details
6. **Persistent History**: localStorage keeps recent cases without backend dependency
7. **Theme Toggle**: Dark mode by default (reduces eye strain in professional use)
8. **Slide-Up Animation**: Entry animation creates sense of content presentation
9. **Sidebar Navigation**: Fixed width allows consistent, always-visible nav on desktop
10. **Metric Cards**: Dashboard instantly communicates key statistics at a glance

---

## 14. ICONS USED (Lucide React)

**Sidebar Navigation**:

- `LayoutDashboard` - Dashboard tab
- `Upload` - Upload Media tab
- `FileText` - Results tab
- `Calendar` - History tab
- `Users` - About Us tab
- `Sun` / `Moon` - Theme toggle

**Components**:

- `Wand2` - Smart detection
- `Gauge` - Confidence-driven
- `ShieldCheck` - Privacy-safe
- `CheckCircle` - No violations
- `AlertTriangle` - Alert indicator
- `AlertCircle` - Error messages
- `Car` - Vehicle/license plate
- `Trash2` - Delete action
- `Eye` - View action
- `CheckSquare` / `Square` - Selection checkboxes
- `X` - Close/remove button

---

## 15. FILE STRUCTURE

```
frontend/src/
├── App.jsx              (Main app logic, state management)
├── App.css              (App layout & dashboard styles)
├── main.jsx             (React entry point)
├── index.css            (Global design tokens, animations)
├── components/
│   ├── Sidebar.jsx      (Navigation sidebar)
│   ├── Sidebar.css
│   ├── Header.jsx       (Page header with title/status)
│   ├── Header.css
│   ├── UploadMedia.jsx  (File upload with preview)
│   ├── UploadMedia.css
│   ├── Results.jsx      (Detection results display)
│   ├── Results.css
│   ├── History.jsx      (Case history table)
│   ├── History.css
│   ├── AboutUs.jsx      (Team page)
│   └── AboutUs.css
├── utils/
│   └── reportPdf.js     (PDF report generation)
└── assets/
    ├── logo_light.png
    ├── logo_dark.png
    ├── abdullah.png
    ├── saqib.png
    └── anwar.png
```

---

## 16. LIBRARIES & DEPENDENCIES

- **react** - UI framework
- **react-dom** - React rendering
- **vite** - Build tool
- **lucide-react** - Icon library (v0.30+)
- **axios** - HTTP client
- **jspdf** - PDF generation
- **jspdf-autotable** - PDF table generation

---

## 17. SUMMARY OF KEY FEATURES TO REPLICATE

### Must-Have Features

1. ✅ Tab-based navigation (Dashboard, Upload, Results, History, About)
2. ✅ Dark/Light theme toggle with persistence
3. ✅ Drag & drop file upload with preview
4. ✅ Detection results display (image + violations grid)
5. ✅ Scrollable results table showing detections
6. ✅ PDF report download functionality
7. ✅ Case history management (view, delete, bulk actions)
8. ✅ Dashboard with key metrics
9. ✅ About page with team info
10. ✅ Responsive design (mobile, tablet, desktop)

### Nice-to-Have Visual Features

1. ✅ Glass morphism panel effects
2. ✅ Smooth slide-up animations on page transitions
3. ✅ Icon + text navigation items
4. ✅ Hover effects with subtle transforms
5. ✅ Status badges and confidence indicators
6. ✅ Placeholder states with helpful messaging
7. ✅ Color-coded violation types (Littering = Red, Smoke = Amber)
8. ✅ Gradient text on headings
9. ✅ Custom scrollbar styling
10. ✅ Team member avatar circles

### Advanced Features

1. ✅ Video support with frame stride parameter
2. ✅ Plate number display with OCR confidence
3. ✅ Multiple detection records per case
4. ✅ Frame-level bounding box images
5. ✅ Vehicle matching with confidence scoring
6. ✅ Local storage caching of cases

---

## 18. NOTES & OBSERVATIONS

1. **Missing CSS Definitions**: Several CSS classes are referenced in JSX but not fully styled in provided CSS files (`.ghost-btn`, `.hero-*`, `.metric-card`, `.upload-shell`, `.side-card`). These may need to be added or inherited defaults apply.

2. **API Integration**: The app expects a backend at `http://localhost:8000` (or VITE_API_BASE_URL). All analysis happens server-side; frontend only handles UI and result display.

3. **localStorage Limitations**: History is limited to 20 most recent cases for performance. Older cases are discarded when limit is exceeded.

4. **No Real-time Sync**: History updates only through manual deletion or new uploads; no polling or WebSocket integration.

5. **PDF Generation**: Uses client-side jsPDF library. PDFs are generated and downloaded directly to user's machine.

6. **Theme System**: Global data-theme attribute on <html> element controls all CSS variable values, enabling instant full-app theme switching.

7. **Responsive Breakpoints**: Main breakpoints are 768px (mobile) and 900px (results/history grid compact view). Others could be added for better tablet support.

8. **Accessibility**: Uses semantic HTML (buttons, nav, sections). Icon-only buttons have aria-labels. Color is not the only indicator (includes text labels and icons).

9. **Performance**: Memoized dashboard calculations prevent unnecessary re-renders. localStorage is used instead of cookies for larger storage.

10. **Browser Support**: Modern browsers only (CSS variables, CSS Grid, backdrop-filter). No IE11 support.

---

## CONCLUSION

The old EcoScout frontend is a well-designed, professional forensic analysis tool with:

- Clear visual hierarchy and information architecture
- Sophisticated color and animation system
- Responsive layout supporting desktop and mobile
- Comprehensive feature set for evidence review and reporting
- Clean component structure suitable for enhancement

All design tokens, animations, color schemes, and layout patterns documented above should be replicated in the new application to maintain visual consistency and user familiarity.
