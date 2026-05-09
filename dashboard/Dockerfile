FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends gcc libsasl2-dev nodejs npm \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/dashboard-requirements.txt
RUN pip install --no-cache-dir -r /tmp/dashboard-requirements.txt

CMD ["tail", "-f", "/dev/null"]
