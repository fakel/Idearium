# 💡 Idearium

**Version 0.2.0** · [Español](README.md) · [Changelog](CHANGELOG.md) · [BSL 1.1 License](LICENSE)

> Capture by voice, text, photo, or document → structured Markdown notes in Obsidian → semantic search and RAG, all local.

Idearium is a _local-first_ personal memory layer. You send it a voice note, a text, a photo containing text, or a document through Telegram (or use the CLI), and the system:

1. transcribes the audio with **faster-whisper** on your GPU (or with OpenRouter),
2. extracts the text from a photo with a multimodal model,
3. structures the capture with a local LLM (**Ollama**) or a remote one validated with **Zod**,
4. writes a Markdown note with frontmatter into your **Obsidian vault**,
5. indexes it in **LanceDB** with embeddings (`bge-m3`, local or remote),
6. lets you query it via RAG, group it into studies, generate palaces of memory, and run quizzes.

All content and vectors live on your machine by default. If you don't have enough GPU, you can use **OpenRouter** for chat, embeddings, and transcription with a single key.

---

## Architecture

```text
Telegram (voz/texto/foto/doc) ──┐
CLI (texto/audio)     ──┴──► IngestController
                                │
                                ├─ STT local (faster-whisper, GPU) u OpenRouter   [solo voz]
                                ├─ OCR multimodal vía OpenRouter                  [solo foto]
                                ├─ LLM Router ── Ollama (local)
                                │             └─ OpenRouter (remoto)
                                ├─ Zod valida el JSON y reintenta
                                ├─ ObsidianService → <vault>/Idearium/*.md
                                └─ Indexer → embeddings bge-m3 (Ollama u OpenRouter) → LanceDB
                                                    ▲
Watcher chokidar (ediciones manuales del vault) ────┘

Consultas: /query + RagService (top-k + contexto citado)
Estudio:   /cluster, /memorize, /quiz
```

## Requirements

- **Node.js ≥ 24** and npm.
- **Ollama** native on `127.0.0.1:11434` (only if you use local chat or embeddings).
- **NVIDIA GPU** recommended for STT (it works on CPU, but slower). Without a GPU, use remote STT.
- **uv** and **Python 3.12** for the local transcription server.
- An Obsidian vault (the folder is created if it does not exist).
- Optional: Telegram bot token and OpenRouter API key.

Tested on Linux with an RTX 3070 (8 GB), driver 580, CUDA 13.4, Node 24, and Ollama 0.35.

## Agent-assisted setup

If you prefer an agent (Claude Code, Codex, Cursor, Gemini CLI, etc.) to set everything up, copy this prompt. It is designed to configure the project without changing its code.

```text
Set up Idearium on this machine and leave it ready to use.

First read README.md and .env.example in full. Do not modify src/, tests/, or the repository defaults.

1. Check for and install the requirements: Node.js >= 24, npm, git, and, if needed, uv/Python 3.12. Ask me before installing system packages.
2. Run npm ci and npm run build.
3. Ask me for the deployment mode:
   - local: Ollama for chat/embeddings and local STT with faster-whisper (GPU or CPU);
   - 100% OpenRouter: remote chat, embeddings, and STT with a single OPENROUTER_API_KEY.
   Do not install Ollama, CUDA, or models if I choose OpenRouter.
4. Ask me for the Obsidian vault, the Telegram token, and the authorized IDs. Create .env from .env.example, write the secrets there, never print them or commit them, and run chmod 600 .env.
5. If I use Telegram, verify the token with getMe and confirm the bot only replies in private chats.
6. Run npm test, npm run doctor, and npm run smoke. If something fails, diagnose it and fix only the configuration (not the code). Note that smoke may make real OpenRouter calls and spend a few cents.
7. If this is a server, set up startup with systemd (scripts/install-server.sh) or Docker only if I ask; do not do it by default.
8. When done, summarize: chosen mode, models, vault and data paths, start/stop commands, doctor/smoke results, and any pending step.

Do not commit, push, or deploy to production without my permission. If something is missing or ambiguous, ask me; do not invent keys or paths.
```

## Installation

```bash
git clone git@github.com:fakel/Idearium.git
cd Idearium
npm install
cp .env.example .env
```

