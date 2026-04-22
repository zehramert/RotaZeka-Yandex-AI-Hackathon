from pydantic import BaseModel, Field, ConfigDict
from typing import Optional

# ══════════════════════════════════════════════════════════════
# DELAY PREDICTION
# ══════════════════════════════════════════════════════════════

class DelayRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "prev_stop_delay"      : 3.5,
            "speed_factor"         : 0.75,
            "traffic_level"        : "high",
            "weather_condition"    : "rain",
            "temperature_c"        : 8.0,
            "precipitation_mm"     : 5.2,
            "wind_speed_kmh"       : 25.0,
            "humidity_pct"         : 80.0,
            "hour_of_day"          : 8,
            "is_weekend"           : 0,
            "day_of_week"          : 1,
            "stop_sequence"        : 5,
            "stop_type"            : "university",
            "distance_from_prev_km": 0.8,
            "is_terminal"          : 0,
            "is_transfer_hub"      : 0
        }
    })

    prev_stop_delay       : float = Field(...,  ge=-5,  le=90)
    speed_factor          : float = Field(...,  ge=0.0, le=1.0)
    traffic_level         : str   = Field(...)
    weather_condition     : str   = Field(...)
    temperature_c         : float = Field(15.0, ge=-20, le=45)
    precipitation_mm      : float = Field(0.0,  ge=0,   le=100)
    wind_speed_kmh        : float = Field(0.0,  ge=0,   le=150)
    humidity_pct          : float = Field(50.0, ge=0,   le=100)
    hour_of_day           : int   = Field(...,  ge=0,   le=23)
    is_weekend            : int   = Field(...,  ge=0,   le=1)
    day_of_week           : int   = Field(...,  ge=0,   le=6)
    stop_sequence         : int   = Field(...,  ge=1,   le=20)
    stop_type             : str   = Field(...)
    distance_from_prev_km : float = Field(...,  ge=0,   le=10)
    is_terminal           : int   = Field(0,    ge=0,   le=1)
    is_transfer_hub       : int   = Field(0,    ge=0,   le=1)


class DelayResponse(BaseModel):
    predicted_delay_min  : float
    predicted_arrival    : str
    status               : str
    status_color         : str
    confidence           : str
    model_version        : str


# ══════════════════════════════════════════════════════════════
# CROWD PREDICTION
# ══════════════════════════════════════════════════════════════

class CrowdRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "stop_id"            : "STP-L01-05",
            "stop_type"          : "university",
            "hour_of_day"        : 8,
            "day_of_week"        : 1,
            "is_weekend"         : 0,
            "weather_condition"  : "rain",
            "traffic_level"      : "moderate",
            "speed_factor"       : 0.75,
            "minutes_to_next_bus": 12.0,
            "baseline_crowd"     : 45.0
        }
    })

    stop_id               : str
    stop_type             : str
    hour_of_day           : int   = Field(..., ge=0,   le=23)
    day_of_week           : int   = Field(..., ge=0,   le=6)
    is_weekend            : int   = Field(..., ge=0,   le=1)
    weather_condition     : str
    traffic_level         : str
    speed_factor          : float = Field(..., ge=0.0, le=1.0)
    minutes_to_next_bus   : Optional[float] = Field(None, ge=0, le=60)
    baseline_crowd        : Optional[float] = Field(None)


class CrowdResponse(BaseModel):
    passengers_waiting   : int
    crowding_level       : str
    crowding_color       : str
    crowding_pct         : int


# ══════════════════════════════════════════════════════════════
# STOPS & LINES
# ══════════════════════════════════════════════════════════════

class StopInfo(BaseModel):
    stop_id          : str
    line_id          : str
    line_name        : str
    stop_sequence    : int
    latitude         : float
    longitude        : float
    stop_type        : str
    is_terminal      : int
    is_transfer_hub  : int


class LineInfo(BaseModel):
    line_id          : str
    line_name        : str
    num_stops        : int
    stop_ids         : list[str]


# ══════════════════════════════════════════════════════════════
# HEALTH CHECK
# ══════════════════════════════════════════════════════════════

class HealthResponse(BaseModel):
    status               : str
    delay_model_loaded   : bool
    crowd_model_loaded   : bool
    total_stops          : int
    total_lines          : int


# ── QUICK TEST ────────────────────────────────────────────────
if __name__ == "__main__":
    # Test DelayRequest validation
    test = DelayRequest(
        prev_stop_delay       = 3.5,
        speed_factor          = 0.75,
        traffic_level         = "high",
        weather_condition     = "rain",
        hour_of_day           = 8,
        is_weekend            = 0,
        day_of_week           = 1,
        stop_sequence         = 5,
        stop_type             = "university",
        distance_from_prev_km = 0.8
    )
    print("✅ DelayRequest valid!")
    print(f"   traffic_level    : {test.traffic_level}")
    print(f"   weather          : {test.weather_condition}")
    print(f"   hour             : {test.hour_of_day}")

    # Test CrowdRequest validation
    test2 = CrowdRequest(
        stop_id             = "STP-L01-05",
        stop_type           = "university",
        hour_of_day         = 8,
        day_of_week         = 1,
        is_weekend          = 0,
        weather_condition   = "rain",
        traffic_level       = "moderate",
        speed_factor        = 0.75,
        minutes_to_next_bus = 12.0
    )
    print("\n✅ CrowdRequest valid!")
    print(f"   stop_id          : {test2.stop_id}")
    print(f"   stop_type        : {test2.stop_type}")
    print(f"   baseline_crowd   : {test2.baseline_crowd} (None = will use historical avg)")
    print("\n✅ schemas.py ready!")