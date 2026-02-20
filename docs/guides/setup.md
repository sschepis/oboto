# Setup and Usage Guide

This guide will help you set up and run the Oboto AI Assistant.

## Prerequisites

*   **Node.js**: v18.0.0 or higher
*   **Package Manager**: `npm` (for root) and `pnpm` (for UI)
*   **Browser**: Google Chrome (for browser automation and extension support)

## Installation

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/sschepis/oboto.git
    cd oboto
    ```

2.  **Install Root Dependencies**
    ```bash
    npm install
    ```

3.  **Install UI Dependencies**
    ```bash
    cd ui
    pnpm install
    cd ..
    ```

## Configuration

1.  **Create Environment File**
    Copy `.env.example` to `.env`:
    ```bash
    cp .env.example .env
    ```

2.  **Configure API Keys**
    Open `.env` and add your API keys:
    *   `GOOGLE_API_KEY` (Required for Gemini)
    *   `ANTHROPIC_API_KEY` (Optional for Claude)
    *   `OPENAI_API_KEY` (Optional)

## Running the Application

### Option A: Server Mode (Recommended)
This runs the backend server and the web UI.

1.  **Start the Backend Server**
    ```bash
    npm run serve
    ```
    This will start the server on `http://localhost:3000`.

2.  **Start the Frontend (Development)**
    In a new terminal:
    ```bash
    npm run dev:ui
    ```
    This will launch the UI on `http://localhost:5173`.

### Option B: CLI Mode
Run the assistant directly in your terminal.

```bash
npm start
```

### Option C: Production Build
To build the UI for production serving:

```bash
npm run build:all
```

## Oboto Cloud (Optional)

Oboto Cloud adds workspace sync, team collaboration, cloud AI agents, and metered AI model access. It's fully optional — everything works without it.

### Setting Up Cloud

1.  **Sign up** at [oboto.ai](https://oboto.ai) to get your cloud credentials.

2.  **Add cloud credentials** to your `.env` or Secrets Vault:
    ```env
    OBOTO_CLOUD_URL=https://your-project.supabase.co
    OBOTO_CLOUD_KEY=your-anon-key
    ```
    Or configure via the Secrets Vault UI (⌘K → "Secrets Vault").

3.  **Restart the server**. You'll see `☁️ Cloud integration initialized` in the logs.

4.  **Log in** via Settings → Cloud tab in the UI.

### Cloud Features

| Feature | Description |
|---------|-------------|
| **Login/Profile** | Sign in to see your org, team, and profile |
| **Workspace Sync** | Link a local workspace to a cloud workspace for state sync |
| **Conversation Sync** | Push/pull messages between local and cloud |
| **Cloud Agents** | Invoke cloud AI agents configured in the dashboard |
| **AI Proxy** | Route AI requests through the cloud (no local API keys needed) |
| **Presence** | See who's online in your workspace in real-time |

### Using Cloud as AI Provider

Set `AI_PROVIDER=cloud` in your `.env` to route all AI requests through the cloud proxy. This uses your organization's metered AI access — no local API keys required.

```env
AI_PROVIDER=cloud
AI_MODEL=auto
```

The cloud proxy supports all major models and automatically routes to the optimal provider. If the cloud is unavailable, Oboto falls back to any locally configured provider.

### No Cloud? No Problem

Without `OBOTO_CLOUD_URL` and `OBOTO_CLOUD_KEY`, the cloud module doesn't load at all. Zero impact on startup time, zero cloud code in memory, and all local features work identically.

## Usage

1.  **Access the UI**: Open `http://localhost:5173` (or the production URL).
2.  **Start a Chat**: Type your request in the input box.
3.  **Use Tools**: The agent will automatically use tools as needed. You can also invoke specific commands (e.g., `/plan`, `/analyze`).
4.  **Manage Files**: Use the built-in file editor tab to view and edit code.
5.  **View Architecture**: Use the `/visualize` command to see system diagrams.
