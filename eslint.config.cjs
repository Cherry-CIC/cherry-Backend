const parser = require('@typescript-eslint/parser');
module.exports = [{
  files: ['src/**/*.{ts,js}'],
  languageOptions: { parser, ecmaVersion: 2020, sourceType: 'module' },
  rules: {
    'no-debugger': 'error', 'no-dupe-args': 'error', 'no-dupe-else-if': 'error',
    'no-unreachable': 'error', 'no-unsafe-finally': 'error', 'constructor-super': 'error',
  },
}];
