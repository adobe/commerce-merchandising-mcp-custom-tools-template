/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

const path = require('path')
const { ActionGenerator, utils } = require('@adobe/generator-app-common-lib')

const validProjectName = value => /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
const ESLINT_CONFIGS = ['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml', '.eslintrc.json', '.eslintrc', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs']

class CommerceMcpGenerator extends ActionGenerator {
  constructor (args, opts) {
    super(args, {
      'action-folder': 'actions',
      'config-path': 'app.config.yaml',
      'full-key-to-manifest': 'application.runtimeManifest',
      ...opts
    })
    this.option('skip-prompt', { type: Boolean, default: false })
    this.option('project-name', { type: String, default: 'commerce-merchandising-mcp' })
    this.option('examples', { type: Boolean, default: true })
    this.sourceRoot(path.join(__dirname, 'templates'))
  }

  async prompting () {
    this.props = {
      projectName: this.options['project-name'],
      examples: this.options.examples
    }
    if (!this.options['skip-prompt']) {
      const answers = await this.prompt([
        {
          type: 'input',
          name: 'projectName',
          message: 'MCP project name:',
          default: this.props.projectName,
          validate: value => validProjectName(value) || 'Use 1-64 lowercase letters, digits or hyphens, starting with a letter or digit.'
        },
        {
          type: 'confirm',
          name: 'examples',
          message: 'Include the whoAmI example tool?',
          default: this.props.examples
        }
      ])
      this.props = { ...this.props, ...answers }
    }
  }

  configuring () {
    if (!validProjectName(this.props.projectName)) {
      throw new Error('Invalid project name: use 1-64 lowercase letters, digits or hyphens, starting with a letter or digit.')
    }
  }

  writing () {
    const { runtimeManifest, runtimePackageName } = this.loadRuntimeManifest(
      this.configPath, this.fullKeyToManifest, this.props.projectName
    )
    if (runtimeManifest.packages[runtimePackageName].actions?.['mcp-tool']) {
      throw new Error('An mcp-tool action already exists in this runtime package.')
    }
    const appRoot = path.dirname(this.configPath)
    const actionRoot = this.destinationPath(this.actionFolder)
    runtimeManifest.packages[runtimePackageName].actions ||= {}
    const context = {
      ...this.props,
      runtimePackageName,
      actionsRelPath: path.relative(path.join(appRoot, 'test'), actionRoot).split(path.sep).join('/')
    }
    const copy = (source, target) => this.fs.copyTpl(this.templatePath(source), target, context)

    for (const file of ['index.js', 'server.js', 'tools.js']) {
      copy(`actions/mcp-tool/${file}`, path.join(actionRoot, 'mcp-tool', file))
    }
    copy('actions/middleware', path.join(actionRoot, 'middleware'))
    copy('actions/utils.js', path.join(actionRoot, 'utils.js'))
    copy('test', path.join(appRoot, 'test'))
    copy('e2e', path.join(appRoot, 'e2e'))
    for (const file of ['README.md', '.env.example']) {
      copy(file, path.join(appRoot, file))
    }
    // keep an existing ESLint setup in the app or any parent folder up to the project root;
    // the template config is `root: true` and would stop it from applying
    const hasEslintConfig = dir => ESLINT_CONFIGS.some(file => this.fs.exists(path.join(dir, file))) ||
      Boolean(this.fs.readJSON(path.join(dir, 'package.json'), {}).eslintConfig)
    const projectRoot = this.destinationRoot()
    const lintDirs = [appRoot]
    while (lintDirs[lintDirs.length - 1] !== projectRoot && lintDirs[lintDirs.length - 1].startsWith(projectRoot + path.sep)) {
      lintDirs.push(path.dirname(lintDirs[lintDirs.length - 1]))
    }
    if (!lintDirs.some(hasEslintConfig)) {
      for (const file of ['.eslintrc.js', '.eslintignore']) {
        copy(file, path.join(appRoot, file))
      }
    }
    this.fs.copy(path.join(__dirname, '../LICENSE'), path.join(appRoot, 'LICENSE'))
    if (!this.fs.exists(this.destinationPath('.gitignore'))) {
      copy('_dot.gitignore', this.destinationPath('.gitignore'))
    }

    this.setRuntimeManifestAction('mcp-tool', path.relative(appRoot, path.join(actionRoot, 'mcp-tool/index.js')),
      runtimeManifest, runtimePackageName, {
        runtime: 'nodejs:22',
        inputs: {
          LOG_LEVEL: 'info'
        },
        annotations: {
          'require-adobe-auth': false,
          final: true,
          'raw-http': true
        }
      })
    this.writeRuntimeManifest(this.configPath, this.fullKeyToManifest, runtimeManifest)
    const actionsKey = [...this.fullKeyToManifest.split('.').slice(0, -1), 'actions'].join('.')
    const config = utils.readYAMLConfig(this, this.configPath)
    if (!actionsKey.split('.').reduce((value, key) => value?.[key], config)) {
      utils.writeKeyYAMLConfig(this, this.configPath, actionsKey, path.relative(appRoot, actionRoot).split(path.sep).join('/'))
    }

    const defaults = this.fs.readJSON(this.templatePath('package.json'))
    const testRoot = path.relative(this.destinationRoot(), path.join(appRoot, 'test')).split(path.sep).join('/')
    const actionsRoot = path.relative(this.destinationRoot(), actionRoot).split(path.sep).join('/')
    defaults.jest.testMatch = [`<rootDir>/${testRoot}/**/*.test.js`]
    defaults.jest.collectCoverageFrom = [`${actionsRoot}/**/*.js`]
    const existing = this.fs.readJSON(this.destinationPath('package.json'), {})
    this.fs.writeJSON(this.destinationPath('package.json'), {
      ...defaults,
      name: this.props.projectName,
      ...existing,
      scripts: { ...defaults.scripts, ...existing.scripts },
      dependencies: { ...existing.dependencies, ...defaults.dependencies },
      devDependencies: { ...existing.devDependencies, ...defaults.devDependencies }
    })
  }
}

module.exports = CommerceMcpGenerator
