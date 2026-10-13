# MationFacelab Audio2Face-3D worker (RunPod Serverless)

Runs NVIDIA's Audio2Face-3D SDK (commit 1ca0f02) with these models:
- Audio2Face-3D v3.0 (diffusion)
- Audio2Emotion v2.2
- the SDK's blendshape solver

It returns per-frame blendshape weights in the format the MationFacelab app expects.

## Status of this package

| Stage | Status |
| --- | --- |
| Source written | Yes. Python and shell files syntax-checked. The C++ engine (harness) compiles (syntax only) against the SDK's public headers at the pinned commit. |
| Container built | No. Not built yet; the first build happens on RunPod or GitHub Actions. |
| GPU initialized | No. Happens on the first RunPod start. |
| Inference verified | No. Only after the Admin "Run real inference test" returns inference_ok: true. |

## Repository layout

~~~
Dockerfile                      <- Dockerfile path for RunPod: /Dockerfile (repo root)
requirements.txt                runpod 1.12.0, huggingface-hub 0.34.3, numpy 1.23.5
harness/main.cpp                C++: A2E -> A2F v3.0 diffusion -> blendshape solver -> JSON
worker/handler.py               RunPod handler (job, self_test, diagnose)
worker/prepare.py               GPU init: model download, TensorRT engine build, cache, locking
worker/diagnose.py              environment report
scripts/start.sh                container entrypoint
scripts/prepare_engines.sh      manual cache (re)build
scripts/diagnose.sh             manual diagnostics
tests/*.json                    sample RunPod requests
.github/workflows/build-image.yml   cloud-build alternative (GitHub Actions -> ghcr.io)
~~~

## Pinned versions

- Base image: nvidia/cuda:12.9.1-devel-ubuntu22.04 (Python 3.10)
- TensorRT: 10.13.3.9-1+cuda12.9 (every apt package pinned and held)
- SDK: NVIDIA/Audio2Face-3D-SDK @ 1ca0f02535ed774f5dbcd724a31cd486368dc783
- Models:
  - nvidia/Audio2Face-3D-v3.0 @ b74132732fd9a9d29b237bec193ded64c9745e91
  - nvidia/Audio2Emotion-v2.2 @ ce1358310179ed7f6b6ea63fe4fa9de5694c1b87
- CUDA architectures compiled: 80, 86, 89, 90

## Build and GPU initialization are separate

**Docker build (no GPU):**
- installs TensorRT
- clones the SDK
- runs NVIDIA's fetch_deps.sh
- compiles libaudio2x.so with nvcc
- compiles the harness

No models and no tokens are used here.

**First job, or worker start (on the GPU), in worker/prepare.py:**
1. Downloads the models from Hugging Face into the network volume.
2. Runs NVIDIA's own converter (audio2x/trt.py, which calls trtexec) to build the TensorRT engines.

**Cache:**
- Location: MODEL_DIR/engines/<key>. The default is /runpod-volume/mationfacelab-a2x.
- The key is a hash of:
  - both model revisions
  - GPU name and compute capability
  - driver major version
  - TensorRT version
  - CUDA version
  - SDK commit

**Interrupted preparation:**
- The build is written to <key>.partial-<pid> and renamed into place only when it finishes.
- Leftover partial folders are deleted on the next attempt.
- A file lock stops two workers from building the same cache at once.

**Progress:**
- Shown in the worker logs as [prepare] {...} lines.
- Written to MODEL_DIR/status.json.
- Sent to the job's progress output, which you can see when polling.

## Model access (Hugging Face)

**Licenses to accept**, with the same Hugging Face account that owns the token:
- https://huggingface.co/nvidia/Audio2Emotion-v2.2 is gated: click "Agree and access repository".
- https://huggingface.co/nvidia/Audio2Face-3D-v3.0 is not gated at the pinned revision, but it is under the NVIDIA Open Model License. Review it on that page.

**Token:**
- Create it at https://huggingface.co/settings/tokens.
- Use a Fine-grained token with only "Read access to contents of all public gated repos you can access". No write access.

**Where to put it:**
1. In the RunPod console, go to Secrets and create a secret, e.g. hf_token.
2. In the endpoint's environment variables, set HF_TOKEN = {{ RUNPOD_SECRET_hf_token }}.

**Keeping it out of the image:** the token is never used at build time. It is not in the Dockerfile, in the image layers, or in this package.

## Deploy option A: RunPod "Import Git Repository"

1. Create a GitHub repository (private is fine) and upload the contents of this folder to the root of the main branch.
2. In RunPod, go to Settings, then Connections, then GitHub, and connect your account.
3. Go to Serverless, then New Endpoint, then Import Git Repository, and pick the repository.
   - Branch: main
   - Dockerfile Path: Dockerfile
4. Apply the endpoint settings below and deploy.
5. Watch the Builds tab. RunPod's limits are 30 minutes for the docker build step and 160 minutes in total.

## Deploy option B: cloud build on GitHub Actions (if option A exceeds the 30-minute limit)

1. In the same repository, open Actions, choose "Build worker image", and click Run workflow with version 0.1.0.
2. The workflow pushes ghcr.io/<owner>/<repo>:0.1.0.
3. Give RunPod access to the image, either way:
   - Make the package public: GitHub, then Packages, then the package settings, then visibility.
   - Or add a registry credential in RunPod using a GitHub token with read:packages.
4. In RunPod, go to New Endpoint, then Docker image, and enter ghcr.io/<owner>/<repo>:0.1.0.

## Proposed endpoint settings

| Setting | Value |
| --- | --- |
| Endpoint type | Queue |
| GPU | Select one 24 GB class only (e.g. L4, A5000 or RTX 4090) so all workers share one engine cache. Any of compute capability 8.0, 8.6, 8.9 or 9.0 works. |
| Container disk | 40 GB |
| Network volume | 20 GB, attached at /runpod-volume, in the same data center as the GPU |
| Active / max workers | 0 / 1 (raise max to 2 only after the self-test passes) |
| Idle timeout | 60 s |
| Execution timeout | 1800 s (the first job on a new GPU type includes the engine build) |
| Environment variables | HF_TOKEN = {{ RUNPOD_SECRET_hf_token }}. Optional: A2F_IDENTITY = 0 (diffusion identity index), PREPARE_ON_START = 1 |

## Interface (matches MationFacelab's backend functions)

**Job request**, sent by the app's submitPerformanceJob:

~~~json
{"input": {"audio_url": "<signed url>", "range_start": 27, "range_end": 36,
           "model": "audio2face-3d-v3.0", "emotion": "audio2emotion", "output": "blendshapes", "job_ref": "<id>"}}
~~~

**Job output**, checked by the app's getJobStatus:

~~~json
{"channels": ["<solver pose name>", ...], "fps": 30.0, "frames": [[w0, w1, ...], ...],
 "ranges": {"<channel>": [min, max]}, "timing": {...}, "model_info": {...}, "inference_ok": true}
~~~

**Field details:**
- **channels:** the pose names reported by the SDK's skin solver, followed by the tongue solver's poses if the executor returns them. They are never renamed, except that a tongue name that clashes with a skin name gets the prefix tongue_.
- **fps:** derived from the SDK's own frame timestamps (16 kHz samples). It is not assumed. The job fails if the value is outside 10 to 240.
- **Timeline origin:** frames[0] is at range_start, in seconds, on the vocal file's own timeline. frames[i] is at range_start + i / fps.
- **Audio context:** 1 second of audio before the excerpt is fed to the model and then discarded, so the first frames have real context. Frames are picked by the SDK timestamps, so any model latency is absorbed.
- **Project offset:** the app applies the project's audio offset during playback. The worker does not change it.
- **Value ranges:** no clamping in the worker. The ranges field shows the minimum and maximum that were actually produced. The app's viewport currently caps each value at 1 after gain, and does not clamp negative values.
- **self_test:** {"input": {"self_test": true}} runs the complete pipeline on NVIDIA's 4-second sample clip. It returns inference_ok: true only when frames were produced and at least one channel moved by more than 0.001.
- **diagnose:** {"input": {"diagnose": true}} reports the GPU, versions, cache state, the last preparation status and library linking. It runs no inference.

## Verification

In MationFacelab, open Admin and click **Run real inference test**. A successful result shows:
- inference_ok: true
- channels: more than 0 (one name per solver pose)
- frames: about 4 s times fps
- model_info, including the GPU, the TensorRT and CUDA versions, the SDK commit and the identity

If the test fails, send {"input":{"diagnose":true}} from the endpoint's Requests tab and read the result.

## Known untested points

- The first real build may reveal compile or packaging issues that only show up with the full CUDA toolchain. Check the Builds tab logs.
- RunPod limits the size of the result payload. Long full-song outputs (e.g. 3 minutes at 30 fps with roughly 60 channels) have not been tested against that limit.
