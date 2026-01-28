import os
import json
import logging
import typing_extensions
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp
import requests
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

def extract_from_invidious(video_id: str):
    """
    Tries to fetch video data from public Invidious instances.
    Bypasses YouTube blocking and Consent pages.
    """
    instances = [
        "https://inv.tux.pizza",
        "https://vid.puffyan.us",
        "https://invidious.projectsegfau.lt",
        "https://invidious.fdn.fr"
    ]
    
    for instance in instances:
        try:
            api_url = f"{instance}/api/v1/videos/{video_id}"
            logger.info(f"Trying Invidious instance: {instance}")
            resp = requests.get(api_url, timeout=10)
            
            if resp.status_code == 200:
                data = resp.json()
                
                title = data.get('title', 'Unknown Recipe')
                description = data.get('description', '')
                thumbnail = ""
                # Get high res thumbnail
                if 'videoThumbnails' in data and data['videoThumbnails']:
                    thumbnail = data['videoThumbnails'][0]['url']
                else:
                    thumbnail = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"
                
                # Fetch Subtitles
                captions = data.get('captions', [])
                subtitle_text = ""
                
                # Prioritize Dutch, then English, then Auto
                selected_caption = None
                for cap in captions:
                    label = cap.get('label', '').lower()
                    if 'dutch' in label or 'nederlands' in label:
                        selected_caption = cap
                        break
                
                if not selected_caption:
                    for cap in captions:
                        label = cap.get('label', '').lower()
                        if 'english' in label:
                            selected_caption = cap
                            break
                            
                if not selected_caption and captions:
                    selected_caption = captions[0]
                    
                if selected_caption:
                    cap_url = instance + selected_caption.get('url')
                    logger.info(f"Fetching Invidious subtitles: {cap_url}")
                    cap_resp = requests.get(cap_url, timeout=5)
                    if cap_resp.status_code == 200:
                        # Invidious returns VTT. We can dump it raw or clean it.
                        # Simple cleanup: remove timestamps?
                        # For now, raw VTT is better than nothing, LLM can handle it.
                        subtitle_text = f"\n\n[SUBTITLES via Invidious]:\n{cap_resp.text}"
                        
                return {
                    'title': title,
                    'description': description + subtitle_text,
                    'thumbnail': thumbnail,
                    'id': video_id
                }
                
        except Exception as e:
            logger.warning(f"Invidious instance {instance} failed: {e}")
            continue
            
    raise Exception("All Invidious instances failed.")

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
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            # TRY 1: Attempt to get audio + metadata + subtitles
            info = ydl.extract_info(url, download=extract_audio)
        except Exception as e:
            # FALLBACK: Catch ALL errors (bot detection, generic failures, etc.) and try generic scraping
            logger.warning(f"yt-dlp failed (Error: {str(e)}). Attempting fallbacks...")
            
            # Remove specific player client args that might trigger detection
            if 'extractor_args' in ydl_opts:
                del ydl_opts['extractor_args']
            
            try:
                # FALLBACK 1 & 2: Try yt-dlp again with looser constraints (Skip download, Flat extract)
                # Only worth trying if it's a "DownloadError" and likely bot-related, but we can try broadly or skip to HTML.
                # For TikTok, yt-dlp retries rarely work if the first one failed hard. Let's try one generic "flat" attempt.
                ydl_opts['extract_flat'] = True
                with yt_dlp.YoutubeDL(ydl_opts) as ydl_flat:
                     info = ydl_flat.extract_info(url, download=False)

            except Exception as e3:
                # FALLBACK 3: NUCLEAR OPTION - Direct HTML Scraping
                logger.warning("yt-dlp completely blocked/failed. Attempting direct HTML scraping...")
                import requests
                import re
                
                # Check if it's YouTube
                is_youtube = "youtube.com" in url or "youtu.be" in url
                
                try:
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                        "Accept-Language": "en-US,en;q=0.9",
                    }
                    if is_youtube:
                        headers["Cookie"] = "SOCS=CAISEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg; CONSENT=YES+cb.20230531-04-p0.en+FX+417; PREF=f6=400&f4=4000000"
                        
                    resp = requests.get(url, headers=headers, timeout=10)
                    if resp.status_code != 200:
                         raise Exception(f"HTML request failed: {resp.status_code}")
                         
                    html = resp.text
                    title = "Unknown Recipe"
                    description = "No description available"
                    thumbnail = ""
                    
                    # --- Generic Scraping (Works for TikTok, Insta, etc.) ---
                    # 1. Title
                    og_title = re.search(r'<meta property="og:title" content="(.*?)">', html)
                    title_tag = re.search(r'<title>(.*?)</title>', html)
                    if og_title:
                        title = og_title.group(1)
                    elif title_tag:
                        title = title_tag.group(1)
                        if is_youtube: title = title.replace(" - YouTube", "")
                    
                    # 2. Description
                    og_desc = re.search(r'<meta property="og:description" content="(.*?)">', html)
                    name_desc = re.search(r'<meta name="description" content="(.*?)">', html)
                    if og_desc:
                        description = og_desc.group(1)
                    elif name_desc:
                        description = name_desc.group(1)
                        
                    # 3. Thumbnail
                    img_match = re.search(r'<meta property="og:image" content="(.*?)">', html)
                    if img_match:
                        thumbnail = img_match.group(1)
                    
                    # --- YouTube Specific Logic (Subtitles & Invidious) ---
                    if is_youtube:
                        # Manual Subtitle Extraction
                        subtitle_text = ""
                        try:
                            json_match = re.search(r'var ytInitialPlayerResponse = ({.*?});', html)
                            if not json_match:
                                json_match = re.search(r'ytInitialPlayerResponse\s*=\s*({.+?})\s*;' , html)
                            
                            if json_match:
                                data = json.loads(json_match.group(1))
                                if 'captions' in data and 'playerCaptionsTracklistRenderer' in data['captions']:
                                    tracks = data['captions']['playerCaptionsTracklistRenderer']['captionTracks']
                                    if tracks:
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
                                                import html as html_lib
                                                clean_subs = re.sub(r'<[^>]+>', ' ', sub_resp.text)
                                                clean_subs = html_lib.unescape(clean_subs)
                                                clean_subs = re.sub(r'\s+', ' ', clean_subs).strip()
                                                subtitle_text = f"\n\n[MANUAL SUBTITLES]:\n{clean_subs}"
                        except Exception as e_sub:
                            logger.warning(f"Manual subtitle extraction failed: {e_sub}")

                        if subtitle_text:
                            description += subtitle_text

                        # Fallback to Invidious if bad scrape
                        if len(description) < 200 or "Before you continue" in title or "Unknown" in title:
                            logger.warning("HTML extraction likely hit Consent Page. Trying Invidious Proxy...")
                            info = extract_from_invidious(url.split("v=")[-1].split("&")[0])
                        else:
                             info = {
                                'title': title,
                                'description': description,
                                'thumbnail': thumbnail,
                                'id': 'unknown'
                            }
                    else:
                        # Non-YouTube (TikTok, etc.) - Just return what we found
                        logger.info(f"Generic HTML scrape successful for {url}")
                        info = {
                            'title': title,
                            'description': description,
                            'thumbnail': thumbnail,
                            'id': 'unknown'
                        }
                    
                except Exception as e4:
                     # FALLBACK 4: Invidious Proxy (YouTube ONLY)
                     if is_youtube:
                         try:
                            logger.info("HTML scraping failed completely. Trying Invidious Proxy...")
                            video_id = url.split("v=")[-1].split("&")[0] 
                            info = extract_from_invidious(video_id)
                         except Exception as e5:
                            raise HTTPException(status_code=400, detail=f"All extraction methods failed. YouTube blocked us. Error: {str(e5)}")
                     else:
                         # Non-YouTube: If generic scrape failed, we really are stuck.
                         raise HTTPException(status_code=400, detail=f"Could not fetch video data. Platform may be blocking requests. Error: {str(e4)}")

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
