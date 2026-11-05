# 💡 Idearium

> **Local-First, Voice-to-Vault AI Knowledge Engine & RAG System**

Idearium is an open-source, local-first personal intelligence layer that bridges the gap between spontaneous thought capture (voice notes, quick texts via Telegram) and structured, long-term personal knowledge management in **Obsidian**.

It processes voice audio on-device using consumer GPU hardware, extracts structured metadata via local LLMs, persists plain Markdown files to a local vault, and maintains an embedded **LanceDB** vector index for zero-latency Retrieval-Augmented Generation (RAG) and cognitive active-recall learning.

---

## 🛈 Executive Overview

- **100% Offline & Private:** All speech-to-text, LLM synthesis, and vector indexing run locally on your own hardware. Zero cloud dependencies, zero subscription fees, and complete data sovereignty.
- **Plaintext Single Source of Truth:** Every capture is converted into standard Markdown (`.md`) files inside an Obsidian Vault, ensuring no vendor lock-in.
- **Embedded Vector Database:** Leverages **LanceDB** embedded directly within the Node.js runtime for zero-network-overhead vector search.
- **On-Demand Memory Palace:** On request, transforms dense conceptual notes into spatial Loci visual routes for active recall study sessions.

---

## 🏗 System Architecture

```text
[ Telegram Voice / Text ]
          │
          ▼
 [ Idearium Engine ] (Node.js + TypeScript)
          │
          ├──► 1. Speech-to-Text (Faster-Whisper REST API / GPU CUDA)
          ├──► 2. LLM Synthesis & JSON Structuring (Ollama / OpenRouter Fallback)
          └──► 3. Markdown Depository (.md) ──► [ Obsidian Local Vault ]
                                                         │
                                                  (File Watcher)
                                                         │
                                                         ▼
 [ Local RAG Engine ] (LanceDB Vector DB) ◄──────────────┘
          │
          ▼
 [ Interactive Interfaces ]
          ├──► Telegram RAG Query & Command Handler
          └──► On-Demand Memory Palace (Loci) & Quiz Sessions
```

---

## 🛠 Tech Stack & Hardware Requirements

### Software Stack
- **Runtime & Language:** Node.js, TypeScript
- **Validation & Schemas:** Zod
- **Bot Framework:** grammY / Telegraf
- **Speech-to-Text (STT):** Faster-Whisper Server (`small` / `medium` int8_float16 model)
- **Local LLM Engine:** Ollama (`Qwen2.5-7B` / `Llama-3.2-3B`)
- **Cloud Fallback:** OpenRouter API Client
- **Vector Database:** `@lancedb/lancedb` (Embedded)
- **Text Embeddings:** `bge-m3` / `multilingual-e5-base`
- **File System Watcher:** `chokidar`

### Hardware Target
- **GPU:** Dedicated GPU with CUDA support (e.g., NVIDIA GTX 1050 Ti 4GB VRAM) for Faster-Whisper acceleration.
- **CPU & RAM:** Multi-core CPU (8+ cores) and 16GB+ RAM for running Ollama LLM models locally.

---

## 🚀 Quick Start & Environment Setup

### 1. Prerequisites
Ensure you have Docker and Node.js (v20+) installed on your local host:
```bash
docker --version
node --version
```

### 2. Docker Services Setup
Create a `docker-compose.yml` to launch local AI dependencies:

```yaml
version: '3.8'

services:
  ollama:
    image: ollama/ollama:latest
    container_name: idearium-ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_storage:/root/.ollama
    restart: unless-stopped

  faster-whisper:
    image: fedirz/faster-whisper-server:latest-cuda
    container_name: idearium-whisper
    ports:
      - "8000:8000"
    environment:
      - WHISPER_MODEL=small
      - WHISPER_DEVICE=cuda
      - WHISPER_COMPUTE_TYPE=int8_float16
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped

volumes:
  ollama_storage:
```

Run the containers:
```bash
docker compose up -d
```

### 3. Application Installation
Clone the repository and install npm packages:
```bash
git clone https://github.com/your-username/idearium.git
cd idearium
npm install
```

Copy the environment template and fill in your details:
```bash
cp .env.example .env
```

