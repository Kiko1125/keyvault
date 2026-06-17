module.exports = {
  bumpFiles: [
    {
      filename: 'package.json',
      type: 'json'
    },
    {
      filename: 'src-tauri/tauri.conf.json',
      type: 'json'
    }
  ],
  commit: true,
  tag: true,
  push: false,
  preset: 'conventionalcommits',
  types: [
    { type: 'feat', section: 'Features' },
    { type: 'fix', section: 'Bug Fixes' },
    { type: 'docs', section: 'Documentation' },
    { type: 'style', section: 'Styles' },
    { type: 'refactor', section: 'Code Refactoring' },
    { type: 'perf', section: 'Performance' },
    { type: 'test', section: 'Tests' },
    { type: 'build', section: 'Builds' },
    { type: 'ci', section: 'Continuous Integrations' },
    { type: 'chore', section: 'Chores' },
    { type: 'revert', section: 'Reverts' }
  ]
}