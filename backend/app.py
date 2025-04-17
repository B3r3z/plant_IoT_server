import os, json
from flask import Flask, request, jsonify
from flask_mqtt import Mqtt
from models import db, Measurement

app = Flask(__name__)
app.config.update(
    SQLALCHEMY_DATABASE_URI = "sqlite:///demo.db",
    SQLALCHEMY_TRACK_MODIFICATIONS = False,
    MQTT_BROKER_URL = "broker",   # nazwa usługi z docker-compose
)
db.init_app(app)
mqtt = Mqtt(app)

# --- MQTT callbacks -------------------------------------------------

@mqtt.on_connect()
def handle_connect(*_):
    mqtt.subscribe("plant/+/telemetry")

@mqtt.on_message()
def handle_message(_, __, msg):
    plant_id = int(msg.topic.split("/")[1])
    data = json.loads(msg.payload)
    row = Measurement(
        plant_id=plant_id,
        ts=data.get("timestamp"),
        moisture=data.get("moisture"),
        temperature=data.get("temperature")
    )
    if row.ts is not None and row.moisture is not None and row.temperature is not None:
        with app.app_context():
            db.session.add(row)
            db.session.commit()
            if data["moisture"] < 30:
                mqtt.publish(f"plant/{plant_id}/cmd/water",
                             json.dumps({"duration_ms": 5000}), qos=1)

# --- REST API -------------------------------------------------------

@app.route("/api/measurements/<int:plant_id>")
def get_measurements(plant_id):
    rows = (Measurement.query
            .filter_by(plant_id=plant_id)
            .order_by(Measurement.ts.desc())
            .limit(100))
    return jsonify([{
        "ts": r.ts,
        "moisture": r.moisture,
        "temperature": r.temperature
    } for r in rows])

@app.route("/api/plants/<int:plant_id>/water", methods=["POST"])
def manual_water(plant_id):
    duration = request.json.get("duration_ms", 5000)
    mqtt.publish(f"plant/{plant_id}/cmd/water",
                 json.dumps({"duration_ms": duration}), qos=1)
    return {"status": "queued"}, 202

# -------------------------------------------------------------------

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(host="0.0.0.0", port=8000)
