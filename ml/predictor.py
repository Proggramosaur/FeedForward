import joblib
import numpy as np
from pathlib import Path

MODEL_DIR = Path(__file__).parent / "models"

# Load models once at import time
_delay_model    = None
_headway_model  = None
_crowding_model = None

def _load_models():
    global _delay_model, _headway_model, _crowding_model
    try:
        _delay_model    = joblib.load(MODEL_DIR / "delay_estimator.joblib")
        _headway_model  = joblib.load(MODEL_DIR / "headway_classifier.joblib")
        _crowding_model = joblib.load(MODEL_DIR / "crowding_model.joblib")
        print("ML models loaded.")
    except FileNotFoundError as e:
        print(f"Warning: ML model not found — {e}. Run ml/train_models.py first.")

_load_models()


def predict_delay(headway_margin_violated_sec: float,
                  is_peak_hour: int,
                  downstream_recovery_slack_sec: float,
                  dwell_buffer_sec: float,
                  num_downstream_stops: int,
                  historical_delay_propagation_rate: float) -> dict:
    if _delay_model is None:
        return {"estimated_cascade_delay_sec": None, "confidence": None}

    features = np.array([[
        headway_margin_violated_sec,
        is_peak_hour,
        downstream_recovery_slack_sec,
        dwell_buffer_sec,
        num_downstream_stops,
        historical_delay_propagation_rate
    ]])
    prediction = float(_delay_model.predict(features)[0])
    # RF confidence approximated via std of tree predictions
    tree_preds = np.array([t.predict(features)[0] for t in _delay_model.estimators_])
    std        = float(np.std(tree_preds))
    confidence = round(max(0.0, 1.0 - (std / max(prediction, 1))), 2)

    return {
        "estimated_cascade_delay_sec": round(prediction, 1),
        "confidence": min(confidence, 1.0)
    }


def predict_headway_risk(mean_headway_sec: float,
                          headway_variance: float,
                          peak_off_peak_ratio: float,
                          min_headway_sec: float,
                          num_trips: int) -> dict:
    if _headway_model is None:
        return {"risk_flag": None, "confidence": None}

    features   = np.array([[mean_headway_sec, headway_variance,
                             peak_off_peak_ratio, min_headway_sec, num_trips]])
    risk_flag  = int(_headway_model.predict(features)[0])
    proba      = _headway_model.predict_proba(features)[0]
    confidence = round(float(max(proba)), 2)

    return {"risk_flag": risk_flag, "confidence": confidence}


def predict_crowding(headway_sec: float,
                     hour_of_day: int,
                     stop_position_ratio: float,
                     is_weekday: int,
                     num_trips_per_hour: float) -> dict:
    if _crowding_model is None:
        return {"predicted_load_factor": None, "confidence": None}

    features   = np.array([[headway_sec, hour_of_day, stop_position_ratio,
                             is_weekday, num_trips_per_hour]])
    prediction = float(_crowding_model.predict(features)[0])
    tree_preds = np.array([t.predict(features)[0] for t in _crowding_model.estimators_])
    std        = float(np.std(tree_preds))
    confidence = round(max(0.0, 1.0 - (std / max(prediction, 1))), 2)

    return {
        "predicted_load_factor": round(min(max(prediction, 0.0), 1.0), 3),
        "confidence": min(confidence, 1.0)
    }