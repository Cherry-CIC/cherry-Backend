const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  modulePathIgnorePatterns: ["<rootDir>/dist"],
  setupFiles: ["<rootDir>/src/test/setupEnv.ts"],
  transform: {
    ...tsJestTransformCfg,
  },
};
