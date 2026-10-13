// MationFacelab Audio2Face-3D harness.
// Audio2Emotion v2.2 -> Audio2Face-3D v3.0 (diffusion) -> blendshape solver, one audio track,
// per-frame blendshape weights written as JSON.
//
// Call patterns taken from NVIDIA Audio2Face-3D-SDK commit 1ca0f02:
//   audio2face-sdk/source/samples/sample-a2f-a2e-executor/main.cpp  (A2E -> emotion accumulator -> A2F, offline)
//   audio2face-sdk/source/benchmarks/executor_blendshape.cpp        (ReadDiffusionBlendshapeSolveExecutorBundle)
//   audio2face-sdk/source/benchmarks/utils.cpp                       (host blendshape results callback)
//
// Usage: a2f_harness <a2f model.json> <a2e model.json> <audio f32le 16 kHz mono> <out.json> <identity index>
#include "audio2face/audio2face.h"
#include "audio2emotion/audio2emotion.h"
#include "audio2x/cuda_utils.h"

#include <cstdio>
#include <fstream>
#include <iostream>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <vector>

#define FAIL(msg) do { std::cerr << "A2X_ERROR: " << msg << std::endl; return 2; } while (0)
#define CHECK_RESULT(expr) do { std::error_code ec_ = (expr); if (ec_) FAIL(#expr << " -> " << ec_.message()); } while (0)
#define CHECK_PTR(expr) do { if (!(expr)) FAIL(#expr << " returned null"); } while (0)

struct Destroyer { template <typename T> void operator()(T* p) const { if (p) p->Destroy(); } };
template <typename T> using UniquePtr = std::unique_ptr<T, Destroyer>;
template <typename T> UniquePtr<T> Own(T* p) { return UniquePtr<T>(p); }

static std::string g_emotionError;

struct Collected {
  std::mutex mutex;
  std::vector<long long> timestamps;
  std::vector<std::vector<float>> weights;
  std::string error;
};

static std::string Escape(const std::string& s) {
  std::string o;
  for (char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += c; }
    else if (static_cast<unsigned char>(c) < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += c;
  }
  return o;
}

