# MationFacelab Audio2Face-3D RunPod worker.
# Builds NVIDIA's Audio2Face-3D SDK from source WITHOUT a GPU.
# TensorRT engines are generated later, on the RunPod GPU (worker/prepare.py).
FROM nvidia/cuda:12.9.1-devel-ubuntu22.04

ARG A2X_SDK_COMMIT=1ca0f02535ed774f5dbcd724a31cd486368dc783
ARG TRT_VERSION=10.13.3.9-1+cuda12.9
# Ampere (A100=80, A-series/RTX30=86), Ada (L4/L40S/RTX40=89), Hopper (H100=90).
# NVIDIA's default list has 8 architectures; trimmed to fit RunPod's 30-minute docker build limit.
ARG CUDA_ARCHS="80;86;89;90"

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    A2X_SDK=/opt/a2x/sdk \
    A2X_BIN=/opt/a2x/bin/a2f_harness \
    LD_LIBRARY_PATH=/opt/a2x/sdk/_build/release/audio2x-sdk/lib:/usr/local/cuda/lib64:/usr/lib/x86_64-linux-gnu

# TensorRT 10.13.3.9 for CUDA 12.9. Every package in the set is pinned so apt cannot mix in TensorRT 11.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git git-lfs ca-certificates curl ffmpeg python3 python3-pip python-is-python3 build-essential \
      libnvinfer10=${TRT_VERSION} libnvinfer-lean10=${TRT_VERSION} libnvinfer-plugin10=${TRT_VERSION} \
      libnvinfer-vc-plugin10=${TRT_VERSION} libnvinfer-dispatch10=${TRT_VERSION} libnvonnxparsers10=${TRT_VERSION} \
      libnvinfer-headers-dev=${TRT_VERSION} libnvinfer-headers-plugin-dev=${TRT_VERSION} libnvinfer-dev=${TRT_VERSION} \
      libnvinfer-plugin-dev=${TRT_VERSION} libnvonnxparsers-dev=${TRT_VERSION} libnvinfer-bin=${TRT_VERSION} \
 && apt-mark hold libnvinfer10 libnvinfer-lean10 libnvinfer-plugin10 libnvinfer-vc-plugin10 libnvinfer-dispatch10 \
      libnvonnxparsers10 libnvinfer-headers-dev libnvinfer-headers-plugin-dev libnvinfer-dev libnvinfer-plugin-dev \
      libnvonnxparsers-dev libnvinfer-bin \
 && rm -rf /var/lib/apt/lists/*

# Layout for the SDK's FindTensorRT.cmake (TENSORRT_ROOT_DIR/include + lib), and trtexec on PATH.
RUN set -eux; TRTEXEC="$(find / -xdev -type f -name trtexec 2>/dev/null | head -n1)"; test -n "$TRTEXEC"; \
    ln -sf "$TRTEXEC" /usr/local/bin/trtexec; \
    mkdir -p /opt/tensorrt; ln -sf /usr/include/x86_64-linux-gnu /opt/tensorrt/include; ln -sf /usr/lib/x86_64-linux-gnu /opt/tensorrt/lib
ENV TENSORRT_ROOT_DIR=/opt/tensorrt

COPY requirements.txt /opt/worker/requirements.txt
RUN pip install --no-cache-dir -r /opt/worker/requirements.txt

# NVIDIA SDK at a pinned commit. Only the 4-second sample WAV is pulled from Git LFS (used by the self-test).
RUN set -eux; git lfs install --skip-repo; \
    git clone https://github.com/NVIDIA/Audio2Face-3D-SDK.git "$A2X_SDK"; cd "$A2X_SDK"; \
    git checkout "$A2X_SDK_COMMIT"; \
    git lfs pull --include "sample-data/audio_4sec_16k_s16le.wav"; \
    test "$(head -c 4 sample-data/audio_4sec_16k_s16le.wav)" = "RIFF"; \
    ./fetch_deps.sh release

# Compile only the shared SDK library (libaudio2x.so). nvcc cross-compiles for CUDA_ARCHS; no GPU is needed.
RUN set -eux; cd "$A2X_SDK"; export PATH="$PATH:$A2X_SDK/_deps/build-deps/ninja"; \
    ./_deps/build-deps/cmake/bin/cmake -B _build/release -G Ninja -S . -DCMAKE_BUILD_TYPE=Release \
      -DTENSORRT_ROOT_DIR=/opt/tensorrt "-DCMAKE_CUDA_ARCHITECTURES=${CUDA_ARCHS}"; \
    ./_deps/build-deps/cmake/bin/cmake --build _build/release --target audio2x --parallel; \
    test -f _build/release/audio2x-sdk/lib/libaudio2x.so; \
    find _build/release -name '*.o' -delete

COPY harness /opt/worker/harness
RUN set -eux; mkdir -p /opt/a2x/bin; \
    g++ -O2 -std=c++17 /opt/worker/harness/main.cpp \
      -I "$A2X_SDK/audio2face-sdk/include" -I "$A2X_SDK/audio2emotion-sdk/include" -I "$A2X_SDK/audio2x-common/include" \
      -I /usr/local/cuda/include \
      -L "$A2X_SDK/_build/release/audio2x-sdk/lib" -laudio2x -L /usr/local/cuda/lib64 -lcudart \
      -Wl,-rpath,"$A2X_SDK/_build/release/audio2x-sdk/lib" -o "$A2X_BIN"; \
    cp "$A2X_SDK/sample-data/audio_4sec_16k_s16le.wav" /opt/a2x/selftest.wav; \
    printf '{"sdk_commit":"%s","tensorrt":"%s","cuda":"%s","cuda_archs":"%s"}\n' \
      "$A2X_SDK_COMMIT" "$TRT_VERSION" "$CUDA_VERSION" "$CUDA_ARCHS" > /opt/a2x/BUILD_INFO.json

COPY worker /opt/worker/worker
COPY scripts /opt/worker/scripts
RUN chmod +x /opt/worker/scripts/*.sh
WORKDIR /opt/worker
CMD ["/opt/worker/scripts/start.sh"]
