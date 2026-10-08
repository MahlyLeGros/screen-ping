FROM node:22.20.0-bookworm-slim AS js-runtime
FROM python:3.12-slim
COPY --from=js-runtime /usr/local/bin/node /usr/local/bin/node

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p uploads

EXPOSE 8000

CMD ["uvicorn", "run:app", "--host", "0.0.0.0", "--port", "8000"]
