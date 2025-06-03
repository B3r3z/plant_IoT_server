#!/bin/bash
set -e

# Wait for database to be ready
echo "Waiting for database..."
until PGPASSWORD=kwiatki_secret_pw psql -h db -U kwiatki_user -d kwiatki_db -c '\q' 2>/dev/null; do
  echo "Database not ready yet - sleeping 1s"
  sleep 1
done
echo "Database is ready!"

# Initialize the database
echo "Initializing database tables..."
python -c "
from app import app, db
with app.app_context():
    db.create_all()
    print('Database tables created successfully')
"

# Start the Flask application
echo "Starting Flask application..."
exec python app.py