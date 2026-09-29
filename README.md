# ForestTrace

ForestTrace is an interactive web platform for monitoring boreal forest dynamics in northern Ontario, Canada. The application supports annual clearcut mapping, biomass visualization, and multi-sensor satellite analysis through an integrated web GIS interface with an AI-powered forestry assistant.

Developed by the Remote Sensing Lab (RSL) at Saint Louis University, ForestTrace supports research and decision-making for forest stewardship, including Indigenous-led land management workflows.

---

## Current Platform Capabilities

The platform provides:

- **Clearcut Detection & Annual Disturbance Tracking**: Track annual harvest and clearcut dynamics across Ontario Forest Management Units (FMUs) from 2015 to present with pixel-level precision and uncertainty metrics.
- **Above-Ground Biomass (AGB) Estimation**: High-resolution forest biomass maps derived from fused SAR and optical data.
- **Multi-Sensor Satellite Overlays**: Interactive viewing of HLS (Harmonized Landsat and Sentinel-2) and Planet NICFI high-resolution satellite imagery.
- **Dual Map Rendering Engines**: Seamless support for standard Leaflet XYZ raster tiles and WebGL MapLibre GL rendering Cloud-Optimized GeoTIFFs (COGs) directly in the browser.
- **Domain-Specific Forestry AI Agent**: Natural language assistant powered by Meta Llama 3.1 8B via Groq inference, grounded with the user's active map viewport, FMUs, layers, and drawn polygons.
- **User Accounts & Role-Based Access Control**:
  - Secure email-based registration with 6-digit confirmation codes.
  - Passwordless / code-based email authentication.
  - Role hierarchy: **Admin**, **Analyst**, and **Standard User**.
  - First-run administrative setup wizard automatically activates when setting up on an uninitialized database.
- **Administrative Dashboard & System Monitoring**:
  - User role assignment, account status management, and activity monitoring.
  - Platform audit statistics (registered users, active accounts, AI query volume, bug reports).
- **Interactive User AI Chat History**: Persisted query history allowing users to review and revisit previous AI conversational analyses.
- **Context-Aware Issue & Bug Reporting**: Submit bug reports that automatically capture active map layers, selected FMUs, current year, viewport coordinates, and browser details.
- **Responsive Landing Page Navigation**: Interactive landing page with smooth anchor navigation (`Overview`, `Methodology`, `About`, `News`, `Contact`), cleanly transitioning to the GIS workspace upon launch.

---

## Tech Stack

- **Frontend**:
  - React (`client/`), Create React App
  - **Leaflet & React-Leaflet**: Default canvas-based raster tile renderer
  - **MapLibre GL**: WebGL renderer for direct in-browser Cloud-Optimized GeoTIFF (COG) decoding
  - **Geoman Free**: Drawing and polygon analysis tools for custom AOIs
- **Backend & APIs**:
  - **Node.js + Express** (`index.js`): Local development API server and production static bundle host
  - **Vercel Serverless Functions** (`api/`):
    - `api/auth.js`: User registration, email verification, passwordless login, and JWT sessions
    - `api/admin.js`: Administrative dashboard APIs, user management, and platform telemetry
    - `api/reports.js`: Issue and bug report submissions with attached map context
    - `api/chat.js`: AI agent streaming and Groq API proxy
- **Database & Storage**:
  - **MongoDB Atlas**: User profiles, roles, AI query logs, and bug reports. Features environment-aware database routing:
    - `foresttrace`: Production database
    - `foresttrace_preview`: Vercel preview / PR deployment database
    - `foresttrace_dev`: Local development database
  - **Vercel Pro Storage (Vercel Blob)**: Production host for Cloud-Optimized GeoTIFFs (COGs) and availability manifests
  - **Cloudflare R2**: Public CDN for raster tile pyramids and geospatial data assets
- **Email Delivery**:
  - **Resend**: Transactional email delivery for 6-digit verification codes (with automatic dev console fallback when testing locally without an API key)

---

## Repository Structure

