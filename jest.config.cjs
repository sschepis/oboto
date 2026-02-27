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
        module: 'esnext',
        isolatedModules: true
      },
      diagnostics: {
        warnOnly: true
      }
    }],
    '^.+\\.m?js$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      useESM: true,
      isolatedModules: true
    }]
  },
  transformIgnorePatterns: [
    'node_modules/(?!(chokidar|readdirp)/)'
  ]
};
