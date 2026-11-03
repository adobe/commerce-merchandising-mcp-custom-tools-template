/*
Copyright 2026 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0.
You may obtain a copy at https://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software is distributed
on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
See the License for the specific language governing permissions and limitations.
*/

module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true
  },
  parserOptions: {
    ecmaVersion: 'latest'
  },
  extends: ['eslint:recommended'],
  rules: {
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error'
  },
  overrides: [
    {
      files: ['test/**/*.js', 'e2e/**/*.js', '**/*.test.js'],
      plugins: ['jest'],
      env: { jest: true },
      extends: ['plugin:jest/recommended']
    }
  ]
}
