#!/usr/bin/env bash

# LumiIQ v3 - Start Script
# Usage: ./start.sh [port] [host] [python_cmd]

# Default values
PORT=${1:-8000}
HOST=${2:-127.0.0.1}
PYTHON_CMD=${3:-/opt/homebrew/bin/python3.11}

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Print header
echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       LumiIQ v3 - Medical Platform    ║${NC}"
echo -e "${BLUE}║   Professional Eye-Gaze Communication  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if Python is available
if ! command -v $PYTHON_CMD &> /dev/null; then
    echo -e "${RED}❌ Python not found at: $PYTHON_CMD${NC}"
    exit 1
fi

# Verify Python version
PYTHON_VERSION=$($PYTHON_CMD --version 2>&1 | awk '{print $2}')
echo -e "${GREEN}✓ Python ${PYTHON_VERSION}${NC}"

# Change to backend directory
cd "$(dirname "$0")/backend" || exit 1

# Check if requirements are installed
if ! $PYTHON_CMD -c "import fastapi" 2>/dev/null; then
    echo -e "${YELLOW}Installing dependencies...${NC}"
    $PYTHON_CMD -m pip install -q -r requirements.txt
fi

# Start server
echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${GREEN}🚀 Starting LumiIQ Server${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BLUE}Server:${NC} http://$HOST:$PORT"
echo -e "  ${BLUE}API Docs:${NC} http://$HOST:$PORT/api/docs"
echo -e "  ${BLUE}Frontend:${NC} http://$HOST:$PORT"
echo ""
echo -e "${YELLOW}Press CTRL+C to stop the server${NC}"
echo ""

# Start the server
exec $PYTHON_CMD server.py --port $PORT --host $HOST
