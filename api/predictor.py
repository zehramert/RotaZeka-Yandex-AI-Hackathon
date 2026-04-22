import joblib
import pickle
import numpy as np
import pandas as pd
import math
import xgboost as xgb
from datetime import datetime, timedelta
from pathlib import Path
import pytz

# ══════════════════════════════════════════════════════════════
# ENCODINGS
# ══════════════════════════════════════════════════════════════

TRAFFIC_MAP = {
    'low': 0, 'moderate': 1, 'high': 2, 'congested': 3
}

WEATHER_MAP = {
    'clear': 0, 'cloudy': 1, 'wind': 2,
    'rain': 3, 'fog': 4, 'snow': 5
}

STOP_TYPE_MAP = {
    'regular': 0, 'residential': 1, 'market': 2,
    'hospital': 3, 'terminal': 4, 'university': 5
}

# ── DELAY MODEL ───────────────────────────────────────────────
DELAY_FEATURE_ORDER = [
    'traffic_level_enc',        # 0
    'weather_condition_enc',    # 1
    'prev_stop_delay',          # 2
    'speed_factor',             # 3
    'temperature_c',            # 4
    'precipitation_mm',         # 5
    'wind_speed_kmh',           # 6
    'humidity_pct',             # 7
    'hour_of_day',              # 8
    'is_weekend',               # 9
    'day_of_week',              # 10
    'stop_sequence',            # 11
    'distance_from_prev_km',    # 12
    'is_transfer_hub',          # 13
    'is_terminal',              # 14
    'stop_type_hospital',       # 15
    'stop_type_market',         # 16
    'stop_type_regular',        # 17
    'stop_type_residential',    # 18
    'stop_type_terminal',       # 19
    'stop_type_university',     # 20
    'time_bucket_afternoon',    # 21
    'time_bucket_early_morning',# 22
    'time_bucket_evening',      # 23
    'time_bucket_evening_rush', # 24
    'time_bucket_lunch',        # 25
    'time_bucket_midday',       # 26
    'time_bucket_morning_rush'  # 27
]

ALL_STOP_TYPES = [
    'hospital', 'market', 'regular',
    'residential', 'terminal', 'university'
]

ALL_TIME_BUCKETS = [
    'afternoon', 'early_morning', 'evening',
    'evening_rush', 'lunch', 'midday', 'morning_rush'
]

# ── CROWD MODEL ───────────────────────────────────────────────
# Exact feature order from X_train.csv (feature importance listing)
CROWD_FEATURE_ORDER = [
    'stop_type_enc',
    'baseline_crowd',
    'is_weekend',
    'weather_condition_enc',
    'traffic_level_enc',
    'speed_factor',
    'hour_sin',
    'hour_cos',
    'dow_sin',
    'dow_cos',
    'stop_x_hour_sin',
    'stop_x_hour_cos',
    'baseline_x_weather',
    'time_bucket_te'
]

# 10 columns that need scaling
CROWD_SCALE_COLS = [
    'baseline_crowd', 'speed_factor', 'time_bucket_te',
    'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos',
    'stop_x_hour_sin', 'stop_x_hour_cos', 'baseline_x_weather'
]

 # ── TARGET ENCODING VALUES (from passenger_flow.csv EDA) ──────
TIME_BUCKET_TE = {
    'early_morning': 26.81,
    'morning_rush' : 68.84,   # was 59.68 — off by 9 passengers
    'midday'       : 26.32,   # was 25.84
    'lunch'        : 40.96,   # was 35.34 — off by 5.6 passengers
    'afternoon'    : (40.96 + 54.84) / 2,  # interpolated — was wrong base values
    'evening_rush' : 54.84,   # was 45.27 — off by 9.5 passengers
    'evening'      : 28.55,   # was 26.83
}

WEATHER_TE = {
    'clear' : 35.58,   # was 29.81
    'cloudy': 36.47,   # was 31.36
    'wind'  : 42.26,   # was 33.17
    'fog'   : 42.27,   # was 38.55
    'rain'  : 49.34,   # was 44.85
    'snow'  : 58.16,   # was 40.49 — most wrong, off by 17.7 passengers
}

STOP_TE = {
    'regular'    : 13.56,  
    'residential': 19.83,   
    'market'     : 37.30,   
    'hospital'   : 47.77,   
    'terminal'   : 67.01,   
    'university' : 78.71,  
}


# ══════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ══════════════════════════════════════════════════════════════

