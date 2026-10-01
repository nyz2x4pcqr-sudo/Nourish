# On-device AI for the Android app: llama.cpp (pinned to one tested commit) plus Nourish's small
# C interface (mobile/shared/llm), exposed to Java through nourish_jni.cpp.
cmake_minimum_required(VERSION 3.22.1)
project(nourish_llm C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Keep in sync with LLAMA_COMMIT in .github/workflows/build-mobile.yml (iOS).
set(LLAMA_COMMIT 0c1e57098bba43ac29e6e3b677cdceebdd22334f)

include(FetchContent)
FetchContent_Declare(llama URL https://github.com/ggml-org/llama.cpp/archive/${LLAMA_COMMIT}.tar.gz)

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_MTMD OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)      # the build machine is not the phone
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)      # ggml's own thread pool; no extra runtime to ship
set(GGML_LLAMAFILE ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(llama)

set(NOURISH_SHARED ${CMAKE_CURRENT_LIST_DIR}/../../../../../shared/llm)
add_library(nourish_llm SHARED nourish_jni.cpp ${NOURISH_SHARED}/nourish_llm.cpp)
target_include_directories(nourish_llm PRIVATE ${NOURISH_SHARED})
target_link_libraries(nourish_llm PRIVATE llama android log)
