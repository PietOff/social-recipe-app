import os
import json
import logging
import typing_extensions
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Social Recipe Extractor")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development; strict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Logger setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Request Model
class ExtractRequest(BaseModel):
    url: str
    gemini_api_key: Optional[str] = None

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

def get_video_data(url: str):
    """
    Uses yt-dlp to extract metadata and automatic captions/subtitles if available.
    """
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'writesubtitles': True,
        'writeautomaticsub': True,
        'subtitleslangs': ['en', 'nl', 'auto'], # English and Dutch
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
            description = info.get('description', '')
            title = info.get('title', '')
            
            combined_text = f"Title: {title}\nDescription: {description}"
            return combined_text
        except Exception as e:
            logger.error(f"yt-dlp error: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Could not extract data from URL: {str(e)}")

def parse_with_llm(text_data: str, api_key: str):
    """
    Uses Google Gemini to parse the raw text into a structured Recipe.
    """
    try:
        genai.configure(api_key=api_key)
        # Using gemini-1.5-flash which is fast and supports JSON response format natively
        model = genai.GenerativeModel('gemini-1.5-flash',
                                      generation_config={"response_mime_type": "application/json",
                                                         "response_schema": Recipe})
        
        prompt = f"""
        You are an expert chef and data parser. I will give you text extracted from a social media cooking video (TikTok/Instagram). 
        Your goal is to extract a structured recipe from it.
        
        If the text is just chatter and contains no recipe, return a JSON with empty fields ("") but explain in 'description' that no recipe was found.
        If the language is Dutch, keep the recipe in Dutch. If English, keep it in English.
        
        Raw Text:
        {text_data}
        """
        
        response = model.generate_content(prompt)
        return json.loads(response.text)
    except Exception as e:
        logger.error(f"Gemini error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI parsing failed: {str(e)}")

@app.post("/extract-recipe")
def extract_recipe(request: ExtractRequest):
    api_key = request.gemini_api_key or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=401, detail="Gemini API Key is required (either in env or request)")

    # 1. Extract raw data
    raw_text = get_video_data(request.url)
    
    # 2. Parse with LLM
    recipe_data = parse_with_llm(raw_text, api_key)
    
    return recipe_data

@app.get("/")
def health_check():
    return {"status": "ok", "service": "Social Recipe Extractor (Gemini)"}
