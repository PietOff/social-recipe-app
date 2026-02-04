import os
import json
import logging
import typing_extensions
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response
from pydantic import BaseModel
import yt_dlp
import requests
import re
from groq import Groq
from dotenv import load_dotenv
import tempfile
from pathlib import Path
import base64
import subprocess
import jwt
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

# Load env vars
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Social Recipe Extractor")

# Configure CORS - allow all Vercel preview URLs
origins = [
    "http://localhost:3000",
    "https://social-recipe-app.vercel.app",
    "https://social-recipe-app-pietoffs-projects.vercel.app",
    "https://social-recipe-app-git-main-pietoffs-projects.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger.info(f"CORS configured for origins: {origins}")

# --- Models ---

class ExtractRequest(BaseModel):
    url: str
    gemini_api_key: Optional[str] = None
    api_key: Optional[str] = None

class Ingredient(typing_extensions.TypedDict):
    item: str
    amount: Optional[str]
    unit: Optional[str]
    group: Optional[str] # New field: e.g. "Sauce", "Marinade"

class Recipe(typing_extensions.TypedDict):
    title: str
    description: str
    ingredients: List[Ingredient]
    instructions: List[str]
    prep_time: Optional[str]
    cook_time: Optional[str]
    servings: Optional[str]
    image_url: Optional[str]
    tags: List[str]  # Replaces 'category', stores ["Lunch", "Sandwich", etc.]

# --- Functions ---






def resolve_redirects(url: str) -> str:
    """
    Expands short URLs (like vm.tiktok.com) to their full canonical form.
    This helps yt-dlp which sometimes struggles with short link redirects.
    """
    try:
        # TikTok specific: they often block HEAD requests, so use GET with stream=True
        headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1"}
        resp = requests.get(url, headers=headers, allow_redirects=True, stream=True, timeout=5)
        return resp.url
    except Exception as e:
        logger.warning(f"URL resolution failed: {e}")
        return url

def get_video_data(url: str, extract_audio: bool = False):
    """
    Uses yt-dlp to extract metadata like title, description, and thumbnail.
    Optionally downloads audio for transcription.
    """
    # 0. Resolve Short URLs (Crucial for TikTok)
    url = resolve_redirects(url)
    logger.info(f"Processing URL: {url}")

    # 1. Base options for metadata
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'writesubtitles': True,
        'writeautomaticsub': True,
        'subtitleslangs': ['en', 'nl', 'auto'],
        # ANTI-BOT MEASURES:
        'extractor_args': {'youtube': {'player_client': ['android', 'ios']}},
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }
    
    # 2. Add audio extraction options if requested
    temp_dir = tempfile.gettempdir()
    # Ensure subtitles have a predictable filename pattern
    ydl_opts['outtmpl'] = f'{temp_dir}/%(id)s.%(ext)s'
    
    audio_path = None
    
    if extract_audio:
        ydl_opts.update({
            'skip_download': False,
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    
    # 3. Execute yt-dlp
    info = {}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=extract_audio)
        except Exception as e:
            # FALLBACK: Catch ALL errors (bot detection, generic failures, etc.) and try generic scraping
            logger.warning(f"yt-dlp failed (Error: {str(e)}). Attempting direct HTML scraping...")
            
            # Request purely for HTML metadata
            import requests
            import re
            
            try:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                    "Accept-Language": "en-US,en;q=0.9",
                }
                # Check for cookies (optional logic kept simple)
                
                resp = requests.get(url, headers=headers, timeout=10)
                if resp.status_code != 200:
                        raise Exception(f"HTML request failed: {resp.status_code}")
                        
                html = resp.text
                title = "Unknown Recipe"
                description = "No description available"
                thumbnail = ""
                
                # --- Generic Scraping ---
                # 1. Title
                og_title = re.search(r'<meta property="og:title" content="([\s\S]*?)">', html)
                title_tag = re.search(r'<title>([\s\S]*?)</title>', html)
                if og_title:
                    title = og_title.group(1)
                elif title_tag:
                    title = title_tag.group(1)
                
                # 2. Description
                og_desc = re.search(r'<meta property="og:description" content="([\s\S]*?)">', html)
                name_desc = re.search(r'<meta name="description" content="([\s\S]*?)">', html)
                if og_desc:
                    description = og_desc.group(1)
                elif name_desc:
                    description = name_desc.group(1)
                
                # 2b. TikTok SPECIFIC
                if "tiktok.com" in url:
                    try:
                        next_data = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
                        if next_data:
                            tiktok_data = json.loads(next_data.group(1))
                            item_info = tiktok_data.get('props', {}).get('pageProps', {}).get('itemInfo', {}).get('itemStruct', {})
                            if item_info:
                                tiktok_desc = item_info.get('desc', '')
                                if tiktok_desc:
                                    description = tiktok_desc
                                # Also get thumbnail
                                if 'video' in item_info:
                                    thumbnail = item_info['video'].get('cover', thumbnail)
                    except Exception as e_tt:
                        logger.warning(f"TikTok JSON parsing failed: {e_tt}")
                
                # 3. Thumbnail
                if not thumbnail:
                    img_match = re.search(r'<meta property="og:image" content="([\s\S]*?)">', html)
                    if img_match:
                        thumbnail = img_match.group(1)
                
                info = {
                    'title': title,
                    'description': description,
                    'thumbnail': thumbnail,
                    'id': 'unknown'
                }
                
            except Exception as e4:
                # If generic scrape failed, we really are stuck.
                logger.error(f"HTML scraping failed: {e4}")
                raise HTTPException(status_code=400, detail=f"Could not fetch video data. Platform may be blocking requests. Error: {str(e4)}")

        try:
            if not info:
                 raise Exception("No video information could be extracted (info dict empty).")
            
            description = info.get('description', '')
            title = info.get('title', '')
            thumbnail = info.get('thumbnail', '')
            video_id = info.get('id')
            
            # Check for audio file if we asked for it AND download succeeded (and not flat extraction)
            if extract_audio and not ydl_opts.get('skip_download') and not ydl_opts.get('extract_flat'):
                # yt-dlp with postprocessor usually appends .mp3
                potential_path = Path(f'{temp_dir}/{video_id}.mp3')
                if potential_path.exists():
                    audio_path = str(potential_path)

            # 4. Look for and read Subtitles (.vtt files)
            combined_text = f"Title: {title}\nDescription: {description}"
            
            # Pattern match for any subtitle file for this video ID
            subtitle_content = ""
            for file_path in Path(temp_dir).glob(f"{video_id}*.vtt"):
                try:
                    with open(file_path, "r", encoding="utf-8") as f:
                        subtitle_content += f.read() + "\n"
                    # Cleanup subtitle file
                    os.remove(file_path)
                except Exception as e:
                    logger.warning(f"Could not read subtitle file {file_path}: {e}")
            
            if subtitle_content:
                combined_text += f"\n\n[SUBTITLES/CAPTIONS]:\n{subtitle_content}"

            return combined_text, thumbnail, audio_path
        except Exception as e:
            logger.error(f"yt-dlp processing error: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Could not process video data: {str(e)}")

