import type { Config } from "tailwindcss";

// Tailwind scans these files for class names so it can tree-shake unused CSS.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
