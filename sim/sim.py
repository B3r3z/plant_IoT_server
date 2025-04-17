import json, random, time, os, paho.mqtt.client as mqtt

PLANT_ID = 1
HOST = os.getenv("MQTT_HOST", "broker")

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, "sim‑esp32")
client.connect(HOST, 1883, 60)

while True:
    payload = {
        "timestamp": int(time.time()),
        "moisture": round(random.uniform(20, 45), 1),
        "temperature": round(random.uniform(20, 25), 1)
    }
    topic = f"plant/{PLANT_ID}/telemetry"
    client.publish(topic, json.dumps(payload))
    print("TX", payload)
    time.sleep(10)
