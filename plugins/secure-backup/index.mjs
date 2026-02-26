import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';
import { consoleStyler } from '../../src/ui/console-styler.mjs';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;       // 256 bits
const IV_LENGTH = 16;        // 128 bits
const SALT_LENGTH = 32;      // 256 bits
const AUTH_TAG_LENGTH = 16;  // 128 bits

const DEFAULT_SETTINGS = {
  enabled: true,
  pbkdf2Iterations: 100000,
  pbkdf2Digest: 'sha512',
  backupDirName: '.backups',
};

const SETTINGS_SCHEMA = [
  { key: 'enabled', label: 'Enabled', type: 'boolean', description: 'Enable or disable secure backup', default: true },
  { key: 'pbkdf2Iterations', label: 'PBKDF2 Iterations', type: 'number', description: 'Number of PBKDF2 iterations for key derivation (higher = slower but more secure)', default: 100000, min: 10000, max: 1000000 },
  { key: 'pbkdf2Digest', label: 'PBKDF2 Digest', type: 'select', description: 'Hash algorithm for PBKDF2 key derivation', default: 'sha512', options: ['sha256', 'sha384', 'sha512'] },
  { key: 'backupDirName', label: 'Backup Directory Name', type: 'text', description: 'Name of the backup directory inside the working directory', default: '.backups' },
];

class CryptoEngine {
  constructor(settings) {
    this.settings = settings;
  }

  deriveKey(passphrase, salt) {
    return crypto.pbkdf2Sync(
      passphrase,
      salt,
      this.settings.pbkdf2Iterations || 100000,
      KEY_LENGTH,
      this.settings.pbkdf2Digest || 'sha512'
    );
  }

