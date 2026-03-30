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
import html
from dotenv import load_dotenv
import tempfile
from pathlib import Path
import base64
import subprocess
import jwt
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from datetime import datetime, timedelta

# Load env vars
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Social Recipe Extractor")

# Configure CORS - allow all Vercel preview URLs
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https://.*\.vercel\.app|http://localhost(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
        'subtitleslangs': ['en', 'nl', 'en-US', 'en-GB', 'auto'],
        'ignoreerrors': False,
        # Anti-bot: rotate user-agents, prefer mobile clients for TikTok/Instagram
        'extractor_args': {
            'youtube': {'player_client': ['android', 'ios', 'web']},
            'tiktok': {'webpage_download': True},
        },
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        'socket_timeout': 30,
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
            try:
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                    "Accept-Language": "en-US,en;q=0.9",
                }
                # Check for cookies (optional logic kept simple)
                
                resp = requests.get(url, headers=headers, timeout=10)
                if resp.status_code != 200:
                        raise Exception(f"HTML request failed: {resp.status_code}")
                        
                html_text = resp.text
                title = "Unknown Recipe"
                description = "No description available"
                thumbnail = ""
                
                # --- Generic Scraping ---
                # 1. Title
                og_title = re.search(r'<meta property="og:title" content="([^"]*)"', html_text)
                title_tag = re.search(r'<title>([\s\S]*?)</title>', html_text)
                if og_title:
                    title = html.unescape(og_title.group(1))
                elif title_tag:
                    title = html.unescape(title_tag.group(1))
                
                # 2. Description
                og_desc = re.search(r'<meta property="og:description" content="([^"]*)"', html_text)
                name_desc = re.search(r'<meta name="description" content="([^"]*)"', html_text)
                if og_desc:
                    description = html.unescape(og_desc.group(1))
                elif name_desc:
                    description = html.unescape(name_desc.group(1))
                
                # 2b. TikTok SPECIFIC
                if "tiktok.com" in url:
                    try:
                        next_data = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html_text)
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
                    img_match = re.search(r'<meta property="og:image" content="([^"]*)"', html_text)
                    if img_match:
                        thumbnail = html.unescape(img_match.group(1))
                
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
        You are an expert chef and data parser. Extract a structured recipe from the text below, which comes from a social media cooking video (TikTok/Instagram/YouTube). The text may include video titles, descriptions, captions, subtitles, and/or an audio transcript.

        RULES:
        1. METRIC units only for weight/volume (ml, l, g, kg). Keep natural counts for discrete items ("3 cloves garlic", "2 eggs"). Never convert countable items to grams.
        2. If amounts are missing, use your culinary knowledge to estimate sensible metric amounts. Never leave amount blank if you can infer it.
        3. Group ingredients by component when relevant (e.g. "Sauce", "Marinade", "Batter"). Default group is "Main".
        4. Instructions: be detailed and sequential. Expand on implied steps. Aim for a complete cooking guide a beginner could follow.
        5. Tags: assign ALL that apply from:
           - Meal: "Breakfast" "Brunch" "Lunch" "Dinner" "Snack" "Dessert" "Appetizer" "Drink"
           - Dish: "Airfryer" "BBQ" "Slow Cooker" "Pasta" "Pizza" "Burger" "Sandwich" "Wrap" "Tacos" "Salad" "Bowl" "Soup" "Stew" "Curry" "Rice" "Meat" "Fish" "Chicken" "Vegetarian" "Vegan" "Low-Carb" "High-Protein" "Smoothie" "Cocktail" "Sauce" "Side"
           - Extra: "Healthy" "Quick" "Spicy" "Traditional" "One-Pan" etc. if clearly applicable
        6. ALWAYS output everything in English, regardless of input language.
        7. If the text contains no recipe at all, still return the JSON schema with empty arrays and explain in description.

        Return ONLY a valid JSON object — no markdown, no explanation:
        {{
            "title": "string",
            "description": "string (2-3 sentences, appetising summary)",
            "ingredients": [{{"item": "string", "amount": "string", "unit": "string", "group": "string"}}],
            "instructions": ["string", "string"],
            "prep_time": "string (e.g. 10 mins)",
            "cook_time": "string (e.g. 25 mins)",
            "servings": "string (e.g. 2 people)",
            "tags": ["string"],
            "image_url": null
        }}

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

