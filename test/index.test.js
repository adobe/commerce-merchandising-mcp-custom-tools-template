/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const helpers = require('yeoman-test')
const yaml = require('js-yaml')

const generator = path.join(__dirname, '../src')
const read = file => fs.readFileSync(file, 'utf8')
const config = (file = 'app.config.yaml') => yaml.load(read(file))
const defaultName = 'commerce-merchandising-mcp'
let runContext
const run = () => (runContext = helpers.run(generator))
// coverage the generated action code must keep (template sources are measured here, not in jest.config.js)
const GENERATED_COVERAGE_THRESHOLD = { global: { branches: 95, functions: 95, lines: 99, statements: 99 } }

afterEach(() => {
  runContext?.cleanup()
  runContext = undefined
})

function runGeneratedTests (directory) {
  const execute = args => {
    try {
      execFileSync(process.execPath, args, { cwd: directory, stdio: 'pipe' })
    } catch (error) {
      throw new Error(`${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`)
    }
  }
  execute([
    require.resolve('jest/bin/jest'),
    '--runInBand',
    '--coverageReporters', 'text-summary',
    '--coverageThreshold', JSON.stringify(GENERATED_COVERAGE_THRESHOLD),
    '--modulePaths', path.join(__dirname, '../node_modules')
  ])
  execute([
    path.join(path.dirname(require.resolve('eslint/package.json')), 'bin/eslint.js'),
    '--resolve-plugins-relative-to', path.join(__dirname, '..'),
    '.'
  ])
}