def transcribe_audio(audio_path: str, api_key: str):
    """
    Uses Groq Whisper to transcribe audio file.
    """
    if not audio_path:
        return ""
        
    try:
        client = Groq(api_key=api_key)
        # Open the file in binary mode
        with open(audio_path, "rb") as file:
            transcription = client.audio.transcriptions.create(
                file=(os.path.basename(audio_path), file),
                model="whisper-large-v3",
                response_format="text"
            )
        return transcription
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        # Fail silently for transcription so we at least try with just text
        return ""
    finally:
        # Cleanup temp file
        try:
            if os.path.exists(audio_path):
                os.remove(audio_path)
        except:
            pass

def parse_with_llm(text_data: str, api_key: str):
    """
    Uses Groq (Llama 3) to parse the raw text into a structured Recipe.
    """
    try:
        client = Groq(api_key=api_key)
        
        prompt = f"""
        You are an expert chef and data parser. I will give you text (and possibly audio transcript) extracted from a social media cooking video (TikTok/Instagram/YouTube). 
        Your goal is to extract a structured recipe from it.
        
        CRITICAL RULES:
        1. Convert WEIGHT/VOLUME to METRIC (ml, l, g, kg). Do NOT use cups, oz, lbs.
           HOWEVER: Keep natural counts for discrete items (e.g. "3 cloves garlic", "2 onions", "1 pinch"). Do NOT convert these to grams (e.g. NEVER say "3g garlic").
        2. Analyze the recipe and assign multiple TAGS from these lists:
           - MEAL TYPES: "Breakfast", "Brunch", "Lunch", "Dinner", "Snack", "Dessert", "Appetizer", "Drink".
           - DISH TYPES: "Airfryer", "BBQ", "Slow Cooker", "Pasta", "Pizza", "Burger", "Sandwich", "Wrap", "Tacos", "Salad", "Bowl", "Soup", "Stew", "Curry", "Rice", "Meat", "Fish", "Chicken", "Vegetarian", "Vegan", "Low-Carb", "High-Protein", "Smoothie", "Cocktail", "Sauce", "Side".
           - Add other relevant tags (e.g. "Healthy", "Quick", "Traditional") if appropriate.
        3. If ingredient AMOUNTS are missing in the text, USE YOUR CULINARY KNOWLEDGE to estimate reasonable metric amounts (e.g. "200g" for pasta for 2 people). NEVER return empty strings for amount/unit if you can infer them.
        4. Group ingredients by component if applicable (e.g., "Sauce", "Dressing", "Main"). If no distinct groups, use "Main".
        5. INSTRUCTIONS: Be detailed and descriptive. Do not summarize. Capture all small steps mentioned, even implied ones. We want a full cooking guide.
        
        Return ONLY valid JSON matching this schema:
        {{
            "title": "string",
            "description": "string",
            "ingredients": [{{"item": "string", "amount": "string", "unit": "string (metric)", "group": "string"}}],
            "instructions": ["string (detailed step 1)", "string (detailed step 2)"],
            "prep_time": "string (e.g. 15 mins)",
            "cook_time": "string (e.g. 1 hour)",
            "servings": "string (e.g. 4 people)",
            "tags": ["string", "string"],
            "image_url": null
        }}

        If the text contains no recipe, return empty strings in JSON but explain in description.
        ALWAYS translate the entire recipe (title, ingredients, instructions) into English, regardless of the input language.
        
        Raw Text:
        {text_data}
        """
        
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile", 
            messages=[
                {"role": "system", "content": "You are a JSON-only API. You must return a valid JSON object and nothing else."},
                {"role": "user", "content": prompt}
            ],
            temperature=0,
            response_format={"type": "json_object"}
        )
        
        content = completion.choices[0].message.content
        return json.loads(content)
    except Exception as e:
        logger.error(f"Groq error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI parsing failed: {str(e)}")

