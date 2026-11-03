#!/usr/bin/env node
/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

/**
 * Production dependency audit gate.
 *
 * Runs `npm audit --omit=dev` and fails on every advisory unless it is listed in
 * audit-allowlist.json AND every production dependency path to the vulnerable package goes
 * through one of the dependency chains (`via`) accepted for it. New advisories, or known ones
 * that become reachable through a new dependency path, fail the gate.
 *
 * Usage: node scripts/audit-gate.js
 */

const path = require('path')
const { execFileSync } = require('child_process')

/**
 * Collects every dependency path (e.g. "a>b>c") to each package in an `npm ls --all --json` tree.
 * Deduplicated nodes (printed without children) are expanded from another occurrence of the same
 * name@version so that no path is missed.
 *
 * @param {object} tree the `npm ls --all --json` output.
 *
 * @returns {Map<string, Set<string>>} package name -> dependency paths.
 */
function dependencyPaths (tree) {
  const children = new Map()
  const index = node => {
    for (const [name, child] of Object.entries(node.dependencies || {})) {
      if (Object.keys(child.dependencies || {}).length > 0) {
        children.set(`${name}@${child.version}`, child.dependencies)
      }
      index(child)
    }
  }
  index(tree)

  const paths = new Map()
  const walk = (dependencies, trail) => {
    for (const [name, child] of Object.entries(dependencies || {})) {
      if (trail.includes(name)) {
        continue
      }
      const current = [...trail, name]
      if (!paths.has(name)) {
        paths.set(name, new Set())
      }
      paths.get(name).add(current.join('>'))
      walk(child.dependencies || children.get(`${name}@${child.version}`), current)
    }
  }
  walk(tree.dependencies, [])
  return paths
}

/**
 * Evaluates `npm audit --json` results against the allowlist.
 *
 * @param {object} audit the `npm audit --json` output.
 * @param {object} tree the `npm ls --all --json` output.
 * @param {Array<{via: string[], advisories: string[]}>} allowlist accepted advisories and the
 *   dependency chains (e.g. "yeoman-generator>pacote") they may be reached through.
 *
 * @returns {{ accepted: Array<object>, rejected: Array<object> }} advisories by outcome.
 */
function evaluate (audit, tree, allowlist) {
  const paths = dependencyPaths(tree)
  const advisories = new Map()
  for (const vulnerability of Object.values(audit.vulnerabilities || {})) {
    for (const via of vulnerability.via) {
      if (typeof via === 'object') {
        const id = String(via.url).split('/').pop()
        advisories.set(`${id}|${via.name}`, { id, name: via.name, severity: via.severity, title: via.title })
      }
    }
  }

  const accepted = []
  const rejected = []
  for (const advisory of advisories.values()) {
    const advisoryPaths = [...(paths.get(advisory.name) || [])]
    const chains = allowlist
      .filter(entry => entry.advisories.includes(advisory.id))
      .flatMap(entry => entry.via)
    const unexpected = advisoryPaths.filter(p => !chains.some(chain => `>${p}>`.includes(`>${chain}>`)))
    // fail safe: an advisory without a resolvable production path is never accepted
    if (advisoryPaths.length > 0 && unexpected.length === 0) {
      accepted.push(advisory)
    } else {
      rejected.push({ ...advisory, paths: unexpected.length > 0 ? unexpected : ['<no production path found>'] })
    }
  }
  return { accepted, rejected }
}

/* istanbul ignore next */
function npmJson (args) {
  let output
  try {
    output = execFileSync('npm', args, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (error) {
    // npm audit / npm ls exit non-zero when they find problems but still print JSON
    if (!error.stdout) {
      throw error
    }
    output = error.stdout
  }
  const json = JSON.parse(output)
  if (json.error && !json.vulnerabilities && !json.dependencies) {
    throw new Error(`npm ${args[0]} failed: ${json.error.summary || JSON.stringify(json.error)}`)
  }
  return json
}

/* istanbul ignore next */
function main () {
  const { allowlist } = require(path.join(__dirname, '..', 'audit-allowlist.json'))
  const audit = npmJson(['audit', '--omit=dev', '--json'])
  const tree = npmJson(['ls', '--all', '--omit=dev', '--json'])
  const { accepted, rejected } = evaluate(audit, tree, allowlist)

  console.log(`audit gate: ${accepted.length} allowlisted advisories, ${rejected.length} rejected`)
  for (const advisory of rejected) {
    console.error(`  ${advisory.severity} ${advisory.id} ${advisory.name}: ${advisory.title}`)
    advisory.paths.forEach(p => console.error(`    via ${p}`))
  }
  if (rejected.length > 0) {
    console.error('Fix the dependency or, if it cannot be fixed and is not reachable at runtime, document it in audit-allowlist.json and SECURITY.md.')
    process.exitCode = 1
  }
}

/* istanbul ignore next */
if (require.main === module) {
  main()
}

module.exports = { dependencyPaths, evaluate }