def is_thin_content(raw_text: str) -> bool:
    """Returns True if the extracted text is too sparse to reliably parse a recipe from."""
    return (
        len(raw_text) < 200 or
        "No description" in raw_text or
        raw_text.strip().startswith("Title: TikTok") or
        raw_text.strip().startswith("Title: Instagram") or
        "Make Your Day" in raw_text
    )


def is_collection_url(url: str) -> bool:
    """Detects if a URL points to a TikTok collection/playlist."""
    return bool(re.search(r'tiktok\.com/@[^/]+/collection/', url))


class ClassifyRequest(BaseModel):
    videos: List[dict]  # [{video_id, title}]
    api_key: Optional[str] = None


@app.post("/classify-recipes")
def classify_recipes(request: ClassifyRequest):
    """
    Takes a list of video titles and classifies each as a recipe/cooking video or not.
    Uses a single fast LLM call so it's cheap even for large collections.
    """
    if not request.videos:
        return {"results": []}

    api_key = request.api_key or os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=401, detail="API Key required")

    titles_list = "\n".join(
        f'{i + 1}. [id:{v.get("video_id", i)}] {v.get("title") or "(no title)"}'
        for i, v in enumerate(request.videos)
    )

    prompt = f"""Classify each TikTok video title below as a cooking/recipe video or not.
Recipe = anything involving food preparation, ingredients, cooking techniques, or meals.
Not a recipe = vlogs, challenges, reactions, day-in-my-life, hauls, travel, dance, etc.
If the title is missing or ambiguous, default to true.

Titles:
{titles_list}

Return ONLY this JSON object (one entry per video, same order):
{{"results": [{{"video_id": "string", "is_recipe": true}}]}}"""

    try:
        client = Groq(api_key=api_key)
        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",  # Fast cheap model — just classification
            messages=[
                {"role": "system", "content": "You are a JSON-only API. Return only valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        return json.loads(completion.choices[0].message.content)
    except Exception as e:
        logger.warning(f"Classification failed: {e} — defaulting all to is_recipe=true")
        # Fail gracefully: mark everything as a recipe so nothing gets silently dropped
        return {"results": [{"video_id": v.get("video_id", str(i)), "is_recipe": True} for i, v in enumerate(request.videos)]}


@app.post("/extract-collection")
def extract_collection(request: ExtractRequest):
    """
    Extracts all video URLs from a TikTok collection URL.
    Returns list of individual video URLs to be processed one by one.
    """
    resolved_url = resolve_redirects(request.url)
    logger.info(f"Extracting collection from: {resolved_url}")

    ydl_opts = {
        'extract_flat': True,
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        'extractor_args': {
            'tiktok': {'webpage_download': True},
        },
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(resolved_url, download=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read collection: {str(e)}")

    if not info:
        raise HTTPException(status_code=400, detail="No data returned for this URL")

    entries = info.get('entries', [])
    if not entries:
        raise HTTPException(status_code=400, detail="No videos found in this collection. Make sure the collection is public.")

    videos = []
    for entry in entries:
        if not entry:
            continue
        video_id = entry.get('id', '')
        # Build canonical TikTok URL from the entry
        webpage_url = entry.get('webpage_url') or entry.get('url', '')
        if not webpage_url.startswith('http') and video_id:
            uploader = entry.get('uploader_id') or entry.get('uploader', 'unknown')
            webpage_url = f"https://www.tiktok.com/@{uploader}/video/{video_id}"
        videos.append({
            'url': webpage_url,
            'title': entry.get('title'),
            'thumbnail': entry.get('thumbnail'),
            'video_id': video_id,
        })

    return {
        'is_collection': True,
        'count': len(videos),
        'collection_title': info.get('title'),
        'videos': videos,
    }


@app.post("/extract-recipe")
def extract_recipe(request: ExtractRequest):
    api_key = request.api_key or request.gemini_api_key or os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=401, detail="API Key is required (GROQ_API_KEY)")

    # --- STEP 1: Fast pass — metadata + subtitles only (no audio download) ---
    logger.info(f"Step 1: Fast metadata extraction for {request.url}")
    raw_text, thumbnail_url, _ = get_video_data(request.url, extract_audio=False)

    # --- STEP 2: If content is rich enough, go straight to LLM ---
    if not is_thin_content(raw_text):
        logger.info(f"Content is rich ({len(raw_text)} chars), skipping audio download")
        recipe_data = parse_with_llm(raw_text, api_key)
        recipe_data['image_url'] = thumbnail_url
        return recipe_data

    # --- STEP 3: Thin content — try audio download + Whisper transcription ---
    logger.info("Content thin, attempting audio download + transcription...")
    try:
        _, _, audio_path = get_video_data(request.url, extract_audio=True)
        if audio_path:
            transcript = transcribe_audio(audio_path, api_key)
            if transcript:
                raw_text += f"\n\n[AUDIO TRANSCRIPT]:\n{transcript}"
    except Exception as e:
        logger.warning(f"Audio extraction failed: {e}")

    # --- STEP 4: Still thin — try direct video download + vision + audio ---
    if is_thin_content(raw_text):
        logger.info("Still thin after audio attempt, trying vision fallback...")
        try:
            headers = {"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1"}
            html_resp = requests.get(request.url, headers=headers, timeout=10)
            if html_resp.status_code == 200:
                direct_url = extract_direct_video_url(request.url, html_resp.text)
                if direct_url:
                    temp_vid_path = f"{tempfile.gettempdir()}/temp_vision_vid.mp4"
                    vid_resp = requests.get(direct_url, stream=True, timeout=30)
                    with open(temp_vid_path, 'wb') as f:
                        for chunk in vid_resp.iter_content(chunk_size=8192):
                            f.write(chunk)

                    # Audio via ffmpeg
                    temp_audio_path = f"{tempfile.gettempdir()}/temp_vision_audio.mp3"
                    subprocess.run(
                        ["ffmpeg", "-i", temp_vid_path, "-vn", "-acodec", "libmp3lame", "-y", temp_audio_path],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                    )
                    transcript = transcribe_audio(temp_audio_path, api_key)
                    if transcript:
                        raw_text += f"\n\n[AUDIO TRANSCRIPT]:\n{transcript}"

                    # Vision frames
                    frames = extract_frames(temp_vid_path)
                    visual_desc = analyze_visuals_with_groq(frames, api_key)
                    if visual_desc:
                        raw_text += visual_desc
        except Exception as e_vision:
            logger.warning(f"Vision fallback failed: {e_vision}")

    # --- STEP 5: Parse whatever we have with LLM ---
    recipe_data = parse_with_llm(raw_text, api_key)
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
    if not result.data:
        raise HTTPException(status_code=500, detail="Recipe insert failed — check Supabase RLS policies")
    return result.data[0]


@app.get("/check-db")
def check_db():
    """Diagnostic endpoint to verify database connection."""
    supabase = get_supabase_client()
    if not supabase:
        return {"status": "error", "message": "Supabase client not initialized"}
    
    try:
        res = supabase.table("users").select("id").limit(1).execute()
        return {"status": "ok", "message": "Database connection verified"}
    except Exception as e:
        logger.error(f"DB Check Failed: {e}")
        return {"status": "error", "message": str(e)}

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


