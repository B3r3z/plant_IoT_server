import os, json
from flask import Flask, request, jsonify
from flask_mqtt import Mqtt
from models import db, Measurement, Plant

app = Flask(__name__)
app.config.update(
    SQLALCHEMY_DATABASE_URI=os.getenv("DATABASE_URL", "sqlite:///fallback.db"),
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    MQTT_BROKER_URL=os.getenv("MQTT_BROKER_URL", "localhost"),
)
db.init_app(app)
mqtt = Mqtt(app)

# --- MQTT callbacks -------------------------------------------------

@mqtt.on_connect()
def handle_connect(*_):
    mqtt.subscribe("plant/+/telemetry")

@mqtt.on_message()
def handle_message(_, __, msg):
    try:
        plant_id = int(msg.topic.split("/")[1])
        data = json.loads(msg.payload)
    except (IndexError, ValueError, json.JSONDecodeError) as e:
        print(f"Error processing message: {e}, Topic: {msg.topic}, Payload: {msg.payload}")
        return

    ts = data.get("timestamp")
    moisture = data.get("moisture")
    temperature = data.get("temperature")

    if ts is None or moisture is None or temperature is None:
        print(f"Missing data in message for plant {plant_id}: {data}")
        return

    with app.app_context():
        plant = Plant.query.get(plant_id)
        if plant is None:
            print(f"Received measurement for unknown plant ID: {plant_id}")
            return

        row = Measurement(
            plant_id=plant_id,
            ts=ts,
            moisture=moisture,
            temperature=temperature
        )
        db.session.add(row)
        db.session.commit()
        print(f"Stored measurement for plant {plant_id}")

        if moisture < 30:
            print(f"Low moisture ({moisture}%) for plant {plant_id}. Sending water command.")
            mqtt.publish(f"plant/{plant_id}/cmd/water",
                         json.dumps({"duration_ms": 5000}), qos=1)

# --- REST API -------------------------------------------------------

@app.route("/api/measurements/<int:plant_id>")
def get_measurements(plant_id):
    plant = Plant.query.get(plant_id)
    if plant is None:
        return jsonify({"error": "Plant not found"}), 404

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
    plant = Plant.query.get(plant_id)
    if plant is None:
        return jsonify({"error": "Plant not found"}), 404

    duration = request.json.get("duration_ms", 5000)
    if not isinstance(duration, int) or duration <= 0:
        return jsonify({"error": "Invalid duration_ms"}), 400

    mqtt.publish(f"plant/{plant_id}/cmd/water",
                 json.dumps({"duration_ms": duration}), qos=1)
    print(f"Manual water command sent to plant {plant_id} for {duration}ms")
    return {"status": "queued"}, 202

# -------------------------------------------------------------------

if __name__ == "__main__":
    with app.app_context():
        try:
            db.create_all()
            print("Database tables created (if they didn't exist).")
        except Exception as e:
            print(f"Error during initial db setup: {e}")
    app.run(host="0.0.0.0", port=8000, debug=os.getenv("FLASK_DEBUG", "False").lower() == "true")