```
foresttrace-app/
├── client/                          # React front-end application
│   ├── public/
│   │   ├── tiles/                   # Local tiles for development (gitignored)
│   │   └── data/                    # Precomputed area statistics & FMU boundaries
│   └── src/
│       ├── App.js                   # Application root & central MODULES registry
│       ├── config.js                # Routing for tiles, data, and COG base URLs
│       ├── context/                 # AuthContext (user state, login, roles)
│       ├── components/              # Map, navigation, modals, and admin dashboard
│       │   ├── TopMenu.jsx          # Contextual header (landing anchor vs. app nav)
│       │   ├── LandingPage.jsx      # Interactive landing page with section anchors
│       │   ├── AdminDashboard.jsx   # Admin management modal & metrics
│       │   ├── AuthModal.jsx        # Login, code verification, and admin bootstrap
│       │   ├── UserChatHistoryModal.jsx # Saved AI conversations modal
│       │   └── BugReportModal.jsx   # Context-aware issue reporter
│       ├── modules/                 # Analysis modules (Clearcut, Biomass, Wildfire, Caribou)
│       ├── pages/                   # Information & documentation pages
│       └── styles/                  # Clean CSS modules (map, layout, auth, admin)
├── api/                             # Serverless backend functions
│   ├── _db.js                       # MongoDB connection pooling & database routing
│   ├── _mailer.js                   # Resend email handler with dev console fallback
│   ├── auth.js                      # Authentication, registration & verification
│   ├── admin.js                     # Admin dashboard endpoints & user role updates
│   ├── reports.js                   # Bug and issue reporting
│   └── chat.js                      # Forestry AI Assistant Groq proxy
├── index.js                         # Express server for local backend & production serving
├── .env.example                     # Root environment variables template
├── client/.env.example              # Client environment variables template
└── CONTRIBUTING.md                  # Comprehensive developer guide & pipeline docs
```

---

## Getting Started

### 1) Prerequisites

- Node.js (v18 or higher recommended)
- npm
- (Optional) MongoDB Atlas URI for user authentication and chat history

### 2) Install Dependencies

From the repository root:

```bash
# Install root backend dependencies
npm install

# Install client dependencies
cd client
npm install
cd ..
```

### 3) Configure Environment Variables

Create your local `.env` files using the provided templates:

1. **Root `.env`** (for server and API):
   ```bash
   cp .env.example .env
   ```
   Configure the following key variables:
   ```ini
   APP_MODE=development
   GROQ_API_KEY=your_groq_api_key_here
   MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net
   MONGODB_DB_NAME=foresttrace_dev
   # Optional: RESEND_API_KEY=re_... (If omitted, verification codes print in terminal)
   ```

2. **Client `.env`** (`client/.env`):
   ```bash
   cp client/.env.example client/.env
   ```
   Add your Google Maps API key (used for place search):
   ```ini
   REACT_APP_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
   REACT_APP_USE_MAPLIBRE=true
   REACT_APP_USE_COG_CLEARCUT=true
   ```

### 4) Run the Application

To run both the Express backend API (port 3001) and the React development server (port 3000) simultaneously:

```bash
npm run dev
```

- Open `http://localhost:3000` in your browser.
- API requests under `/api/*` are automatically proxied to `http://localhost:3001`.

Alternatively, you can run services independently:
- `npm run server` — Runs only the Express backend server on port 3001.
- `npm run client` — Runs only the React frontend on port 3000.

### 5) First-Run Admin Setup

When launching ForestTrace against a fresh database (or when `foresttrace_dev` has no registered users), the app detects an uninitialized state:
1. The top navigation displays **Setup Admin**.
2. Click **Setup Admin** to create the initial administrator account (name, email, password).
3. Once created, you are automatically logged in with full administrative privileges to access the **Admin Dashboard**.

---

## Managing Background Processes (Windows)

If you ever need to stop background Node or dev server processes running on ports 3000 or 3001:

- **PowerShell**:
  ```powershell
  Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
  ```
- **Command Prompt**:
  ```cmd
  taskkill /F /IM node.exe
  ```

---

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)** license.

- Full license text: https://creativecommons.org/licenses/by-nc/4.0/legalcode
- Local license file: `LICENSE`

### Summary
- You may share and adapt the material.
- You must provide attribution to the Remote Sensing Lab at Saint Louis University.
- Commercial use is not permitted without additional permission.

For permissions beyond this license (including commercial partnerships), contact the Remote Sensing Lab at Saint Louis University (`vasit.sagan@slu.edu`).