def get_time_bucket(hour: int) -> str:
    if   5 <= hour <= 6:   return 'early_morning'
    elif 7 <= hour <= 9:   return 'morning_rush'
    elif 10 <= hour <= 11: return 'midday'
    elif hour == 12:       return 'lunch'
    elif 13 <= hour <= 16: return 'afternoon'
    elif 17 <= hour <= 19: return 'evening_rush'
    else:                  return 'evening'

def get_status(delay: float):
    if delay < 2:    return "ON TIME",          "green"
    elif delay < 5:  return "SLIGHTLY DELAYED", "yellow"
    elif delay < 15: return "DELAYED",           "orange"
    else:            return "HEAVILY DELAYED",   "red"

def get_confidence(delay: float) -> str:
    if delay < 5:    return "high"
    elif delay < 15: return "medium"
    else:            return "low"

def get_crowding(passengers: int):
    if passengers <= 5:
        return "empty",    "green",  int(passengers / 60 * 100)
    elif passengers <= 15:
        return "light",    "teal",   int(passengers / 60 * 100)
    elif passengers <= 30:
        return "moderate", "yellow", int(passengers / 60 * 100)
    elif passengers <= 50:
        return "busy",     "orange", int(passengers / 60 * 100)
    else:
        return "crowded",  "red",    min(100, int(passengers / 60 * 100))


# ══════════════════════════════════════════════════════════════
# PREDICTOR CLASS
# ══════════════════════════════════════════════════════════════

