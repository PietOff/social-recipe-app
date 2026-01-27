# Social Recipe Extractor

App converts TikTok/Instagram cooking videos into structured recipes.

## Structure

- `frontend/`: Next.js (React) application.
- `backend/`: FastAPI (Python) application + yt-dlp + OpenAI.

## prereqs

- Node.js (v18+)
- Python (v3.9+)
- OpenAI API Key

## Setup & Run

### Backend

1. `chmod +x setup_backend.sh && ./setup_backend.sh`
2. Create `backend/.env` with `OPENAI_API_KEY=sk-...`
3. Start server:

   ```bash
   cd backend
   source venv/bin/activate
   uvicorn main:app --reload
   ```

### Frontend

1. `cd frontend`
2. `npm install` (should be done by init)
3. `npm run dev`
4. Open <http://localhost:3000>
