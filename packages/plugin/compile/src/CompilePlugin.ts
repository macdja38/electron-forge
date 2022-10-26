import { ForgeConfig, ForgeHookMap } from '@electron-forge/shared-types';
import PluginBase, { StartOptions } from '@electron-forge/plugin-base';
import * as path from 'path';

import { CompilePluginConfig } from './Config';
import { createCompileHook } from './lib/compile-hook';

export default class LocalElectronPlugin extends PluginBase<CompilePluginConfig> {
  name = 'electron-compile';

  private dir!: string;

  constructor(c: CompilePluginConfig) {
    super(c);

    this.init = this.init.bind(this);
    this.getHooks = this.getHooks.bind(this);
    this.startLogic = this.startLogic.bind(this);
  }

  init(dir: string, config: ForgeConfig): void {
    super.init(dir, config);
    this.dir = dir;
  }

  getHooks(): ForgeHookMap {
    return {
      packageAfterCopy: createCompileHook(this.dir),
    };
  }

  async startLogic(_opts: StartOptions): Promise<string[]> {
    return [process.execPath, path.resolve(this.dir, 'node_modules/electron-prebuilt-compile/lib/cli')];
  }
}

export { CompilePluginConfig };
