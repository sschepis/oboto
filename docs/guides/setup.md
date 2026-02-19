# Setup and Usage Guide

This guide will help you set up and run the Robodev AI Assistant.

## Prerequisites

*   **Node.js**: v18.0.0 or higher
*   **Package Manager**: `npm` (for root) and `pnpm` (for UI)
*   **Browser**: Google Chrome (for browser automation and extension support)

## Installation

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/sschepis/robodev.git
    cd robodev
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

## Usage

1.  **Access the UI**: Open `http://localhost:5173` (or the production URL).
2.  **Start a Chat**: Type your request in the input box.
3.  **Use Tools**: The agent will automatically use tools as needed. You can also invoke specific commands (e.g., `/plan`, `/analyze`).
4.  **Manage Files**: Use the built-in file editor tab to view and edit code.
5.  **View Architecture**: Use the `/visualize` command to see system diagrams.
