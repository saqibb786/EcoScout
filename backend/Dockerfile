FROM python:3.11-slim

# Set working directory
WORKDIR /code

# Install system dependencies needed by OpenCV and model compiles
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libglib2.0-0 \
    libgomp1 \
    libgl1 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libxcb1 \
    libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file first to utilize Docker build cache
COPY requirements-cpu.txt /code/requirements-cpu.txt

# Upgrade pip and install packages
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /code/requirements-cpu.txt

# Create cache directory for model downloads (EasyOCR / PyTorch)
# HF Spaces run with user UID 1000, so we must make the home cache directory writable
RUN mkdir -p /code/.cache && chmod -R 777 /code/.cache
ENV HOME=/code
ENV HF_HOME=/code/.cache

# Copy all application files
COPY . /code

# Grant permissions to all files in workdir
RUN chmod -R 777 /code

# Hugging Face default port
ENV PORT=7860
EXPOSE 7860

# Run FastAPI app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
