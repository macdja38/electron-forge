import { ChildProcess } from 'child_process';
import { ArchOption, Options as ElectronPackagerOptions, TargetPlatform } from 'electron-packager';
import { RebuildOptions } from 'electron-rebuild';
import { OraImpl } from '@electron-forge/async-ora';

export type ElectronProcess = ChildProcess & { restarted: boolean };

export type ForgePlatform = TargetPlatform;
export type ForgeArch = ArchOption;
export type ForgeConfigPublisher = IForgeResolvablePublisher | IForgePublisher;
export type ForgeConfigMaker = IForgeResolvableMaker | IForgeMaker;
export type ForgeConfigPlugin = IForgeResolvablePlugin | IForgePlugin;

export interface ForgeSimpleHookSignatures {
  generateAssets: [platform: ForgePlatform, version: ForgeArch];
  postStart: [appProcess: ElectronProcess];
  prePackage: [platform: ForgePlatform, version: ForgeArch];
  packageAfterCopy: [buildPath: string, electronVersion: string, platform: ForgePlatform, arch: ForgeArch];
  packageAfterPrune: [buildPath: string, electronVersion: string, platform: ForgePlatform, arch: ForgeArch];
  packageAfterExtract: [buildPath: string, electronVersion: string, platform: ForgePlatform, arch: ForgeArch];
  postPackage: [
    packageResult: {
      platform: ForgePlatform;
      arch: ForgeArch;
      outputPaths: string[];
      spinner?: OraImpl;
    }
  ];
  preMake: [];
}

export interface ForgeMutatingHookSignatures {
  postMake: [makeResults: ForgeMakeResult[]];
  resolveForgeConfig: [currentConfig: ForgeConfig];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readPackageJson: [packageJson: Record<string, any>];
}

export type ForgeHookName = keyof (ForgeSimpleHookSignatures & ForgeMutatingHookSignatures);
export type ForgeSimpleHookFn<Hook extends keyof ForgeSimpleHookSignatures> = (
  forgeConfig: ForgeConfig,
  ...args: ForgeSimpleHookSignatures[Hook]
) => Promise<void>;
export type ForgeMutatingHookFn<Hook extends keyof ForgeMutatingHookSignatures> = (
  forgeConfig: ForgeConfig,
  ...args: ForgeMutatingHookSignatures[Hook]
) => Promise<ForgeMutatingHookSignatures[Hook][0] | undefined>;
export type ForgeHookFn<Hook extends ForgeHookName> = Hook extends keyof ForgeSimpleHookSignatures
  ? ForgeSimpleHookFn<Hook>
  : Hook extends keyof ForgeMutatingHookSignatures
  ? ForgeMutatingHookFn<Hook>
  : never;
export type ForgeHookMap = {
  [S in ForgeHookName]?: ForgeHookFn<S>;
};

export interface IForgePluginInterface {
  triggerHook<Hook extends keyof ForgeSimpleHookSignatures>(hookName: Hook, hookArgs: ForgeSimpleHookSignatures[Hook]): Promise<void>;
  triggerMutatingHook<Hook extends keyof ForgeMutatingHookSignatures>(
    hookName: Hook,
    item: ForgeMutatingHookSignatures[Hook][0]
  ): Promise<ForgeMutatingHookSignatures[Hook][0]>;
  overrideStartLogic(opts: StartOptions): Promise<StartResult>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type ForgeRebuildOptions = Omit<RebuildOptions, 'buildPath' | 'electronVersion' | 'arch'>;
export type ForgePackagerOptions = Omit<ElectronPackagerOptions, 'dir' | 'arch' | 'platform' | 'out' | 'electronVersion'>;
export interface ForgeConfig {
  /**
   * A string to uniquely identify artifacts of this build, will be appended
   * to the out dir to generate a nested directory.  E.g. out/current-timestamp
   *
   * If a function is provided, it must synchronously return the buildIdentifier
   */
  buildIdentifier?: string | (() => string);
  hooks?: ForgeHookMap;
  /**
   * @internal
   */
  pluginInterface: IForgePluginInterface;
  /**
   * An array of Forge plugins or a tuple consisting of [pluginName, pluginOptions]
   */
  plugins: ForgeConfigPlugin[];
  rebuildConfig: ForgeRebuildOptions;
  packagerConfig: ForgePackagerOptions;
  makers: ForgeConfigMaker[];
  publishers: ForgeConfigPublisher[];
}
export interface ForgeMakeResult {
  /**
   * An array of paths to artifacts generated for this make run
   */
  artifacts: string[];
  /**
   * The state of the package.json file when the make happened
   */
  packageJSON: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  /**
   * The platform this make run was for
   */
  platform: ForgePlatform;
  /**
   * The arch this make run was for
   */
  arch: ForgeArch;
}

export interface IForgeResolvablePlugin {
  name: string;
  config?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface IForgePlugin {
  /** @internal */
  __isElectronForgePlugin: boolean;
  name: string;

  init(dir: string, forgeConfig: ForgeConfig): void;
  getHooks?(): ForgeHookMap;
  startLogic?(opts: StartOptions): Promise<StartResult>;
}

export interface IForgeResolvableMaker {
  enabled: boolean;
  name: string;
  platforms: ForgePlatform[] | null;
  config: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface IForgeMaker {
  /** @internal */
  __isElectronForgeMaker: boolean;
  readonly platforms?: ForgePlatform[];
}

export interface IForgeResolvablePublisher {
  name: string;
  platforms?: ForgePlatform[] | null;
  config?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface IForgePublisher {
  /** @internal */
  __isElectronForgePublisher: boolean;
  readonly platforms?: ForgePlatform[];
}

export interface StartOptions {
  /**
   * The path to the electron forge project to run
   */
  dir?: string;
  /**
   * The path (relative to dir) to the electron app to run relative to the project directory
   */
  appPath?: string;
  /**
   * Whether to use sensible defaults or prompt the user visually
   */
  interactive?: boolean;
  /**
   * Enables advanced internal Electron debug calls
   */
  enableLogging?: boolean;
  /**
   * Arguments to pass through to the launched Electron application
   */
  args?: (string | number)[];
  /**
   * Runs the Electron process as if it were node, disables all Electron API's
   */
  runAsNode?: boolean;
  /**
   * Enables the node inspector, you can connect to this from chrome://inspect
   */
  inspect?: boolean;
  /**
   * Enables the node inspector, you can connect to this from chrome://inspect
   * Pauses the execution on first JavaScript line until debugger connects.
   */
  inspectBrk?: boolean;
}

export type StartResult = ElectronProcess | string | string[] | false;

export interface InitTemplateOptions {
  copyCIFiles?: boolean;
}

export interface ForgeTemplate {
  requiredForgeVersion?: string;
  dependencies?: string[];
  devDependencies?: string[];
  initializeTemplate?: (dir: string, options: InitTemplateOptions) => Promise<void>;
}

export type PackagePerson =
  | undefined
  | string
  | {
      name: string;
      email?: string;
      url?: string;
    };
