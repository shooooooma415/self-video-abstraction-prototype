#include <librealsense2/rs.hpp>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>

#include <array>
#include <atomic>
#include <csignal>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace {
constexpr int kPort = 8090;
constexpr uint32_t kMagic = 0x50445352;  // "RSDP" in little endian.
std::atomic<bool> running{true};

#pragma pack(push, 1)
struct DepthHeader {
  uint32_t magic;
  uint16_t version;
  uint16_t headerSize;
  uint32_t width;
  uint32_t height;
  float depthScaleMeters;
  float fx;
  float fy;
  float ppx;
  float ppy;
  uint32_t colorBytes;
  uint32_t colorStride;
  uint64_t timestampMs;
};
#pragma pack(pop)
static_assert(sizeof(DepthHeader) == 52, "Unexpected depth frame header layout");

struct PublishedFrame {
  DepthHeader header{};
  std::vector<uint16_t> pixels;
  std::vector<uint8_t> color;
  bool ready = false;
};

std::mutex frameMutex;
PublishedFrame latestFrame;

void stop(int) { running.store(false); }

bool sendAll(int socket, const void* bytes, size_t length) {
  const auto* data = static_cast<const uint8_t*>(bytes);
  size_t sent = 0;
  while (sent < length) {
    const auto result = ::send(socket, data + sent, length - sent, 0);
    if (result <= 0) return false;
    sent += static_cast<size_t>(result);
  }
  return true;
}

bool originAllowed(const std::string& origin) {
  static const std::array<std::string, 8> allowed = {
      "http://localhost:3000", "http://localhost:5173", "http://localhost:5174",
      "http://127.0.0.1:3000", "http://127.0.0.1:5173", "http://127.0.0.1:5174",
      "http://localhost", "http://127.0.0.1"};
  for (const auto& value : allowed) if (origin == value) return true;
  return origin.empty();
}

std::string findOrigin(const std::string& request) {
  const std::string key = "\r\nOrigin:";
  auto start = request.find(key);
  if (start == std::string::npos) return "";
  start += key.size();
  while (start < request.size() && request[start] == ' ') ++start;
  auto end = request.find("\r\n", start);
  return request.substr(start, end == std::string::npos ? end : end - start);
}

void sendResponse(int socket, int status, const std::string& reason,
                  const std::string& contentType, const std::string& origin,
                  const void* body, size_t bodyLength) {
  std::string header = "HTTP/1.1 " + std::to_string(status) + " " + reason + "\r\n";
  header += "Content-Type: " + contentType + "\r\n";
  header += "Content-Length: " + std::to_string(bodyLength) + "\r\n";
  header += "Cache-Control: no-store\r\nConnection: close\r\n";
  if (!origin.empty() && originAllowed(origin)) {
    header += "Access-Control-Allow-Origin: " + origin + "\r\n";
    header += "Vary: Origin\r\n";
  }
  header += "Access-Control-Allow-Methods: GET, OPTIONS\r\n";
  header += "Access-Control-Allow-Headers: Content-Type\r\n\r\n";
  if (!sendAll(socket, header.data(), header.size())) return;
  if (bodyLength) sendAll(socket, body, bodyLength);
}

void handleClient(int client) {
  std::array<char, 4096> buffer{};
  const auto length = ::recv(client, buffer.data(), buffer.size() - 1, 0);
  if (length <= 0) return;
  const std::string request(buffer.data(), static_cast<size_t>(length));
  const std::string origin = findOrigin(request);
  if (!originAllowed(origin)) {
    const std::string message = "Origin is not allowed";
    sendResponse(client, 403, "Forbidden", "text/plain", "", message.data(), message.size());
    return;
  }

  if (request.rfind("OPTIONS ", 0) == 0) {
    sendResponse(client, 204, "No Content", "text/plain", origin, nullptr, 0);
    return;
  }
  if (request.rfind("GET /health ", 0) == 0) {
    const std::string message = "{\"ok\":true,\"device\":\"Intel RealSense D415\"}";
    sendResponse(client, 200, "OK", "application/json", origin, message.data(), message.size());
    return;
  }
  if (request.rfind("GET /depth ", 0) == 0) {
    PublishedFrame snapshot;
    {
      std::lock_guard<std::mutex> guard(frameMutex);
      snapshot = latestFrame;
    }
    if (!snapshot.ready) {
      const std::string message = "Depth stream is starting";
      sendResponse(client, 503, "Service Unavailable", "text/plain", origin,
                   message.data(), message.size());
      return;
    }
    std::vector<uint8_t> payload(sizeof(snapshot.header) + snapshot.pixels.size() * sizeof(uint16_t) + snapshot.color.size());
    size_t offset = 0;
    std::memcpy(payload.data() + offset, &snapshot.header, sizeof(snapshot.header));
    offset += sizeof(snapshot.header);
    std::memcpy(payload.data() + offset, snapshot.pixels.data(), snapshot.pixels.size() * sizeof(uint16_t));
    offset += snapshot.pixels.size() * sizeof(uint16_t);
    std::memcpy(payload.data() + offset, snapshot.color.data(), snapshot.color.size());
    sendResponse(client, 200, "OK", "application/octet-stream", origin,
                 payload.data(), payload.size());
    return;
  }
  const std::string message = "Not found";
  sendResponse(client, 404, "Not Found", "text/plain", origin, message.data(), message.size());
}