class Predictor:
    def __init__(self):
        self.delay_model  = None
        self.crowd_model  = None
        self.crowd_scaler = None
        self.stops_df     = None
        self.flow_df      = None
        self._load_models()
        self._load_data()

    def _load_models(self):
        # ── DELAY MODEL (LightGBM Regressor via joblib) ───────
        delay_path = Path('models/delay_model.pkl')
        if delay_path.exists():
            self.delay_model = joblib.load(delay_path)
            print(f"✅ Delay model loaded  (LightGBM Regressor)")
        else:
            print(f"⚠️  Delay model not found at {delay_path}")

        # ── CROWD MODEL (XGBoost Booster via pickle) ──────────
        crowd_path  = Path('models/model2/xgboost_hierarchical/xgb_stratA_2x.pkl')
        scaler_path = Path('models/model2/xgboost_hierarchical/scaler.pkl')

        if crowd_path.exists():
            with open(crowd_path, 'rb') as f:
                self.crowd_model = pickle.load(f)
            print(f"✅ Crowd model loaded  (XGB-StratA-2x)")
        else:
            print(f"⚠️  Crowd model not found at {crowd_path}")

        if scaler_path.exists():
            with open(scaler_path, 'rb') as f:
                self.crowd_scaler = pickle.load(f)
            print(f"✅ Crowd scaler loaded ({self.crowd_scaler.n_features_in_} features)")
        else:
            self.crowd_scaler = None
            print(f"⚠️  Crowd scaler not found")

    def _load_data(self):
        stops_path = Path('data/bus_stops.csv')
        flow_path  = Path('data/passenger_flow.csv')
        if stops_path.exists():
            self.stops_df = pd.read_csv(stops_path)
            print(f"✅ Stops data loaded  ({len(self.stops_df)} stops)")
        if flow_path.exists():
            self.flow_df = pd.read_csv(flow_path)
            print(f"✅ Flow data loaded   ({len(self.flow_df)} records)")

    @property
    def delay_model_loaded(self) -> bool:
        return self.delay_model is not None

    @property
    def crowd_model_loaded(self) -> bool:
        return self.crowd_model is not None


    # ══════════════════════════════════════════════════════════
    # DELAY PREDICTION
    # ══════════════════════════════════════════════════════════

    def predict_delay(self, req) -> dict:
        if not self.delay_model_loaded:
            return self._delay_fallback(req)

        time_bucket = get_time_bucket(req.hour_of_day)

        features = {
            'traffic_level_enc'      : TRAFFIC_MAP.get(req.traffic_level, 1),
            'weather_condition_enc'  : WEATHER_MAP.get(req.weather_condition, 0),
            'prev_stop_delay'        : req.prev_stop_delay,
            'speed_factor'           : req.speed_factor,
            'temperature_c'          : req.temperature_c,
            'precipitation_mm'       : req.precipitation_mm,
            'wind_speed_kmh'         : req.wind_speed_kmh,
            'humidity_pct'           : req.humidity_pct,
            'hour_of_day'            : req.hour_of_day,
            'is_weekend'             : req.is_weekend,
            'day_of_week'            : req.day_of_week,
            'stop_sequence'          : req.stop_sequence,
            'distance_from_prev_km'  : req.distance_from_prev_km,
            'is_transfer_hub'        : req.is_transfer_hub,
            'is_terminal'            : req.is_terminal,
        }

        # One-hot stop_type
        for st in ALL_STOP_TYPES:
            features[f'stop_type_{st}'] = 1 if req.stop_type == st else 0

        # One-hot time_bucket
        for tb in ALL_TIME_BUCKETS:
            features[f'time_bucket_{tb}'] = 1 if time_bucket == tb else 0

        X = pd.DataFrame(
            [[features[col] for col in DELAY_FEATURE_ORDER]],
            columns=DELAY_FEATURE_ORDER
        )

        predicted_delay = float(self.delay_model.predict(X)[0])
        predicted_delay = max(0, predicted_delay)

        TURKEY_TZ = pytz.timezone('Europe/Istanbul')
        now = datetime.now(TURKEY_TZ) 
        arrival_str  = (now + timedelta(minutes=predicted_delay)).strftime("%H:%M")
        status, color = get_status(predicted_delay)
        confidence   = get_confidence(predicted_delay)

        return {
            "predicted_delay_min": round(predicted_delay, 1),
            "predicted_arrival"  : arrival_str,
            "status"             : status,
            "status_color"       : color,
            "confidence"         : confidence,
            "model_version"      : "lgbm_delay_v1"
        }

    def _delay_fallback(self, req) -> dict:
        traffic_penalty = {'low':0,'moderate':3,'high':8,'congested':18}
        weather_penalty = {'clear':0,'cloudy':1,'wind':2,'rain':4,'fog':5,'snow':8}
        delay = (req.prev_stop_delay * 0.85
                 + traffic_penalty.get(req.traffic_level, 3)
                 + weather_penalty.get(req.weather_condition, 0))
        delay = max(0, delay)
        now   = datetime.now()
        arrival_str   = (now + timedelta(minutes=delay)).strftime("%H:%M")
        status, color = get_status(delay)
        return {
            "predicted_delay_min": round(delay, 1),
            "predicted_arrival"  : arrival_str,
            "status"             : status,
            "status_color"       : color,
            "confidence"         : "low",
            "model_version"      : "fallback_rules"
        }


    # ══════════════════════════════════════════════════════════
    # CROWD PREDICTION
    # ══════════════════════════════════════════════════════════

    def predict_crowd(self, req) -> dict:
        baseline = req.baseline_crowd or self._get_baseline_crowd(
            req.stop_id, req.hour_of_day, req.day_of_week
        )

        if not self.crowd_model_loaded:
            return self._crowd_fallback(baseline, req)

        hour = req.hour_of_day
        dow  = req.day_of_week

        # ── Cyclical encoding ──────────────────────────────
        hour_sin = math.sin(2 * math.pi * hour / 24)
        hour_cos = math.cos(2 * math.pi * hour / 24)
        dow_sin  = math.sin(2 * math.pi * dow  / 7)
        dow_cos  = math.cos(2 * math.pi * dow  / 7)

        # ── Base encodings ─────────────────────────────────
        stop_enc    = STOP_TYPE_MAP.get(req.stop_type, 0)
        weather_enc = WEATHER_MAP.get(req.weather_condition, 0)
        traffic_enc = TRAFFIC_MAP.get(req.traffic_level, 1)

        # ── Target encodings ───────────────────────────────
        time_bucket    = get_time_bucket(hour)
        time_bucket_te = TIME_BUCKET_TE.get(time_bucket, 34.0)
        weather_te     = WEATHER_TE.get(req.weather_condition, 34.0)
        stop_te        = STOP_TE.get(req.stop_type, 34.0)

        # ── Interaction features ───────────────────────────
        # IMPORTANT: uses TARGET ENCODING not label encoding!
        baseline_x_weather = baseline   * weather_te
        stop_x_hour_sin    = stop_te    * hour_sin
        stop_x_hour_cos    = stop_te    * hour_cos

        # ── Build raw feature dict ─────────────────────────
        raw = {
            'stop_type_enc'        : stop_enc,
            'time_bucket_te'       : time_bucket_te,
            'is_weekend'           : req.is_weekend,
            'stop_x_hour_sin'      : stop_x_hour_sin,
            'hour_cos'             : hour_cos,
            'dow_sin'              : dow_sin,
            'baseline_x_weather'   : baseline_x_weather,
            'stop_x_hour_cos'      : stop_x_hour_cos,
            'speed_factor'         : req.speed_factor,
            'weather_condition_enc': weather_enc,
            'hour_sin'             : hour_sin,
            'baseline_crowd'       : baseline,
            'dow_cos'              : dow_cos,
            'traffic_level_enc'    : traffic_enc
        }

        df = pd.DataFrame([raw], columns=CROWD_FEATURE_ORDER)

        # ── Scale 10 continuous columns ────────────────────
        if self.crowd_scaler is not None:
            df[CROWD_SCALE_COLS] = self.crowd_scaler.transform(
                df[CROWD_SCALE_COLS]
            )

        # ── Predict (XGBoost Booster needs DMatrix) ────────
        dmatrix    = xgb.DMatrix(df[CROWD_FEATURE_ORDER])
        passengers = int(max(0, self.crowd_model.predict(dmatrix)[0]))

        level, color, pct = get_crowding(passengers)
        return {
            "passengers_waiting": passengers,
            "crowding_level"    : level,
            "crowding_color"    : color,
            "crowding_pct"      : pct
        }

    def _get_baseline_crowd(self, stop_id, hour, day_of_week) -> float:
        if self.flow_df is None:
            return 34.0
        match = self.flow_df[
            (self.flow_df['stop_id']     == stop_id) &
            (self.flow_df['hour_of_day'] == hour)    &
            (self.flow_df['day_of_week'] == day_of_week)
        ]
        return float(match['avg_passengers_waiting'].mean()) if len(match) > 0 else 34.0

    def _crowd_fallback(self, baseline, req) -> dict:
        weather_mult = {'clear':1.0,'cloudy':1.1,'wind':1.1,
                        'fog':1.2,'rain':1.5,'snow':1.3}
        passengers = int(baseline * weather_mult.get(req.weather_condition, 1.0))
        passengers = max(0, passengers)
        level, color, pct = get_crowding(passengers)
        return {
            "passengers_waiting": passengers,
            "crowding_level"    : level,
            "crowding_color"    : color,
            "crowding_pct"      : pct
        }

    # ══════════════════════════════════════════════════════════
    # STOPS & LINES
    # ══════════════════════════════════════════════════════════

    def get_all_stops(self) -> list:
        if self.stops_df is None:
            return []
        return self.stops_df.to_dict(orient='records')

    def get_all_lines(self) -> list:
        if self.stops_df is None:
            return []
        lines = []
        for line_id, group in self.stops_df.groupby('line_id'):
            lines.append({
                "line_id"  : line_id,
                "line_name": group['line_name'].iloc[0],
                "num_stops": len(group),
                "stop_ids" : group['stop_id'].tolist()
            })
        return lines


