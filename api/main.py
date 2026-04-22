from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
import uvicorn

# Import our schemas and predictor
import sys
sys.path.append(str(Path(__file__).parent))

from schemas import (
    DelayRequest, DelayResponse,
    CrowdRequest, CrowdResponse,
    StopInfo, LineInfo,
    HealthResponse
)
from predictor import predictor

import requests as http_requests

OPENWEATHER_API_KEY = "7a82757bd7c5c0720a23baa5b7397b27"

WEATHER_MAP = {
    "Clear":        "clear",
    "Clouds":       "cloudy",
    "Rain":         "rain",
    "Drizzle":      "rain",
    "Snow":         "snow",
    "Fog":          "fog",
    "Mist":         "fog",
    "Haze":         "fog",
    "Thunderstorm": "rain",
    "Wind":         "wind",
}

# ══════════════════════════════════════════════════════════════
# APP SETUP
# ══════════════════════════════════════════════════════════════

app = FastAPI(
    title       = "RotaZeka — Predictive Transit API",
    description = "Bus arrival time and crowd prediction for Sivas, Turkey",
    version     = "1.0.0"
)

# Allow frontend to call API (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# Serve frontend static files
frontend_path = Path(__file__).parent.parent / "frontend"

@app.get("/")
async def root():
    return FileResponse(str(frontend_path / "index.html"))

@app.get("/style.css")
async def styles():
    return FileResponse(str(frontend_path / "style.css"))

@app.get("/app.js")
async def javascript():
    return FileResponse(
        str(frontend_path / "app.js"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )


# ══════════════════════════════════════════════════════════════
# ROUTES
# ══════════════════════════════════════════════════════════════



# ── HEALTH CHECK ──────────────────────────────────────────────
@app.get("/health", response_model=HealthResponse)
async def health():
    """Check if API and models are running"""
    stops = predictor.get_all_stops()
    lines = predictor.get_all_lines()
    return {
        "status"             : "ok",
        "delay_model_loaded" : predictor.delay_model_loaded,
        "crowd_model_loaded" : predictor.crowd_model_loaded,
        "total_stops"        : len(stops),
        "total_lines"        : len(lines)
    }


# ── DELAY PREDICTION ──────────────────────────────────────────
@app.post("/predict/delay", response_model=DelayResponse)
async def predict_delay(req: DelayRequest):
    """
    Predict how many minutes late the bus will be at a stop.
    
    - **prev_stop_delay**: delay at the previous stop (minutes)
    - **speed_factor**: current bus speed factor 0-1
    - **traffic_level**: low / moderate / high / congested
    - **weather_condition**: clear / cloudy / wind / fog / rain / snow
    - Returns predicted delay, arrival time, and status
    """
    try:
        # Validate categorical inputs
        valid_traffic = ['low', 'moderate', 'high', 'congested']
        valid_weather = ['clear', 'cloudy', 'wind', 'fog', 'rain', 'snow']
        valid_stops   = ['regular', 'residential', 'market',
                         'hospital', 'terminal', 'university']

        if req.traffic_level not in valid_traffic:
            raise HTTPException(
                status_code = 422,
                detail      = f"traffic_level must be one of {valid_traffic}"
            )
        if req.weather_condition not in valid_weather:
            raise HTTPException(
                status_code = 422,
                detail      = f"weather_condition must be one of {valid_weather}"
            )
        if req.stop_type not in valid_stops:
            raise HTTPException(
                status_code = 422,
                detail      = f"stop_type must be one of {valid_stops}"
            )

        # Run prediction
        result = predictor.predict_delay(req)
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code = 500,
            detail      = f"Prediction error: {str(e)}"
        )


# ── CROWD PREDICTION ──────────────────────────────────────────
@app.post("/predict/crowd", response_model=CrowdResponse)
async def predict_crowd(req: CrowdRequest):
    try:
        valid_weather = ['clear', 'cloudy', 'wind', 'fog', 'rain', 'snow']
        valid_traffic = ['low', 'moderate', 'high', 'congested']
        valid_stops   = ['regular', 'residential', 'market',
                         'hospital', 'terminal', 'university']

        if req.weather_condition not in valid_weather:
            raise HTTPException(status_code=422,
                detail=f"weather_condition must be one of {valid_weather}")
        if req.traffic_level not in valid_traffic:
            raise HTTPException(status_code=422,
                detail=f"traffic_level must be one of {valid_traffic}")
        if req.stop_type not in valid_stops:
            raise HTTPException(status_code=422,
                detail=f"stop_type must be one of {valid_stops}")

        # ── ADD THIS ──────────────────────────────────────────
        # Validate stop_id exists in our data
        all_stops   = predictor.get_all_stops()
        valid_stop_ids = [s['stop_id'] for s in all_stops]
        if req.stop_id not in valid_stop_ids:
            # Don't crash — just use fallback baseline
            # Some stops might not be in bus_stops.csv
            pass  # predictor handles this with _get_baseline_crowd fallback
        # ─────────────────────────────────────────────────────

        result = predictor.predict_crowd(req)
        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")


# ── STOPS ─────────────────────────────────────────────────────
@app.get("/stops")
async def get_stops(line_id: str = None):
    """
    Get all bus stops.
    Optional filter: /stops?line_id=L01
    """
    try:
        stops = predictor.get_all_stops()
        if line_id:
            stops = [s for s in stops if s.get('line_id') == line_id]
        return {
            "total" : len(stops),
            "stops" : stops
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── LINES ─────────────────────────────────────────────────────
@app.get("/lines")
async def get_lines():
    """Get all bus lines with their stops"""
    try:
        lines = predictor.get_all_lines()
        return {
            "total" : len(lines),
            "lines" : lines
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── STOP DETAIL ───────────────────────────────────────────────
@app.get("/stops/{stop_id}")
async def get_stop(stop_id: str):
    """Get details for a specific stop"""
    try:
        stops = predictor.get_all_stops()
        stop  = next((s for s in stops if s['stop_id'] == stop_id), None)
        if not stop:
            raise HTTPException(
                status_code = 404,
                detail      = f"Stop {stop_id} not found"
            )
        return stop
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
        
@app.get("/current-weather")
async def current_weather():
    try:
        url = (
            "http://api.openweathermap.org/data/2.5/weather"
            f"?lat=39.7477&lon=37.0179&appid={OPENWEATHER_API_KEY}"
        )
        res  = http_requests.get(url, timeout=5)
        data = res.json()

        return {
            "weather_condition": WEATHER_MAP.get(data["weather"][0]["main"], "clear"),
            "weather_label":     data["weather"][0]["description"].capitalize(),
            "temperature_c":     round(data["main"]["temp"] - 273.15, 1),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

 
# ══════════════════════════════════════════════════════════════
# RUN SERVER
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    print("""
╔══════════════════════════════════════════════════════════╗
║           RotaZeka — Predictive Transit API              ║
║                   Starting server...                     ║
╚══════════════════════════════════════════════════════════╝
    """)
    uvicorn.run(
        "main:app",
        host     = "0.0.0.0",
        port     = 8000,
        reload   = True,
        workers  = 1
    )