void serveHttp() {
  const int server = ::socket(AF_INET, SOCK_STREAM, 0);
  if (server < 0) {
    std::cerr << "Could not create HTTP socket\n";
    running.store(false);
    return;
  }
  int reuse = 1;
  ::setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_port = htons(kPort);
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (::bind(server, reinterpret_cast<sockaddr*>(&address), sizeof(address)) < 0 || ::listen(server, 4) < 0) {
    std::cerr << "Could not listen on 127.0.0.1:" << kPort << "; is the port already in use?\n";
    ::close(server);
    running.store(false);
    return;
  }
  std::cout << "RealSense depth bridge: http://localhost:" << kPort << "\n";
  while (running.load()) {
    fd_set readSet;
    FD_ZERO(&readSet);
    FD_SET(server, &readSet);
    timeval timeout{0, 250000};
    const int ready = ::select(server + 1, &readSet, nullptr, nullptr, &timeout);
    if (ready <= 0) continue;
    const int client = ::accept(server, nullptr, nullptr);
    if (client < 0) continue;
    handleClient(client);
    ::shutdown(client, SHUT_RDWR);
    ::close(client);
  }
  ::close(server);
}
}  // namespace

int main() {
  std::signal(SIGINT, stop);
  std::signal(SIGTERM, stop);
  std::thread server;
  try {
    rs2::pipeline pipeline;
    rs2::config config;
    config.enable_stream(RS2_STREAM_DEPTH, 640, 480, RS2_FORMAT_Z16, 30);
    config.enable_stream(RS2_STREAM_COLOR, 640, 480, RS2_FORMAT_RGB8, 30);
    const auto profile = pipeline.start(config);
    const auto device = profile.get_device();
    const auto depthSensor = device.first<rs2::depth_sensor>();
    const float scale = depthSensor.get_depth_scale();
    rs2::align alignToColor(RS2_STREAM_COLOR);
    server = std::thread(serveHttp);

    std::cout << "Streaming aligned D415 depth at 640x480. Stop with Ctrl-C.\n";
    while (running.load()) {
      const auto frames = pipeline.wait_for_frames(1000);
      const auto aligned = alignToColor.process(frames);
      const auto depth = aligned.get_depth_frame();
      const auto color = aligned.get_color_frame();
      if (!depth || !color) continue;
      const auto intrinsics = depth.get_profile().as<rs2::video_stream_profile>().get_intrinsics();
      const uint32_t width = static_cast<uint32_t>(depth.get_width());
      const uint32_t height = static_cast<uint32_t>(depth.get_height());
      const uint32_t colorWidth = static_cast<uint32_t>(color.get_width());
      const uint32_t colorHeight = static_cast<uint32_t>(color.get_height());
      if (width != colorWidth || height != colorHeight) continue;
      const auto* source = reinterpret_cast<const uint16_t*>(depth.get_data());
      const size_t rowStride = static_cast<size_t>(depth.get_stride_in_bytes()) / sizeof(uint16_t);
      const auto* colorSource = reinterpret_cast<const uint8_t*>(color.get_data());
      const size_t colorRowStride = static_cast<size_t>(color.get_stride_in_bytes());
      const uint32_t packedColorStride = width * 3;
      PublishedFrame next;
      next.header = {kMagic, 2, static_cast<uint16_t>(sizeof(DepthHeader)), width, height,
                     scale, intrinsics.fx, intrinsics.fy, intrinsics.ppx, intrinsics.ppy,
                     packedColorStride * height, packedColorStride,
                     static_cast<uint64_t>(depth.get_timestamp())};
      next.pixels.resize(static_cast<size_t>(width) * height);
      next.color.resize(static_cast<size_t>(packedColorStride) * height);
      for (uint32_t row = 0; row < height; ++row) {
        std::memcpy(next.pixels.data() + static_cast<size_t>(row) * width,
                    source + static_cast<size_t>(row) * rowStride,
                    static_cast<size_t>(width) * sizeof(uint16_t));
        std::memcpy(next.color.data() + static_cast<size_t>(row) * packedColorStride,
                    colorSource + static_cast<size_t>(row) * colorRowStride,
                    packedColorStride);
      }
      next.ready = true;
      {
        std::lock_guard<std::mutex> guard(frameMutex);
        latestFrame = std::move(next);
      }
    }
    pipeline.stop();
    if (server.joinable()) server.join();
  } catch (const rs2::error& error) {
    running.store(false);
    if (server.joinable()) server.join();
    std::cerr << "RealSense error: " << error.what() << "\n";
    std::cerr << "On macOS 12+, librealsense USB access may require running this bridge with sudo.\n";
    return 1;
  } catch (const std::exception& error) {
    running.store(false);
    if (server.joinable()) server.join();
    std::cerr << "Depth bridge error: " << error.what() << "\n";
    return 1;
  }
  return 0;
}