# --- Endpoints ---

def extract_direct_video_url(url: str, html: str) -> Optional[str]:
    """
    Attempts to find a direct .mp4 URL from the HTML/JSON of TikTok/Instagram.
    """
    # SKIP YouTube: We use Invidious/yt-dlp for that. Direct parsing is harder and often blocked.
    if "youtube.com" in url or "youtu.be" in url:
        return None

    try:
        # 1. Instagram / Generic OG
        og_video = re.search(r'<meta property="og:video" content="(.*?)"', html)
        if og_video:
            return og_video.group(1)
            
        # 3. TikTok / Generic JSON Regex Scan
        # Strategy: Look for specific keys like "playAddr", "videoUrl", "contentUrl"
        # and extract the value, then decode unicode escapes.
        
        patterns = [
            r'"playAddr":"(https?://[^"]+)"',       # Common TikTok
            r'"video":\{[^}]*"url":"(https?://[^"]+)"', # Some variations
            r'"contentUrl":"(https?://[^"]+)"',     # Schema.org
            r'"downloadAddr":"(https?://[^"]+)"',   # TikTok download
            r'"Url":"(https?://[^"]+)"',            # Generic
            r'(https?://[^"\\\\]*tiktokcdn[^"\\\\]*?\.mp4[^"\\\\]*)', # Broad scan for TikTok CDN
            r'(https?://[^"\\\\]*?\.mp4[^"\\\\]*)'  # ANY .mp4 URL (Last resort)
        ]
        
        for pattern in patterns:
            match = re.search(pattern, html)
            if match:
                raw_url = match.group(1)
                # Decode unicode escapes (e.g. \u002F -> /)
                # And HTML entities if any
                clean_url = raw_url.encode('utf-8').decode('unicode_escape')
                clean_url = clean_url.replace(r'\/', '/')
                
                # Check extension or domain to be sure
                # Filter out small assets or weird matches
                if (".mp4" in clean_url) and ("tiktokcdn" in clean_url or "fbcdn" in clean_url or "cdn" in clean_url):
                     return clean_url

        return None
    except Exception as e:
        logger.warning(f"Direct URL extraction failed: {e}")
        return None

