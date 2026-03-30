module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        ...require('./tsconfig.json').compilerOptions,
        module: 'esnext'
      },
      diagnostics: {
        warnOnly: true
      }
    }],
    '^.+\\.m?js$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        ...require('./tsconfig.json').compilerOptions,
        module: 'esnext'
      }
    }]
  },
  transformIgnorePatterns: [
    'node_modules/(?!(chokidar|readdirp|uuid)/)'
  ],
  testPathIgnorePatterns: [
    '<rootDir>/src/server/__tests__/dynamic-router.test.mjs'
  ]
};