# ── SINGLE INSTANCE ───────────────────────────────────────────
predictor = Predictor()


# ── QUICK TEST ────────────────────────────────────────────────
if __name__ == "__main__":
    from schemas import DelayRequest, CrowdRequest
    print("\n🧪 TESTING PREDICTOR")
    print("="*50)

    delay_req = DelayRequest(
        prev_stop_delay       = 5.2,
        speed_factor          = 0.65,
        traffic_level         = "high",
        weather_condition     = "rain",
        temperature_c         = 8.0,
        precipitation_mm      = 5.0,
        wind_speed_kmh        = 20.0,
        humidity_pct          = 80.0,
        hour_of_day           = 8,
        is_weekend            = 0,
        day_of_week           = 1,
        stop_sequence         = 5,
        stop_type             = "university",
        distance_from_prev_km = 0.8,
        is_terminal           = 0,
        is_transfer_hub       = 0
    )
    result = predictor.predict_delay(delay_req)
    print(f"\n🎯 Delay Prediction:")
    for k, v in result.items():
        print(f"  {k:<22}: {v}")

    crowd_req = CrowdRequest(
        stop_id             = "STP-L01-05",
        stop_type           = "university",
        hour_of_day         = 8,
        day_of_week         = 1,
        is_weekend          = 0,
        weather_condition   = "rain",
        traffic_level       = "high",
        speed_factor        = 0.65,
        minutes_to_next_bus = 12.0
    )
    result2 = predictor.predict_crowd(crowd_req)
    print(f"\n👥 Crowd Prediction:")
    for k, v in result2.items():
        print(f"  {k:<22}: {v}")
    print("\n✅ predictor.py ready!")