def extract_frames(video_path: str, num_frames: int = 4) -> List[str]:
    """
    Extracts key frames from video using FFmpeg and converts to base64.
    """
    import subprocess
    frames = []
    try:
        # Get duration
        result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", video_path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        duration = float(result.stdout)
        
        timestamps = [duration * (i + 1) / (num_frames + 1) for i in range(num_frames)]
        
        for ts in timestamps:
            # Extract frame to memory (pipe)
            cmd = [
                "ffmpeg", "-ss", str(ts), "-i", video_path,
                "-frames:v", "1", "-f", "image2", "-c:v", "mjpeg", "-"
            ]
            process = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if process.returncode == 0:
                frames.append(base64.b64encode(process.stdout).decode('utf-8'))
                
    except Exception as e:
        logger.warning(f"Frame extraction failed: {e}")
        
    return frames

def analyze_visuals_with_groq(frames: List[str], api_key: str) -> str:
    """
    Sends video frames to Groq's Llama Vision model to read on-screen text and actions.
    """
    if not frames:
        return ""
        
    try:
        client = Groq(api_key=api_key)
        
        # Prepare content: Text prompt + Images
        content = [
            {"type": "text", "text": "These are frames from a cooking video. Describe strictly what you see: ingredients shown, amounts visible in text overlays, and cooking actions. Do not hallucinate."}
        ]
        
        for b64 in frames:
            content.append({
                "type": "image_url",
                "image_url": {
                     "url": f"data:image/jpeg;base64,{b64}"
                }
            })

        completion = client.chat.completions.create(
            model="llama-3.2-11b-vision-preview",
            messages=[
                {
                    "role": "user",
                    "content": content
                }
            ],
            temperature=0,
            max_tokens=1024,
        )
        return "\n\n[VISUAL ANALYSIS]:\n" + completion.choices[0].message.content
        
    except Exception as e:
        logger.warning(f"Groq Vision analysis failed: {e}")
        return ""

# --- Endpoints ---

