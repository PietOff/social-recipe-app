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

# Request Model
class ExtractRequest(BaseModel):
    url: str
    gemini_api_key: Optional[str] = None
    api_key: Optional[str] = None

class Ingredient(typing_extensions.TypedDict):
    item: str
    amount: Optional[str]
    unit: Optional[str]

class Recipe(typing_extensions.TypedDict):
    title: str
    description: str
    ingredients: List[Ingredient]
    instructions: List[str]
    prep_time: Optional[str]
    cook_time: Optional[str]
    servings: Optional[str]
    image_url: Optional[str]
    category: Optional[str]

def get_video_data(url: str, extract_audio: bool = False):
    """
    Uses yt-dlp to extract metadata. Optional: Downloads audio for transcription.
    """
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'writesubtitles': True,
        'writeautomaticsub': True,
        'subtitleslangs': ['en', 'nl', 'auto'],
    }
    
    # If we need audio, we update options to download it
    audio_path = None
    temp_dir = tempfile.gettempdir()
    
    if extract_audio:
        ydl_opts.update({
            'skip_download': False,
            'format': 'bestaudio/best',
            'outtmpl': f'{temp_dir}/%(id)s.%(ext)s',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=extract_audio)
            description = info.get('description', '')
            title = info.get('title', '')
            thumbnail = info.get('thumbnail', '')
            
            # If audio was downloaded, find the path
            if extract_audio:
                video_id = info.get('id')
                # yt-dlp with postprocessor usually appends .mp3
                potential_path = Path(f'{temp_dir}/{video_id}.mp3')
                if potential_path.exists():
                    audio_path = str(potential_path)
            
            combined_text = f"Title: {title}\nDescription: {description}"
            return combined_text, thumbnail, audio_path
        except Exception as e:
            logger.error(f"yt-dlp error: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Could not extract data from URL: {str(e)}")

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
        return "" # Fail silently for transcription, rely on text
    finally:
        # Cleanup
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
        You are an expert chef and data parser. I will give you text extracted from a social media cooking video (TikTok/Instagram). 
        Your goal is to extract a structured recipe from it.
        
        CRITICAL RULES:
        1. Convert ALL units to METRIC (ml, l, g, kg). Do NOT use cups, oz, lbs, or spoons if possible (use grams/ml).
        2. Categorize the recipe into one of: "Breakfast", "Lunch", "Dinner", "Snack", "Dessert".
        
        Return ONLY valid JSON matching this schema:
        {{
            "title": "string",
            "description": "string",
            "ingredients": [{{"item": "string", "amount": "string", "unit": "string (metric)"}}],
            "instructions": ["string (step 1)", "string (step 2)"],
            "prep_time": "string (e.g. 15 mins)",
            "cook_time": "string (e.g. 1 hour)",
            "servings": "string (e.g. 4 people)",
            "category": "string (enum)",
            "image_url": null
        }}

        If the text contains no recipe, return empty strings but explain in description.
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

@app.post("/extract-recipe")
def extract_recipe(request: ExtractRequest):
    api_key = request.api_key or request.gemini_api_key or os.getenv("GROQ_API_KEY") or os.getenv("GEMINI_API_KEY")
    
    if not api_key:
        raise HTTPException(status_code=401, detail="API Key is required (GROQ_API_KEY)")

import tempfile
from pathlib import Path

# ... (imports)

def get_video_data(url: str, extract_audio: bool = False):
    """
    Uses yt-dlp to extract metadata. Optional: Downloads audio for transcription.
    """
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'writesubtitles': True,
        'writeautomaticsub': True,
        'subtitleslangs': ['en', 'nl', 'auto'],
    }
    
    # If we need audio, we update options to download it
    audio_path = None
    if extract_audio:
        # Create a temporary file path
        temp_dir = tempfile.gettempdir()
        ydl_opts.update({
            'skip_download': False,
            'format': 'bestaudio/best',
            'outtmpl': f'{temp_dir}/%(id)s.%(ext)s',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
        })
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=extract_audio)
            description = info.get('description', '')
            title = info.get('title', '')
            thumbnail = info.get('thumbnail', '')
            
            # If audio was downloaded, find the path
            if extract_audio:
                video_id = info.get('id')
                # yt-dlp with postprocessor usually appends .mp3
                potential_path = Path(f'{temp_dir}/{video_id}.mp3')
                if potential_path.exists():
                    audio_path = str(potential_path)
            
            combined_text = f"Title: {title}\nDescription: {description}"
            return combined_text, thumbnail, audio_path
        except Exception as e:
            logger.error(f"yt-dlp error: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Could not extract data from URL: {str(e)}")

def transcribe_audio(audio_path: str, api_key: str):
    """
    Uses Groq Whisper to transcribe audio file.
    """
    if not audio_path:
        return ""
        
    try:
        client = Groq(api_key=api_key)
        with open(audio_path, "rb") as file:
            transcription = client.audio.transcriptions.create(
                file=(audio_path, file.read()),
                model="whisper-large-v3",
                response_format="text"
            )
        return transcription
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}")
        return "" # Fail silently for transcription, rely on text
    finally:
        # Cleanup
        try:
            if os.path.exists(audio_path):
                os.remove(audio_path)
        except:
            pass

def parse_with_llm(text_data: str, api_key: str):
    # ... (existing parse_with_llm function)

@app.post("/extract-recipe")
def extract_recipe(request: ExtractRequest):
    api_key = request.gemini_api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=401, detail="API Key is required")

    # 1. Decide if we need audio (if typical description is short, or always)
    # For now: ALWAYS try to get audio if description is short, or just always for better quality?
    # Let's do it smart: First get metadata (fast). If desc < 100 chars, download audio.
    # Actually, yt-dlp does it in one pass usually. Let's force audio download for maximizing quality as requested.
    
    # Extract raw data WITH audio
    raw_text, thumbnail_url, audio_path = get_video_data(request.url, extract_audio=True)
    
    # 2. Transcribe if audio exists
    if audio_path:
        logger.info(f"Transcribing audio from {audio_path}...")
        transcript = transcribe_audio(audio_path, api_key)
        raw_text += f"\n\n[AUDIO TRANSCRIPT]:\n{transcript}"
    
    # 3. Parse with LLM
    recipe_data = parse_with_llm(raw_text, api_key)
    
    # 4. Inject the real thumbnail URL
    recipe_data['image_url'] = thumbnail_url
    
    return recipe_data
