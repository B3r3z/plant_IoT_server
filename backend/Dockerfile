FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
ENV FLASK_ENV=production
EXPOSE 8000
CMD ["python", "app.py"]