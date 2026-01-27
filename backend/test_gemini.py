import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
print(f"API Key found: {'Yes' if api_key else 'No'}")

try:
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-1.5-pro')
    response = model.generate_content("Hello, can you hear me?")
    print(f"Success! Response: {response.text}")
except Exception as e:
    print(f"Error: {e}")
