import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // three.js / R3F code mutates scene objects, materials and refs by design (see r3f best practices:
  // mutate in useFrame, never setState). The React-Compiler purity/immutability rules don't model that.
  {
    files: ["components/game/**", "components/arena/**", "components/landing/VersusPreview.tsx"],
    rules: { "react-hooks/immutability": "off", "react-hooks/purity": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "refs/**", "public/vendor/**",
  ]),
]);

export default eslintConfig;
