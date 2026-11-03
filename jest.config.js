/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.js'],
  testTimeout: 60000,
  collectCoverage: true,
  // template sources are EJS; their coverage is enforced on the generated app in test/index.test.js
  collectCoverageFrom: ['src/**/*.js', '!src/templates/**', 'scripts/**/*.js'],
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: { branches: 100, functions: 100, lines: 100, statements: 100 }
  }
}
