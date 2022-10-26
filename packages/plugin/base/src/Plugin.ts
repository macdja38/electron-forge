import { ElectronProcess, ResolvedForgeConfig, ForgeHookFn, IForgePlugin, StartOptions } from '@electron-forge/shared-types';

export { StartOptions };

export default abstract class Plugin<C> implements IForgePlugin {
  public abstract name: string;

  /** @internal */
  __isElectronForgePlugin!: true;

  constructor(public config: C) {
    Object.defineProperty(this, '__isElectronForgePlugin', {
      value: true,
      enumerable: false,
      configurable: false,
    });
  }

  init(_dir: string, _config: ResolvedForgeConfig): void {
    // By default, do nothing. This can be overridden.
  }

  getHook(_hookName: string): ForgeHookFn | null {
    return null;
  }

  async startLogic(_startOpts: StartOptions): Promise<ElectronProcess | string | string[] | false> {
    return false;
  }
}