@app.post("/extract-recipe")
def extract_recipe(request: ExtractRequest):
    # Support multiple env var names/locations
    api_key = request.api_key or request.gemini_api_key or os.getenv("GROQ_API_KEY")
    
    if not api_key:
        raise HTTPException(status_code=401, detail="API Key is required (GROQ_API_KEY)")

    # 1. Extract raw data
    raw_text, thumbnail_url, audio_path = get_video_data(request.url, extract_audio=True)
    
    # 2. Transcribe Audio (if found via yt-dlp)
    if audio_path:
        logger.info(f"Transcribing audio from {audio_path}...")
        transcript = transcribe_audio(audio_path, api_key)
        if transcript:
            raw_text += f"\n\n[AUDIO TRANSCRIPT]:\n{transcript}"
            
    # 3. Vision Fallback: If text is short, try to download and SEE the video
    # Check if raw_text is just "Unknown Recipe\nNo description available" or a generic platform title
    is_thin_content = (
        len(raw_text) < 150 or 
        "No description" in raw_text or
        "TikTok" in raw_text[:30] or
        "Instagram" in raw_text[:30] or
        "Make Your Day" in raw_text
    )
    if is_thin_content:
        logger.info("Description thin. Attempting Vision Analysis...")
        # We need the HTML to find direct URL manually if yt-dlp failed to give us a file
        # But get_video_data consumes the attempts.
        # Let's try to find a direct video URL using our new helper if we don't have enough data
        # Note: We don't have the HTML here easily unless we refactor get_video_data to return it or we fetch again.
        # Fetching HTML again is cheap.
        try:
             import requests
             headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1"}
             html_resp = requests.get(request.url, headers=headers, timeout=10)
             if html_resp.status_code == 200:
                 direct_url = extract_direct_video_url(request.url, html_resp.text)
                 if direct_url:
                     logger.info(f"Found direct video URL: {direct_url[:50]}...")
                     # Download temp
                     temp_vid_path = f"{tempfile.gettempdir()}/temp_vision_vid.mp4"
                     vid_resp = requests.get(direct_url, stream=True)
                     with open(temp_vid_path, 'wb') as f:
                         for chunk in vid_resp.iter_content(chunk_size=8192):
                             f.write(chunk)
                     
                     # Extract Audio for Whisper (if yt-dlp failed to get it)
                     if not audio_path:
                         # Use ffmpeg to extract audio from this temp file
                         import subprocess
                         temp_audio_path = f"{tempfile.gettempdir()}/temp_vision_audio.mp3"
                         subprocess.run(["ffmpeg", "-i", temp_vid_path, "-vn", "-acodec", "libmp3lame", "-y", temp_audio_path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                         transcript = transcribe_audio(temp_audio_path, api_key)
                         if transcript:
                             raw_text += f"\n\n[AUDIO TRANSCRIPT FROM DIRECT DL]:\n{transcript}"

                     # Extract Frames for Vision
                     frames = extract_frames(temp_vid_path)
                     visual_desc = analyze_visuals_with_groq(frames, api_key)
                     if visual_desc:
                         raw_text += visual_desc
                         
        except Exception as e_vision:
            logger.warning(f"Vision fallback failed: {e_vision}")

    # 4. Parse with LLM (Llama 3)
    recipe_data = parse_with_llm(raw_text, api_key)
    
    # 5. Inject thumb
    recipe_data['image_url'] = thumbnail_url
    
    return recipe_data

@app.get("/")
def health_check():
    return {"status": "ok", "service": "Social Recipe Extractor (Groq+Whisper)"}


# ============================================================
# AUTHENTICATION & USER ENDPOINTS
# ============================================================

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")

# Pydantic models for auth
class GoogleAuthRequest(BaseModel):
    credential: str  # Google ID token

class UserResponse(BaseModel):
    id: str
    email: str
    name: Optional[str]
    avatar_url: Optional[str]
    token: str  # JWT for subsequent requests

# Pydantic models for recipes
class RecipeInput(BaseModel):
    title: str
    description: Optional[str] = ""
    ingredients: Optional[List[dict]] = []
    instructions: Optional[List[str]] = []
    tags: Optional[List[str]] = []
    image_url: Optional[str] = None
    prep_time: Optional[str] = None
    cook_time: Optional[str] = None
    servings: Optional[str] = None

class RecipeResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    ingredients: Optional[List[dict]]
    instructions: Optional[List[str]]
    tags: Optional[List[str]]
    image_url: Optional[str]
    prep_time: Optional[str]
    cook_time: Optional[str]
    servings: Optional[str]


def get_supabase_client():
    """Lazy import to avoid errors if Supabase isn't configured."""
    try:
        from supabase_client import get_supabase
        return get_supabase()
    except Exception as e:
        logger.warning(f"Supabase not configured: {e}")
        return None


def verify_jwt(authorization: str = Header(None)) -> dict:
    """Verify JWT token and return user data."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
    
    token = authorization.replace("Bearer ", "")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


@app.options("/auth/google")
@app.options("/user/recipes")
@app.options("/user/recipes/{recipe_id}")
@app.options("/recipes")
@app.options("/recipes/{recipe_id}")
async def cors_preflight(request: Request):
    """Handle CORS preflight for auth endpoints."""
    origin = request.headers.get("origin", "")
    # Log the preflight request for debugging
    logger.info(f"CORS preflight request from origin: {origin}")
    # Check if origin is in our allowed list
    allowed_origin = origin if origin in origins else origins[0]
    logger.info(f"CORS preflight response: allowing origin {allowed_origin}")
    return Response(
        content="OK",
        status_code=200,
        media_type="text/plain",
        headers={
            "Access-Control-Allow-Origin": allowed_origin,
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Max-Age": "86400",
        }
    )


@app.post("/auth/google", response_model=UserResponse)
async def google_auth(request: GoogleAuthRequest):
    """
    Verify Google ID token and create/get user.
    Returns a JWT for subsequent authenticated requests.
    """
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not configured")
    
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google OAuth not configured")
    
    try:
        # Verify the Google ID token
        idinfo = id_token.verify_oauth2_token(
            request.credential,
            google_requests.Request(),
            GOOGLE_CLIENT_ID
        )
        
        google_id = idinfo['sub']
        email = idinfo.get('email', '')
        name = idinfo.get('name', '')
        avatar_url = idinfo.get('picture', '')
        
        # Check if user exists
        result = supabase.table("users").select("*").eq("google_id", google_id).execute()
        
        if result.data:
            user = result.data[0]
        else:
            # Create new user
            new_user = {
                "google_id": google_id,
                "email": email,
                "name": name,
                "avatar_url": avatar_url
            }
            insert_result = supabase.table("users").insert(new_user).execute()
            user = insert_result.data[0]
        
        # Generate JWT
        token_payload = {
            "user_id": user["id"],
            "email": user["email"],
            "exp": int((datetime.now() + timedelta(days=30)).timestamp())
        }
        token = jwt.encode(token_payload, JWT_SECRET, algorithm="HS256")
        
        return UserResponse(
            id=user["id"],
            email=user["email"],
            name=user.get("name"),
            avatar_url=user.get("avatar_url"),
            token=token
        )
        
    except ValueError as e:
        logger.error(f"Invalid Google token: {e}")
        raise HTTPException(status_code=401, detail="Invalid Google token")


@app.get("/recipes")
async def list_recipes(user: dict = Depends(verify_jwt)):
    """Get all recipes for the authenticated user."""
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not configured")
    
    result = supabase.table("recipes").select("*").eq("user_id", user["user_id"]).order("created_at", desc=True).execute()
    return result.data


@app.post("/recipes")
async def save_recipe(recipe: RecipeInput, user: dict = Depends(verify_jwt)):
    """Save a recipe for the authenticated user."""
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not configured")
    
    recipe_data = {
        "user_id": user["user_id"],
        "title": recipe.title,
        "description": recipe.description,
        "ingredients": recipe.ingredients,
        "instructions": recipe.instructions,
        "tags": recipe.tags,
        "image_url": recipe.image_url,
        "prep_time": recipe.prep_time,
        "cook_time": recipe.cook_time,
        "servings": recipe.servings
    }
    
    result = supabase.table("recipes").insert(recipe_data).execute()
    return result.data[0] if result.data else None


@app.delete("/recipes/{recipe_id}")
async def delete_recipe(recipe_id: str, user: dict = Depends(verify_jwt)):
    """Delete a recipe (only if owned by user)."""
    supabase = get_supabase_client()
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not configured")
    
    # Verify ownership and delete
    result = supabase.table("recipes").delete().eq("id", recipe_id).eq("user_id", user["user_id"]).execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Recipe not found or not owned by user")
    
    return {"deleted": True, "id": recipe_id}


# Import datetime for JWT expiration
from datetime import datetime, timedelta
