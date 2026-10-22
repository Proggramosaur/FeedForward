import pandas as pd
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, accuracy_score
import joblib
from pathlib import Path

DATA_DIR  = Path(__file__).parent / "data"
MODEL_DIR = Path(__file__).parent / "models"
MODEL_DIR.mkdir(exist_ok=True)

def train_delay_estimator():
    df = pd.read_csv(DATA_DIR / "delay_training.csv")
    X  = df.drop(columns=["estimated_cascade_delay_sec"])
    y  = df["estimated_cascade_delay_sec"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    model = RandomForestRegressor(n_estimators=100, random_state=42)
    model.fit(X_train, y_train)

    mae = mean_absolute_error(y_test, model.predict(X_test))
    print(f"Delay Estimator MAE: {mae:.1f} sec")

    joblib.dump(model, MODEL_DIR / "delay_estimator.joblib")
    print("Saved delay_estimator.joblib")


def train_headway_classifier():
    df = pd.read_csv(DATA_DIR / "headway_pattern_training.csv")
    X  = df.drop(columns=["risk_flag"])
    y  = df["risk_flag"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X_train, y_train)

    acc = accuracy_score(y_test, model.predict(X_test))
    print(f"Headway Classifier Accuracy: {acc:.2%}")

    joblib.dump(model, MODEL_DIR / "headway_classifier.joblib")
    print("Saved headway_classifier.joblib")


def train_crowding_model():
    df = pd.read_csv(DATA_DIR / "crowding_training.csv")
    X  = df.drop(columns=["predicted_load_factor"])
    y  = df["predicted_load_factor"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    model = RandomForestRegressor(n_estimators=100, random_state=42)
    model.fit(X_train, y_train)

    mae = mean_absolute_error(y_test, model.predict(X_test))
    print(f"Crowding Model MAE: {mae:.4f} load factor")

    joblib.dump(model, MODEL_DIR / "crowding_model.joblib")
    print("Saved crowding_model.joblib")


if __name__ == "__main__":
    print("Training Delay Estimator...")
    train_delay_estimator()

    print("\nTraining Headway Pattern Classifier...")
    train_headway_classifier()

    print("\nTraining Crowding Model...")
    train_crowding_model()

    print("\nAll models trained and saved.")