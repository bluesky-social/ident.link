import { readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const name = "atproto-principal-binding";
// Deliberate allowlist: never recurse into account state, audit data or dependencies.
export const files = [
  "SKILL.md",
  "references/protocol.md",
  "scripts/package.json",
  "scripts/package-lock.json",
  "scripts/bind.mjs",
  "scripts/config.mjs",
  "scripts/page.mjs",
  "scripts/style.css",
  "scripts/fixtures.mjs",
  "scripts/binding.test.mjs",
  "scripts/config.test.mjs",
  "scripts/flow.test.mjs",
  "scripts/page.test.mjs",
];

function entry(path, bytes) {
  const header = Buffer.alloc(512);
  const field = (offset, width, value) =>
    header.write(value, offset, width, "utf8");
  const octal = (offset, width, value) =>
    field(offset, width, value.toString(8).padStart(width - 1, "0") + "\0");
  if (Buffer.byteLength(path) > 100) throw new Error("Archive path too long");
  field(0, 100, path);
  octal(100, 8, 0o644);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, bytes.length);
  octal(136, 12, 0);
  header.fill(0x20, 148, 156);
  field(156, 1, "0");
  field(257, 6, "ustar\0");
  field(263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  field(148, 8, checksum.toString(8).padStart(6, "0") + "\0 ");
  return Buffer.concat([
    header,
    bytes,
    Buffer.alloc((512 - (bytes.length % 512)) % 512),
  ]);
}

export async function packageSkill() {
  const entries = [];
  for (const path of files) {
    const source = join(root, "skills", name, path);
    if (!(await lstat(source)).isFile())
      throw new Error("Only regular source files may be packaged");
    const bytes = await readFile(source);
    const publicPath = join(root, "public", "skills", name, path);
    await mkdir(dirname(publicPath), { recursive: true });
    await writeFile(publicPath, bytes);
    entries.push(entry(`${name}/${path}`, bytes));
  }
  const archive = gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
  const destination = join(root, "public", "downloads", `${name}.tar.gz`);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, archive);
  console.log(`Packaged ${files.length} source files for ${name}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await packageSkill();
