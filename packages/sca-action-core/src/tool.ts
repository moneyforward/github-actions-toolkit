import { RubyGemsInstaller } from './tool/installer';

export * as installer from './tool/installer'

export function installGem(isStrict = true, ...gemNames: string[]): Promise<Map<string, string>> {
  console.log(`::group::Installing gems...`);
  return new RubyGemsInstaller(isStrict).execute(gemNames)
    .finally(() => console.log(`::endgroup::`));
}
