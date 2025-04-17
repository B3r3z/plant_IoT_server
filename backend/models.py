from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()

class Measurement(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    plant_id = db.Column(db.Integer)
    ts = db.Column(db.Integer)
    moisture = db.Column(db.Float)
    temperature = db.Column(db.Float)
