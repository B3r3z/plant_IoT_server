import os, json
from flask import Flask, request, jsonify, send_from_directory
from flask_mqtt import Mqtt
from models import db, Measurement, Plant, User
from flask_bcrypt import Bcrypt
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
FRONTEND_FOLDER = os.path.join(BASE_DIR, 'frontend')

app = Flask(__name__, static_folder=FRONTEND_FOLDER)

app.config.update(
    SQLALCHEMY_DATABASE_URI=os.getenv("DATABASE_URL", "sqlite:///fallback.db"),
    SQLALCHEMY_TRACK_MODIFICATIONS=False,
    MQTT_BROKER_URL=os.getenv("MQTT_BROKER_URL", "localhost"),
    JWT_SECRET_KEY=os.getenv("JWT_SECRET", "super-secret-key-please-change")
)
db.init_app(app)
mqtt = Mqtt(app)
bcrypt = Bcrypt(app)
jwt = JWTManager(app)

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

# --- Auth Endpoints -------------------------------------------------

@app.route("/auth/register", methods=["POST"])
def register():
    data = request.json
    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify({"msg": "Email and password required"}), 400

    user_exists = User.query.filter_by(email=email).first()
    if user_exists:
        return jsonify({"msg": "Email already registered"}), 409

    pw_hash = bcrypt.generate_password_hash(password).decode('utf-8')
    new_user = User(email=email, password_hash=pw_hash)
    try:
        db.session.add(new_user)
        db.session.commit()
        return jsonify({"msg": "User registered successfully"}), 201
    except Exception as e:
        db.session.rollback()
        print(f"Error during registration: {e}")
        
        return jsonify({"msg": "Registration failed"}), 500


@app.route("/auth/login", methods=["POST"])
def login():
    data = request.json
    email = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify({"msg": "Email and password required"}), 400

    user = User.query.filter_by(email=email).first()
    if user and bcrypt.check_password_hash(user.password_hash, password):
        access_token = create_access_token(identity=user.id)
        return jsonify(access_token=access_token)
    else:
        return jsonify({"msg": "Bad email or password"}), 401

# --- REST API -------------------------------------------------------

@app.route("/api/plants", methods=["GET"])
@jwt_required()
def get_user_plants():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"msg": "User not found"}), 404

    plants = [{"id": p.id, "name": p.name} for p in user.plants]
    return jsonify(plants)

@app.route("/api/plants", methods=["POST"])
@jwt_required()
def create_plant():
    current_user_id = get_jwt_identity()
    data = request.get_json()
    name = data.get("name")

    if not name:
        return jsonify({"error": "Plant name is required"}), 400

    user = User.query.get(current_user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    new_plant = Plant(name=name, user_id=current_user_id)
    db.session.add(new_plant)
    db.session.commit()
    return jsonify({"id": new_plant.id, "name": new_plant.name, "user_id": new_plant.user_id}), 201

@app.route("/api/measurements/<int:plant_id>")
@jwt_required()
def get_measurements(plant_id):
    current_user_id = get_jwt_identity()
    plant = Plant.query.filter_by(id=plant_id, user_id=current_user_id).first()
    if plant is None:
        return jsonify({"error": "Plant not found or access denied"}), 404

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
@jwt_required()
def manual_water(plant_id):
    current_user_id = get_jwt_identity()
    plant = Plant.query.filter_by(id=plant_id, user_id=current_user_id).first()
    if plant is None:
        return jsonify({"error": "Plant not found or access denied"}), 404

    duration = request.json.get("duration_ms", 5000)
    if not isinstance(duration, int) or duration <= 0:
        return jsonify({"error": "Invalid duration_ms"}), 400

    mqtt.publish(f"plant/{plant_id}/cmd/water",
                 json.dumps({"duration_ms": duration}), qos=1)
    print(f"Manual water command sent to plant {plant_id} for {duration}ms by user {current_user_id}")
    return {"status": "queued"}, 202

# --- Frontend Serving Routes ----------------------------------------

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

# -------------------------------------------------------------------

if __name__ == "__main__":
    with app.app_context():
        try:
            db.create_all()
            print("Database tables created (if they didn't exist).")
        except Exception as e:
            print(f"Error during initial db setup: {e}")
    app.run(host="0.0.0.0", port=8000, debug=os.getenv("FLASK_DEBUG", "False").lower() == "true")