Edit `.env` with at least `OBSIDIAN_VAULT_PATH` and, if you are going to use the bot, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS`.

### Automatic installation on a server (Ubuntu/Debian)

For a dedicated server there is an idempotent installer that leaves everything ready and started with systemd:

```bash
git clone git@github.com:fakel/Idearium.git /opt/idearium
cd /opt/idearium
sudo bash scripts/install-server.sh
```

What it does:

- Installs base packages, **Node.js 24** (if needed), **Ollama**, and downloads `qwen2.5:7b-instruct` + `bge-m3`.
- Installs the npm dependencies and builds (`npm ci && npm run build`).
- Detects the GPU with `nvidia-smi`:
  - **With GPU**: installs local STT (`uv sync` with CUDA wheels) and creates `idearium-stt.service`.
  - **Without GPU**: configures an external OpenAI-compatible STT in `.env` and does **not** install CUDA.
- Creates `.env` from `.env.example` if it does not exist, with the vault at `/srv/idearium/vault` and data at `/var/lib/idearium`. It asks for the Telegram token and the allowlist (unless `--yes`).
- Creates `idearium.service` (bot + watcher) and `idearium-stt.service` (local STT only), with automatic restart.

Useful options:

```bash
sudo bash scripts/install-server.sh --stt=external   # force external STT
sudo bash scripts/install-server.sh --stt=cpu        # local STT without CUDA (slow)
sudo bash scripts/install-server.sh --user=miusuario # user that runs the services
sudo bash scripts/install-server.sh --no-models      # do not download models
sudo bash scripts/install-server.sh --no-service     # install only, without systemd
```

For external STT, edit `.env`:

```dotenv
WHISPER_API_URL=https://api.openai.com
WHISPER_API_KEY=sk-...
WHISPER_MODEL=whisper-1
# OpenRouter (same key as chat):
# WHISPER_API_URL=https://openrouter.ai/api
# WHISPER_MODEL=openai/whisper-1
# Groq alternative:
# WHISPER_API_URL=https://api.groq.com/openai
# WHISPER_MODEL=whisper-large-v3
```

The endpoint must accept `POST /v1/audio/transcriptions` with `multipart/form-data`. The installer only configures OpenAI by default; for another provider, change the URL, model, and key.

If the server has no GPU and you want to avoid Ollama entirely, after installing, edit `.env` with the block from [100 % OpenRouter mode](#21-server-without-gpu-100--openrouter-mode) and run `npm run doctor` + `sudo systemctl restart idearium`.

Operation:

```bash
sudo systemctl status idearium idearium-stt
sudo journalctl -u idearium -f
sudo systemctl restart idearium
```

### Web access to the vault on a remote server: Ignis

If Idearium runs on a remote server (LXC, VPS, or an always-on machine), the vault is no longer on your laptop. To read and edit it from the browser, I recommend **[Ignis](https://github.com/Nystik-gh/ignis)**, which runs Obsidian as a web application and keeps the vault on the server.

- Docker image: `nobbe/ignis:latest`.
- Mount the **same folder** Idearium uses (`/srv/idearium/vault` in the installer) as the vault.
- Ignis **does not include authentication**: publish it only behind HTTPS and basic auth (Caddy, nginx, or Cloudflare Tunnel). Do not expose the port directly to the Internet.
- Changes you make from Ignis are detected by the Idearium watcher and reindexed automatically.

A minimal Compose example, to put behind your TLS proxy:

```yaml
services:
  ignis:
    image: nobbe/ignis:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    volumes:
      - /srv/idearium/vault:/vaults/Idearium
```

It is not mandatory: Idearium works the same without Ignis. It is a convenience for remote servers, not a requirement.

### Docker (OpenRouter only)

For a server without a GPU, the Docker image does not install Ollama, Whisper, or CUDA: chat, embeddings, and STT are done against OpenRouter. The vault and LanceDB are mounted from the host.

```bash
cp .env.docker.example .env   # fill in OPENROUTER_API_KEY and Telegram
mkdir -p vault data
docker compose up -d --build
docker compose logs -f idearium
```

The container does not expose ports (it uses polling). To mount your real vault, define `IDEARIUM_VAULT_DIR` and `IDEARIUM_DATA_DIR` in `.env`. Full guide, models, costs, and diagnostics: **[DOCKER.md](DOCKER.md)**.

### 1. Ollama models

They are not downloaded automatically; run them once:

```bash
ollama pull qwen2.5:7b-instruct   # chat and structuring (~4.7 GB)
ollama pull bge-m3                # 1024-dim embeddings (~1.2 GB)
```

> With 8 GB of VRAM, `qwen2.5:7b-instruct` in Q4 fits alongside `bge-m3` if you don't keep other models loaded. If you prefer something lighter, change `OLLAMA_MODEL` (for example `qwen2.5:3b-instruct`).

### 2. Transcription server (optional if you will only use text)

```bash
cd stt
uv sync          # installs faster-whisper + CUDA 12 libs (cuBLAS/cuDNN)
./start.sh       # http://127.0.0.1:8000
```

`stt/start.sh` adds the libs from the `nvidia-*` wheels to `LD_LIBRARY_PATH`, which are required by CTranslate2. If the GPU fails, the server automatically falls back to CPU/int8 and logs it. Variables: `WHISPER_MODEL` (default `small`), `WHISPER_DEVICE` (default `cuda`), `WHISPER_COMPUTE_TYPE` (default `int8_float16`).

If you don't want to run Whisper locally, point `WHISPER_API_URL` to an external OpenAI-compatible provider and define `WHISPER_API_KEY`; the bot uses the same `/v1/audio/transcriptions` endpoint. OpenRouter also works: `WHISPER_API_URL=https://openrouter.ai/api` and `WHISPER_MODEL=openai/whisper-large-v3-turbo` (if you leave `WHISPER_API_KEY` empty, `OPENROUTER_API_KEY` is reused).

### 2.1 Server without GPU: 100 % OpenRouter mode

OpenRouter covers all three pieces: chat, embeddings, and transcription. A single `OPENROUTER_API_KEY` is enough to avoid installing Ollama or Whisper.

By default `OPENROUTER_REASONING_EFFORT=none`: the bot's tasks (digest, classification, RAG, quiz, palace) are extraction/synthesis over context already given and do not need a chain of thought. `deepseek/deepseek-v4.1-flash` reasons by default, so `none` avoids latency and extra output tokens. Raise it to `low` only if `/cluster` or quiz correction gets worse.