Environment Configuration (`.env`):
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
WHISPER_API_URL=http://localhost:8000
OLLAMA_API_URL=http://localhost:11434
OPENROUTER_API_KEY=your_optional_openrouter_key
OBSIDIAN_VAULT_PATH=/path/to/your/obsidian/vault
LANCED_DB_PATH=./data/lancedb
```

Build and run the service:
```bash
npm run build
npm start
```

---

## 📋 GitHub Milestones & Issues Backlog

### Milestone 1: Base Infrastructure & Environment Setup
- **Issue 1.1: Configure local Docker infrastructure (Ollama & Faster-Whisper GPU)**
  - Create `docker-compose.yml` including `ollama` and `faster-whisper-server`.
  - Enable NVIDIA GPU passthrough for the Faster-Whisper container.
  - Verify container health and REST API accessibility on local ports.
- **Issue 1.2: Initialize Node.js project with TypeScript, Zod, and environment variables**
  - Initialize NPM project and configure `tsconfig.json`.
  - Install core dependencies (`grammy`, `zod`, `dotenv`, `@lancedb/lancedb`, `axios`).
  - Define project folder structure (`src/config`, `src/services`, `src/controllers`, `src/schemas`).

### Milestone 2: Audio Capture & Local Transcription
- **Issue 2.1: Implement Telegram Bot webhook/polling for voice notes**
  - Setup Telegram Bot instance using `grammy` or `telegraf`.
  - Implement handler to detect incoming `voice` and `text` payload objects.
- **Issue 2.2: Save incoming audio streams to local storage**
  - Fetch Telegram file download link via Telegram API.
  - Stream the `.ogg` file to the local disk directory.
- **Issue 2.3: Integrate local Faster-Whisper REST API for transcription**
  - Build `stt.service.ts` to post audio files via `multipart/form-data`.
  - Parse and return the transcribed text string.

### Milestone 3: LLM Structuring & Intelligent Routing
- **Issue 3.1: Process transcript with local LLM (Ollama) into structured JSON**
  - Define System Prompt enforcing JSON mode output.
  - Build `llm.service.ts` to call Ollama HTTP endpoints.
- **Issue 3.2: Implement OpenRouter client for fallback/complex routing**
  - Add OpenRouter API client to `llm.service.ts`.
  - Create routing logic to toggle between Ollama local and OpenRouter models based on explicit flags or complexity.
- **Issue 3.3: Validate LLM JSON outputs using Zod schemas**
  - Create `noteDigest.schema.ts` with Zod validation rules.
  - Add retry or fallback logic if JSON parsing fails validation.

### Milestone 4: Obsidian Vault Integration & Markdown Depository
- **Issue 4.1: Markdown Note Generator (`obsidian.service.ts`)**
  - Create Markdown template engine supporting YAML frontmatter (title, tags, category, timestamp).
  - Save generated `.md` files to the local Obsidian Vault directory.
  - Send confirmation message with note summary back to user on Telegram.

### Milestone 5: Embedded Vector Database (LanceDB) & Vault Sync
- **Issue 5.1: Initialize LanceDB embedded database & schemas (`vector.service.ts`)**
  - Install `@lancedb/lancedb` dependency in the Node.js project.
  - Define LanceDB schema for notes (ID, vector, raw content, metadata JSON, file path, updated_at).
  - Initialize database connection pointing to local storage path.
- **Issue 5.2: File-Watcher & LanceDB Synchronization Engine**
  - Setup `chokidar` in Node.js monitoring the Obsidian Vault folder.
  - Extract text content and YAML frontmatter from `.md` files upon file events.
  - Generate embeddings (`bge-m3`) and sync vector rows directly into LanceDB tables.

### Milestone 6: RAG Query Engine & Conversational Interface
- **Issue 6.1: Vector Retrieval & RAG Pipeline (`rag.service.ts`)**
  - Implement vector search query service using LanceDB Node.js API.
  - Construct context-augmented prompts with retrieved Markdown chunks.
  - Synthesize RAG responses using local LLM via Ollama.
- **Issue 6.2: Chat Interface Integration**
  - Expose query interface endpoint or Telegram `/query` command.
  - Return synthesized answers with references to source Obsidian notes.

### Milestone 7: Knowledge Depository & On-Demand Memory Palace (Future Roadmap)
- **Issue 7.1: On-Demand Topic Clustering & Study Guide Generation**
  - Implement Telegram `/cluster` command handler to initiate note grouping on request.
  - Perform semantic search and clustering queries in LanceDB based on the target topic.
  - Generate and save a master study guide Markdown file inside the Obsidian Vault.
- **Issue 7.2: On-Demand Spatial Loci Mapping (Memory Palace Generator)**
  - Implement Telegram `/memorize` command handler to process spatial transformation on demand.
  - Build a specialized System Prompt mapping concepts into vivid visual anchors tied to a physical route.
  - Append the generated Loci map section directly to the target Obsidian note and update its LanceDB payload.
- **Issue 7.3: Interactive Active Recall & Loci Quiz Session**
  - Implement Telegram `/quiz` command handler to start an interactive active recall session.
  - Query LanceDB for stored Loci anchors and generate context-aware practice questions.
  - Provide step-by-step feedback and score responses using local LLM evaluation.

---

## 📜 License

Distributed under the Business Source License 1.1. See `LICENSE` for more information.