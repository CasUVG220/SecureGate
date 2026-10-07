/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Integración y regresión necesitan Postgres real: van aparte (jest.integration.config.ts).
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/integration/', '/__tests__/regression/', '/__tests__/helpers/'],
  clearMocks: true,
};
