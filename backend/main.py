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

# Load env vars
load_dotenv()

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# CORS: Allow all for simplicity in this demo (including mobile via IP)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Data Models ---
class Ingredient(typing_extensions.TypedDict):
    item: str
    amount: str
    unit: str

class Recipe(typing_extensions.TypedDict):
    title: str
    description: str
    ingredients: List[Ingredient]
    instructions: List[str]
    prep_time: Optional[str]
    cook_time: Optional[str]
    servings: Optional[str]
    image_url: Optional[str]
    category: Optional[str] # New field: Breakfast, Lunch, Dinner, Snack, Dessert

class ExtractRequest(BaseModel):
    url: str
    api_key: Optional[str] = None # Generic name, can accept any supported key

# --- Helpers ---

def get_video_data(url: str):
    """
    Uses yt-dlp to extract metadata like title, description, and thumbnail.
    """
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'writesubtitles': True,
        'writeautomaticsub': True,
        'subtitleslangs': ['en', 'nl', 'auto'],
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
            description = info.get('description', '')
            title = info.get('title', '')
            thumbnail = info.get('thumbnail', '')
            
            combined_text = f"Title: {title}\nDescription: {description}"
            return combined_text, thumbnail
        except Exception as e:
            logger.error(f"yt-dlp error: {str(e)}")
            raise HTTPException(status_code=400, detail=f"Could not extract data from URL: {str(e)}")

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
    # Try different env vars to be flexible
    api_key = request.api_key or os.getenv("GROQ_API_KEY") or os.getenv("GEMINI_API_KEY")
    
    if not api_key:
        raise HTTPException(status_code=401, detail="API Key is required (GROQ_API_KEY)")

    # 1. Extract raw data
    raw_text, thumbnail_url = get_video_data(request.url)
    
    # 2. Parse with LLM
    recipe_data = parse_with_llm(raw_text, api_key)
    
    # 3. Inject the real thumbnail URL
    recipe_data['image_url'] = thumbnail_url
    
    return recipe_data
