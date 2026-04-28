# RotaZeka 🚌
 
**Predictive Transit — Smart Urban Mobility for Sivas**
 
> When will the bus *actually* arrive?
 
RotaZeka predicts bus arrival delays and stop crowding levels in real time, using traffic, weather, and historical transit data — so commuters can plan their time instead of just waiting.
 
> 🏆 **1st Place** — Yandex & Sivas University of Science and Technology Anatolian Hackathon 2026  
> Evaluated by Machine Learning experts at Yandex and Professors at SUST.
 
---
 
## Live Demo
 
🔗 [team-035.hackaton.sivas.edu.tr](https://team-035.hackaton.sivas.edu.tr/)
 
---
 
## How it works — user flow
 
1. Open RotaZeka in your browser
2. Select your bus line (e.g. L01 — Merkez to University)
3. Select your stop (e.g. STP-L01-04)
4. Set weather and traffic conditions (or click **Get Current Weather**)
5. Click **PREDICT →**
6. In under 1 second, two cards appear:
   - **Delay card** — "Bus is 6.3 minutes late, arrives at 08:42"
   - **Crowd card** — "96 people waiting — VERY CROWDED"
7. The app auto-refreshes every 30 seconds with the latest prediction
---
 
## Models
 
### Model 1 — Delay Prediction
 
Predicts how many minutes late a bus will arrive at a given stop.
 
**Features:** `prev_stop_delay`, `speed_factor`, `traffic_level`, `weather_condition`, `temperature_c`, `precipitation_mm`, `wind_speed_kmh`, `humidity_pct`, `hour_of_day`, `is_weekend`, `day_of_week`, `stop_sequence`, `stop_type`, `distance_from_prev_km`, `is_terminal`, `is_transfer_hub`
 
**Model comparison (MAE ↓):**
 
| Model | MAE |
|---|---|
| **LightGBM** ✅ | **0.164** |
| Random Forest | 0.178 |
| Decision Tree | 0.272 |
| KNN | 1.027 |
| Linear Regression | 1.479 |
 
**Final model:** LightGBM — MAE = 0.164 min (≈ 10 seconds typical error), RMSE = 0.273, R² = 0.9991
 
Top features: `prev_stop_delay` (24.8%), `speed_factor` (16.7%), `distance_from_prev_km` (13.0%)
 
---
 
### Model 2 — Crowd Estimation
 
Predicts how many passengers will be waiting at a stop.
 
**Features:** `stop_id`, `stop_type`, `hour_of_day`, `day_of_week`, `is_weekend`, `weather_condition`, `traffic_level`, `speed_factor`, `minutes_to_next_bus`
 
Three strategies were explored:
 
#### 1. Individual models
CatBoost, LightGBM, XGBoost, and Random Forest were trained and compared across stop types (regular, residential, market, hospital, terminal, university).
 
#### 2. Ensemble via stacking
A stacking ensemble with Linear Regression as meta-learner. LightGBM received the highest weight across all meta-learner configurations.
Results: RMSE = 6.692, MAE = 4.570, R² = 0.9419
 
#### 3. Hierarchical modeling
- **Strategy A — Extreme oversampling:** Flagged rows where `passengers > 87.3` (mean + 2σ), duplicated 188 extreme rows 2×. Best result: RMSE = 6.560, MAE = 4.415, R² = 0.941. Hospital MAE: −12%, University MAE: −12%.
- **Strategy B — Split by stop type:** Model-Low (regular/residential/market/hospital) achieved RMSE = 3.851, MAE = 2.698, R² = 0.921. Model-High (terminal/university) underfitted due to insufficient data.
**Crowd prediction leaderboard:**
 
| Rank | Model | RMSE | MAE | R² |
|---|---|---|---|---|
| 🥇 1 | XGB-StratA-2x | 6.56 | 4.414 | 0.941 |
| 2 | Ensemble (Stack) | 6.691 | 4.569 | 0.941 |
| 3 | XGBoost | 6.722 | 4.578 | 0.941 |
| 4 | LightGBM | 6.879 | 4.695 | 0.939 |
| 5 | CatBoost | 6.914 | 4.712 | 0.938 |
| 6 | Random Forest (baseline) | 7.511 | 4.987 | 0.926 |
 
> The final model reduces RMSE by **75%** compared to a naive always-average baseline (target std = 26.6 → model RMSE = 6.56).
 
---
 
## Tech stack
 
| Layer | Tools |
|---|---|
| ML models | LightGBM, XGBoost-StartA-2x |
| Backend | FastAPI |
| Weather | Weather API (live conditions) |
| Frontend | Web app (auto-refresh every 30s) |
 
100% open source · No GPU · No ML platform
 
---
