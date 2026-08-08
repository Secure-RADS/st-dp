FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libcap2-bin \
    && rm -rf /var/lib/apt/lists/*
COPY main.py /main.py
ENTRYPOINT ["python3", "/main.py"]
