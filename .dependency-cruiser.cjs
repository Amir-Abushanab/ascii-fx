/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules impossible to reason about or extract.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      comment:
        'Imports must resolve (Vite virtual modules excepted — they exist only inside the bundler).',
      from: {},
      to: { couldNotResolve: true, dependencyTypesNot: ['npm-unknown'], pathNot: ['^virtual:'] },
    },
    {
      name: 'no-undeclared-dependencies',
      severity: 'error',
      comment:
        "Every runtime import must be declared in its own package.json. pnpm's flat-ish store and the workspace root can make an undeclared import resolve here and fail for everyone who installs the published tarball.",
      from: { path: '^packages/' },
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'Modules nothing imports are dead weight (ambient .d.ts and entry points excepted).',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)src/index\\.tsx?$',
          '(^|/)src/cli\\.ts$',
          '(^|/)src/canvas2d\\.ts$',
          '(^|/)src/main\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'core-stays-pure',
      severity: 'error',
      comment: 'Spec §1: @ascii-fx/core must not depend on other workspace packages.',
      from: { path: '^packages/core/src' },
      to: { path: '^packages/(compiler|gpu|three|react|react-three|vite)/' },
    },
    {
      name: 'no-compiler-in-browser-packages',
      severity: 'error',
      comment:
        'Spec §1: the compiler is build-time only and must never reach browser runtime packages.',
      from: { path: '^packages/(gpu|three|react|react-three)/src' },
      to: { path: '^packages/compiler/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // Cross-package type imports resolve to packages/*/dist/*.d.ts. That is build
    // output, not source, and following it pads the graph with a second copy of
    // every module the rules are meant to be checking.
    exclude: { path: ['\\.astro$', '/dist/'] },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.d.ts'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
