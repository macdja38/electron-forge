import { asyncOra } from '@electron-forge/async-ora';
import PluginBase from '@electron-forge/plugin-base';
import { ElectronProcess, ForgeArch, ResolvedForgeConfig, ForgeHookFn, ForgePlatform } from '@electron-forge/shared-types';
import Logger, { Tab } from '@electron-forge/web-multi-logger';

import chalk from 'chalk';
import debug from 'debug';
import fs from 'fs-extra';
import http from 'http';
import { merge } from 'webpack-merge';
import path from 'path';
import { utils } from '@electron-forge/core';
import webpack, { Configuration, Watching } from 'webpack';
import WebpackDevServer from 'webpack-dev-server';

import { WebpackPluginConfig } from './Config';
import ElectronForgeLoggingPlugin from './util/ElectronForgeLogging';
import once from './util/once';
import WebpackConfigGenerator from './WebpackConfig';
import { isLocalWindow, isPreloadOnly } from './util/rendererTypeUtils';

const d = debug('electron-forge:plugin:webpack');
const DEFAULT_PORT = 3000;
const DEFAULT_LOGGER_PORT = 9000;

type WebpackToJsonOptions = Parameters<webpack.Stats['toJson']>[0];
type WebpackWatchHandler = Parameters<webpack.Compiler['watch']>[1];

export default class WebpackPlugin extends PluginBase<WebpackPluginConfig> {
  name = 'webpack';

  private isProd = false;

  // The root of the Electron app
  private projectDir!: string;

  // Where the Webpack output is generated. Usually `$projectDir/.webpack`
  private baseDir!: string;

  private _configGenerator!: WebpackConfigGenerator;

  private watchers: Watching[] = [];

  private servers: http.Server[] = [];

  private loggers: Logger[] = [];

  private port = DEFAULT_PORT;

  private loggerPort = DEFAULT_LOGGER_PORT;

  constructor(c: WebpackPluginConfig) {
    super(c);

    if (c.port) {
      if (this.isValidPort(c.port)) {
        this.port = c.port;
      }
    }
    if (c.loggerPort) {
      if (this.isValidPort(c.loggerPort)) {
        this.loggerPort = c.loggerPort;
      }
    }

    this.startLogic = this.startLogic.bind(this);
    this.getHook = this.getHook.bind(this);
  }

  private isValidPort = (port: number) => {
    if (port < 1024) {
      throw new Error(`Cannot specify port (${port}) below 1024, as they are privileged`);
    } else if (port > 65535) {
      throw new Error(`Port specified (${port}) is not a valid TCP port.`);
    } else {
      return true;
    }
  };

  exitHandler = (options: { cleanup?: boolean; exit?: boolean }, err?: Error): void => {
    d('handling process exit with:', options);
    if (options.cleanup) {
      for (const watcher of this.watchers) {
        d('cleaning webpack watcher');
        watcher.close(() => {
          /* Do nothing when the watcher closes */
        });
      }
      this.watchers = [];
      for (const server of this.servers) {
        d('cleaning http server');
        server.close();
      }
      this.servers = [];
      for (const logger of this.loggers) {
        d('stopping logger');
        logger.stop();
      }
      this.loggers = [];
    }
    if (err) console.error(err.stack);
    // Why: This is literally what the option says to do.
    // eslint-disable-next-line no-process-exit
    if (options.exit) process.exit();
  };

  async writeJSONStats(type: string, stats: webpack.Stats | undefined, statsOptions: WebpackToJsonOptions, suffix: string): Promise<void> {
    if (!stats) return;
    d(`Writing JSON stats for ${type} config`);
    const jsonStats = stats.toJson(statsOptions);
    const jsonStatsFilename = path.resolve(this.baseDir, type, `stats-${suffix}.json`);
    await fs.writeJson(jsonStatsFilename, jsonStats, { spaces: 2 });
  }

  private runWebpack = async (options: Configuration[], isRenderer = false): Promise<webpack.MultiStats | undefined> =>
    new Promise((resolve, reject) => {
      webpack(options).run(async (err, stats) => {
        if (isRenderer && this.config.renderer.jsonStats) {
          for (const [index, entryStats] of (stats?.stats ?? []).entries()) {
            const name = this.config.renderer.entryPoints[index].name;
            await this.writeJSONStats('renderer', entryStats, options[index].stats as WebpackToJsonOptions, name);
          }
        }
        if (err) {
          return reject(err);
        }
        return resolve(stats);
      });
    });

