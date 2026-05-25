import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    // Test reports (generated Playwright trace assets):
    "playwright-report/**",
    "test-results/**",
    // Third-party libraries copied to public:
    "public/pdf.mjs",
    "public/pdf.worker.min.mjs",
    ".claude/**",
  ]),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
]);

export default eslintConfig;
