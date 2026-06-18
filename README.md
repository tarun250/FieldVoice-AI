# FieldVoice AI: Voice-First AI Assistant for Field Workers

FieldVoice AI is a voice-first assistant designed specifically for field technicians and supervisors in industrial environments. It enables hands-free equipment inspections, voice-controlled work order logging, natural language corrections, and Retrieval-Augmented Generation (RAG) queries for equipment specifications/manuals. 

It consists of three major components:
1. **Express.js Backend API Monolith**: Handles speech processing, structured AI extraction, vector searches (FAISS), database persistence, and API key failover/rotation.
2. **Next.js Web Frontend**: A supervisor administration and monitoring dashboard for real-time order auditing, exception handling, and raw audio playbacks.
3. **Flutter Mobile Application**: A ruggedized technician client supporting hands-free background listening, audio cues, speech-to-text, text-to-speech, and offline database queueing.

---

## 🚀 Key Features

*   **Hands-Free / PTT Voice Capture**: Technicians can complete inspections, report faults, and query history entirely by voice using a headset button or voice activation.
*   **Structured Data Extraction**: Free-form technician voice notes are parsed by LLMs into a validated JSON schema (Equipment ID, Fault Code, Severity, Actions, Parts).
*   **Speech Key Rotation & Failover**: Automatic rotation and failover between `GROQ_API_KEY` and `GROQ_API_KEY_2` to mitigate text-to-speech token per day (TPD) rate limits.
*   **Smart TTS Caching**: MD5 hashing and caching of static template prompts (e.g., "inspection started") to conserve API limits.
*   **Interactive Voice Confirmation Loop**: Read back details of parsed reports, letting workers confirm, cancel, or state natural language modifications (e.g., *"change severity to critical"*) without touching the screen.
*   **Offline Mode & Queueing**: Saves compressed audio and metadata locally when connectivity is lost and automatically synchronizes sequentially upon reconnection.
*   **Knowledge Manual Querying (RAG)**: Retrieval-augmented answers from PDFs and manuals read back aloud.
*   **Supervisor Admin Portal**: A real-time monitoring console to stream technician actions, inspect audio logs, and review or override low-confidence parse exceptions.

---

## 🏗️ System Architecture

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                    1. CLIENT TIER                                     │
│                                                                                       │
│   [Microphone Input]                                                                  │
│           │                                                                           │
│           ▼                                                                           │
│   [Audio Capture Module] ───(Opus Encoding)───► [Network Check]                       │
│                                                       │                               │
│                                          ┌────────────┴────────────┐                  │
│                                        Online                   Offline               │
│                                          │                         │                  │
│                                          ▼                         ▼                  │
│   [Supervisor Dashboard] ◄───(WS)────┐ [API Client] ◄───(Sync)─── [Local DB]          │
└──────────▲───────────────────────────┼──────────┬──────────────────────────────────────┘
           │                           │          │
           │ (WebSockets)              │ (REST)   │ (REST)
           │                           │          │
┌──────────┴───────────────────────────┼──────────▼──────────────────────────────────────┐
│                                      │ 2. APPLICATION TIER                             │
│                                      │                                                 │
│   [Socket.io Manager] ───────────────┘       [Audio Ingestion Module]                  │
│                                                         │                             │
│                                      ┌──────────────────┼──────────────────┐          │
│                                      │                  │                  │          │
│                                      ▼                  ▼                  ▼          │
│                               [Whisper STT]        [FAISS RAG]      [LLM Extractor]   │
│                                (Groq API)       (Vector Searcher)  (OpenRouter/Groq)  │
└─────────────────────────────────────────────────────────┬──────────────────┬──────────┘
                                                          │                  │
                                                          ▼                  ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                    3. DATA TIER                                       │
│                                                                                       │
│                             [PostgreSQL Database + pgvector]                          │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Flow Table