  init = (dir: string): void => {
    this.setDirectories(dir);

    d('hooking process events');
    process.on('exit', (_code) => this.exitHandler({ cleanup: true }));
    process.on('SIGINT' as NodeJS.Signals, (_signal) => this.exitHandler({ exit: true }));
  };

  setDirectories = (dir: string): void => {
    this.projectDir = dir;
    this.baseDir = path.resolve(dir, '.webpack');
  };

  get configGenerator(): WebpackConfigGenerator {
    if (!this._configGenerator) {
      this._configGenerator = new WebpackConfigGenerator(this.config, this.projectDir, this.isProd, this.port);
    }

    return this._configGenerator;
  }

  private loggedOutputUrl = false;

  getHook(name: string): ForgeHookFn | null {
    switch (name) {
      case 'prePackage':
        this.isProd = true;
        return async (config: ResolvedForgeConfig, platform: ForgePlatform, arch: ForgeArch) => {
          await fs.remove(this.baseDir);
          await utils.rebuildHook(
            this.projectDir,
            await utils.getElectronVersion(this.projectDir, await fs.readJson(path.join(this.projectDir, 'package.json'))),
            platform,
            arch,
            config.rebuildConfig
          );
          await this.compileMain();
          await this.compileRenderers();
        };
      case 'postStart':
        return async (_config: ResolvedForgeConfig, child: ElectronProcess) => {
          if (!this.loggedOutputUrl) {
            console.info(`\n\nWebpack Output Available: ${chalk.cyan(`http://localhost:${this.loggerPort}`)}\n`);
            this.loggedOutputUrl = true;
          }
          d('hooking electron process exit');
          child.on('exit', () => {
            if (child.restarted) return;
            this.exitHandler({ cleanup: true, exit: true });
          });
        };
      case 'resolveForgeConfig':
        return this.resolveForgeConfig;
      case 'packageAfterCopy':
        return this.packageAfterCopy;
      default:
        return null;
    }
  }

  resolveForgeConfig = async (forgeConfig: ResolvedForgeConfig): Promise<ResolvedForgeConfig> => {
    if (!forgeConfig.packagerConfig) {
      forgeConfig.packagerConfig = {};
    }
    if (forgeConfig.packagerConfig.ignore) {
      if (typeof forgeConfig.packagerConfig.ignore !== 'function') {
        console.error(
          chalk.red(`You have set packagerConfig.ignore, the Electron Forge webpack plugin normally sets this automatically.

Your packaged app may be larger than expected if you dont ignore everything other than the '.webpack' folder`)
        );
      }
      return forgeConfig;
    }
    forgeConfig.packagerConfig.ignore = (file: string) => {
      if (!file) return false;

      if (this.config.jsonStats && file.endsWith(path.join('.webpack', 'main', 'stats.json'))) {
        return true;
      }

      if (this.config.renderer.jsonStats && file.endsWith(path.join('.webpack', 'renderer', 'stats.json'))) {
        return true;
      }

      if (!this.config.packageSourceMaps && /[^/\\]+\.js\.map$/.test(file)) {
        return true;
      }

      return !/^[/\\]\.webpack($|[/\\]).*$/.test(file);
    };
    return forgeConfig;
  };

  packageAfterCopy = async (_forgeConfig: ResolvedForgeConfig, buildPath: string): Promise<void> => {
    const pj = await fs.readJson(path.resolve(this.projectDir, 'package.json'));

    if (!pj.main?.endsWith('.webpack/main')) {
      throw new Error(`Electron Forge is configured to use the Webpack plugin. The plugin expects the
"main" entry point in "package.json" to be ".webpack/main" (where the plugin outputs
the generated files). Instead, it is ${JSON.stringify(pj.main)}`);
    }

    if (pj.config) {
      delete pj.config.forge;
    }
    pj.devDependencies = {};
    pj.dependencies = {};
    pj.optionalDependencies = {};
    pj.peerDependencies = {};

    await fs.writeJson(path.resolve(buildPath, 'package.json'), pj, {
      spaces: 2,
    });

    await fs.mkdirp(path.resolve(buildPath, 'node_modules'));
  };

  compileMain = async (watch = false, logger?: Logger): Promise<void> => {
    let tab: Tab;
    if (logger) {
      tab = logger.createTab('Main Process');
    }
    await asyncOra('Compiling Main Process Code', async () => {
      const mainConfig = await this.configGenerator.getMainConfig();
      await new Promise((resolve, reject) => {
        const compiler = webpack(mainConfig);
        const [onceResolve, onceReject] = once(resolve, reject);
        const cb: WebpackWatchHandler = async (err, stats) => {
          if (tab && stats) {
            tab.log(
              stats.toString({
                colors: true,
              })
            );
          }
          if (this.config.jsonStats) {
            await this.writeJSONStats('main', stats, mainConfig.stats as WebpackToJsonOptions, 'main');
          }

          if (err) return onceReject(err);
          if (!watch && stats?.hasErrors()) {
            return onceReject(new Error(`Compilation errors in the main process: ${stats.toString()}`));
          }

          return onceResolve(undefined);
        };
        if (watch) {
          this.watchers.push(compiler.watch({}, cb));
        } else {
          compiler.run(cb);
        }
      });
    });
  };

  compileRenderers = async (watch = false): Promise<void> => {
    await asyncOra('Compiling Renderer Template', async () => {
      const stats = await this.runWebpack(await this.configGenerator.getRendererConfig(this.config.renderer.entryPoints), true);
      if (!watch && stats?.hasErrors()) {
        throw new Error(`Compilation errors in the renderer: ${stats.toString()}`);
      }
    });

    for (const entryPoint of this.config.renderer.entryPoints) {
      if ((isLocalWindow(entryPoint) && !!entryPoint.preload) || isPreloadOnly(entryPoint)) {
        await asyncOra(`Compiling Renderer Preload: ${chalk.cyan(entryPoint.name)}`, async () => {
          const stats = await this.runWebpack(
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            [await this.configGenerator.getPreloadConfigForEntryPoint(entryPoint)]
          );

          if (stats?.hasErrors()) {
            throw new Error(`Compilation errors in the preload (${entryPoint.name}): ${stats.toString()}`);
          }
        });
      }
    }
  };

  launchRendererDevServers = async (logger: Logger): Promise<void> => {
    await asyncOra('Launching Dev Servers for Renderer Process Code', async () => {
      const tab = logger.createTab('Renderers');
      const pluginLogs = new ElectronForgeLoggingPlugin(tab);

      const config = await this.configGenerator.getRendererConfig(this.config.renderer.entryPoints);

      if (config.length === 0) {
        return;
      }

      for (const entryConfig of config) {
        if (!entryConfig.plugins) entryConfig.plugins = [];
        entryConfig.plugins.push(pluginLogs);
      }

      const compiler = webpack(config);
      const webpackDevServer = new WebpackDevServer(this.devServerOptions(), compiler);
      await webpackDevServer.start();
      this.servers.push(webpackDevServer.server!);
    });

    await asyncOra('Compiling Preload Scripts', async () => {
      for (const entryPoint of this.config.renderer.entryPoints) {
        if ((isLocalWindow(entryPoint) && !!entryPoint.preload) || isPreloadOnly(entryPoint)) {
          const config = await this.configGenerator.getPreloadConfigForEntryPoint(entryPoint);
          await new Promise((resolve, reject) => {
            const tab = logger.createTab(`${entryPoint.name} - Preload`);
            const [onceResolve, onceReject] = once(resolve, reject);

            this.watchers.push(
              webpack(config).watch({}, (err, stats) => {
                if (stats) {
                  tab.log(
                    stats.toString({
                      colors: true,
                    })
                  );
                }

                if (err) return onceReject(err);
                return onceResolve(undefined);
              })
            );
          });
        }
      }
    });
  };

  devServerOptions(): Record<string, unknown> {
    const cspDirectives =
      this.config.devContentSecurityPolicy ?? "default-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-eval' 'unsafe-inline' data:";

    const defaults: Partial<WebpackDevServer.Configuration> = {
      hot: true,
      devMiddleware: {
        writeToDisk: true,
      },
      historyApiFallback: true,
    };
    const overrides: Partial<WebpackDevServer.Configuration> = {
      port: this.port,
      setupExitSignals: true,
      static: path.resolve(this.baseDir, 'renderer'),
      headers: {
        'Content-Security-Policy': cspDirectives,
      },
    };

    return merge(defaults, this.config.devServer ?? {}, overrides);
  }

  private alreadyStarted = false;

  async startLogic(): Promise<false> {
    if (this.alreadyStarted) return false;
    this.alreadyStarted = true;

    await fs.remove(this.baseDir);

    const logger = new Logger(this.loggerPort);
    this.loggers.push(logger);
    await this.compileMain(true, logger);
    await this.launchRendererDevServers(logger);
    await logger.start();
    return false;
  }
}

export { WebpackPluginConfig };