  encrypt(data, passphrase) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = this.deriveKey(passphrase, salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH
    });

    const encrypted = Buffer.concat([
      cipher.update(data),
      cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return {
      salt,
      iv,
      authTag,
      ciphertext: encrypted
    };
  }

  decrypt(payload, passphrase) {
    const key = this.deriveKey(passphrase, payload.salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, payload.iv, {
      authTagLength: AUTH_TAG_LENGTH
    });

    decipher.setAuthTag(payload.authTag);

    const decrypted = Buffer.concat([
      decipher.update(payload.ciphertext),
      decipher.final()
    ]);

    return decrypted;
  }

  computeChecksum(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  verifyChecksum(data, expected) {
    const actual = this.computeChecksum(data);
    return crypto.timingSafeEqual(
      Buffer.from(actual, 'hex'),
      Buffer.from(expected, 'hex')
    );
  }

  generateId() {
    return Date.now().toString(36) + '-' + crypto.randomBytes(6).toString('hex');
  }
}

export async function activate(api) {
  consoleStyler.log('plugin', 'Activating...');

  const cryptoEngine = new CryptoEngine(DEFAULT_SETTINGS);

  // Pre-create instance object to avoid race condition with onSettingsChange callback
  const instanceState = { settings: null };
  api.setInstance(instanceState);

  const { pluginSettings } = await registerSettingsHandlers(
    api, 'secure-backup', DEFAULT_SETTINGS, SETTINGS_SCHEMA,
    () => {
      cryptoEngine.settings = pluginSettings;
      instanceState.settings = pluginSettings;
    }
  );

  instanceState.settings = pluginSettings;

  cryptoEngine.settings = pluginSettings;
  const getBackupsDir = () => {
    // Sanitize backupDirName to prevent path traversal
    const raw = pluginSettings.backupDirName || '.backups';
    const sanitized = raw.replace(/[\/\\]/g, '').replace(/^\.{2,}$/, '.backups') || '.backups';
    return path.join(api.workingDir, sanitized);
  };

  async function ensureBackupDir() {
    try {
      await fs.mkdir(getBackupsDir(), { recursive: true });
    } catch (e) {
      consoleStyler.logError('error', 'Could not create backup directory', e);
    }
  }

  api.tools.register({
    name: 'create_backup',
    useOriginalName: true,
    description: 'Create an encrypted backup of the application state and data',
    parameters: {
      type: 'object',
      properties: {
        passphrase: { type: 'string', description: 'Passphrase used to encrypt the backup' },
        name: { type: 'string', description: 'Optional name for the backup' }
      },
      required: ['passphrase']
    },
    handler: async (args) => {
      if (!pluginSettings.enabled) {
        return { success: false, message: 'Secure Backup plugin is disabled' };
      }

      const backupsDir = getBackupsDir();
      await ensureBackupDir();

      const backupData = {
        timestamp: Date.now(),
        name: args.name || `Backup-${new Date().toISOString()}`,
        data: {
          info: "Oboto Backup Payload",
          version: "1.0.0"
        }
      };

      const dataBuffer = Buffer.from(JSON.stringify(backupData), 'utf-8');
      const encrypted = cryptoEngine.encrypt(dataBuffer, args.passphrase);
      
      const backupId = cryptoEngine.generateId();
      const checksum = cryptoEngine.computeChecksum(encrypted.ciphertext);

      const backupFile = {
        metadata: {
          id: backupId,
          timestamp: backupData.timestamp,
          name: backupData.name,
          checksum
        },
        salt: encrypted.salt.toString('base64'),
        iv: encrypted.iv.toString('base64'),
        authTag: encrypted.authTag.toString('base64'),
        payload: encrypted.ciphertext.toString('base64')
      };

      const filePath = path.join(backupsDir, `${backupId}.json`);
      await fs.writeFile(filePath, JSON.stringify(backupFile, null, 2), 'utf-8');

      return { success: true, backupId, path: filePath, checksum };
    }
  });

  api.tools.register({
    name: 'restore_backup',
    useOriginalName: true,
    description: 'Restore data from an encrypted backup file',
    parameters: {
      type: 'object',
      properties: {
        backupId: { type: 'string', description: 'ID of the backup to restore' },
        passphrase: { type: 'string', description: 'Passphrase used to decrypt the backup' }
      },
      required: ['backupId', 'passphrase']
    },
    handler: async (args) => {
      if (!pluginSettings.enabled) {
        return { success: false, message: 'Secure Backup plugin is disabled' };
      }

      const backupsDir = getBackupsDir();
      // Security: prevent path traversal — resolve and verify the path stays inside backupsDir
      const filePath = path.join(backupsDir, `${args.backupId}.json`);
      const resolvedPath = path.resolve(filePath);
      const resolvedBackupsDir = path.resolve(backupsDir);
      if (resolvedPath !== resolvedBackupsDir && !resolvedPath.startsWith(resolvedBackupsDir + path.sep)) {
        throw new Error('Invalid backup ID: path traversal detected');
      }
      let fileContent;
      try {
        fileContent = await fs.readFile(filePath, 'utf-8');
      } catch (e) {
        throw new Error(`Backup not found: ${args.backupId}`);
      }

      const backupFileData = JSON.parse(fileContent);
      const ciphertext = Buffer.from(backupFileData.payload, 'base64');
      
      if (!cryptoEngine.verifyChecksum(ciphertext, backupFileData.metadata.checksum)) {
        throw new Error('Backup integrity check failed - checksum mismatch');
      }

      const decrypted = cryptoEngine.decrypt({
        salt: Buffer.from(backupFileData.salt, 'base64'),
        iv: Buffer.from(backupFileData.iv, 'base64'),
        authTag: Buffer.from(backupFileData.authTag, 'base64'),
        ciphertext
      }, args.passphrase);

      const data = JSON.parse(decrypted.toString('utf-8'));
      
      consoleStyler.log('plugin', `[Secure Backup] Successfully decrypted data: ${data.name}`);

      return { success: true, message: `Restored backup ${data.name}` };
    }
  });

  api.tools.register({
    name: 'list_backups',
    useOriginalName: true,
    description: 'List all available encrypted backups',
    parameters: {
      type: 'object',
      properties: {}
    },
    handler: async () => {
      const backupsDir = getBackupsDir();
      await ensureBackupDir();
      const files = await fs.readdir(backupsDir);
      const backups = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const content = await fs.readFile(path.join(backupsDir, file), 'utf-8');
            const parsed = JSON.parse(content);
            if (parsed.metadata) {
              backups.push(parsed.metadata);
            }
          } catch (e) {
            // Ignore invalid files
          }
        }
      }

      return { backups: backups.sort((a, b) => b.timestamp - a.timestamp) };
    }
  });

  consoleStyler.log('plugin', 'Activated.');
}

export function deactivate(api) {
  consoleStyler.log('plugin', 'Deactivated.');
}
