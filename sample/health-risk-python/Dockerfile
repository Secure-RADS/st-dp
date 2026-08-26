FROM python:3.12-slim

COPY main.py /app/main.py

ENV PYTHONUNBUFFERED=1
ENV PATH="/usr/local/bin:/usr/bin:/bin"
ENTRYPOINT ["python3", "/app/main.py"]
