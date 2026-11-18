FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY seobot ./seobot
COPY sites.json .
RUN useradd -u 1000 -m bot
USER bot
ENTRYPOINT ["python", "-m", "seobot.main"]
