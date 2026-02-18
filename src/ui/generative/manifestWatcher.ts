import * as chokidar from 'chokidar';
import { readFile } from 'fs/promises';
import { UiManifest } from './types';

export class ManifestWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private currentManifest: UiManifest | null = null;
  private onChange: (manifest: UiManifest) => void;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceDelay: number = 200; // 200ms debounce

  constructor(onChange: (manifest: UiManifest) => void, debounceDelay: number = 200) {
    this.onChange = onChange;
    this.debounceDelay = debounceDelay;
  }

  async start(path: string): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
    }

    this.watcher = chokidar.watch(path, {
      persistent: true,
      ignoreInitial: false,
    });

    const handleChange = (filePath: string) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(async () => {
        try {
          const content = await readFile(filePath, 'utf-8');
          const manifest = JSON.parse(content) as UiManifest;
          this.currentManifest = manifest;
          this.onChange(manifest);
        } catch (error) {
          console.error('Error reading manifest:', error);
        }
      }, this.debounceDelay);
    };

    this.watcher.on('change', handleChange);
    this.watcher.on('add', handleChange);
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  getCurrentManifest(): UiManifest | null {
    return this.currentManifest;
  }
}
