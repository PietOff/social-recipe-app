import os
import json
import logging
import typing_extensions
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp
from groq import Groq
from dotenv import load_dotenv
import tempfile
from pathlib import Path

# Load env vars
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Social Recipe Extractor")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

def get_video_data(url: str, extract_audio: bool = False):
    """
    Uses yt-dlp to extract metadata like title, description, and thumbnail.
    Optionally downloads audio for transcription.
    """
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
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            # TRY 1: Attempt to get audio + metadata + subtitles
            info = ydl.extract_info(url, download=extract_audio)
        except yt_dlp.utils.DownloadError as e:
            # FALLBACK 1: If audio download is blocked, try metadata + subtitles ONLY
            if "Sign in" in str(e) or "bot" in str(e).lower():
                logger.warning("YouTube blocked audio. Falling back to metadata + subtitles...")
                ydl_opts['skip_download'] = True
                
                # Remove specific player client args that might trigger detection
                if 'extractor_args' in ydl_opts:
                    del ydl_opts['extractor_args']
                
                try:
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl_fallback:
                        info = ydl_fallback.extract_info(url, download=True)
                except yt_dlp.utils.DownloadError as e2:
                    # FALLBACK 2: Flat Extraction (Title/Desc only)
                    try:
                        if "Sign in" in str(e2) or "bot" in str(e2).lower():
                            logger.warning("YouTube blocked metadata. Falling back to FLAT extraction...")
                            ydl_opts['extract_flat'] = True
                            with yt_dlp.YoutubeDL(ydl_opts) as ydl_flat:
                                info = ydl_flat.extract_info(url, download=False)
                        else:
                            raise e2
                    except Exception as e3:
                        # FALLBACK 3: NUCLEAR OPTION - Direct HTML Scraping
                        # If yt-dlp is completely banned, try to just get the HTML text.
                        logger.warning("yt-dlp completely blocked. Attempting direct HTML scraping...")
                        import requests
                        import re
                        
                        try:
                            headers = {
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                                "Accept-Language": "en-US,en;q=0.9"
                            }
                            resp = requests.get(url, headers=headers, timeout=10)
                            if resp.status_code == 200:
                                html = resp.text
                                
                                # Robust Regex Extraction
                                # 1. Title
                                title = "Unknown Recipe"
                                og_title = re.search(r'<meta property="og:title" content="(.*?)">', html)
                                title_tag = re.search(r'<title>(.*?)</title>', html)
                                
                                if og_title:
                                    title = og_title.group(1)
                                elif title_tag:
                                    title = title_tag.group(1).replace(" - YouTube", "")
                                
                                # 2. Description
                                description = "No description available"
                                og_desc = re.search(r'<meta property="og:description" content="(.*?)">', html)
                                name_desc = re.search(r'<meta name="description" content="(.*?)">', html)
                                
                                    description = name_desc.group(1)
                                
                                # 3. Thumbnail
                                thumbnail = ""
                                img_match = re.search(r'<meta property="og:image" content="(.*?)">', html)
                                if img_match:
                                    thumbnail = img_match.group(1)
                                    
                                # 4. Manual Subtitle Extraction (The "Golden Key")
                                subtitle_text = ""
                                try:
                                    # Find JSON blob
                                    json_match = re.search(r'var ytInitialPlayerResponse = ({.*?});', html)
                                    if not json_match:
                                        json_match = re.search(r'ytInitialPlayerResponse\s*=\s*({.+?})\s*;' , html)
                                    
                                    if json_match:
                                        data = json.loads(json_match.group(1))
                                        if 'captions' in data and 'playerCaptionsTracklistRenderer' in data['captions']:
                                            tracks = data['captions']['playerCaptionsTracklistRenderer']['captionTracks']
                                            if tracks:
                                                # Prefer Dutch or English, otherwise first available
                                                selected_track = tracks[0] 
                                                for track in tracks:
                                                    lang = track.get('name', {}).get('simpleText', '').lower()
                                                    if 'dutch' in lang or 'nederlands' in lang:
                                                        selected_track = track
                                                        break
                                                
                                                track_url = selected_track.get('baseUrl')
                                                if track_url:
                                                    logger.info(f"Fetching manual subtitles from: {track_url[:50]}...")
                                                    sub_resp = requests.get(track_url)
                                                    if sub_resp.status_code == 200:
                                                        # Simple XML cleanup (remove <text start="..." dur="..."> and </text>)
                                                        # The format is usually: <text start="0.5" dur="3.2">Hello world</text>
                                                        # We just want "Hello world"
                                                        raw_subs = sub_resp.text
                                                        # Decode HTML entities
                                                        import html as html_lib
                                                        clean_subs = re.sub(r'<[^>]+>', ' ', raw_subs) # Remove tags
                                                        clean_subs = html_lib.unescape(clean_subs)     # &amp; -> &
                                                        clean_subs = re.sub(r'\s+', ' ', clean_subs).strip() # Access whitespace
                                                        subtitle_text = f"\n\n[MANUAL SUBTITLES]:\n{clean_subs}"
                                except Exception as e_sub:
                                    logger.warning(f"Manual subtitle extraction failed: {e_sub}")

                                # Append subtitles to description so LLM sees it
                                if subtitle_text:
                                    description += subtitle_text

                                logger.info(f"HTML Scrape Result - Title: {title}, Desc Len: {len(description)}")
                                
                                # Mock the info object
                                info = {
                                    'title': title,
                                    'description': description,
                                    'thumbnail': thumbnail,
                                    'id': 'unknown'
                                }
                            else:
                                raise Exception(f"HTML request failed: {resp.status_code}")
                        except Exception as e4:
                             raise HTTPException(status_code=400, detail=f"All extraction methods failed. YouTube blocked us. Error: {str(e4)}")

            else:
                raise e

        try:
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
        1. Convert ALL units to METRIC (ml, l, g, kg). Do NOT use cups, oz, lbs, or spoons if possible (use grams/ml).
        2. Analyze the recipe and assign multiple TAGS from these lists:
           - MEAL TYPES: "Breakfast", "Brunch", "Lunch", "Dinner", "Snack", "Dessert".
           - DISH TYPES: "Sandwich", "Pasta", "Pizza", "Salad", "Soup", "Rice", "Meat", "Fish", "Vegetarian", "Vegan", "Wrap", "Bowl", "Tacos", "Burger", "Stew", "Curry", "Roast", "Bake".
           - Add other relevant tags (e.g. "Chicken", "Healthy", "Quick") if appropriate.
        3. If ingredient AMOUNTS are missing in the text, USE YOUR CULINARY KNOWLEDGE to estimate reasonable metric amounts (e.g. "200g" for pasta for 2 people). NEVER return empty strings for amount/unit if you can infer them.
        4. Group ingredients by component if applicable (e.g., "Sauce", "Dressing", "Main"). If no distinct groups, use "Main".
        
        Return ONLY valid JSON matching this schema:
        {{
            "title": "string",
            "description": "string",
            "ingredients": [{{"item": "string", "amount": "string", "unit": "string (metric)", "group": "string"}}],
            "instructions": ["string (step 1)", "string (step 2)"],
            "prep_time": "string (e.g. 15 mins)",
            "cook_time": "string (e.g. 1 hour)",
            "servings": "string (e.g. 4 people)",
            "tags": ["string", "string"],
            "image_url": null
        }}

        If the text contains no recipe, return empty strings in JSON but explain in description.
        If language is Dutch, keep it Dutch.
        
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

@app.post("/extract-recipe")
def extract_recipe(request: ExtractRequest):
    # Support multiple env var names/locations
    api_key = request.api_key or request.gemini_api_key or os.getenv("GROQ_API_KEY") or os.getenv("GEMINI_API_KEY")
    
    if not api_key:
        raise HTTPException(status_code=401, detail="API Key is required (GROQ_API_KEY)")

    # 1. Extract raw data (ALWAYS try to get audio for better results)
    raw_text, thumbnail_url, audio_path = get_video_data(request.url, extract_audio=True)
    
    # 2. Transcribe if audio exists
    if audio_path:
        logger.info(f"Transcribing audio from {audio_path}...")
        transcript = transcribe_audio(audio_path, api_key)
        if transcript:
            raw_text += f"\n\n[AUDIO TRANSCRIPT]:\n{transcript}"
    
    # 3. Parse with LLM
    recipe_data = parse_with_llm(raw_text, api_key)
    
    # 4. Inject the real thumbnail URL
    recipe_data['image_url'] = thumbnail_url
    
    return recipe_data

@app.get("/")
def health_check():
    return {"status": "ok", "service": "Social Recipe Extractor (Groq+Whisper)"}
