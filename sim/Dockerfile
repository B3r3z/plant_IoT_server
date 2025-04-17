FROM python:3.12-slim
WORKDIR /sim
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY sim.py .
CMD ["python", "sim.py"]