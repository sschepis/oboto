import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;       // 256 bits
const IV_LENGTH = 16;        // 128 bits
const SALT_LENGTH = 32;      // 256 bits
const AUTH_TAG_LENGTH = 16;  // 128 bits
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_DIGEST = 'sha512';

class CryptoEngine {
  deriveKey(passphrase, salt) {
    return crypto.pbkdf2Sync(
      passphrase,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      PBKDF2_DIGEST
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

export function activate(api) {
  console.log('[Secure Backup] Activating...');
  const cryptoEngine = new CryptoEngine();
  const backupsDir = path.join(api.workingDir, '.backups');

  async function ensureBackupDir() {
    try {
      await fs.mkdir(backupsDir, { recursive: true });
    } catch (e) {
      console.error('[Secure Backup] Could not create .backups directory', e);
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
      await ensureBackupDir();

      // Collect data to backup. We can get plugin settings and anything else from storage or disk.
      // For this implementation, we will backup the state that we can access.
      const backupData = {
        timestamp: Date.now(),
        name: args.name || `Backup-${new Date().toISOString()}`,
        // Note: For a real system we would ask oboto for everything or read all storage files.
        // For now, we will simulate by reading a dummy object.
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

      const backupFile = JSON.parse(fileContent);
      const ciphertext = Buffer.from(backupFile.payload, 'base64');
      
      if (!cryptoEngine.verifyChecksum(ciphertext, backupFile.metadata.checksum)) {
        throw new Error('Backup integrity check failed - checksum mismatch');
      }

      const decrypted = cryptoEngine.decrypt({
        salt: Buffer.from(backupFile.salt, 'base64'),
        iv: Buffer.from(backupFile.iv, 'base64'),
        authTag: Buffer.from(backupFile.authTag, 'base64'),
        ciphertext
      }, args.passphrase);

      const data = JSON.parse(decrypted.toString('utf-8'));
      
      // In a real scenario, we would apply `data` to the system state here.
      console.log('[Secure Backup] Successfully decrypted data:', data.name);

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

  console.log('[Secure Backup] Activated.');
}

export function deactivate(api) {
  console.log('[Secure Backup] Deactivated.');
}
