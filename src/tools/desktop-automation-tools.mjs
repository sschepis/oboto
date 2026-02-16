// Desktop Automation Tools using @nut-tree-fork/nut-js
// Provides keyboard and mouse control, screen analysis, and window management

import { mouse, keyboard, screen, Point, Button, Key, imageResource, straightTo, centerOf, sleep } from '@nut-tree-fork/nut-js';
import { consoleStyler } from '../ui/console-styler.mjs';

// Configure nut.js defaults
mouse.config.mouseSpeed = 1000; // Pixels per second

export class DesktopAutomationTools {
    constructor() {
        this.isAutomationEnabled = true; // Can be toggled via config in future
    }

    // Move mouse to coordinates
    async moveMouse(args) {
        const { x, y, speed } = args;
        
        consoleStyler.log('working', `Moving mouse to (${x}, ${y})`);
        
        try {
            if (speed) {
                mouse.config.mouseSpeed = speed;
            }
            
            await mouse.move(straightTo(new Point(x, y)));
            
            // Reset speed to default
            mouse.config.mouseSpeed = 1000;
            
            return `Mouse moved to (${x}, ${y})`;
        } catch (error) {
            consoleStyler.log('error', `Mouse move failed: ${error.message}`);
            return `Error moving mouse: ${error.message}`;
        }
    }

    // Click mouse button
    async clickMouse(args) {
        const { button = 'left', double_click = false } = args;
        
        consoleStyler.log('working', `${double_click ? 'Double-' : ''}Clicking ${button} mouse button`);
        
        try {
            const btn = button === 'right' ? Button.RIGHT : (button === 'middle' ? Button.MIDDLE : Button.LEFT);
            
            if (double_click) {
                await mouse.doubleClick(btn);
            } else {
                await mouse.click(btn);
            }
            
            return `Clicked ${button} button${double_click ? ' (double)' : ''}`;
        } catch (error) {
            consoleStyler.log('error', `Mouse click failed: ${error.message}`);
            return `Error clicking mouse: ${error.message}`;
        }
    }

    // Type text
    async typeText(args) {
        const { text, delay = 0 } = args;
        
        consoleStyler.log('working', `Typing text: "${text}"`);
        
        try {
            if (delay > 0) {
                keyboard.config.autoDelayMs = delay;
            }
            
            await keyboard.type(text);
            
            // Reset delay
            keyboard.config.autoDelayMs = 500;
            
            return `Typed "${text}"`;
        } catch (error) {
            consoleStyler.log('error', `Typing failed: ${error.message}`);
            return `Error typing text: ${error.message}`;
        }
    }

    // Press specific key(s)
    async pressKey(args) {
        const { keys } = args; // Array of key names like ['Control', 'c']
        
        consoleStyler.log('working', `Pressing keys: ${keys.join(' + ')}`);
        
        try {
            const mappedKeys = keys.map(k => this.mapKey(k)).filter(k => k !== null);
            
            if (mappedKeys.length === 0) {
                return "Error: No valid keys provided";
            }
            
            await keyboard.pressKey(...mappedKeys);
            await keyboard.releaseKey(...mappedKeys);
            
            return `Pressed ${keys.join(' + ')}`;
        } catch (error) {
            consoleStyler.log('error', `Key press failed: ${error.message}`);
            return `Error pressing keys: ${error.message}`;
        }
    }

    // Capture screen
    async captureScreen(args) {
        const { filename = 'screenshot.png' } = args;
        
        consoleStyler.log('working', `Capturing screen to ${filename}`);
        
        try {
            const img = await screen.grab();
            await screen.save(filename); // nut.js handles format based on extension
            return `Screenshot saved to ${filename} (${img.width}x${img.height})`;
        } catch (error) {
            consoleStyler.log('error', `Screen capture failed: ${error.message}`);
            return `Error capturing screen: ${error.message}`;
        }
    }
    
    // Get screen dimensions
    async getScreenSize() {
        try {
            const width = await screen.width();
            const height = await screen.height();
            return `Screen size: ${width}x${height}`;
        } catch (error) {
            return `Error getting screen size: ${error.message}`;
        }
    }

    // Helper to map string key names to nut.js Key constants
    mapKey(keyName) {
        const keyMap = {
            'enter': Key.Enter,
            'escape': Key.Escape,
            'tab': Key.Tab,
            'space': Key.Space,
            'backspace': Key.Backspace,
            'delete': Key.Delete,
            'control': Key.LeftControl, // Default to left
            'alt': Key.LeftAlt,
            'shift': Key.LeftShift,
            'command': Key.LeftSuper, // Mac Command / Windows Key
            'super': Key.LeftSuper,
            'up': Key.Up,
            'down': Key.Down,
            'left': Key.Left,
            'right': Key.Right,
            'f1': Key.F1, 'f2': Key.F2, 'f3': Key.F3, 'f4': Key.F4, 'f5': Key.F5,
            'f6': Key.F6, 'f7': Key.F7, 'f8': Key.F8, 'f9': Key.F9, 'f10': Key.F10,
            'f11': Key.F11, 'f12': Key.F12,
            'printscreen': Key.Print,
            'home': Key.Home,
            'end': Key.End,
            'pageup': Key.PageUp,
            'pagedown': Key.PageDown
        };
        
        // Handle single characters
        if (keyName.length === 1) {
            const upper = keyName.toUpperCase();
            if (Key[upper] !== undefined) {
                return Key[upper];
            }
        }
        
        const lowerName = keyName.toLowerCase();
        return keyMap[lowerName] !== undefined ? keyMap[lowerName] : null;
    }
}
