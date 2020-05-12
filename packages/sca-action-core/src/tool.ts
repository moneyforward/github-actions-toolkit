import { RubyGemsInstaller } from './tool/installer';

export * as command from './tool/command';
export * as installer from './tool/installer'
export * as stream from './tool/stream';

export function installGem(isStrict = true, ...gemNames: string[]): Promise<Map<string, string>> {
  console.log(`::group::Installing gems...`);
  return new RubyGemsInstaller(isStrict).execute(gemNames)
    .finally(() => console.log(`::endgroup::`));
}
