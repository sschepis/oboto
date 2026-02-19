# Oboto Chrome Controller Extension

This extension connects Google Chrome to the Oboto environment, allowing for full browser automation and control.

## Installation

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top right corner.
3. Click **Load unpacked**.
4. Select the `chrome-extension` directory inside your Oboto project.

## Usage

1. Start your Oboto server (e.g., `npm start` in the project root).
2. The extension acts as a WebSocket client connecting to `ws://localhost:3000/ws/chrome`.
3. Click the Oboto extension icon in the Chrome toolbar.
   - **Green Badge (ON)**: Connected successfully.
   - **Red Badge (OFF)**: Disconnected.
   - **Amber Badge (...)**: Connecting / Reconnecting.

## Features

- **Tab Management**: Create, close, update, move, and reload tabs.
- **Window Management**: Create and manage windows.
- **Navigation**: Navigate to URLs and wait for load.
- **DOM Interaction**: Click, type, scroll, extract text/links/structure, and execute JS.
- **Debugger**: Attach Chrome Debugger Protocol (CDP) for advanced automation.
- **Network & Storage**: Manage cookies, downloads, history, and bookmarks.
- **Event Streaming**: Forwards tab, window, and navigation events to Oboto.

## Troubleshooting

- If the badge stays red, ensure the Oboto server is running on port 3000.
- Check the extension service worker console (`chrome://extensions` > Details > Inspect views: Service Worker) for connection errors.
- Default port is 3000. You can change it in `chrome.storage.local` if needed (key: `port`).