| Component | Responsibility / Input | Technology | Target / Output |
| :--- | :--- | :--- | :--- |
| **Audio Capture** | Audio capture & Opus encoding | Web Audio API / Flutter Record | Compressed audio stream |
| **Sync Manager** | Offline queueing & auto-sync | SQLite / IndexedDB | Chronological upload to server |
| **API Backend** | Handles audio parsing & routing | Express.js / Node.js | Invokes AI orchestration |
| **STT Gateway** | Audio transcription | Groq Whisper API | High-accuracy transcription |
| **RAG Vector Search**| Similarity indexing & retrieval | FAISS Vector Store / pgvector | Contextual manual specifications |
| **LLM Extractor** | Structured data extraction | Groq & OpenRouter | Validated JSON Work Order |
| **Live Broadcast** | Socket streaming to dashboard | Socket.io / WebSockets | Real-time supervisor updates |

---

## 📂 Repository Structure

```
fieldvoice-ai/
├── backend/                       # Express.js Backend Application
│   ├── src/                       # Application Source Files
│   │   ├── config/                # Service clients & environment setup
│   │   │   ├── db.js              # PostgreSQL client connection pool
│   │   │   ├── groq.js            # Groq API client config (Whisper STT)
│   │   │   └── openrouter.js      # OpenRouter API client config (LLM)
│   │   ├── controllers/           # API Controller logic handlers
│   │   │   ├── audioController.js # Handles uploads, transcribes, and extracts
│   │   │   ├── orderController.js # Handles manual CRUD and updates
│   │   │   └── queryController.js # Handles vector search and Q&A answers
│   │   ├── db/                    # PostgreSQL Migrations & Seeding
│   │   │   ├── migrations/        # SQL schema migration files
│   │   │   └── seeds/             # Starter data (mock assets, manuals)
│   │   ├── models/                # Database Model Queries
│   │   │   ├── Equipment.js       # Queries for asset tags and metadata
│   │   │   ├── WorkOrder.js       # Queries for creating/updating orders
│   │   │   └── Worker.js          # Queries for technician directories
│   │   ├── routes/                # Express API Route definitions
│   │   │   ├── api.js             # Root API router
│   │   │   ├── audio.js           # Voice upload and sync paths
│   │   │   └── orders.js          # Work order management paths
│   │   ├── services/              # Core Domain Services
│   │   │   ├── faissService.js    # FAISS-Node search and indexing service
│   │   │   ├── llmService.js      # OpenAI prompt parser using OpenRouter
│   │   │   ├── ttsService.js      # CanopyLabs Orpheus TTS with Failover Rotation
│   │   │   └── syncService.js     # Batch queue database sync logic
│   │   ├── index.js               # Express application entry point
│   │   └── sockets.js             # Socket.io connection coordinator
│   ├── vector_store/              # FAISS Binary Index storage folder
│   │   ├── manuals.index          # Binary FAISS vector indices
│   │   └── metadata.json          # Key-value maps for manual text chunks
│   ├── package.json               # Backend dependencies
│   └── .env.example               # Backend environment variables
│
├── frontend/                      # Next.js Client Application
│   ├── public/                    # Static Assets (audio chimes, icons)
│   ├── src/                       # Client Source Files
│   │   ├── app/                   # Next.js App Router View paths
│   │   │   ├── layout.js          # Global layout wrapper
│   │   │   ├── page.js            # Supervisor real-time Dashboard route page
│   │   ├── components/            # Reusable React UI Components
│   │   ├── hooks/                 # Client Hooks (Voice & Network logic)
│   │   ├── utils/                 # Client-side utility functions
│   │   ├── package.json           # Frontend dependencies
│   │   └── .env.example           # Frontend environment variables
│
├── mobile/                        # Flutter Mobile Application
│   ├── lib/                       # Flutter Source Code
│   │   ├── screens/               # Screen widgets (home_screen.dart)
│   │   ├── services/              # APIs, Audio services, and Bluetooth
│   │   └── main.dart              # App bootstrap entrypoint
│   ├── pubspec.yaml               # Flutter package configuration
│   └── README.md                  # Mobile project starting guide
│
├── render.yaml                    # Render.com Cloud Deployment template
├── README.md                      # Monorepo root README
└── package.json                   # Monorepo workspace root configuration
```

