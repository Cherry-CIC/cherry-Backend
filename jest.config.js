const { createDefaultPreset } = require("ts-jest");

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    ...tsJestTransformCfg,
  },
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    "src/modules/order/tests/exportRoutes.test.ts",
    "src/modules/products/tests/productRoutes.test.ts",
  ],
};
