FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV INFERENCE_HOST=0.0.0.0
ENV INFERENCE_PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host ${INFERENCE_HOST} --port ${INFERENCE_PORT}"]