---

## 🛠️ Setup & Installation

### Prerequisites
*   [Node.js](https://nodejs.org/) (v18 or higher)
*   [Flutter SDK](https://docs.flutter.dev/get-started/install) (v3.19 or higher)
*   [PostgreSQL](https://www.postgresql.org/) (with `pgvector` extension installed)

---

### 1. Backend Setup

1.  Navigate to the backend directory:
    ```bash
    cd backend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Configure your environment variables:
    *   Copy `.env.example` to `.env`.
    *   Provide valid keys for the databases and external service APIs:
    ```ini
    PORT=3000
    GROQ_API_KEY=your_primary_groq_api_key
    GROQ_API_KEY_2=your_secondary_groq_api_key
    OPENROUTER_API_KEY=your_openrouter_api_key
    
    # PostgreSQL Configuration
    PGHOST=localhost
    PGPORT=5432
    PGUSER=your_pg_user
    PGPASSWORD=your_pg_password
    PGDATABASE=fieldvoice
    PGSSL=false
    ```
4.  Run SQL database migrations and seed databases:
    ```bash
    # (Assuming PG database is created)
    npm run db:migrate # If custom migration commands exist, otherwise load migrations.sql
    ```
5.  Start the development server:
    ```bash
    npm run dev
    ```
6.  Run backend unit & integration tests:
    ```bash
    npm run test
    ```

---

### 2. Frontend Setup

1.  Navigate to the frontend directory:
    ```bash
    cd ../frontend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Configure environment variables:
    *   Create a `.env.local` or edit `.env.example`:
    ```ini
    NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
    ```
4.  Start the Next.js development server:
    ```bash
    npm run dev
    ```
    *The supervisor dashboard will be available at `http://localhost:3001`.*

---

### 3. Mobile Setup (Flutter)

1.  Navigate to the mobile directory:
    ```bash
    cd ../mobile
    ```
2.  Install Flutter dependencies:
    ```bash
    flutter pub get
    ```
3.  Ensure a physical device or emulator is connected:
    ```bash
    flutter devices
    ```
4.  Run the application on your device:
    ```bash
    flutter run
    ```
5.  Compile a release or debug APK:
    ```bash
    flutter build apk --debug
    ```

---

## 🛠️ Groq TTS API Key Rotation & Caching Details

To prevent rate limiting (429 errors) on the CanopyLabs Orpheus TTS model (which has a strict 3,600 Tokens Per Day tier limit):
1.  **Failover Rotation**: The backend service tracks `GROQ_API_KEY` and `GROQ_API_KEY_2`. If any synthesis request fails, it immediately retries with the alternative key and persists that key choice for subsequent requests.
2.  **MD5 Cache Store**: Any static instruction templates (e.g., `"inspection started"`, `"report rejected"`) are hashed via MD5 and cached in the local filesystem (`backend/uploads/`). Dynamic variables (like reports containing serialized numbers) bypass caching to avoid disk clutter.

---

## 🧪 Testing

The backend includes a comprehensive suite of 50 integration and unit tests covering:
*   Structured Data Extraction logic (`extractionService`)
*   Speech-to-Text file boundary validation (`sttService`)
*   SSE connection lifecycle management (`sse`)
*   Work order lifecycle queries (`workOrderService`)
*   RAG QA similarity search fallbacks (`queryService`)

Run tests inside the `backend/` folder:
```bash
npm run test
```

---

## ☁️ Deployment

The project is structured to deploy smoothly on **Render** (via the root `render.yaml` configuration). It sets up the Node backend, configures required environment variables, and links dependencies automatically.
