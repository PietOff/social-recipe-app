#!/bin/bash
# setup_backend.sh

# Use brew python if available
export PATH=$PATH:/opt/homebrew/bin

if ! command -v python3 &> /dev/null; then
    echo "python3 could not be found"
    exit 1
fi

cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

echo "Backend setup complete. Run 'source backend/venv/bin/activate' then 'uvicorn backend.main:app --reload' to start."
