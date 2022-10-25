import { asyncOra } from '@electron-forge/async-ora';
import { BaseTemplate } from '@electron-forge/template-base';
import fs from 'fs-extra';
import { InitTemplateOptions } from '@electron-forge/shared-types';
import path from 'path';

class TypeScriptWebpackTemplate extends BaseTemplate {
  public templateDir = path.resolve(__dirname, '..', 'tmpl');

  async initializeTemplate(directory: string, options: InitTemplateOptions) {
    await super.initializeTemplate(directory, options);
    await asyncOra('Setting up Forge configuration', async () => {
      const forgeConfigPath = path.resolve(directory, 'forge.config.js');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const forgeConfig = require(forgeConfigPath);
      forgeConfig.plugins = forgeConfig.plugins || [];
      forgeConfig.plugins.push({
        name: '@electron-forge/plugin-webpack',
        config: {
          mainConfig: './webpack.main.config.js',
          renderer: {
            config: './webpack.renderer.config.js',
            entryPoints: [
              {
                html: './src/index.html',
                js: './src/renderer.ts',
                name: 'main_window',
                preload: {
                  js: './src/preload.ts',
                },
              },
            ],
          },
        },
      });
      await fs.writeFile(forgeConfigPath, `module.exports = ${JSON.stringify(forgeConfig, null, 2)}`);
    });
    await asyncOra('Setting up TypeScript configuration', async () => {
      const filePath = (fileName: string) => path.join(directory, 'src', fileName);

      // Copy Webpack files
      await this.copyTemplateFile(directory, 'webpack.main.config.js');
      await this.copyTemplateFile(directory, 'webpack.renderer.config.js');
      await this.copyTemplateFile(directory, 'webpack.rules.js');
      await this.copyTemplateFile(directory, 'webpack.plugins.js');

      await this.updateFileByLine(path.resolve(directory, 'src', 'index.html'), (line) => {
        if (line.includes('link rel="stylesheet"')) return '';
        return line;
      });

      // Copy tsconfig with a small set of presets
      await this.copyTemplateFile(directory, 'tsconfig.json');

      // Copy eslint config with recommended settings
      await this.copyTemplateFile(directory, '.eslintrc.json');

      // Remove index.js and replace with index.ts
      await fs.remove(filePath('index.js'));
      await this.copyTemplateFile(path.join(directory, 'src'), 'index.ts');

      await this.copyTemplateFile(path.join(directory, 'src'), 'renderer.ts');

      // Remove preload.js and replace with preload.ts
      await fs.remove(filePath('preload.js'));
      await this.copyTemplateFile(path.join(directory, 'src'), 'preload.ts');

      // update package.json
      const packageJSONPath = path.resolve(directory, 'package.json');
      const packageJSON = await fs.readJson(packageJSONPath);
      packageJSON.main = '.webpack/main';
      // Configure scripts for TS template
      packageJSON.scripts.lint = 'eslint --ext .ts,.tsx .';
      await fs.writeJson(packageJSONPath, packageJSON, {
        spaces: 2,
      });

      await fs.writeJson(packageJSONPath, packageJSON, { spaces: 2 });
    });
  }
}

export default new TypeScriptWebpackTemplate();
