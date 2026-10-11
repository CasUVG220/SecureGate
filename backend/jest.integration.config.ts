import type { Config } from 'jest';

/**
 * Pruebas de integración (*.int.test.ts) y regresión (*.reg.test.ts) contra un
 * Postgres REAL y descartable (base *_test en localhost). Sin mocks de pg.
 * Se ejecutan con --runInBand (comparten una sola base) vía `npm run test:*`.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/integration/**/*.int.test.ts',
    '**/__tests__/regression/**/*.reg.test.ts',
  ],
  setupFiles: ['<rootDir>/src/__tests__/helpers/env.ts'],
  globalSetup: '<rootDir>/src/__tests__/helpers/globalSetup.ts',
  testTimeout: 30_000,
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: 'reports', classNameTemplate: '{classname}', titleTemplate: '{title}' }],
  ],
};

export default config;