```dotenv
LLM_PREFERENCE=remote_only
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=deepseek/deepseek-v4.1-flash
OPENROUTER_REASONING_EFFORT=none

EMBEDDING_PROVIDER=openrouter
OPENROUTER_EMBED_MODEL=baai/bge-m3
EMBEDDING_DIM=1024

WHISPER_API_URL=https://openrouter.ai/api
WHISPER_MODEL=openai/whisper-large-v3-turbo
WHISPER_API_KEY=                # empty = reuse OPENROUTER_API_KEY
WHISPER_TIMEOUT_MS=180000
```

### 2.2 Recommended models on OpenRouter

| Task | Free (`:free`) | Recommended paid | Why |
| --- | --- | --- | --- |
| Capture → JSON (title, summary, tags) | `google/gemma-4-31b-it:free` | `openai/gpt-4o-mini` · `deepseek/deepseek-v4-flash` (via OpenRouter) | Reliable and cheap JSON; the second one has a 1M context |
| `/query` and RAG | `nvidia/nemotron-3.5-super-vl:free` | `google/gemini-3.1-flash-lite` | Long context (1M) at low cost |
| `/cluster`, `/memorize`, `/quiz` | `dots-studio/dots-3-note-preview:free` | `anthropic/claude-sonnet-4.6` · `openai/gpt-5.4-mini` | Better writing and reasoning |
| Embeddings | `nvidia/nemotron-3.5-embed-8b:free` | `baai/bge-m3` | bge-m3 is 1024 dims, multilingual, and the same as local |
| Audio (STT) | **no hay** | `openai/whisper-large-v3-turbo` · `openai/gpt-4o-transcribe` · `elevenlabs/scribe-v2` | Turbo is the cheapest; GPT-4o Transcribe handles noise/accents better; Scribe v2 stands out in multilingual |

Reference prices (per 1M tokens, except audio):

| Model | Input | Output |
| --- | --- | --- |
| `deepseek/deepseek-v4-flash` | $0.09 | $0.18 |
| `openai/gpt-4o-mini` | $0.15 | $0.60 |
| `google/gemini-3.1-flash-lite` | $0.25 | $1.50 |
| `openai/gpt-5.4-mini` | $0.75 | $4.50 |
| `anthropic/claude-sonnet-4.6` | $3.00 | $15.00 |
| `baai/bge-m3` (embeddings) | $0.01 | — |
| `openai/whisper-large-v3-turbo` | ~$0.0002/minute | — |
| `elevenlabs/scribe-v2` | ~$0.0037/minute | — |
| `openai/whisper-1` | ~$0.006/minute | — |

#### Free vs paid

- The `:free` models are limited to **20 requests/minute and 50 requests/day**; the daily limit rises to 1,000 if you have ever bought $10 in credits. They fail with `429` when shared capacity is busy, may disappear or change without notice, and several do not support `response_format` (the ones in the table do).
- In paid mode there is no such free daily quota: you pay per token and get stable versions, more throughput, and routing/privacy options. For this project the cost is low: a typical capture costs fractions of a cent.
- **There is no free STT on OpenRouter**: transcription is always billed per second of audio.
- Free embeddings exist, but their dimension may not be 1024; if you change it you must adjust `EMBEDDING_DIM` and reindex everything. That is why the recommended remote mode uses the paid `baai/bge-m3` (you keep using 1024 dims).
- If you change the embeddings model, reindex from scratch (`rm -rf data/lancedb data/index-state.json && npm run cli -- reindex`).


### 3. Telegram bot (optional)

The bot uses **long polling**: you don't need a domain, a webhook, or open ports.

#### 3.1 Create the bot and get the token

