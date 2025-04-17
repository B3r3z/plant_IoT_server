from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    plants = db.relationship('Plant', backref='owner', lazy=True)
class Plant(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    measurements = db.relationship('Measurement', backref='plant', lazy=True)

class Measurement(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    plant_id = db.Column(db.Integer, db.ForeignKey('plant.id'), nullable=False) # New: Foreign Key
    ts = db.Column(db.Integer, index=True) # Add index for faster time-based queries
    moisture = db.Column(db.Float)
    temperature = db.Column(db.Float)
