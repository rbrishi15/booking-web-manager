import { access, cp, readdir, rm } from "node:fs/promises";

const source = new URL("../storybook-static/", import.meta.url);
const destination = new URL("../public/storybook/", import.meta.url);

// Do not discard an existing preview unless the new build completed successfully.
await access(new URL("index.html", source));
await access(new URL("iframe.html", source));
await access(new URL("index.json", source));
if ((await readdir(source)).includes("storybook")) {
  throw new Error("Storybook contains a nested build. Disable Vite publicDir copying before staging.");
}
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });

console.info("Staged static Storybook at public/storybook for /storybook.");
