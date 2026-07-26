import next from "eslint-config-next";

/**
 * `eslint-config-next` v16 ships a flat config array covering the Next.js and
 * TypeScript rule sets, so it is spread directly rather than bridged with FlatCompat.
 */
const config = [
  ...next,
  {
    ignores: [".next/**", "node_modules/**"],
  },
];

export default config;
