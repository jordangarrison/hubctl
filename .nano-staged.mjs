// Staged-file tasks for the pre-commit hook (see simple-git-hooks in package.json).
// nano-staged re-stages files a task modifies, so format/lint autofixes land in
// the commit. Full validate (incl. tests) runs on pre-push.
export default {
  '*.{ts,mjs,js}': ({ filenames }) => {
    const list = filenames.map((file) => `'${file}'`).join(' ')
    return [
      `oxfmt --config oxfmt.config.mjs ${list}`,
      `oxlint --config oxlint.config.mjs --report-unused-disable-directives-severity=error --fix ${list}`,
    ]
  },
}
