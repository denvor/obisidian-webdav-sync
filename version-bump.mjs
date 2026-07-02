const fs = require("fs");
const path = require("path");

const pluginId = "obsidian-webdav-sync";
const manifestPath = path.join(__dirname, "manifest.json");
const packagePath = path.join(__dirname, "package.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

// Read version from package.json, write to manifest.json
manifest.version = pkg.version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Bumped ${pluginId} to version ${pkg.version}`);
