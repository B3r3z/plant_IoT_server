FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Copy frontend files AFTER copying the rest of the backend
COPY ./frontend ./frontend

ENV FLASK_ENV=production
EXPOSE 8000
CMD ["python", "app.py"]