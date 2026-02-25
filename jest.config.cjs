module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs'],
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      isolatedModules: true,
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
