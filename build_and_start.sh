#!/bin/bash

# Stop and remove existing containers to start fresh
echo "Stopping existing containers..."
docker-compose down

# Optionally remove volumes if you want a completely fresh start
echo "Removing volumes..."
docker volume rm server_backedn_postgres-data server_backedn_mosquitto-data 2>/dev/null || true

echo "Building and starting all services..."
# Build and start ALL services, not just backend and sim
docker-compose up --build -d

echo "All services should be starting now."
echo "Use 'docker-compose logs -f' to view logs."