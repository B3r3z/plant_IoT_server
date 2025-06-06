import os, json
from flask import Flask, request, jsonify, send_from_directory
from flask_mqtt import Mqtt
from models import db, Measurement, Plant, User
from flask_bcrypt import Bcrypt
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
FRONTEND_FOLDER = os.path.join(BASE_DIR, 'frontend')
STATIC_FOLDER = os.path.join(FRONTEND_FOLDER, 'static')  # Define static folder path

app = Flask(__name__, static_folder=STATIC_FOLDER, static_url_path='/static')

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

# --- Debugging: Log Headers ---
@app.before_request
def log_request_info():
    # Avoid logging for static files to reduce noise
    if request.path.startswith('/static'):
        return
    # Use app.logger for better practice in Flask, but print works too
    print(f"Incoming Request: {request.method} {request.path}")
    # Specifically check for the Authorization header
    auth_header = request.headers.get('Authorization')
    print(f"Authorization Header: {auth_header}")
    # You can print all headers if needed: print(f"Headers: {request.headers}")

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
        plant = db.session.get(Plant, plant_id)
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
        access_token = create_access_token(identity=str(user.id))
        return jsonify(access_token=access_token)
    else:
        return jsonify({"msg": "Bad email or password"}), 401

# --- REST API -------------------------------------------------------

@app.route("/api/me", methods=["GET"])
@jwt_required()
def get_me():
    current_user_id = get_jwt_identity()
    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"msg": "User not found"}), 404
    return jsonify({"id": user.id, "email": user.email})

@app.route("/api/plants", methods=["GET"])
@jwt_required()
def get_user_plants():
    current_user_id = get_jwt_identity()
    user = db.session.get(User, current_user_id)
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
    plant_id = data.get("plant_id")
    if plant_id:
        existing_plant = Plant.query.get(plant_id)
        if existing_plant:
            return jsonify({"error": "Plant ID already exists"}), 409
    if not name:
        return jsonify({"error": "Plant name is required"}), 400

    user = db.session.get(User, current_user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    #new_plant = Plant(name=name, user_id=current_user_id)
    if plant_id:
        new_plant = Plant(id=plant_id, name=name, user_id=current_user_id)
    else:
        new_plant = Plant(name=name, user_id=current_user_id)
    db.session.add(new_plant)
    db.session.commit()
    return jsonify({"id": new_plant.id, "name": new_plant.name, "user_id": new_plant.user_id}), 201

@app.route("/api/plants/<int:plant_id>", methods=["DELETE"])
@jwt_required()
def delete_plant(plant_id):
    current_user_id = get_jwt_identity()
    plant = Plant.query.filter_by(id=plant_id, user_id=current_user_id).first()
    
    if plant is None:
        return jsonify({"error": "Plant not found or access denied"}), 404
    
    try:
        # Usuń wszystkie pomiary powiązane z rośliną
        Measurement.query.filter_by(plant_id=plant_id).delete()
        # Usuń roślinę
        db.session.delete(plant)
        db.session.commit()
        return jsonify({"msg": "Plant deleted successfully"}), 200
    except Exception as e:
        db.session.rollback()
        print(f"Error during plant deletion: {e}")
        return jsonify({"error": "Failed to delete plant"}), 500

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

@app.route("/api/plants/ids", methods=["GET"])
@jwt_required()
def get_plant_ids():
    """Return list of plant IDs that belong to the current user"""
    current_user_id = get_jwt_identity()
    plants = Plant.query.filter_by(user_id=current_user_id).all()
    plant_ids = [plant.id for plant in plants]
    return jsonify({"plant_ids": plant_ids})

# --- Frontend Serving Routes ----------------------------------------

@app.route('/')
def serve_index():
    return send_from_directory(FRONTEND_FOLDER, 'index.html')

# -------------------------------------------------------------------

if __name__ == "__main__":
    with app.app_context():
        try:
            db.create_all()
            print("Database tables created (if they didn't exist).")
        except Exception as e:
            print(f"Error during initial db setup: {e}")
    app.run(host="0.0.0.0", port=8000, debug=os.getenv("FLASK_DEBUG", "False").lower() == "true")
