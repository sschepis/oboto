export const EMBED_TOOLS = [
    {
        type: "function",
        function: {
            name: "embed_object",
            description: `Embed rich media inline in the chat. Use this tool to show YouTube videos, Spotify tracks, audio players, maps, CodePen demos, Loom videos, Figma files, GitHub Gists, tweets, or any URL as an inline iframe.

WHEN TO USE:
- User asks to "show me a video" or "play this song"
- User shares a YouTube/Spotify/Loom/CodePen/Figma/Gist URL
- You want to present a visual result (map, demo, media) inline rather than just a link

EMBED TYPES:
- youtube: YouTube video (pass any youtube.com or youtu.be URL)
- video: Direct video file (mp4, webm URL)
- audio: Audio file (mp3, wav, ogg URL)
- spotify: Spotify track/album/playlist URL
- loom: Loom video URL
- codepen: CodePen pen URL
- figma: Figma file URL
- gist: GitHub Gist URL
- tweet: Twitter/X post URL
- map: Google Maps URL or a place name/address
- iframe: Any URL to embed in a sandboxed iframe
- generic: Fallback for any embeddable URL

The embedded content renders inline in the chat with a header, controls, and optional description.`,
            parameters: {
                type: "object",
                properties: {
                    embed_type: {
                        type: "string",
                        enum: ["youtube", "video", "audio", "iframe", "map", "tweet", "codepen", "spotify", "figma", "gist", "loom", "generic"],
                        description: "The type of embed. Determines rendering behavior and URL transformation."
                    },
                    url: {
                        type: "string",
                        description: "The source URL to embed. For YouTube, any valid youtube.com or youtu.be link. For maps, a Google Maps URL or a place name."
                    },
                    title: {
                        type: "string",
                        description: "Display title shown in the embed header. If omitted, the embed type label is used."
                    },
                    description: {
                        type: "string",
                        description: "Optional caption or description shown below the embed."
                    },
                    thumbnail_url: {
                        type: "string",
                        description: "Optional thumbnail image URL. If provided, shows a preview image with a play button instead of loading the embed immediately."
                    },
                    start_time: {
                        type: "number",
                        description: "Start time in seconds (for video/audio embeds)."
                    },
                    autoplay: {
                        type: "boolean",
                        description: "Whether to autoplay the media. Default: false."
                    },
                    width: {
                        type: "string",
                        description: "CSS width value (e.g. '100%', '640px'). Default: '100%'."
                    },
                    height: {
                        type: "string",
                        description: "CSS height value (e.g. '360px', '152px'). Default: auto-calculated per type."
                    }
                },
                required: ["embed_type", "url"]
            }
        }
    }
];