int main(int argc, char** argv) {
  if (argc != 6) {
    std::cerr << "usage: a2f_harness <a2f model.json> <a2e model.json> <audio.f32le> <out.json> <identity>" << std::endl;
    return 1;
  }
  const char* a2fModel = argv[1];
  const char* a2eModel = argv[2];
  const char* audioPath = argv[3];
  const char* outPath = argv[4];
  const std::size_t identity = std::stoul(argv[5]);

  // Raw float32, 16 kHz, mono (converted by the handler with ffmpeg). NVIDIA's samples require 16 kHz.
  std::vector<float> audio;
  {
    std::ifstream f(audioPath, std::ios::binary | std::ios::ate);
    if (!f) FAIL("cannot open audio " << audioPath);
    const auto bytes = static_cast<std::size_t>(f.tellg());
    audio.resize(bytes / sizeof(float));
    f.seekg(0);
    f.read(reinterpret_cast<char*>(audio.data()), audio.size() * sizeof(float));
  }
  if (audio.empty()) FAIL("audio is empty");

  CHECK_RESULT(nva2x::SetCudaDeviceIfNeeded(0));

  // Diffusion v3.0 + blendshape solve. CPU solver -> HOST results. Constant noise -> repeatable takes.
  nva2f::IDiffusionModel::IGeometryModelInfo* rawInfo = nullptr;
  auto bundle = Own(nva2f::ReadDiffusionBlendshapeSolveExecutorBundle(
      1, a2fModel, nva2f::IGeometryExecutor::ExecutionOption::SkinTongue,
      false, identity, true, &rawInfo, nullptr));
  CHECK_PTR(bundle);
  CHECK_PTR(rawInfo);
  auto modelInfo = Own(rawInfo);
  const std::string identityName = modelInfo->GetNetworkInfo().GetIdentityName(identity);

  auto& executor = bundle->GetExecutor();
  if (executor.GetResultType() != nva2f::IBlendshapeExecutor::ResultsType::HOST)
    FAIL("expected host blendshape results from the CPU solver");

  // Audio2Emotion classifier sharing the same audio accumulator (parameters as in NVIDIA's sample).
  auto a2eInfo = Own(nva2e::ReadClassifierModelInfo(a2eModel));
  CHECK_PTR(a2eInfo);
  nva2e::EmotionExecutorCreationParameters emotionParams;
  emotionParams.cudaStream = bundle->GetCudaStream().Data();
  emotionParams.nbTracks = 1;
  nva2x::IAudioAccumulator* const sharedAudio = &bundle->GetAudioAccumulator(0);
  emotionParams.sharedAudioAccumulators = &sharedAudio;
  auto classifierParams = a2eInfo->GetExecutorCreationParameters(60000, 30, 1, 30);
  auto emotion = Own(nva2e::CreateClassifierEmotionExecutor(emotionParams, classifierParams));
  CHECK_PTR(emotion);

  auto& emotionAcc = bundle->GetEmotionAccumulator(0);
  auto emotionCallback = [](void* userdata, const nva2e::IEmotionExecutor::Results& r) -> bool {
    auto ec = static_cast<nva2x::IEmotionAccumulator*>(userdata)->Accumulate(r.timeStampCurrentFrame, r.emotions, r.cudaStream);
    if (ec) { g_emotionError = ec.message(); return false; }
    return true;
  };
  CHECK_RESULT(emotion->SetResultsCallback(emotionCallback, &emotionAcc));

  // Host results may arrive on another thread after Execute() returns -> mutex + Wait().
  Collected col;
  nva2f::IBlendshapeExecutor::host_results_callback_t resultsCallback =
      [](void* userdata, const nva2f::IBlendshapeExecutor::HostResults& r, std::error_code ec) {
        auto& c = *static_cast<Collected*>(userdata);
        std::lock_guard<std::mutex> lock(c.mutex);
        if (ec) { if (c.error.empty()) c.error = ec.message(); return; }
        c.timestamps.push_back(static_cast<long long>(r.timeStampCurrentFrame));
        c.weights.emplace_back(r.weights.Data(), r.weights.Data() + r.weights.Size());
      };
  CHECK_RESULT(executor.SetResultsCallback(resultsCallback, &col));

  CHECK_RESULT(bundle->GetAudioAccumulator(0).Accumulate(
      nva2x::HostTensorFloatConstView{audio.data(), audio.size()}, bundle->GetCudaStream().Data()));
  CHECK_RESULT(bundle->GetAudioAccumulator(0).Close());

  while (nva2x::GetNbReadyTracks(*emotion) > 0) {
    CHECK_RESULT(emotion->Execute(nullptr));
    if (!g_emotionError.empty()) FAIL("emotion accumulate: " << g_emotionError);
  }
  CHECK_RESULT(emotionAcc.Close());

  while (nva2x::GetNbReadyTracks(executor) > 0) CHECK_RESULT(executor.Execute(nullptr));
  CHECK_RESULT(executor.Wait(0));
  if (!col.error.empty()) FAIL("blendshape solve: " << col.error);
  if (col.weights.empty()) FAIL("no frames produced");

  // Channel names come from the solvers themselves (skin, then tongue).
  nva2f::IBlendshapeSolver* skin = nullptr;
  CHECK_RESULT(nva2f::GetExecutorSkinSolver(executor, 0, &skin));
  CHECK_PTR(skin);
  std::vector<std::string> names;
  std::set<std::string> seen;
  for (int i = 0; i < skin->NumBlendshapePoses(); ++i) { names.emplace_back(skin->GetPoseName(i)); seen.insert(names.back()); }
  const std::size_t skinCount = names.size();
  nva2f::IBlendshapeSolver* tongue = nullptr;
  if (!nva2f::GetExecutorTongueSolver(executor, 0, &tongue) && tongue) {
    for (int i = 0; i < tongue->NumBlendshapePoses(); ++i) {
      std::string n = tongue->GetPoseName(i);
      if (seen.count(n)) n = "tongue_" + n;
      names.push_back(n);
    }
  }
  const std::size_t weightCount = executor.GetWeightCount();
  if (weightCount == skinCount) names.resize(skinCount);
  else if (weightCount != names.size())
    FAIL("weight count " << weightCount << " matches neither skin (" << skinCount << ") nor skin+tongue (" << names.size() << ")");
  for (const auto& wv : col.weights) if (wv.size() != weightCount) FAIL("frame has " << wv.size() << " weights, expected " << weightCount);

  std::ofstream out(outPath);
  if (!out) FAIL("cannot write " << outPath);
  out << "{\"identity\":\"" << Escape(identityName) << "\",\"sample_rate\":16000,\"skin_count\":" << skinCount
      << ",\"weight_count\":" << weightCount << ",\"channels\":[";
  for (std::size_t i = 0; i < names.size(); ++i) out << (i ? "," : "") << '"' << Escape(names[i]) << '"';
  out << "],\"timestamps\":[";
  for (std::size_t i = 0; i < col.timestamps.size(); ++i) out << (i ? "," : "") << col.timestamps[i];
  out << "],\"weights\":[";
  char buf[32];
  for (std::size_t f = 0; f < col.weights.size(); ++f) {
    out << (f ? ",[" : "[");
    for (std::size_t i = 0; i < col.weights[f].size(); ++i) { std::snprintf(buf, sizeof buf, "%.6g", col.weights[f][i]); out << (i ? "," : "") << buf; }
    out << ']';
  }
  out << "]}";
  out.close();
  std::cout << "A2X_OK frames=" << col.weights.size() << " weights=" << weightCount << " identity=" << identityName << std::endl;
  return 0;
}
