import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vitest } from 'vitest';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { automock } from 'test/utils.js';

describe('StorageRepository memory events', () => {
  const filename = 'd03b347d-a339-40c7-8625-af6f50d57eee.3f44e515-5cc6-454f-b7a0-cfa9d94f20dc.json';
  let directory: string;
  let sut: StorageRepository;

  beforeEach(async () => {
    directory = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'immich-memory-events-')));
    sut = new StorageRepository(automock(LoggingRepository, { strict: false }));
  });

  afterEach(async () => {
    vitest.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('atomically coalesces one owner-asset file with private permissions and no temporary leftovers', async () => {
    await sut.writeMemoryEvent(directory, filename, Buffer.from('{"reason":"upload"}'));
    await sut.writeMemoryEvent(directory, filename, Buffer.from('{"reason":"scene-metadata"}'));
    expect(await fs.readdir(directory)).toEqual([filename]);
    expect(await fs.readFile(path.join(directory, filename), 'utf8')).toBe('{"reason":"scene-metadata"}');
    const stats = await fs.stat(path.join(directory, filename));
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('preserves the previously published file when replacement fails and removes only its temporary write', async () => {
    await sut.writeMemoryEvent(directory, filename, Buffer.from('accepted'));
    vitest.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename unavailable'));
    await expect(sut.writeMemoryEvent(directory, filename, Buffer.from('replacement'))).rejects.toThrow(
      'rename unavailable',
    );
    expect(await fs.readFile(path.join(directory, filename), 'utf8')).toBe('accepted');
    expect(await fs.readdir(directory)).toEqual([filename]);
  });

  it('does not create a missing directory or accept a relative configured path', async () => {
    await expect(sut.writeMemoryEvent(path.join(directory, 'missing'), filename, Buffer.from('{}'))).rejects.toThrow();
    await expect(sut.writeMemoryEvent('relative/path', filename, Buffer.from('{}'))).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('rejects a symlinked target directory without writing through it', async () => {
    const link = path.join(directory, 'link');
    await fs.symlink(directory, link);
    await expect(sut.writeMemoryEvent(link, filename, Buffer.from('{}'))).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual(['link']);
  });

  it('rejects a directory exposed to another group or user', async () => {
    await fs.chmod(directory, 0o770);
    await expect(sut.writeMemoryEvent(directory, filename, Buffer.from('{}'))).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('rejects a directory owned by a different uid', async () => {
    const uid = process.getuid!();
    vitest.spyOn(process, 'getuid').mockReturnValue(uid + 1);
    await expect(sut.writeMemoryEvent(directory, filename, Buffer.from('{}'))).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('does not follow an existing destination symlink outside the spool', async () => {
    const sentinel = path.join(directory, 'sentinel');
    await fs.writeFile(sentinel, 'preserve');
    await fs.symlink(sentinel, path.join(directory, filename));
    await sut.writeMemoryEvent(directory, filename, Buffer.from('event'));
    expect(await fs.readFile(sentinel, 'utf8')).toBe('preserve');
    const stats = await fs.lstat(path.join(directory, filename));
    expect(stats.isSymbolicLink()).toBe(false);
  });

  it('rejects filenames outside the owner and asset uuid contract', async () => {
    await expect(sut.writeMemoryEvent(directory, '../outside.json', Buffer.from('{}'))).rejects.toThrow();
    await expect(sut.writeMemoryEvent(directory, 'one-owner.json', Buffer.from('{}'))).rejects.toThrow();
    expect(await fs.readdir(directory)).toEqual([]);
  });
});
