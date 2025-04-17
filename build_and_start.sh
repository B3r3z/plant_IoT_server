#!/bin/bash

# Script to start the backend and sim services in detached mode

echo "Starting backend and sim services..."

docker-compose up --build -d backend sim

echo "Services backend and sim should be starting."
echo "Use 'docker-compose logs -f backend sim' to view logs."