describe('Commerce MCP generator', () => {
  test('interactive defaults generate a complete app with working tests', async () => {
    const result = await run().withPrompts({
      projectName: defaultName, allowlist: '', examples: true
    })
    const app = config()
    const action = app.application.runtimeManifest.packages[defaultName].actions['mcp-tool']
    expect(app.application.actions).toBe('actions')
    expect(action).toMatchObject({
      function: 'actions/mcp-tool/index.js',
      runtime: 'nodejs:22',
      web: 'yes',
      annotations: { 'require-adobe-auth': false, 'raw-http': true }
    })
    for (const file of ['.env.example', '.gitignore', 'README.md', 'LICENSE']) {
      expect(fs.existsSync(file)).toBe(true)
    }
    for (const file of ['actions/mcp-tool/resources.js', 'actions/mcp-tool/prompts.js']) {
      expect(fs.existsSync(file)).toBe(false)
    }
    expect(read('actions/mcp-tool/server.js')).not.toMatch(/registerResources|registerPrompts/)
    expect(read('actions/mcp-tool/server.js')).toContain(`name: '${defaultName}'`)
    expect(read('.gitignore')).toContain('!.env.example')
    expect(fs.existsSync('.env')).toBe(false)
    expect(JSON.parse(read('package.json'))).toMatchObject({
      name: defaultName,
      private: true,
      dependencies: { '@adobe/aio-lib-core-logging': expect.any(String) }
    })
    expect(read('package.json')).not.toMatch(/aio-sdk|node-fetch/)
    runGeneratedTests(result.cwd)
  })

  test('skip-prompt uses defaults without asking questions', async () => {
    await run().withOptions({ 'skip-prompt': true })
    expect(config().application.runtimeManifest.packages).toHaveProperty(defaultName)
    expect(config().application.runtimeManifest.packages[defaultName].actions['mcp-tool'].inputs).not.toHaveProperty('IMS_ENV')
    expect(read('.env.example')).not.toContain('IMS_ENV')
    expect(read('.env.example')).toContain('IMS_CLIENT_ALLOWLIST=\n')
  })

  test('custom options apply even with prompts skipped and examples disabled', async () => {
    const result = await run().withOptions({
      'skip-prompt': true,
      'project-name': 'my-commerce-tools',
      allowlist: ' client-a, client-b,client-a,, ',
      examples: false
    })
    expect(config().application.runtimeManifest.packages).toHaveProperty('my-commerce-tools')
    expect(read('actions/mcp-tool/server.js')).toContain("name: 'my-commerce-tools'")
    expect(read('.env.example')).toContain('IMS_CLIENT_ALLOWLIST=client-a,client-b')
    expect(read('actions/mcp-tool/index.js')).toContain('imsAuth({ allowList: ["client-a","client-b"] })')
    expect(read('actions/mcp-tool/tools.js')).not.toContain('const whoAmI')
    runGeneratedTests(result.cwd)
  })

  test('interactive answers override defaults', async () => {
    await run().withPrompts({
      projectName: 'prompted-tools', allowlist: 'client-c', examples: false
    })
    expect(read('.env.example')).toContain('IMS_CLIENT_ALLOWLIST=client-c')
    expect(read('actions/mcp-tool/server.js')).toContain("name: 'prompted-tools'")
  })

  test('interactive prompts validate the project name and allowlist', async () => {
    const validations = {}
    const answers = { projectName: 'Bad Name', allowlist: 'client a', examples: true }
    await expect(run().withPrompts(answers, {
      callback (answer) {
        if (this.question.validate) {
          validations[this.question.name] = [this.question.validate(answer), this.question.validate(this.question.default)]
        }
        return answer
      }
    })).rejects.toThrow(/Invalid project name/)
    expect(validations).toEqual({
      projectName: [expect.stringMatching(/lowercase letters/), true],
      allowlist: [expect.stringMatching(/letters, digits, underscores and hyphens/), true]
    })
  })

  test('merges an existing App Builder app without removing unrelated configuration', async () => {
    await run()
      .withOptions({ 'skip-prompt': true })
      .inTmpDir(dir => {
        fs.writeFileSync(path.join(dir, 'app.config.yaml'), yaml.dump({
          application: {
            actions: 'actions',
            web: 'web-src',
            runtimeManifest: {
              packages: {
                existing: {
                  license: 'Apache-2.0',
                  actions: { hello: { function: 'actions/hello/index.js' } }
                }
              }
            }
          }
        }))
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
          name: 'existing-app',
          scripts: { build: 'aio app build' },
          dependencies: { lodash: '^4.17.21' }
        }))
        fs.writeFileSync(path.join(dir, '.gitignore'), '# existing ignore\n')
        fs.writeFileSync(path.join(dir, '.eslintrc.json'), '{ "root": true }\n')
      })
    const app = config()
    expect(app.application.web).toBe('web-src')
    expect(app.application.runtimeManifest.packages.existing.actions).toHaveProperty('hello')
    expect(app.application.runtimeManifest.packages.existing.actions).toHaveProperty('mcp-tool')
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.name).toBe('existing-app')
    expect(pkg.scripts.build).toBe('aio app build')
    expect(pkg.dependencies.lodash).toBe('^4.17.21')
    expect(read('.gitignore')).toBe('# existing ignore\n')
    expect(read('.eslintrc.json')).toBe('{ "root": true }\n')
    expect(fs.existsSync('.eslintrc.js')).toBe(false)
  })

  test('supports the action-folder and config-path options used by App Builder', async () => {
    const result = await run().withOptions({
      'skip-prompt': true,
      'action-folder': 'extensions/custom/actions',
      'config-path': 'extensions/custom/ext.config.yaml',
      'full-key-to-manifest': 'runtimeManifest'
    })
    const app = config('extensions/custom/ext.config.yaml')
    expect(app.actions).toBe('actions')
    expect(app.runtimeManifest.packages[defaultName].actions['mcp-tool'].function).toBe('actions/mcp-tool/index.js')
    expect(read('extensions/custom/test/tools.test.js')).toContain("require('../actions/mcp-tool/tools')")
    expect(fs.existsSync('extensions/custom/actions/mcp-tool/index.js')).toBe(true)
    expect(JSON.parse(read('package.json')).jest).toMatchObject({
      testMatch: ['<rootDir>/extensions/custom/test/**/*.test.js'],
      collectCoverageFrom: ['extensions/custom/actions/**/*.js']
    })
    runGeneratedTests(result.cwd)
  })

  test('keeps an ESLint config from a parent folder or package.json', async () => {
    await run()
      .withOptions({
        'skip-prompt': true,
        'action-folder': 'extensions/custom/actions',
        'config-path': 'extensions/custom/ext.config.yaml',
        'full-key-to-manifest': 'runtimeManifest'
      })
      .inTmpDir(dir => {
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'existing-app', eslintConfig: { root: true } }))
      })
    expect(JSON.parse(read('package.json')).eslintConfig).toEqual({ root: true })
    expect(fs.existsSync('extensions/custom/.eslintrc.js')).toBe(false)
    expect(fs.existsSync('extensions/custom/.eslintignore')).toBe(false)
  })

  test('the generator tests run against dependency versions the generated app allows', () => {
    // generated apps are tested with this repository's node_modules; keep them in the template's ranges
    const template = JSON.parse(read(path.join(generator, 'templates/package.json')))
    for (const [name, range] of Object.entries({ ...template.dependencies, ...template.devDependencies })) {
      const installed = JSON.parse(read(path.join(__dirname, '../node_modules', name, 'package.json'))).version
      const [major, minor, patch] = range.replace(/^\^/, '').split('.').map(Number)
      const [iMajor, iMinor, iPatch] = installed.split('.').map(Number)
      expect({ name, range, valid: /^\^\d+\.\d+\.\d+$/.test(range) }).toEqual({ name, range, valid: true })
      expect({ name, installed, sameMajor: iMajor === major && (major > 0 || iMinor === minor) })
        .toEqual({ name, installed, sameMajor: true })
      expect({ name, installed, atLeastRange: iMinor > minor || (iMinor === minor && iPatch >= patch) })
        .toEqual({ name, installed, atLeastRange: true })
    }
  })

  test('does not replace an existing mcp-tool action', async () => {
    await expect(run()
      .withOptions({ 'skip-prompt': true })
      .inTmpDir(dir => {
        fs.writeFileSync(path.join(dir, 'app.config.yaml'), yaml.dump({
          application: {
            runtimeManifest: {
              packages: { existing: { actions: { 'mcp-tool': { function: 'actions/existing.js' } } } }
            }
          }
        }))
      })).rejects.toThrow('An mcp-tool action already exists')
    expect(config().application.runtimeManifest.packages.existing.actions['mcp-tool'].function).toBe('actions/existing.js')
  })

  test.each([
    [{ 'project-name': '../bad' }, /Invalid project name/],
    [{ 'project-name': 'Bad Name' }, /Invalid project name/],
    [{ allowlist: 'client-a\nIMS_ENV=stage' }, /Invalid IMS allowlist/]
  ])('rejects invalid non-interactive options %j', async (options, error) => {
    await expect(run().withOptions({ 'skip-prompt': true, ...options })).rejects.toThrow(error)
  })
})
