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
            # FALLBACK: If audio download is blocked, try metadata + subtitles ONLY
            if extract_audio and "Sign in" in str(e):
                logger.warning("YouTube blocked audio. Falling back to metadata + subtitles...")
                ydl_opts['skip_download'] = True
                with yt_dlp.YoutubeDL(ydl_opts) as ydl_fallback:
                    info = ydl_fallback.extract_info(url, download=True) # download=True needed for subtitles/metadata
            else:
                raise e

        try:
            description = info.get('description', '')
            title = info.get('title', '')
            thumbnail = info.get('thumbnail', '')
            video_id = info.get('id')
            
            # Check for audio file if we asked for it AND download succeeded
            if extract_audio and not ydl_opts.get('skip_download'):
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
            raise HTTPException(status_code=400, detail=f"Could not processing video data: {str(e)}")

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
