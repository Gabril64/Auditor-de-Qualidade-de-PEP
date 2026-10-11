FROM python:3.13-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

COPY services/worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/worker/worker/worker.py .
COPY data_extract/ ./data_extract/

CMD ["python", "worker.py"]