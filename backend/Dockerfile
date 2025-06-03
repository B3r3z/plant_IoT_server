FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
RUN apt-get update && apt-get install -y postgresql-client

COPY . .

# Copy frontend files AFTER copying the rest of the backend
COPY ./frontend ./frontend

COPY entry.sh /entry.sh
RUN chmod +x /entry.sh


ENV FLASK_ENV=production
EXPOSE 8000
ENTRYPOINT ["/entry.sh"]
CMD ["python", "app.py"]

