import { defineConfig } from 'vitest/config';

export default defineConfig(({ command, mode }) => {
  return {
    test: {
      alias: {
        '@': './src'
      },
      coverage: {
        provider: 'istanbul',
        reporter: [
          ['text'],
          ['html'],
          ['json', { 'file': 'coverage-summary.json' }],
        ]
      }
    },
    define: {
      __BUILD_TS__: '100000000'
    }
  };
});
