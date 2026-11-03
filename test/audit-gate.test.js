/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

const { dependencyPaths, evaluate } = require('../scripts/audit-gate')

const advisory = (name, id, severity = 'high') => ({
  name,
  via: [{ name, severity, title: `${name} issue`, url: `https://github.com/advisories/${id}` }]
})

// gen>pacote>tar is printed in full; the second tar under other>pacote is deduplicated (no children)
const tree = {
  dependencies: {
    gen: {
      version: '5.0.0',
      dependencies: {
        pacote: { version: '1.0.0', dependencies: { tar: { version: '6.0.0' } } }
      }
    },
    other: {
      version: '1.0.0',
      dependencies: { pacote: { version: '1.0.0' }, cycle: { version: '1.0.0', dependencies: { other: { version: '1.0.0' } } } }
    }
  }
}

describe('audit gate', () => {
  test('dependencyPaths expands deduplicated nodes and ignores cycles', () => {
    const paths = dependencyPaths(tree)
    expect([...paths.get('tar')]).toEqual(['gen>pacote>tar', 'other>pacote>tar'])
    expect([...paths.get('other')]).toEqual(['other'])
    expect(dependencyPaths({}).size).toBe(0)
  })

  test('accepts allowlisted advisories reached only through allowlisted chains', () => {
    const audit = { vulnerabilities: { tar: advisory('tar', 'GHSA-1'), pacote: { via: ['tar'] } } }
    const allowlist = [{ via: ['gen>pacote', 'other>pacote'], advisories: ['GHSA-1'] }]
    const result = evaluate(audit, tree, allowlist)
    expect(result.accepted).toEqual([{ id: 'GHSA-1', name: 'tar', severity: 'high', title: 'tar issue' }])
    expect(result.rejected).toEqual([])
  })

  test('rejects advisories that are reachable through a new path', () => {
    const audit = { vulnerabilities: { tar: advisory('tar', 'GHSA-1') } }
    const allowlist = [{ via: ['gen>pacote'], advisories: ['GHSA-1'] }]
    const { accepted, rejected } = evaluate(audit, tree, allowlist)
    expect(accepted).toEqual([])
    expect(rejected).toEqual([expect.objectContaining({ id: 'GHSA-1', paths: ['other>pacote>tar'] })])
  })

  test('chains only match whole package names', () => {
    const audit = { vulnerabilities: { tar: advisory('tar', 'GHSA-1') } }
    const allowlist = [{ via: ['en>pacote', 'other>pacote'], advisories: ['GHSA-1'] }]
    expect(evaluate(audit, tree, allowlist).rejected[0].paths).toEqual(['gen>pacote>tar'])
  })

  test('rejects advisories that are not allowlisted', () => {
    const audit = { vulnerabilities: { tar: advisory('tar', 'GHSA-2') } }
    const allowlist = [{ via: ['gen', 'other'], advisories: ['GHSA-1'] }]
    expect(evaluate(audit, tree, allowlist).rejected).toHaveLength(1)
  })

  test('rejects advisories without a resolvable production path', () => {
    const audit = { vulnerabilities: { missing: advisory('missing', 'GHSA-3') } }
    const allowlist = [{ via: ['missing'], advisories: ['GHSA-3'] }]
    expect(evaluate(audit, tree, allowlist).rejected[0].paths).toEqual(['<no production path found>'])
  })

  test('passes a clean audit', () => {
    expect(evaluate({}, tree, [])).toEqual({ accepted: [], rejected: [] })
  })
})