1. Open Telegram and search for **[@BotFather](https://t.me/BotFather)** (the official one, with the blue check).
2. Send `/newbot`.
3. Choose a **display name** (for example `Mi Idearium`).
4. Choose a **username** ending in `bot` that is available (for example `mi_idearium_bot`).
5. BotFather will reply with something like:

   ```text
   Use this token to access the HTTP API:
   123456789:AAH8xQ2exampleTokenNoReal_9fGh3kLm
   ```

   That is your `TELEGRAM_BOT_TOKEN`. **Do not share it or upload it to the repo.**

6. Optional: send `/setdescription` and `/setuserpic` to BotFather to customize the bot.
7. The bot only responds in **private chats**; there is no need to configure group privacy.

> If the token leaks: `/revoke` in BotFather generates a new one and invalidates the previous one. Update `.env` afterward.

#### 3.2 Get your user ID

The bot only serves the IDs in the allowlist.

1. Open **[@userinfobot](https://t.me/userinfobot)** and send `/start`.
2. Copy the number from the `Id:` line (for example `123456789`).
3. If you want to authorize more people, repeat with each one. You can also use **[@RawDataBot](https://t.me/RawDataBot)** and read `"from":{"id":...}`.

#### 3.3 Configure `.env`

Edit `.env` at the project root:

```bash
TELEGRAM_BOT_TOKEN=123456789:AAH8xQ2exampleTokenNoReal_9fGh3kLm
TELEGRAM_ALLOWED_USER_IDS=123456789
```

Multiple users are separated by commas, without spaces:

```bash
TELEGRAM_ALLOWED_USER_IDS=123456789,987654321
```

Notes:

- The token goes **without quotes** and without spaces around the `=`.
- Use your **positive** user ID. The bot rejects groups and channels for privacy, even if the ID is in the allowlist.
- The bot **refuses to start** if the token or the allowlist is empty: this is intentional so as not to leave an open bot.
- `.env` is in `.gitignore`; do not commit it.

Verify the token without starting the bot:

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

It should return `"ok":true` and the bot's username. If it returns `401 Unauthorized`, the token was copied incorrectly.

#### 3.4 Start and test

```bash
npm run dev      # development (tsx watch, restarts on save)
# or
npm run build && npm start   # production
```

In the console, the startup of the bot and the watcher should appear. Then, from **your** Telegram account:

1. Open the chat with your bot (search for it by its username) and press **Start** or send `/start`.
   - It should reply with the help and the active LLM provider.
2. Send a text: `probar mi primer idea sobre el proyecto`.
   - The bot shows the title, the summary, and the suggested category, and asks **which folder** to save it in with buttons for the existing folders.
   - Choose a folder and then a category; only then does it reply with the path of the `.md`, the tags, and whether it was indexed.
3. Send a **voice note**.
   - The `.ogg` is downloaded, transcribed, and goes through the same folder and category selection.
4. Try `/query ¿qué ideas tengo?`.
5. Try from another unauthorized account: it should reply "No estás autorizado".

If the bot does not respond:

- Check that the process is still alive and free of errors in the console.
- `npm run doctor` validates the token, the allowlist, and the rest of the environment.
- Confirm that you wrote your real ID (not the username) in `TELEGRAM_ALLOWED_USER_IDS`.
- If another instance of the bot is running with the same token, Telegram returns `409 Conflict`: close the other one (`Ctrl+C` or `pkill -f "tsx.*src/index.ts"`).
- The bot only works while the process is running; it is not a cloud service.

#### 3.5 Everything with a single command

To avoid opening three terminals, the `scripts/local.sh` script starts and stops Ollama, STT, and the bot together. The processes stay in the background (`setsid`), with PIDs in `.run/` and logs in `logs/`.

```bash
npm run local:start      # start everything
npm run local:status     # check processes and /health
npm run local:logs       # follow the bot log (Ctrl+C to exit)
npm run local:stop       # stop everything
npm run local:restart    # restart everything
```

`npm run local:logs -- stt` and `npm run local:logs -- ollama` show the other logs. If Ollama was already running as a system service, `local:start` reuses it and `local:stop` does **not** stop it.

On a GTX 1050 Ti the script starts STT on CPU (`WHISPER_DEVICE=cpu`, `int8`) to avoid CUDA failures; it can be overridden with those variables in `.env`.

Before the first start, download the models once:

```bash
ollama pull qwen2.5:3b
ollama pull bge-m3
```

### 4. Verification

```bash
npm run doctor   # dependencies, models, STT, vault, token, LanceDB
npm test         # 171 tests (schemas, multi-note selector, chunking, frontmatter, classification, palaces, indexer, RAG, bot, STT, seed, spaced repetition)
npm run smoke    # E2E in a temporary vault: create, index, and query a note
```

### Course seed

The repo includes the course **Idearium: how it was built** (22 notes) in `seed/aprendizaje/idearium/`. If the vault does not contain **any** Markdown note, the bot copies the course to `<vault>/Aprendizaje/Idearium/` on startup and indexes it. If there are already notes —even if they are not from the course— it copies or overwrites nothing. To disable it: `SEED_ON_EMPTY=false`.

The seed is part of the project and is distributed under the BSL 1.1 license.

## Usage

### Telegram

Opening the chat with `/start` (or with `/menu`) shows a **fixed keyboard** with the usual actions: `🔍 Consultar`, `📚 Notas`, `🏛️ Palacios`, `🧠 Memorizar`, `🎯 Quiz`, `🃏 Tarjetas`, `📖 Repasar`, `🔄 Reindexar`, and `❓ Ayuda`. There is no need to type `/query` or remember the syntax:

- **Consultar** → write the question in the next message.
- **Memorizar** → write the number, title, or topic of the note.
- **Quiz** → write the number, title, or topic of the notes.
- **Tarjetas** → lists your cards; **Repasar** starts reviewing the due ones.
- **Notas**, **Palacios**, and **Reindexar** run when pressed.
- **Ayuda** shows the menu and the status again.

The commands in the table still work for those who prefer to type them, and Telegram's native menu (`/`) includes all of them with their description.

| Action | How |
| --- | --- |
| Save an idea | Send free text, a voice note, a photo with text, or a document; choose folder and category |
| Discard a pending capture | `/cancelar` |
| Ask the vault | `/query ¿qué anoté sobre el presupuesto?` |
| List notes and numbers | `/notas` or `/notas presupuesto` |
| Read a note | `/notas 7`, `/notas #0007`, or `/notas 0000` (course) |
| Delete a note | `/notas rm 7` |
| Reindex after bulk changes | `/reindex` |
| Force the remote provider | `/remoto <texto>` |
| Create a study that groups notes | `/cluster hardware local` |
| Create/update a palace | `/memorize ruta/o/tema` (a single note) |
| View a palace or list all | `/palacio [número|ruta/o/tema]` |
| Delete a palace | `/palacio rm <número|ruta/o/tema>` |
| Interactive quiz | `/quiz tema`, `/quiz 7`, or `/quiz notas A, B y C` · `/quiz stop` |
| Create cards from a note | `/tarjeta 7` or `/tarjeta Título` |
| Manage cards | `/tarjetas`, `/tarjetas <id>`, `/tarjeta stats`, `/tarjeta rm|suspender|reanudar|editar <id>` |
| Review due cards | `/repasar` · `/repasar stop` |
| Accumulated cost and tokens | `/usage` |
| Help + status | `/start` |
| Show the action keyboard | `/menu` |

The bot replies with the title, path, tags, and provider used. If the audio, the photo, or the document cannot be processed, no note is created and the error is reported.

#### OpenRouter cost and usage

Each OpenRouter response carries its real consumption (`usage.cost` and tokens). Idearium aggregates it in `USAGE_FILE` (`./data/usage.json` by default):

- When saving a note, the confirmation message adds a line `💵 $0.000123 · 1.234 tokens · total $0.0456` with the cost of that capture (includes the summary, OCR/STT, and embeddings used).
- `/query` adds the same line at the end of the response.
- `/usage` shows the accumulated total **since the first call**: total, breakdown by chat/OCR/embeddings/transcription, and the models that have cost the most.
- The file only contains aggregated totals; it does not store notes, prompts, or conversations. If it is deleted, the counter starts from zero.
- Free models record `$0.000000`; if a provider does not return `usage`, the request counts but without tokens/cost.
- The cost note is informational: OpenRouter may round or bill differently for credits, cache, or discounts.

`/notas` shows all notes with their number (`0001 — Título`); `/notas texto` filters by title or path. Old notes without a number appear by their title. `/notas 7` (or `/notas #0007`) shows the full content of that note, without frontmatter.

The course notes use a four-digit prefix (`0000`–`0021`) and do not have `note_number` in the frontmatter: `/notas 0000` reads them by the file name. Those prefixes **do count** toward global numbering, so the first capture after the course will be `0022`.

`/notas rm <número|título|ruta>` deletes the `.md` file, its chunks from the index, and the `index-state.json` entry. It only resolves exact matches: number, title, or path; it does not delete by topic. If the note was a source for a palace, the bot deletes the palace when no source notes remain; if others remain, it updates `source_notes`, removes the link to the deleted note, and tells you which palace was kept. Palaces can also be deleted with `/palacio rm`. It does not delete the original audio or document.

#### Note names

Each captured note is saved as:

```text
NNNN-titulo-DDMMAA.md
```

Example: `0007-comprar-filtros-de-cafe-061126.md`.

- `NNNN`: global vault number, zero-padded to 4 digits. It is computed as the highest existing number + 1, looking at all folders and also the `NNNN` prefixes of the course notes (`0000`–`0021`).
- `titulo`: title slug (no accents, lowercase, hyphens).
- `DDMMAA`: local creation date.

The frontmatter includes `note_number: 7` and `aliases: ["0007"]`, so you can reference the note from any other note with `[[0007]]` in addition to `[[0007-comprar-filtros-de-cafe-061126]]`. You can also use the number directly in the bot: `/quiz 7`, `/memorize 7`, or `/palacio 7` (the latter looks in the palace list, not the note number).

Old notes keep their current name; numbering applies to new ones.

#### Interactive classification (folder and category)

Each text, voice note, photo, or document stops before being saved so that you choose where it goes:

1. **Folder**: buttons with the vault folders that already contain notes (including `Idearium`), plus `➕ Otra carpeta`. You can also type a relative name, for example `Proyectos/Idearium`; the folder is created if it does not exist.
2. **Category**: buttons with the categories already used in the vault (sorted by frequency), starting with the one suggested by the LLM, plus `➕ Otra categoría`. You can also type one: `#idea`, `#tarea`, `#aprendizaje`, `#referencia`, `#proyecto`, `#personal`, or `#otro` (plurals are accepted).

The prepared capture lives in memory for up to 30 minutes. If the bot restarts or that time passes, you must send it again. `/cancelar` discards it without writing anything; the downloaded audio, photo, or document may remain in `data/audio/`, `data/images/`, or `data/documents/` for manual cleanup.

#### Documents

You can send `.md`, `.txt`, `.pdf`, `.doc`, or `.docx` as a file. The bot:

1. Downloads the original into `DOCUMENT_DIR` (20 MB maximum, Telegram's limit).
2. Extracts the text: Markdown without frontmatter, plain text, PDF with a text layer, DOCX with `mammoth`, and DOC with `word-extractor`.
3. Passes it through the same classification flow (folder and category) and saves the `.md` with `document_file` in the frontmatter.

Limits: scanned PDFs without a text layer cannot be read without OCR; the extracted text is trimmed to `DOCUMENT_MAX_CHARS`. The original is not deleted automatically.

#### Photos (OCR)

You can send a photo as a normal Telegram photo (not as a file). The bot:

1. Picks the largest resolution Telegram sent and downloads it into `IMAGES_DIR` (20 MB maximum).
2. Sends it to the multimodal model configured in `OPENROUTER_VISION_MODEL` (`google/gemma-4-31b-it` by default) with a prompt that asks for Markdown and preserves tables, columns, rows, and notes.
3. If the primary model fails, it automatically retries with `OPENROUTER_VISION_FALLBACK_MODEL` (`qwen/qwen3-vl-30b-a3b-instruct`).
4. Shows the detected text, the model used, and asks for confirmation with **Usar este texto**, **Corregir**, or **Cancelar**. If the text came out wrong, **Reintentar con alternativa** reprocesses the same photo with Qwen.
5. Only if you confirm does it generate the summary and continue with the normal folder/category flow.
6. Saves the note with `image_file` in the frontmatter.

Gemma 4 31B is ~2.5× cheaper than Qwen3-VL 30B and read the table tests just as well; Qwen uses more image resolution and remains a safety net for dense documents or small print.

Limits: OCR works well with printed text and screenshots; for handwriting or very skewed photos the quality depends on the model. If it detects no text, it replies `No se detectó texto legible` and does not create an empty note. The photo goes out to OpenRouter; no local OCR is used.

Each `/query` response cites the notes with `[[wikilinks]]` and lists **only the cited sources**. RAG discards chunks far from the best result and limits the fragments per note, so `RAG_TOP_K` is the number of candidates, not of final sources. If there are no results, it explicitly replies that it found nothing (it does not make things up).

#### Palaces of memory

- `/palacio` with no arguments lists all palaces, numbered, individual and combined (`[combinado]`).
- `/palacio 2` returns palace number 2 from that list.
- `/palacio ruta/o/nota.md` or `/palacio tema` still work to query by path, title, or semantic search.
- The response is only the palace story (distilled text), without a path or headings; if it exceeds Telegram's limit it is split into several messages.
- If the note has no palace, the bot suggests creating it with `/memorize <nota>`.
- `/palacio rm <número|nota|tema>` deletes the file from `Palacios/` and removes its link from the source notes; if it was an old palace inside a note, it deletes only that section.

#### Multi-note quiz

`/quiz` accepts a note number, lists of notes, or a topic:

```text
/quiz 7
/quiz sobre las notas Sprint 3, Retrospectiva y OKR del equipo
/quiz procedimiento de compra
```

- It selects the notes by explicit title or by topic and distributes between 3 and 6 questions (at least one per note when the model allows it).
- The `source` of each question is validated against the selected notes; if the LLM invents a source, the question is discarded.
- The feedback cites `[[Título]]` and the final summary shows hits per note.
- If there are no notes for the topic, it does not start the quiz and says so.

#### Palaces of memory

`/memorize` creates the palace of **a single note**. If the expression matches several notes, it does not choose one at random: it shows a list of buttons for you to choose.

```text
/memorize Filtro de café
/memorize procedimiento de compra
```

- If there is a single match, it creates or updates the palace directly.
- If there are several, it shows up to 5 candidates with buttons; pressing one generates the palace for that note.
- An explicit list (`/memorize Nota A, Nota B`) is rejected: the multi-note palace is no longer exposed in the bot because it chose imprecise notes.
- When finished, the message indicates the palace number and how to read it with `/palacio <número>`.
- The palace is created as a new note in `Palacios/YYYY-MM-DD-palacio-<tema>.md` with `type: palacio` and `source_notes`.
- In the original note only a link `[[Palacios/...|Palacio — Título]]` remains inside `## Palacio de la memoria`; the story is not copied.
- The story has 4–6 scenes with a place, an idea, and an absurd image; it does not copy paragraphs from the note.
- `/palacio` shows that story directly, without headings or the full text of the vault.
- The context is limited with `MEMORY_MAX_CHARS` (24,000 by default); if it is trimmed, the note indicates so.

The listing is useful for copying the path and querying it directly; only `.md` files in the vault are read, ignoring `.obsidian/` and `.trash/`.

#### Spaced repetition (flashcards)

Create cards from **one note** with `/tarjeta 7` or `/tarjeta Título`. The bot proposes 5 question/answer pairs, shows a preview, and saves nothing until you press **Guardar** (Save). You can edit each card or cancel the batch.

- `/tarjetas` lists your box; `/tarjetas <id>` shows question, answer, source, tags, and next date. `/tarjetas text` filters by question, answer, or tag.
- `/tarjeta stats` shows total, due, reviews today, 30-day accuracy, streak, and leeches.
- `/tarjeta rm|suspender|reanudar|editar <id>` manages a card. Editing asks for the question first, then the answer.
- `/repasar` opens a session with due cards (at most `SR_MAX_DUE_PER_SESSION`). It shows the question, **Mostrar respuesta** (Show answer), and four ratings: **Otra vez**, **Difícil**, **Bien**, **Fácil**. You can undo the last one and stop with `/repasar stop`.
- `/repasar tag` limits the session to that tag (for example, `#proyecto`).

The algorithm is simplified SM-2: `Otra vez` resets the interval to 10 minutes; `Difícil`/`Bien`/`Fácil` apply 1.2/2.5/3.2 multipliers to the previous interval (minimum 1 day) and adjust ease between 1.3 and 3.0. A card with `SR_LEECH_THRESHOLD` lapses is marked as a leech and is not suspended automatically.

Reminders are sent at `SR_NOTIFY_TIMES` (time zone `SR_TIMEZONE`) when cards are due and `SR_MAX_REVIEWS_PER_DAY` has not been reached; there is a `SR_NOTIFY_GRACE_MINUTES` window. At most one reminder is sent per slot and day, and it is not repeated after a bot restart.

Cards are stored in `FLASHCARD_FILE` (`./data/flashcards.json` by default), with only IDs, questions, answers, tags, source, and review state. They are not sent to OpenRouter during review; the LLM is used only to generate them or evaluate a quiz. Deleting the source note does not delete its cards: the citation is kept and you can remove them with `/tarjeta rm`.

### CLI

```bash
npm run cli -- text "Idea capturada desde terminal" [--remote]
npm run cli -- audio ./nota.ogg [--remote]
npm run cli -- query "¿qué ideas tengo sobre X?"
npm run cli -- notes [texto]
npm run cli -- reindex
```

`--remote` forces OpenRouter (it fails if there is no `OPENROUTER_API_KEY`).

## Note structure

Example of a generated note. The content follows the capture language; the section headings are fixed in Spanish (`Resumen`, `Ideas clave`, `Acciones`, `Transcripción`).

```markdown
---
id: 3f1c…
title: Repensar el índice
note_number: 7
aliases: ["0007"]
summary: La búsqueda debe priorizar notas recientes.
category: idea
tags:
  - busqueda
  - indice
created: 2026-11-05T15:00:00.000Z
updated: 2026-11-05T15:00:00.000Z
source: telegram_voice
language: es
audio_file: /…/data/audio/2026-11-05/….ogg
---

# Repensar el índice

## Resumen
…
## Ideas clave
- …
## Acciones
- [ ] …
## Transcripción
…
```

| Category | Use |
| --- | --- |
| `idea`, `tarea`, `aprendizaje`, `referencia`, `proyecto`, `personal`, `otro` | Capture classification |

## Configuration (`.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | empty | BotFather token; without it there is no bot |
| `TELEGRAM_ALLOWED_USER_IDS` | empty | Comma-separated IDs; required |
| `OLLAMA_API_URL` | `http://127.0.0.1:11434` | Local Ollama |
| `OLLAMA_MODEL` | `qwen2.5:7b-instruct` | Chat/structuring model |
| `OLLAMA_EMBED_MODEL` | `bge-m3` | Embeddings (1024 dims) |
| `OLLAMA_NUM_CTX` | `8192` | Local model context |
| `WHISPER_API_URL` | `http://127.0.0.1:8000` | Local or external OpenAI-compatible STT |
| `WHISPER_API_KEY` | empty | Bearer token for external STT |
| `WHISPER_MODEL` | `small` | faster-whisper model or provider model |
| `WHISPER_TIMEOUT_MS` | `120000` | Transcription timeout |
| `OBSIDIAN_VAULT_PATH` | `~/Documents/IdeariumVault` | Vault root |
| `NOTE_SUBDIR` | `Idearium` | Notes subfolder |
| `LANCEDB_PATH` | `./data/lancedb` | Vector index |
| `AUDIO_DIR` | `./data/audio` | Downloaded audio files |
| `DOCUMENT_DIR` | `./data/documents` | Downloaded original documents |
| `DOCUMENT_MAX_CHARS` | `200000` | Maximum text extracted from a document |
| `IMAGES_DIR` | `./data/images` | Original photos for OCR |
| `USAGE_FILE` | `./data/usage.json` | Aggregated OpenRouter cost/token totals |
| `FLASHCARD_FILE` | `./data/flashcards.json` | Cards, review state, and reminders |
| `SR_ENABLED` | `true` | Enables review reminders |
| `SR_TIMEZONE` | `America/Lima` | IANA zone for dates and reminders |
| `SR_NOTIFY_TIMES` | `08:30,20:30` | Local reminder times, comma-separated |
| `SR_NOTIFY_GRACE_MINUTES` | `60` | Window for a late reminder |
| `SR_CARDS_PER_NOTE` | `5` | Cards proposed per note |
| `SR_MAX_REVIEWS_PER_DAY` | `40` | Daily review limit and reminder condition |
| `SR_MAX_DUE_PER_SESSION` | `20` | Due cards per `/repasar` session |
| `SR_LEECH_THRESHOLD` | `6` | Lapses before a card is marked as a leech |
| `SEED_ON_EMPTY` | `true` | Copies the included course only if the vault has no notes |
| `SEED_DIR` | `./seed/aprendizaje/idearium` | Course seed folder |
| `EMBEDDING_DIM` | `1024` | Must match the embeddings model |
| `EMBEDDING_PROVIDER` | `ollama` | `ollama` or `openrouter` |
| `OPENROUTER_EMBED_MODEL` | `baai/bge-m3` | Remote embeddings model (1024 dims) |
| `LLM_PREFERENCE` | `local_first` | `local_only`, `local_first`, `remote_first`, `remote_only` |
| `LLM_ESCALATE_ON` | `validation_failure,explicit_flag` | Escalation triggers |
| `LLM_MAX_LOCAL_CHARS` | `12000` | `long_input` threshold |
| `LLM_TIMEOUT_MS` | `120000` | Timeout per call |
| `OPENROUTER_API_KEY` | empty | Enables OpenRouter (chat, embeddings, and STT) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Chat/embeddings endpoint |
| `OPENROUTER_MODEL` | empty → `openai/gpt-4o-mini` | OpenRouter chat model |
| `OPENROUTER_VISION_MODEL` | `google/gemma-4-31b-it` | Multimodal model for photo OCR |
| `OPENROUTER_VISION_FALLBACK_MODEL` | `qwen/qwen3-vl-30b-a3b-instruct` | Automatic or on-demand fallback for OCR |
| `OPENROUTER_REASONING_EFFORT` | `none` | `none`, `minimal`, `low`, `medium`, `high`; `none` avoids reasoning tokens |
| `LLM_REMOTE_MODEL` | empty | Historical alias for the OpenRouter model |
| `RAG_TOP_K` | `8` | Retrieved candidates; filtered by distance before answering |
| `MEMORY_MAX_NOTES` | `5` | Maximum candidates for the multi-note quiz and the `/memorize` list |
| `MEMORY_MAX_CHARS` | `24000` | Maximum context characters for palace/quiz |
| `LOG_LEVEL` | `info` | pino level |

### Local/remote routing

- `local_first` (default): uses Ollama. Escalates to OpenRouter if the JSON does not validate (after a local retry with the Zod error as feedback), if you use `--remote`, or if the capture exceeds `LLM_MAX_LOCAL_CHARS`.
- `remote_first`: tries OpenRouter and falls back to local.
- `local_only` / `remote_only`: a single mode. `remote_only` uses OpenRouter, without Ollama.
- Without `OPENROUTER_API_KEY`, the `remote_*` preferences degrade to `local_first` with a warning.
- Embeddings are local by default (`bge-m3`). With `EMBEDDING_PROVIDER=openrouter`, remote `baai/bge-m3` is used (same 1024 dimension).
- There are no other remote providers: DeepSeek was removed from the project because it offers neither embeddings nor STT.

## npm commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Bot + watcher with reload |
| `npm run local:start` | Ollama + STT + bot in the background |
| `npm run local:stop` | Stops everything started by `local:start` |
| `npm run local:status` | Process status and healthchecks |
| `npm run local:logs` | Follows the logs (`-- stt` / `-- ollama`) |
| `npm run build` | Compiles TypeScript to `dist/` |
| `npm start` | Runs `dist/index.js` |
| `npm test` | Vitest |
| `npm run cli -- <cmd>` | CLI |
| `npm run doctor` | Actionable diagnostics |
| `npm run smoke` | E2E test in a temporary vault |
| `npm run install:server` | Installer for Ubuntu/Debian (requires sudo) |

## How the index works

- `chunkMarkdown` splits by headings and splits long sections with overlap.
- Each chunk is embedded with `bge-m3` in batches and stored in the `notes` table of LanceDB (`note_path`, `chunk_index`, `vector`, `text`, `title`, `tags`, `category`, `updated_at`).
- A hash per file is stored in `data/index-state.json`; if it has not changed, it is not reindexed.
- The watcher (`chokidar`, 500 ms debounce) syncs manual edits to the vault, ignoring `.obsidian/` and `.trash/`.

## Troubleshooting

**Ollama is not responding** → `ollama serve` and check `curl 127.0.0.1:11434/api/tags`.

**A model is missing** → the doctor tells you which one; `ollama pull <modelo>`.

**STT is on CPU** → check `/health`; if there is no GPU, the server falls back to CPU on purpose. To force it: `WHISPER_DEVICE=cpu ./stt/start.sh`. On GPU, verify `nvidia-smi` and that `uv sync` installed `nvidia-cudnn-cu12`.

**"Could not connect to Ollama for embeddings"** → `bge-m3` is missing or Ollama is down; the index is not updated but the note is already saved.

**Docker with GPU** → not used in this project. If you see `failed to discover GPU vendor from CDI`, it is the Docker setup, not Idearium; STT runs natively.

**I changed the embeddings model** → update `EMBEDDING_DIM` and delete `data/lancedb` + `data/index-state.json`; then `/reindex`.

## Privacy

- Audio, transcriptions, notes, and vectors stay on your disk.
- Only what you send to Telegram (which is unavoidable) leaves your machine and, if you enable OpenRouter, the text of the capture/query, the fragments used by RAG, the embeddings, and/or the audio sent to OpenRouter.
- With `EMBEDDING_PROVIDER=openrouter`, the texts of your notes also leave for OpenRouter to compute vectors.
- With remote STT, the audio leaves for the provider configured in `WHISPER_API_URL`.
- With remote OCR, the photo leaves for OpenRouter; the detected text is saved in the note.
- Audio files are stored in `data/audio/`; delete them whenever you want.
- The bot only works in private chats: in groups or channels it refuses to respond so as not to expose your notes to third parties.

## Status and roadmap

**The current version on `main`** (v0.2.0) includes text, voice, photo-with-OCR, and document capture; interactive classification; a fixed Telegram menu; notes with `/notas` to list, read, and delete; notes in Obsidian; a LanceDB index; RAG; studies; palaces of memory; quizzes; **flashcards with spaced repetition and scheduled reminders**; a CLI; a server installer; and a 100 % OpenRouter mode.

Pending:

- OCR for scanned PDFs (photos already use multimodal OCR).
- Optional Telegram webhook for HTTPS deployments (F6).
- Hybrid BM25 search, periodic summaries, multi-vault, and mobile integration outside Telegram.

## License

**Business Source License 1.1** — see [LICENSE](LICENSE).

You may use, copy, modify, and distribute Idearium for **non-commercial** purposes. Commercial use —including offering it as a paid product or service— requires a commercial license: `iam@fakel.lol`. Four years after the publication of each version, that version becomes **GPL-3.0-or-later**.

All versions of Idearium are distributed under **BSL 1.1**.
